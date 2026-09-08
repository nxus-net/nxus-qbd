#!/usr/bin/env node
/**
 * Installed-tarball smoke test.
 *
 * Packs the SDK, installs the tarball into a throwaway project, and imports
 * every entry point the `exports` map advertises using **plain node** — no
 * bundler, no vitest, no tsx.
 *
 * This exists because none of those three can see the defect it catches. The
 * package built cleanly, `tsc` was green and 114 unit tests passed while
 * `dist/index.js` re-exported `./client` with no file extension: vitest and tsx
 * resolve an extensionless relative specifier, and Node ESM does not. Consumers
 * got ERR_MODULE_NOT_FOUND before a single line of SDK code ran.
 *
 * A source-level test run cannot substitute for this. The only way to know the
 * published artifact loads is to install the published artifact and load it.
 *
 * Usage: node scripts/smoke-package.mjs
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));

// Every subpath the package advertises. A consumer can import any of these, so
// all of them are part of the contract.
const entryPoints = Object.keys(pkg.exports).map((subpath) =>
  subpath === "." ? pkg.name : `${pkg.name}/${subpath.replace(/^\.\//, "")}`,
);

// `shell` is needed for pnpm/npm on Windows (they are .cmd shims) but must
// stay off for node itself: cmd.exe strips the quotes off an inline -e script,
// which turned `import("nxus-qbd/models/qbd")` into a bare identifier and made
// this very check fail for a reason that had nothing to do with the package.
function run(command, args, cwd, { shell = process.platform === "win32" } = {}) {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell,
  });
}

const workDir = mkdtempSync(join(tmpdir(), "nxus-qbd-smoke-"));
let failed = false;

try {
  console.log(`[smoke] packing ${pkg.name}@${pkg.version}`);
  // `pnpm pack` prints the tarball path on the last non-empty line.
  const packOutput = run("pnpm", ["pack", "--pack-destination", workDir], packageRoot);
  const tarball = packOutput.trim().split(/\r?\n/).filter(Boolean).pop();
  console.log(`[smoke] tarball: ${tarball}`);

  writeFileSync(
    join(workDir, "package.json"),
    JSON.stringify({ name: "nxus-qbd-smoke", private: true, type: "module" }, null, 2),
  );

  // npm rather than pnpm: a plain `npm install <tarball>` produces the flat
  // node_modules layout a consumer gets, with no workspace or store linking
  // that might mask a resolution problem.
  console.log("[smoke] installing tarball with npm");
  run("npm", ["install", "--no-audit", "--no-fund", "--silent", tarball], workDir);

  const probe = join(workDir, "probe.mjs");
  for (const entry of entryPoints) {
    // Written to a file rather than passed with -e. An inline script has to
    // survive the shell, and on Windows cmd.exe strips its quotes — which
    // turned `import("nxus-qbd/models/qbd")` into a bare identifier and failed
    // this check for a reason that had nothing to do with the package.
    writeFileSync(
      probe,
      `const m = await import(${JSON.stringify(entry)});\n` +
        `console.log("OK   ${entry} ->", Object.keys(m).length, "runtime exports");\n`,
    );
    try {
      process.stdout.write(run("node", [probe], workDir, { shell: false }));
    } catch (error) {
      failed = true;
      const stderr = String(error.stderr ?? "");
      const reason =
        stderr.split("\n").find((line) => /Error/.test(line))?.trim() ??
        "import failed";
      process.stdout.write(`FAIL ${entry} -> ${reason}\n`);
    }
  }
} finally {
  rmSync(workDir, { recursive: true, force: true });
}

if (failed) {
  console.error(
    "\n[smoke] FAILED — the published package does not load in plain Node.\n" +
      "Relative specifiers in the emitted JavaScript must carry explicit file\n" +
      "extensions ('./client.js', './models/index.js'). tsconfig uses NodeNext\n" +
      "so the compiler enforces this; a failure here means something bypassed it.",
  );
  process.exit(1);
}

console.log(`\n[smoke] all ${entryPoints.length} advertised entry points load in plain Node.`);
