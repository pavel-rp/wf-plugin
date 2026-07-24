// wf resolver — SessionStart constitution injection (WF-334).
//
// Pure composition + dedupe helpers for the `refresh-if-stale` SessionStart hook.
// The hook, after its freshness check/rebuild, emits the project's composed
// constitution as `hookSpecificOutput.additionalContext` so every wf session
// starts with the non-negotiable articles already in context. This module holds
// ZERO IO — the hook supplies the stdin string and the (already fingerprinted)
// `_local/constitution.md` content, and this decides what stdout to emit. That
// keeps the decision unit-testable and the hook a thin reader/emitter around the
// resolver's fingerprinted sources (never an un-fingerprinted raw read).

/** The hook-output `hookEventName` for a SessionStart hook (Claude Code schema). */
export const SESSION_START_EVENT = "SessionStart";

/** The composed constitution record, workspace-relative — a fingerprinted
 *  `constitution` source (see resolver/types.ts). */
export const CONSTITUTION_RELPATH = "_local/constitution.md";

/** The four SessionStart re-fire sources (Claude Code hook input `source`). */
export type SessionStartSource = "startup" | "resume" | "clear" | "compact";

/**
 * Decide whether this SessionStart re-fire must carry the constitution payload.
 *
 * The payload is injected into context, so the rule is purely about whether the
 * current context already holds a prior copy:
 *   - `startup` / `clear` — a fresh (empty) context → EMIT.
 *   - `compact` — compaction summarizes the prior injected copy away → EMIT, so
 *     the constitution survives compaction (one copy restored, not lost).
 *   - `resume` — the resumed context still holds the copy injected at its
 *     original startup → SUPPRESS, so there is no double-injection.
 *
 * Across a startup→resume→compact sequence this yields exactly one copy present
 * at every point (startup adds it, resume keeps it, compact restores it) — never
 * zero (survives compaction), never two (no double-injection).
 *
 * An absent/unknown source defaults to EMIT: a missing payload is worse than a
 * possible duplicate, and the hook's never-block invariant favors presence.
 */
export function shouldEmitForSource(source: string | null | undefined): boolean {
  return source !== "resume";
}

/** Extract the SessionStart `source` from the hook's stdin JSON, defensively.
 *  Any parse failure or missing/ill-typed field yields `null` (→ emit by
 *  default), so a malformed or absent hook input never blocks or throws. */
export function parseSessionSource(stdin: string | null | undefined): string | null {
  if (!stdin) return null;
  try {
    const obj = JSON.parse(stdin) as { source?: unknown };
    return typeof obj.source === "string" ? obj.source : null;
  } catch {
    return null;
  }
}

/** Normalize the composed constitution record into the `additionalContext`
 *  string, or `null` when there is nothing to inject — an absent record (a
 *  non-wf repo, or a wf repo with no `/wf:constitution` run yet) or an
 *  empty/whitespace-only one produces no payload. */
export function composeConstitutionContext(record: string | null): string | null {
  if (record === null) return null;
  const trimmed = record.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** The SessionStart hook-output object that injects `context` as additionalContext. */
export function sessionStartPayload(context: string): {
  hookSpecificOutput: {
    hookEventName: typeof SESSION_START_EVENT;
    additionalContext: string;
  };
} {
  return {
    hookSpecificOutput: {
      hookEventName: SESSION_START_EVENT,
      additionalContext: context,
    },
  };
}

/**
 * Compose the exact stdout the SessionStart hook should emit for a given re-fire
 * `source` and composed constitution `record`: the single JSON hook-output
 * object, or `null` to emit nothing on stdout — a suppressed re-fire (`resume`),
 * or no constitution to inject. Pure: the hook wraps this with the IO (read
 * stdin, read the fingerprinted record, write stdout).
 */
export function composeSessionStartStdout(
  source: string | null | undefined,
  record: string | null,
): string | null {
  if (!shouldEmitForSource(source)) return null;
  const context = composeConstitutionContext(record);
  if (context === null) return null;
  return JSON.stringify(sessionStartPayload(context));
}
