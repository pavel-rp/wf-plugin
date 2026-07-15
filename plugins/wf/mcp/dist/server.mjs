// src/launch.ts
var MIN_NODE_MAJOR = 20;
var currentVersion = process.versions.node;
var currentMajor = Number.parseInt(currentVersion.split(".")[0] ?? "", 10);
if (!Number.isInteger(currentMajor) || currentMajor < MIN_NODE_MAJOR) {
  process.stderr.write(
    `[wf-resolver] Unsupported Node.js ${currentVersion}: the wf resolver MCP runtime requires Node.js >=${MIN_NODE_MAJOR} on PATH. Install Node.js ${MIN_NODE_MAJOR} or newer and restart Claude Code.
`
  );
  process.exit(1);
}
var runtimeUrl = new URL("./runtime.mjs", import.meta.url).href;
import(runtimeUrl).catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`[wf-resolver] Failed to start resolver runtime:
${message}
`);
  process.exit(1);
});
