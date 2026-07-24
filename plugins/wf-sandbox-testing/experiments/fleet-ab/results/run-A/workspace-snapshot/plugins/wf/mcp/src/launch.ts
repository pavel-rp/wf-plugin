// wf resolver MCP runtime — launcher.
//
// This is the process entrypoint declared in plugins/wf/.mcp.json. It runs a
// single guard — the declared Node.js prerequisite — BEFORE any SDK code is
// evaluated, then hands off to the self-contained server bundle.
//
// The server bundle lives in a sibling file (dist/runtime.mjs) and is loaded
// via a dynamic import so its top-level module code (the MCP SDK) is only
// evaluated once the Node.js check has passed. This guarantees the diagnostic
// below reaches stderr even on an unsupported interpreter, instead of a raw
// syntax/feature crash from the SDK.

// Declared, explicit prerequisite: Node.js >= 20 (an active LTS floor). The MCP
// TypeScript SDK v2 itself declares engines.node ">=20"; the runtime pins the
// same floor.
const MIN_NODE_MAJOR = 20;

const currentVersion = process.versions.node;
const currentMajor = Number.parseInt(currentVersion.split(".")[0] ?? "", 10);

if (!Number.isInteger(currentMajor) || currentMajor < MIN_NODE_MAJOR) {
  process.stderr.write(
    `[wf-resolver] Unsupported Node.js ${currentVersion}: the wf resolver MCP ` +
      `runtime requires Node.js >=${MIN_NODE_MAJOR} on PATH. Install Node.js ` +
      `${MIN_NODE_MAJOR} or newer and restart Claude Code.\n`,
  );
  process.exit(1);
}

// Sibling bundle, resolved relative to this file so it works from any copied
// install location. Computed specifier → esbuild leaves it as a runtime import
// (it is NOT inlined into this launcher), preserving the deferred evaluation.
const runtimeUrl = new URL("./runtime.mjs", import.meta.url).href;

import(runtimeUrl).catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`[wf-resolver] Failed to start resolver runtime:\n${message}\n`);
  process.exit(1);
});
