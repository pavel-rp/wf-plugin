// wf resolver — pre-MCP `refresh-if-stale` command (WF-271).
//
// This is the ONLY resolver lifecycle hook core declares: a SessionStart command
// that runs BEFORE the MCP server is up, so it uses the command/CLI adapter
// (filesystem + `claude plugin list --json`) rather than the in-session MCP
// tools. It reads the persisted snapshot and refreshes it iff a declared input
// changed, the schema/resolver version is incompatible, the cache is missing, or
// the cache is malformed — deterministic, fingerprint-driven, NEVER time-based.
//
// It is bundled to dist/refresh-if-stale.mjs (self-contained, no node_modules)
// so it launches with a bare `node`. It always exits 0: a resolver hiccup must
// never block a session — a stale snapshot is corrected by the query-time
// backstop on the next typed query regardless.

import {
  RESOLVER_GENERATOR,
  evaluateFreshness,
  fsIO,
  normalizeSlashes,
  readSnapshot,
  resolveAndPersist,
  runPluginList,
  type StaleReason,
} from "./resolver/index.js";

function workspaceRoot(): string {
  return normalizeSlashes(process.env.WF_WORKSPACE_ROOT || process.cwd());
}

function log(line: string): void {
  process.stdout.write(`wf-resolver refresh-if-stale: ${line}\n`);
}

function main(): void {
  const root = workspaceRoot();

  // Read the cache defensively: a missing file is `null`; an incompatible schema
  // or a malformed/torn file throws — both are treated as "must rebuild" rather
  // than surfaced, so a bad cache self-heals instead of blocking startup.
  let cached = null;
  let cacheReason: StaleReason | null = null;
  try {
    cached = readSnapshot(root);
    if (cached === null) {
      cacheReason = { code: "cache/absent", message: "no snapshot cached yet." };
    }
  } catch (err) {
    cacheReason = {
      code: "cache/unreadable",
      message: `cached snapshot is malformed or incompatible: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }

  if (cached === null) {
    resolveAndPersist({ workspaceRoot: root });
    log(`built snapshot (${cacheReason?.message ?? "no cache"}).`);
    return;
  }

  // Full validation including the plugin inventory (the CLI is available here,
  // pre-MCP). `runPluginList()` returns `null` when the CLI is unavailable — a
  // recorded absence the freshness check compares, never a fake empty inventory.
  const { fresh, reasons } = evaluateFreshness(cached, root, {
    readFile: (p) => fsIO.readFile(p),
    pluginListRaw: runPluginList(),
    generatorVersion: RESOLVER_GENERATOR.version,
  });

  if (fresh) {
    log("snapshot is fresh; no rebuild.");
    return;
  }

  resolveAndPersist({ workspaceRoot: root });
  log(`refreshed snapshot; reasons: ${reasons.map((r) => r.code).join(", ")}.`);
}

try {
  main();
} catch (err) {
  // Never block a session on a resolver failure; the query-time backstop will
  // still validate + refresh on the next typed query.
  process.stderr.write(
    `wf-resolver refresh-if-stale: skipped (${
      err instanceof Error ? err.message : String(err)
    }).\n`,
  );
}

process.exit(0);
