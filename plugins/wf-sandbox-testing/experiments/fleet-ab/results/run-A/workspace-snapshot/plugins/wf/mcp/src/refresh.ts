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

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveWorkspaceIdentity } from "./git-workspace.js";
import {
  CONSTITUTION_RELPATH,
  RESOLVER_GENERATOR,
  composeSessionStartStdout,
  evaluateFreshness,
  fsIO,
  joinSlash,
  normalizeSlashes,
  parseSessionSource,
  readSnapshot,
  resolveAndPersist,
  runPluginList,
  type StaleReason,
} from "./resolver/index.js";

function workspaceRoot(): string {
  const configured = process.env.WF_WORKSPACE_ROOT || process.cwd();
  return resolveWorkspaceIdentity(resolve(configured)).root;
}

/** Resolve the core `wf` plugin root — the anchor for locating a core skill's
 *  `interface.md` in the settings-validation pass. This bundle is
 *  `<coreRoot>/mcp/dist/refresh-if-stale.mjs`, so two directory levels up is the
 *  core plugin root; `WF_CORE_PLUGIN_ROOT` overrides it (tests / non-standard
 *  hosts). Mirrors ports.ts `resolveCorePluginRoot` without pulling in the
 *  service bundle. */
function corePluginRoot(): string {
  if (process.env.WF_CORE_PLUGIN_ROOT) {
    return normalizeSlashes(process.env.WF_CORE_PLUGIN_ROOT);
  }
  const here = fileURLToPath(import.meta.url); // .../plugins/wf/mcp/dist/refresh-if-stale.mjs
  return normalizeSlashes(resolve(dirname(here), "..", "..")); // .../plugins/wf
}

// Status logs go to STDERR (WF-334): stdout is the hook's JSON channel — it must
// carry ONLY the single SessionStart hook-output object (the constitution
// payload), never a plain-text log line, or the payload is unparseable.
function log(line: string): void {
  process.stderr.write(`wf-resolver refresh-if-stale: ${line}\n`);
}

/** Read the hook's stdin JSON (the SessionStart input carrying `source`), or
 *  `null` when unavailable — a TTY, no piped input, or a read error. Never
 *  blocks or throws; an absent source defaults to emitting the payload. */
function readStdin(): string | null {
  try {
    if (process.stdin.isTTY) return null;
    return readFileSync(0, "utf8");
  } catch {
    return null;
  }
}

/**
 * After the freshness pass, emit the project's composed constitution as the
 * SessionStart `hookSpecificOutput.additionalContext` (WF-334) — served from the
 * fingerprinted `_local/constitution.md` record (no un-fingerprinted raw read),
 * deduped across the four re-fire sources. stdout carries ONLY this single
 * hook-JSON object; nothing is written when there is no constitution record (a
 * non-wf repo, or a wf repo with no `/wf:constitution` run) or the re-fire is a
 * suppressed `resume`.
 */
function emitConstitution(root: string): void {
  const source = parseSessionSource(readStdin());
  const record = fsIO.readFile(joinSlash(root, CONSTITUTION_RELPATH));
  const stdout = composeSessionStartStdout(source, record);
  if (stdout !== null) {
    process.stdout.write(`${stdout}\n`);
  }
}

function refreshIfStale(root: string): void {
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
    resolveAndPersist({ workspaceRoot: root, corePluginRoot: corePluginRoot() });
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

  resolveAndPersist({ workspaceRoot: root, corePluginRoot: corePluginRoot() });
  log(`refreshed snapshot; reasons: ${reasons.map((r) => r.code).join(", ")}.`);
}

try {
  const root = workspaceRoot();
  refreshIfStale(root);
  // Emit the constitution AFTER the freshness pass, in its own try so a
  // composition/read hiccup never undoes the refresh or blocks the session — the
  // outer catch below preserves the always-exit-0 invariant (no payload that run,
  // and the query-time backstop still refreshes on the next typed query).
  emitConstitution(root);
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
