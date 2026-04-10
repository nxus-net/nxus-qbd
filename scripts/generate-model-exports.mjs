import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const packageRoot = path.resolve(__dirname, '..');
const pythonModelsRoot = path.resolve(packageRoot, '..', 'nxus-qbd-python', 'nxus_qbd', 'models');
const generatedTypesPath = path.join(packageRoot, 'src', 'generated', 'types.gen.ts');
const modelsRoot = path.join(packageRoot, 'src', 'models');

const packageNames = ['core', 'qbd'];

async function main() {
  const generatedExports = await readGeneratedExports();
  const sharedSymbols = await readSharedSymbols();

  await rm(modelsRoot, { recursive: true, force: true });
  await mkdir(modelsRoot, { recursive: true });

  for (const packageName of packageNames) {
    const modules = await readPythonPackageModules(packageName);
    const packageDir = path.join(modelsRoot, packageName);
    await mkdir(packageDir, { recursive: true });

    for (const moduleDef of modules) {
      const moduleContent = renderModuleFile(moduleDef.symbols, `../../generated`, generatedExports);
      await writeFile(path.join(packageDir, `${moduleDef.module}.ts`), moduleContent);
    }

    await writeFile(
      path.join(packageDir, 'index.ts'),
      renderPackageIndex(modules.map((moduleDef) => moduleDef.module)),
    );
  }

  await writeFile(path.join(modelsRoot, 'index.ts'), renderRootIndex(sharedSymbols, generatedExports));
}

async function readGeneratedExports() {
  const exportMap = new Map();
  const content = await readFile(generatedTypesPath, 'utf8');

  for (const match of content.matchAll(/^export (type|enum) ([A-Za-z0-9_]+)/gm)) {
    exportMap.set(match[2], match[1] === 'enum' ? 'value' : 'type');
  }

  return exportMap;
}

async function readPythonPackageModules(packageName) {
  const initPath = path.join(pythonModelsRoot, packageName, '__init__.py');
  const content = await readFile(initPath, 'utf8');

  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('from .'))
    .map((line) => {
      const match = line.match(/^from \.(?<module>[a-z0-9_]+) import (?<symbols>.+)$/);
      if (!match?.groups) {
        throw new Error(`Could not parse module export line in ${initPath}: ${line}`);
      }

      return {
        module: match.groups.module,
        symbols: match.groups.symbols.split(',').map((symbol) => symbol.trim()).filter(Boolean),
      };
    });
}

async function readSharedSymbols() {
  const initPath = path.join(pythonModelsRoot, '__init__.py');
  const content = await readFile(initPath, 'utf8');
  const sharedLine = content
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.startsWith('from ._shared import '));

  if (!sharedLine) {
    throw new Error(`Could not locate shared model export line in ${initPath}`);
  }

  return sharedLine
    .replace('from ._shared import ', '')
    .split(',')
    .map((symbol) => symbol.trim())
    .filter(Boolean);
}

function renderModuleFile(symbols, importPath, generatedExports) {
  const { typeSymbols, valueSymbols } = classifySymbols(symbols, generatedExports);
  const lines = [header()];

  if (valueSymbols.length > 0) {
    lines.push(`export { ${valueSymbols.join(', ')} } from '${importPath}';`);
  }

  if (typeSymbols.length > 0) {
    lines.push(`export type { ${typeSymbols.join(', ')} } from '${importPath}';`);
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
