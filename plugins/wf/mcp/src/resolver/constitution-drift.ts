// wf resolver — core-article drift detection over an already-composed record (WF-501).
//
// THE PROBLEM THIS EXISTS FOR. WF-492 made an amended core article REACHABLE: a
// re-composition now carries `constitution-core.ts`'s body into a record composed
// against an older release. It did not make the staleness VISIBLE. Until something
// re-composes, a record stays behind the release the project is running and nothing
// says so — which is how this repo's own composed record sat measurably stale for
// over a month with no one noticing. This module closes that half: it answers
// whether a record's core-article text is the running release's, and it answers it
// WITHOUT re-composing anything.
//
// FOUR RULES ARE CORRECTNESS, NOT PREFERENCE:
//
//   1. DETECTION NEVER MUTATES WHAT IT INSPECTS. A check that fixes what it finds is
//      a re-composition, and re-composition already exists and is separately gated.
//      That is enforced STRUCTURALLY rather than by discipline: this module takes a
//      string and returns a report. It is never handed a path, a writer, or an IO
//      port, so "it repaired the record" is not expressible here.
//
//   2. THE COMPARISON POINT IS DERIVED, NEVER STORED. The obvious alternative — record
//      a hash or a version stamp in the composed record and compare against it — fails
//      on the exact population this exists to serve. No already-composed record carries
//      such a stamp, so on the day it shipped every stale record would report "unknown"
//      instead of "stale", inverting the whole point. Worse, planting the stamp means
//      WRITING to the record, which is rule 1's forbidden act. Deriving instead compares
//      the record's rendered core section against the body the caller carries: no
//      migration, no persisted state, correct for a record composed by any past release,
//      and immune to the second failure mode where a stored stamp is itself stale while
//      the text is fine. Both sides are already in memory at check time.
//
//   3. AN UNRECOGNIZED STRUCTURE IS ITS OWN ANSWER — never "current", never "stale".
//      Guessing "current" on a document this code cannot parse is the silent-failure
//      mode the whole line of work exists to kill, and guessing "stale" would send a
//      project to re-compose a record the composer would refuse anyway. So recognition
//      is delegated to `constitution-compose.ts`'s OWN helpers rather than reimplemented:
//      a record the composer refuses is a record this module calls `unrecognized`, by
//      construction. Two copies of that predicate would let them disagree about the same
//      file, which is the two-copies-with-no-guard defect this module family closes.
//
//   4. ARTICLE TEXT IS COMPARED, NOT INTERPRETED. `constitution-core.ts` states that its
//      body is rendered text and not a parser target, and that holds here: nothing in
//      this module derives behaviour from what an article MEANS. The only thing read out
//      of a line is its `<provenance>.<n>` id, and only so a difference can be named
//      ("core.6 differs") instead of dumped as two walls of prose. That identity prefix
//      is the same one the shipped ceiling test parses, it is applied identically to both
//      sides of the comparison, and a wording change inside an article still simply reads
//      as a difference — never as a new behaviour.
//
// WHY BLANK LINES AND LINE ENDINGS ARE NOT DRIFT. The comparison runs over the section's
// MEANINGFUL lines — trailing whitespace and carriage returns stripped, blanks dropped.
// A record differing from the release only in blank-line layout or in CRLF-vs-LF is not
// behind the release on article text, and reporting drift for it would be a false positive
// that teaches readers to ignore the signal. Byte-identity is the COMPOSER's business
// (its rule 4, which governs whether a write happens); currency is this module's.

import type { Diagnostic } from "./types.js";
import { CORE_ARTICLES_HEADING } from "./constitution-core.js";
import {
  CAPABILITY_ARTICLES_HEADING,
  locateHeading,
  nextTopLevelHeading,
} from "./constitution-compose.js";

/** The composed record's core articles are behind the body the running release
 *  carries. A `warning`: the project is running on stated principles its record
 *  does not state. */
export const CORE_DRIFT_CODE = "constitution/core-drift";

/** The composed record's core-articles section could not be located unambiguously,
 *  so neither drift nor currency is asserted. An `info`: nothing is known to be
 *  wrong, and nothing is claimed to be right. */
export const CORE_UNRECOGNIZED_CODE = "constitution/core-unrecognized";

/** How one article differs.
 *
 *  `absent` — the running release defines this article and the record carries no
 *  line bearing its id (the ordinary shape of a record composed before the ids
 *  existed at all).
 *  `changed` — both carry the id; the text differs.
 *  `unexpected` — the record carries an article id the running release no longer
 *  defines, which is drift in the other direction and just as worth naming. */
export type CoreArticleDifferenceState = "absent" | "changed" | "unexpected";

export interface CoreArticleDifference {
  /** The `<provenance>.<n>` id, e.g. `core.6`. */
  id: string;
  state: CoreArticleDifferenceState;
}

/**
 * The three-way answer. There is deliberately no fourth state and no boolean: a
 * caller that cannot tell `unrecognized` from `current` is the defect (rule 3).
 */
export type CoreArticleDriftReport =
  | { verdict: "current" }
  | {
      verdict: "stale";
      /** Named, id-by-id. Can legitimately be empty when the sections differ only
       *  in ordering or in unattributable content — `unattributedLines` and the
       *  composed message carry that case rather than pretending nothing differs. */
      differences: readonly CoreArticleDifference[];
      /** Meaningful lines in the record's core section bearing no recognizable
       *  article id — reported as one count rather than one noisy entry per line,
       *  because a pre-id record makes EVERY line unattributable and a per-line
       *  dump would bury the nine differences that matter. */
      unattributedLines: number;
    }
  | { verdict: "unrecognized"; detail: string };

/** The rendered article shape both sides use: `- **<id> — <title>.** <body>`.
 *  Anchored and deliberately narrow — a line that is not an article bullet yields
 *  `null` and is counted as unattributed rather than half-parsed. */
const ARTICLE_ID = /^- \*\*([^*\s]+)\s+—\s/;

function articleId(line: string): string | null {
  const matched = ARTICLE_ID.exec(line);
  return matched === null ? null : matched[1];
}

/** The lines that carry meaning: carriage returns and trailing whitespace stripped,
 *  blanks dropped. See the header — layout and line endings are not drift. */
function meaningful(lines: readonly string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    const trimmed = line.replace(/\r$/, "").trimEnd();
    if (trimmed.length > 0) out.push(trimmed);
  }
  return out;
}

function sameSequence(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

/** Attribute the difference between two meaningful-line sequences, id by id. */
function attribute(
  observed: readonly string[],
  expected: readonly string[],
): { differences: CoreArticleDifference[]; unattributedLines: number } {
  const expectedById = new Map<string, string>();
  for (const line of expected) {
    const id = articleId(line);
    if (id !== null) expectedById.set(id, line);
  }

  const observedById = new Map<string, string>();
  let unattributedLines = 0;
  for (const line of observed) {
    const id = articleId(line);
    if (id === null) {
      unattributedLines += 1;
      continue;
    }
    observedById.set(id, line);
  }

  const differences: CoreArticleDifference[] = [];
  // Release-side first, in the release's own order, so the report reads in the
  // order a human would look the articles up.
  for (const [id, line] of expectedById) {
    const seen = observedById.get(id);
    if (seen === undefined) differences.push({ id, state: "absent" });
    else if (seen !== line) differences.push({ id, state: "changed" });
  }
  for (const id of observedById.keys()) {
    if (!expectedById.has(id)) differences.push({ id, state: "unexpected" });
  }

  return { differences, unattributedLines };
}

/**
 * Decide whether `current`'s core-articles section is the article text the running
 * release carries.
 *
 * Pure: identical inputs always produce a deep-equal result, no input is mutated,
 * and no byte is read or written anywhere.
 *
 * `coreArticles` is the body to compare against — supplied by the caller exactly as
 * `composeConstitutionRecord` takes it, so this module reaches for no constant of
 * its own and a caller holding article text from any source can drive it.
 */
export function detectCoreArticleDrift(
  current: string,
  coreArticles: readonly string[],
): CoreArticleDriftReport {
  const lines = current.split("\n");

  // Recognition is the composer's, not a second opinion (rule 3).
  const core = locateHeading(lines, CORE_ARTICLES_HEADING);
  if (!core.ok) return { verdict: "unrecognized", detail: core.detail };
  const articles = locateHeading(lines, CAPABILITY_ARTICLES_HEADING);
  if (!articles.ok) return { verdict: "unrecognized", detail: articles.detail };

  if (core.index >= articles.index) {
    return {
      verdict: "unrecognized",
      detail: `the composed constitution record places \`${CORE_ARTICLES_HEADING}\` at or after \`${CAPABILITY_ARTICLES_HEADING}\`, so its core section cannot be located; neither drift nor currency is asserted, and the record is not modified.`,
    };
  }
  if (nextTopLevelHeading(lines, core.index + 1) !== articles.index) {
    return {
      verdict: "unrecognized",
      detail: `the composed constitution record carries an unrecognized section between \`${CORE_ARTICLES_HEADING}\` and \`${CAPABILITY_ARTICLES_HEADING}\`, so its core section cannot be delimited; neither drift nor currency is asserted, and the record is not modified.`,
    };
  }

  const observed = meaningful(lines.slice(core.index + 1, articles.index));
  const expected = meaningful(coreArticles);
  if (sameSequence(observed, expected)) return { verdict: "current" };

  const { differences, unattributedLines } = attribute(observed, expected);
  return { verdict: "stale", differences, unattributedLines };
}

/** Render the id-by-id summary that names WHAT differs — the half of the success
 *  criterion a bare "you are stale" would miss. */
function summarize(
  differences: readonly CoreArticleDifference[],
  unattributedLines: number,
): string {
  const parts: string[] = [];
  for (const state of ["changed", "absent", "unexpected"] as const) {
    const ids = differences.filter((entry) => entry.state === state).map((entry) => entry.id);
    if (ids.length > 0) parts.push(`${ids.join(", ")} ${state}`);
  }
  if (unattributedLines > 0) {
    parts.push(`${unattributedLines} record line(s) carrying no recognized article id`);
  }
  if (parts.length === 0) {
    // Every article the release defines is present and unchanged, yet the sections
    // are not the same sequence — so what differs is order or arrangement. Say that,
    // rather than emitting a difference list that would read as "nothing differs".
    return "the section's article order or arrangement differs, though every article the release defines is present unchanged";
  }
  return parts.join("; ");
}

/**
 * Map a report onto the single resolution diagnostic it warrants, or `null` when
 * there is nothing to report.
 *
 * NEITHER DIAGNOSTIC CARRIES A `category`, AND THAT IS THE DECISION, NOT AN OMISSION.
 * `failure.ts` makes `isFailureSignal` true for any categorized diagnostic, which
 * flips `resolve_gate.healthy` and escalates a delivery write from `continue` to
 * `block`. A composed constitution that trails the running release is a thing the
 * project should be TOLD, not a resolver failure that should stop it committing —
 * and blocking every delivery write until someone re-composes would make the honest
 * signal something projects route around. So these stay advisory: visible on
 * `resolve_inspect`, inert at the gate. This is the same carve-out `ref-not-found`
 * documents for the same reason. The remedy rides in the message instead of in
 * `recovery`, which is only meaningful alongside a `category`.
 */
export function coreArticleDriftDiagnostic(report: CoreArticleDriftReport): Diagnostic | null {
  if (report.verdict === "current") return null;
  if (report.verdict === "unrecognized") {
    return {
      severity: "info",
      code: CORE_UNRECOGNIZED_CODE,
      message: `the composed constitution's core-article currency could not be determined: ${report.detail}`,
    };
  }
  return {
    severity: "warning",
    code: CORE_DRIFT_CODE,
    message: `the composed constitution's core articles are behind the running release — ${summarize(report.differences, report.unattributedLines)}. This check does not modify the record; re-compose it with \`/wf:constitution\` to carry the current articles.`,
  };
}
