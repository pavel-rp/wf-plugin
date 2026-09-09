// wf resolver — SessionStart constitution injection (WF-334, WF-576).
//
// Pure composition + dedupe + splitting helpers for the `refresh-if-stale`
// SessionStart hook. The hook, after its freshness check/rebuild, emits the
// project's composed constitution as `hookSpecificOutput.additionalContext` so
// every wf session starts with the non-negotiable articles already in context.
//
// The host caps EACH hook-output value at 10,000 characters and replaces a
// larger one with a stub plus a short preview, so a record past that size would
// lose every article after the preview (WF-576). The cap is per value and the
// host delivers every parallel hook's `additionalContext`, so the record is
// injected as LABELLED PARTS: `hooks.json` declares one SessionStart entry per
// part index (`--part 0` … `--part N-1`), and each entry emits at most one part
// under `CONSTITUTION_PART_BUDGET`. A record that fits the budget still travels
// as today's single header-less payload, byte-identical to the pre-split shape.
//
// This module holds ZERO IO — the hook supplies the stdin string, the part index
// and the (already fingerprinted) `_local/constitution.md` content, and this
// decides what stdout to emit. That keeps the decision unit-testable and the
// hook a thin reader/emitter around the resolver's fingerprinted sources (never
// an un-fingerprinted raw read).

/** The hook-output `hookEventName` for a SessionStart hook (Claude Code schema). */
export const SESSION_START_EVENT = "SessionStart";

/** The composed constitution record, workspace-relative — a fingerprinted
 *  `constitution` source (see resolver/types.ts). */
export const CONSTITUTION_RELPATH = "_local/constitution.md";

/** The four SessionStart re-fire sources (Claude Code hook input `source`). */
export type SessionStartSource = "startup" | "resume" | "clear" | "compact";

// --- part contract ----------------------------------------------------------

/** The declared ceiling on the injected record, in JS string length (what the
 *  host counts). A longer record is cut here and the last part says so. */
export const CONSTITUTION_MAX_CHARS = 40000;

/** The per-part budget for one `additionalContext` value — header, body and
 *  any diagnostic included. Kept under the host's 10,000-character per-value
 *  cap with margin, so no part is ever replaced by the "output too large" stub. */
export const CONSTITUTION_PART_BUDGET = 9000;

/** The number of SessionStart hook entries `hooks.json` must declare. The hook
 *  list is static, so this is a BUILD-TIME constant derived from the ceiling and
 *  the budget rather than from the record at hand; `test/hooks.test.ts` locks
 *  the declared entries to it so the two can never drift apart. */
export const CONSTITUTION_PART_COUNT = Math.ceil(CONSTITUTION_MAX_CHARS / CONSTITUTION_PART_BUDGET);

/** Characters reserved in every multi-part payload for the part header (the
 *  longest is part 1's, which also carries the read-order sentence). */
export const CONSTITUTION_HEADER_RESERVE = 200;

/** Characters reserved on the last part for the over-ceiling diagnostic line. */
export const CONSTITUTION_DIAGNOSTIC_RESERVE = 200;

/** The body budget of one part once the header and diagnostic reserves are set
 *  aside — the chunk size the splitter packs to. Every multi-part payload is
 *  header + body (≤ this) + optional diagnostic, so it fits the part budget. */
export const CONSTITUTION_PART_USABLE =
  CONSTITUTION_PART_BUDGET - CONSTITUTION_HEADER_RESERVE - CONSTITUTION_DIAGNOSTIC_RESERVE;

/** The sentence part 1 of a multi-part record carries: parallel hooks deliver
 *  parts in no guaranteed order, so the reader is told to order them by label. */
export const CONSTITUTION_PART_ORDER_NOTE =
  "Parts may arrive in any order; read them in part order.";

/** The header line every part of a multi-part record starts with (1-based). */
export function constitutionPartHeader(index: number, count: number): string {
  const label = `wf constitution — part ${index + 1} of ${count}`;
  return index === 0 ? `${label}\n${CONSTITUTION_PART_ORDER_NOTE}\n\n` : `${label}\n\n`;
}

/** The diagnostic line appended to the last part of an over-ceiling record. */
export function constitutionOverageNote(length: number, ceiling: number): string {
  return `[wf constitution truncated: the record is ${length} characters and the SessionStart ceiling is ${ceiling} characters; the remainder is not injected.]`;
}

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
 *
 * The rule is per re-fire, not per part: every part of a multi-part record is
 * emitted or suppressed together.
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

/** Report a record that exceeds the ceiling — `{ length, ceiling }` when the
 *  trimmed record is longer than `CONSTITUTION_MAX_CHARS`, `null` at or below
 *  it. Shares the splitter's trim/threshold rule so the hook can log the same
 *  overage to stderr without re-implementing it. */
export function constitutionOverage(
  record: string | null,
): { length: number; ceiling: number } | null {
  return overageOfContext(composeConstitutionContext(record));
}

/** The overage rule on an already-composed (trimmed) context, so a caller that
 *  has composed once does not pay a second trimming pass. */
function overageOfContext(
  context: string | null,
): { length: number; ceiling: number } | null {
  if (context === null || context.length <= CONSTITUTION_MAX_CHARS) return null;
  return { length: context.length, ceiling: CONSTITUTION_MAX_CHARS };
}

/**
 * Cut `text` into at most `count` body chunks, each at most `usable` characters,
 * preferring line boundaries. For each chunk the cut is searched in the window
 * that keeps the remainder packable into the chunks still to come, so no chunk
 * ever overflows and the count never exceeds `ceil(len / usable)`; a cut is made
 * mid-line only when no newline falls inside that window — a single line longer
 * than it, or a record whose length is an exact multiple of `usable`, where any
 * shorter chunk would need one part more than the contract promises. The
 * newline at a line-boundary cut is dropped, so a chunk ends on a complete line
 * and the next one starts on a fresh one.
 */
function chunkBodies(text: string, usable: number, count: number): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const remainingChunks = count - chunks.length - 1;
    const remaining = text.length - start;
    if (remainingChunks <= 0 || remaining <= usable) {
      chunks.push(text.slice(start));
      break;
    }
    const maxEnd = start + usable;
    // The cut may not leave more than the later chunks can carry.
    const minEnd = Math.max(start + 1, text.length - remainingChunks * usable);
    const nl = text.lastIndexOf("\n", maxEnd);
    if (nl >= minEnd) {
      chunks.push(text.slice(start, nl));
      start = nl + 1;
    } else {
      chunks.push(text.slice(start, maxEnd));
      start = maxEnd;
    }
  }
  return chunks;
}

/**
 * Split the composed constitution record into the labelled parts the hook
 * emits, one per `additionalContext` value:
 *   - `null` / blank record → `[]` (nothing to inject);
 *   - trimmed record within `CONSTITUTION_PART_BUDGET` → ONE header-less part,
 *     byte-identical to the pre-split single payload;
 *   - otherwise the record (cut at `CONSTITUTION_MAX_CHARS` when longer) is
 *     packed into `ceil(len / CONSTITUTION_PART_USABLE)` parts on line
 *     boundaries, each prefixed with `wf constitution — part i of n` (part 1 also
 *     states the read order) and the last one carrying the over-ceiling
 *     diagnostic when a cut was applied. Every part's full text is at most
 *     `CONSTITUTION_PART_BUDGET`, and the count never exceeds
 *     `CONSTITUTION_PART_COUNT`.
 */
export function splitConstitution(record: string | null): string[] {
  const context = composeConstitutionContext(record);
  if (context === null) return [];
  if (context.length <= CONSTITUTION_PART_BUDGET) return [context];

  const overage = overageOfContext(context);
  const body = overage === null ? context : context.slice(0, CONSTITUTION_MAX_CHARS);
  const bodies = chunkBodies(
    body,
    CONSTITUTION_PART_USABLE,
    Math.ceil(body.length / CONSTITUTION_PART_USABLE),
  );
  const count = bodies.length;

  return bodies.map((chunk, i) => {
    const header = constitutionPartHeader(i, count);
    const tail =
      overage !== null && i === count - 1
        ? `\n\n${constitutionOverageNote(overage.length, overage.ceiling)}`
        : "";
    return `${header}${chunk}${tail}`;
  });
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
 * `source`, composed constitution `record` and `part` index: the single JSON
 * hook-output object carrying that part, or `null` to emit nothing on stdout —
 * a suppressed re-fire (`resume`), no constitution to inject, or a part index
 * past the record's last part (the hook entries past a small record's single
 * part). `part` defaults to 0 so the pre-split two-argument call is unchanged.
 * Pure: the hook wraps this with the IO (read stdin, read the fingerprinted
 * record, write stdout).
 */
export function composeSessionStartStdout(
  source: string | null | undefined,
  record: string | null,
  part = 0,
): string | null {
  if (!shouldEmitForSource(source)) return null;
  const parts = splitConstitution(record);
  if (!Number.isInteger(part) || part < 0 || part >= parts.length) return null;
  return JSON.stringify(sessionStartPayload(parts[part]));
}
