// wf resolver — pre-MCP `refresh-if-stale` command (WF-271, WF-334, WF-576).
//
// This is the ONLY resolver lifecycle hook core declares: a SessionStart command
// that runs BEFORE the MCP server is up, so it uses the command/CLI adapter
// (filesystem + `claude plugin list --json`) rather than the in-session MCP
// tools. It reads the persisted snapshot and refreshes it iff a declared input
// changed, the schema/resolver version is incompatible, the cache is missing, or
// the cache is malformed — deterministic, fingerprint-driven, NEVER time-based.
//
// After the freshness pass it injects the project's composed constitution into
// the session as `additionalContext`. The host caps each hook-output value at
// 10,000 characters, so the record travels in LABELLED PARTS: `hooks.json`
// declares `CONSTITUTION_PART_COUNT` SessionStart entries, each invoking this
// bundle with `--part <i>`, and every invocation emits at most the one part it
// is responsible for (a record that fits one part leaves the higher-indexed
// entries silent). ONLY PART 0 runs the freshness pass and any snapshot
// rebuild: the entries run in parallel, and concurrent rebuilds would race on
// the persisted snapshot. Parts ≥ 1 admit the root, read the record, emit
// their part, and do nothing else.
//
// It is bundled to dist/refresh-if-stale.mjs (self-contained, no node_modules)
// so it launches with a bare `node`. It always exits 0: a resolver hiccup must
// never block a session — a stale snapshot is corrected by the query-time
// backstop on the next typed query regardless.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { selectWorkspaceRoot, type AdmittedWorkspaceRoot } from "./workspace-admission.js";
import {
  CONSTITUTION_RELPATH,
  RESOLVER_GENERATOR,
  composeSessionStartStdout,
  constitutionOverage,
  constitutionOverageNote,
  evaluateFreshness,
  fsIO,
  joinSlash,
  normalizeSlashes,
  parseSessionSource,
  readSnapshot,
  resolveAndPersist,
  runPluginList,
  splitConstitution,
  type StaleReason,
} from "./resolver/index.js";

/** The part index this invocation is responsible for, from `--part <n>` on the
 *  command line. Absent, unparseable, or negative → 0, so the pre-split
 *  invocation shape (no argument) still behaves exactly as part 0. */
function partIndex(argv: readonly string[]): number {
  const at = argv.indexOf("--part");
  if (at === -1) return 0;
  const parsed = Number.parseInt(argv[at + 1] ?? "", 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

/** Select and admit this run's workspace root through the one resolver-owned
 *  API (WF-445). Pre-MCP there is no prior launch identity, so the admitted
 *  candidate IS the launch (`launch: null`) — canonicalize and identify, no
 *  family constraint. `??` rather than `||` is the whole point: `||` cannot
 *  tell an UNSET `WF_WORKSPACE_ROOT` (absent — fall through to cwd) from one
 *  set to the empty string (a blank DECLARATION — terminal, never cwd). */
function admittedRoot(): AdmittedWorkspaceRoot {
  return selectWorkspaceRoot(
    {
      explicit: null,
      environment: process.env.WF_WORKSPACE_ROOT ?? null,
      cwd: process.cwd(),
    },
    null,
  );
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
 * Emit ONE labelled part of the project's composed constitution as the
 * SessionStart `hookSpecificOutput.additionalContext` (WF-334, WF-576) — served
 * from the fingerprinted `_local/constitution.md` record (no un-fingerprinted
 * raw read), deduped across the four re-fire sources, and split under the
 * host's per-value output cap. stdout carries ONLY this single hook-JSON
 * object; nothing is written when there is no constitution record (a non-wf
 * repo, or a wf repo with no `/wf:constitution` run), the re-fire is a
 * suppressed `resume`, or `part` is past the record's last part (the entries a
 * small record leaves idle). A record over the ceiling is cut, and the part
 * carrying the diagnostic also logs it to stderr so the overage is visible
 * outside the injected context.
 */
function emitConstitution(root: string, part: number): void {
  const source = parseSessionSource(readStdin());
  const record = fsIO.readFile(joinSlash(root, CONSTITUTION_RELPATH));
  const stdout = composeSessionStartStdout(source, record, part);
  if (stdout !== null) {
    process.stdout.write(`${stdout}\n`);
    const overage = constitutionOverage(record);
    if (overage !== null && part === splitConstitution(record).length - 1) {
      log(constitutionOverageNote(overage.length, overage.ceiling));
    }
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
    readContainedFile: (capabilityRoot, selectedPath, maxBytes) =>
      fsIO.readContainedFile!(capabilityRoot, selectedPath, maxBytes),
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
  const part = partIndex(process.argv.slice(2));
  const admitted = admittedRoot();
  if (!admitted.ok) {
    // A DECLARED but unadmissible root is TERMINAL (WF-445): this run does no
    // work at all — no freshness pass, no snapshot rebuild, no constitution
    // payload, and nothing on stdout (stdout is the hook's JSON channel). It is
    // REPORTED on stderr rather than silently degrading to the current working
    // directory, which is the containment defect this replaced. Falling through
    // to the shared `process.exit(0)` below keeps the always-exit-0 invariant:
    // terminal for the refresh, never a blocked session. Every per-part entry
    // reaches this branch, so only part 0 reports it — once per session, not
    // once per part.
    if (part === 0) {
      log(
        `no work — ${admitted.source} workspace root rejected (${admitted.reason}): ${admitted.diagnostic}`,
      );
    }
  } else {
    // Only part 0 runs the freshness pass: the per-part hook entries run in
    // parallel, and a rebuild from more than one of them would race on the
    // persisted snapshot. Parts ≥ 1 read the record and emit their part only.
    if (part === 0) {
      try {
        refreshIfStale(admitted.root);
      } catch (err) {
        // A freshness-pass failure must not suppress THIS part's emission: the
        // other parts are independent processes that never run the pass, so
        // swallowing it here would inject a constitution missing part 1 of n.
        // Report it and fall through to emit; the query-time backstop still
        // validates + refreshes on the next typed query.
        log(
          `freshness pass skipped (${err instanceof Error ? err.message : String(err)}).`,
        );
      }
    }
    // Emit the constitution AFTER the freshness pass, in its own try so a
    // composition/read hiccup never undoes the refresh or blocks the session — the
    // outer catch below preserves the always-exit-0 invariant (no payload that run,
    // and the query-time backstop still refreshes on the next typed query).
    emitConstitution(admitted.root, part);
  }
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
