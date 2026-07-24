// Contract-test runner for the wf resolver engine.
//
// The workspace ships no TypeScript toolchain at production time (esbuild does
// type-erasure, not type-checking), and CI pins Node 20 which cannot execute TS
// directly. So this runner bundles each test/*.test.ts (with the src it imports)
// into a throwaway dir via the already-pinned esbuild, then runs them under
// Node's built-in test runner (`node:test`). No new dependency is introduced.
//
// Fixtures are located at runtime via WF_MCP_DIR (the package dir), which this
// runner sets, so a test works regardless of the cwd it is launched from.

import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const pkgDir = join(scriptDir, "..");
const testDir = join(pkgDir, "test");

const entries = (await readdir(testDir)).filter((f) => f.endsWith(".test.ts"));
if (entries.length === 0) {
  process.stdout.write("No resolver contract tests found (test/*.test.ts).\n");
  process.exit(0);
}

const outDir = await mkdtemp(join(tmpdir(), "wf-resolver-test-"));
let exitCode = 0;
try {
  await build({
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node20",
    logLevel: "silent",
    entryPoints: entries.map((f) => join(testDir, f)),
    outdir: outDir,
    outExtension: { ".js": ".mjs" },
  });

  const builtFiles = (await readdir(outDir))
    .filter((f) => f.endsWith(".mjs"))
    .map((f) => join(outDir, f));

  const result = spawnSync(process.execPath, ["--test", ...builtFiles], {
    stdio: "inherit",
    env: { ...process.env, WF_MCP_DIR: pkgDir },
  });
  exitCode = result.status ?? 1;
} finally {
  await rm(outDir, { recursive: true, force: true });
}

process.exit(exitCode);
