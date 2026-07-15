// Reproducible bundle build for the wf resolver MCP runtime.
//
// Produces two committed artifacts under dist/ from the checked-in TypeScript:
//   - runtime.mjs : the MCP server with every dependency inlined (self-contained)
//   - server.mjs  : the tiny launcher (Node-version guard + dynamic import of runtime.mjs)
//
// esbuild output is deterministic for a fixed esbuild version + inputs, so the
// same TS source + pinned lockfile always yield byte-identical bundles. That is
// what scripts/verify-bundle.mjs relies on to detect a stale committed bundle.

import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdir } from "node:fs/promises";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const pkgDir = join(scriptDir, "..");

const COMMON = {
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  legalComments: "none",
  logLevel: "silent",
};

/**
 * Build both bundles into `outDir`. Returns the list of output filenames.
 * @param {string} outDir
 */
export async function buildBundle(outDir) {
  await mkdir(outDir, { recursive: true });

  // The self-contained server: bundle the SDK + zod + core into one file.
  await build({
    ...COMMON,
    entryPoints: [join(pkgDir, "src/index.ts")],
    outfile: join(outDir, "runtime.mjs"),
  });

  // The launcher: nothing external to bundle. It references ./runtime.mjs via a
  // computed URL, so esbuild leaves that as a runtime dynamic import.
  await build({
    ...COMMON,
    entryPoints: [join(pkgDir, "src/launch.ts")],
    outfile: join(outDir, "server.mjs"),
  });

  return ["runtime.mjs", "server.mjs"];
}

// Direct invocation (`npm run build`) writes the committed dist/.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const outputs = await buildBundle(join(pkgDir, "dist"));
  process.stdout.write(`Built ${outputs.join(", ")} into dist/\n`);
}
