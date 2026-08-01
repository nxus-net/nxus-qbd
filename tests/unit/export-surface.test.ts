import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import * as modelsRoot from "../../src/models";
import * as modelsCore from "../../src/models/core";
import * as modelsQbd from "../../src/models/qbd";

/**
 * Locks the public export surface of the four entry points declared in
 * package.json `exports`: ".", "./models", "./models/core", "./models/qbd".
 * Those are the only paths a consumer can import, so they are the contract.
 *
 * This exists so the generated model layout can be restructured — split into
 * per-module declaration files, say — and proven not to change what anyone
 * can import. Types are erased at runtime, so the type surface is read with
 * the TypeScript checker; enums are the only generated exports that survive
 * into JavaScript, so those are additionally checked as runtime values.
 *
 * Refresh after an intentional surface change:
 *   UPDATE_EXPORT_SNAPSHOT=1 pnpm exec vitest run export-surface --pool=threads
 * The resulting diff is the review — an unexplained addition or removal here
 * is a breaking change to consumers.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "..", "..");
const snapshotPath = path.join(__dirname, "export-surface.snapshot.json");

const entryPoints = {
  ".": "src/index.ts",
  "./models": "src/models/index.ts",
  "./models/core": "src/models/core/index.ts",
  "./models/qbd": "src/models/qbd/index.ts",
} as const;

function readTypeSurface(): Record<string, string[]> {
  const rootNames = Object.values(entryPoints).map((p) => path.join(packageRoot, p));
  const configPath = ts.findConfigFile(packageRoot, ts.sys.fileExists, "tsconfig.json");
  if (!configPath) {
    throw new Error("tsconfig.json not found");
  }

  const parsed = ts.parseJsonConfigFileContent(
    ts.readConfigFile(configPath, ts.sys.readFile).config,
    ts.sys,
    packageRoot,
  );
  const program = ts.createProgram(rootNames, { ...parsed.options, noEmit: true });
  const checker = program.getTypeChecker();

  const surface: Record<string, string[]> = {};
  for (const [subpath, relative] of Object.entries(entryPoints)) {
    const sourceFile = program.getSourceFile(path.join(packageRoot, relative));
    if (!sourceFile) {
      throw new Error(`Entry point not in program: ${relative}`);
    }

    const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
    if (!moduleSymbol) {
      throw new Error(`${relative} is not a module`);
    }

    surface[subpath] = checker
      .getExportsOfModule(moduleSymbol)
      .map((symbol) => symbol.getName())
      .sort();
  }

  return surface;
}

// Enums are the only generated exports that emit JavaScript. If a restructure
// ever turned one into a type alias it would vanish at runtime while still
// type-checking, and `AccountType.BANK` would break for consumers only at
// runtime — so record the members, not just the names.
function readEnumRuntime(): Record<string, Record<string, string>> {
  const namespaces: Record<string, unknown> = {
    ...modelsRoot,
    ...modelsCore,
    ...modelsQbd,
  };

  const enums: Record<string, Record<string, string>> = {};
  for (const [name, value] of Object.entries(namespaces)) {
    if (value === null || typeof value !== "object") continue;
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) continue;
    if (!entries.every(([, member]) => typeof member === "string")) continue;
    enums[name] = Object.fromEntries(entries.sort(([a], [b]) => (a < b ? -1 : 1))) as Record<
      string,
      string
    >;
  }

  return enums;
}

describe("public export surface", () => {
  it("matches the committed snapshot", { timeout: 120_000 }, () => {
    const actual = { types: readTypeSurface(), enums: readEnumRuntime() };

    if (process.env.UPDATE_EXPORT_SNAPSHOT) {
      writeFileSync(snapshotPath, `${JSON.stringify(actual, null, 2)}\n`, "utf8");
    }

    const expected = JSON.parse(readFileSync(snapshotPath, "utf8"));

    // Compared per entry point so a failure names the subpath that moved.
    for (const subpath of Object.keys(entryPoints)) {
      expect(actual.types[subpath], `type exports of "${subpath}"`).toEqual(
        expected.types[subpath],
      );
    }
    expect(actual.enums, "runtime enum exports").toEqual(expected.enums);
  });

  it("re-exports every model subpath from the models root", () => {
    const rootNames = new Set(Object.keys(modelsRoot));
    for (const name of [...Object.keys(modelsCore), ...Object.keys(modelsQbd)]) {
      expect(rootNames.has(name), `${name} missing from src/models`).toBe(true);
    }
  });
});
