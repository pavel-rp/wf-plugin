// Stale-bundle guard for the wf resolver MCP runtime.
//
// Rebuilds the bundle from the checked-in TypeScript into a throwaway directory
// and compares it byte-for-byte against the committed dist/. A mismatch means
// the committed bundle no longer corresponds to the source + pinned lockfile —
// verification FAILS (exit 1) so a stale bundle can never merge.
//
// This does NOT touch the committed dist/. Run `npm ci` first so the build sees
// the exact pinned dependency tree.

import { buildBundle } from "./build.mjs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const pkgDir = join(scriptDir, "..");
const committedDir = join(pkgDir, "dist");

/** @param {string} path */
async function sha256(path) {
  const bytes = await readFile(path);
  return createHash("sha256").update(bytes).digest("hex");
}

const tempDir = await mkdtemp(join(tmpdir(), "wf-resolver-verify-"));
let failed = false;
try {
  const outputs = await buildBundle(tempDir);
  for (const name of outputs) {
    let committedHash;
    try {
      committedHash = await sha256(join(committedDir, name));
    } catch {
      process.stderr.write(
        `STALE: committed dist/${name} is missing. Run \`npm run build\` and commit dist/.\n`,
      );
      failed = true;
      continue;
    }
    const freshHash = await sha256(join(tempDir, name));
    if (committedHash !== freshHash) {
      process.stderr.write(
        `STALE: committed dist/${name} (${committedHash.slice(0, 12)}) does not match a ` +
          `rebuild from src + lockfile (${freshHash.slice(0, 12)}). Run \`npm run build\` and commit dist/.\n`,
      );
      failed = true;
    } else {
      process.stdout.write(`OK: dist/${name} matches rebuild (${freshHash.slice(0, 12)}).\n`);
    }
  }
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

if (failed) {
  process.exit(1);
}
process.stdout.write("Bundle is reproducible and up to date.\n");
