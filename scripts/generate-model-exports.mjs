import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const packageRoot = path.resolve(__dirname, '..');
// Module grouping is derived once, upstream, and shipped with the pinned spec.
// Never hand-edit spec/grouping.json — regenerate it with the root pipeline.
const groupingPath = path.join(packageRoot, 'spec', 'grouping.json');
const generatedTypesPath = path.join(packageRoot, 'src', 'generated', 'types.gen.ts');
const modelsRoot = path.join(packageRoot, 'src', 'models');

const packageNames = ['core', 'qbd'];

async function main() {
  await applyPublicBaseUrl();

  const generatedExports = await readGeneratedExports();
  const grouping = await readGrouping();
  const sharedSymbols = readSharedSymbols(grouping);

  await rm(modelsRoot, { recursive: true, force: true });
  await mkdir(modelsRoot, { recursive: true });

  for (const packageName of packageNames) {
    const modules = readPackageModules(grouping, packageName);
    const packageDir = path.join(modelsRoot, packageName);
    await mkdir(packageDir, { recursive: true });

    for (const moduleDef of modules) {
      const moduleContent = renderModuleFile(moduleDef.module, moduleDef.symbols, `../../generated`, generatedExports);
      await writeFile(path.join(packageDir, `${moduleDef.module}.ts`), moduleContent);
    }

    await writeFile(
      path.join(packageDir, 'index.ts'),
      renderPackageIndex(modules.map((moduleDef) => moduleDef.module)),
    );
  }

  await writeFile(path.join(modelsRoot, 'index.ts'), renderRootIndex(sharedSymbols, generatedExports));
}

// hey-api bakes the spec's servers[0].url into ClientOptions.baseUrl. The SDK
// resolves its real base URL at runtime (see src/config.ts resolveBaseUrl), so
// this constant is advertisement only — but generating from a dev server would
// still publish a dev host in the package. The pinned spec already declares the
// public URL; this covers generate:live / generate:local, which bypass it.
async function applyPublicBaseUrl() {
  const publicBaseUrl = process.env.OPENAPI_PUBLIC_BASE_URL || 'https://api.nx-us.net/';

  const content = await readFile(generatedTypesPath, 'utf8');
  const rewritten = content.replace(
    /(\bbaseUrl:\s*)('[^']+'|"[^"]+")(\s*\|\s*\(string\s*&\s*\{\}\);)/,
    `$1'${publicBaseUrl}'$3`,
  );

  if (rewritten === content) {
    throw new Error(`Could not locate ClientOptions.baseUrl in ${generatedTypesPath}`);
  }

  await writeFileWithRetry(generatedTypesPath, rewritten);
}

async function writeFileWithRetry(filePath, content) {
  const maxAttempts = 5;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await writeFile(filePath, content);
      return;
    } catch (error) {
      if (attempt === maxAttempts) {
        throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, 100 * attempt));
    }
  }
}

async function readGeneratedExports() {
  const exportMap = new Map();
  const content = await readFile(generatedTypesPath, 'utf8');

  for (const match of content.matchAll(/^export (type|enum) ([A-Za-z0-9_]+)/gm)) {
    exportMap.set(match[2], match[1] === 'enum' ? 'value' : 'type');
  }

  return exportMap;
}

async function readGrouping() {
  let content;
  try {
    content = await readFile(groupingPath, 'utf8');
  } catch (error) {
    throw new Error(
      `Could not read ${groupingPath}. It ships with the pinned spec — restore it from the repo or regenerate the spec artifacts.`,
      { cause: error },
    );
  }

  const grouping = JSON.parse(content);
  if (!grouping.schemas || typeof grouping.schemas !== 'object') {
    throw new Error(`${groupingPath} has no 'schemas' map — it is not a valid grouping artifact.`);
  }

  return grouping;
}

// Schemas are stored in sorted key order, so collecting them in iteration order
// keeps module members alphabetical without an extra sort.
function readPackageModules(grouping, packageName) {
  const byModule = new Map();

  for (const [symbol, placement] of Object.entries(grouping.schemas)) {
    if (placement.package !== packageName) {
      continue;
    }

    const existing = byModule.get(placement.module);
    if (existing) {
      existing.push(symbol);
    } else {
      byModule.set(placement.module, [symbol]);
    }
  }

  return [...byModule.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([module, symbols]) => ({ module, symbols }));
}

// `_shared` symbols carry an empty package — they are re-exported from the models root.
function readSharedSymbols(grouping) {
  const shared = Object.entries(grouping.schemas)
    .filter(([, placement]) => !placement.package)
    .map(([symbol]) => symbol);

  if (shared.length === 0) {
    throw new Error(`No shared symbols found in ${groupingPath}`);
  }

  return shared;
}

function renderModuleFile(moduleName, symbols, importPath, generatedExports) {
  const { availableSymbols, missingSymbols } = partitionAvailableSymbols(symbols, generatedExports);
  const { typeSymbols, valueSymbols } = classifySymbols(availableSymbols, generatedExports);
  const lines = [header()];

  if (valueSymbols.length > 0) {
    lines.push(`export { ${valueSymbols.join(', ')} } from '${importPath}';`);
  }

  if (typeSymbols.length > 0) {
    lines.push(`export type { ${typeSymbols.join(', ')} } from '${importPath}';`);
  }

  if (missingSymbols.length > 0) {
    console.warn(`[generate-model-exports] ${moduleName}: skipping ${missingSymbols.length} symbol(s) absent from generated schema: ${missingSymbols.join(', ')}`);
    lines.push(`// Not re-exported here because they are not present in src/generated/types.gen.ts: ${missingSymbols.join(', ')}`);
  }

  // Ensure the file is a module even when every symbol was filtered out.
  // Without an export, TypeScript treats the file as a script and the parent
  // `export * from './<module>'` fails with TS2306.
  if (valueSymbols.length === 0 && typeSymbols.length === 0) {
    lines.push('export {};');
  }

  return `${lines.join('\n')}\n`;
}

function renderPackageIndex(moduleNames) {
  const lines = [header()];
  for (const moduleName of moduleNames) {
    lines.push(`export * from './${moduleName}';`);
  }

  return `${lines.join('\n')}\n`;
}

function renderRootIndex(sharedSymbols, generatedExports) {
  const { availableSymbols, missingSymbols } = partitionAvailableSymbols(sharedSymbols, generatedExports);
  const lines = [
    header(),
    `import * as core from './core';`,
    `import * as qbd from './qbd';`,
    '',
    `export { core, qbd };`,
    `export * from './core';`,
    `export * from './qbd';`,
  ];

  const sharedExports = renderSplitExportBlock(availableSymbols, '../generated', generatedExports);
  if (sharedExports) {
    lines.push('', sharedExports);
  }

  if (missingSymbols.length > 0) {
    lines.push('', `// Not re-exported here because they are not present in src/generated/types.gen.ts: ${missingSymbols.join(', ')}`);
  }

  return `${lines.join('\n')}\n`;
}

function renderSplitExportBlock(symbols, importPath, generatedExports) {
  const { typeSymbols, valueSymbols } = classifySymbols(symbols, generatedExports);
  const lines = [];

  if (valueSymbols.length > 0) {
    lines.push(`export { ${valueSymbols.join(', ')} } from '${importPath}';`);
  }

  if (typeSymbols.length > 0) {
    lines.push(`export type { ${typeSymbols.join(', ')} } from '${importPath}';`);
  }

  return lines.join('\n');
}

function classifySymbols(symbols, generatedExports) {
  const { availableSymbols, missingSymbols } = partitionAvailableSymbols(symbols, generatedExports);
  if (missingSymbols.length > 0) {
    throw new Error(`Missing generated exports for symbols: ${missingSymbols.join(', ')}`);
  }

  const typeSymbols = [];
  const valueSymbols = [];

  for (const symbol of availableSymbols) {
    if (generatedExports.get(symbol) === 'value') {
      valueSymbols.push(symbol);
    } else {
      typeSymbols.push(symbol);
    }
  }

  return { typeSymbols, valueSymbols };
}

function partitionAvailableSymbols(symbols, generatedExports) {
  return {
    availableSymbols: symbols.filter((symbol) => generatedExports.has(symbol)),
    missingSymbols: symbols.filter((symbol) => !generatedExports.has(symbol)),
  };
}

function header() {
  return '// This file is auto-generated by scripts/generate-model-exports.mjs';
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
