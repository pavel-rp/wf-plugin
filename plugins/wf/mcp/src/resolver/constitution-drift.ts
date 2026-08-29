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
//      project to re-compose a record the composer would refuse anyway — a remedy that
//      cannot succeed is worse than no remedy. So recognition is delegated to
//      `constitution-compose.ts`'s OWN helpers rather than reimplemented, and the gate
//      reproduces the composer's refusal set IN FULL: both section-heading pairs plus
//      the project-clauses boundary, each of the three orderings, and each of the two
//      "an unrecognized section sits between these headings" checks. Reproducing only
//      SOME of them is the subtle version of the same bug — the detector would call a
//      record current that the composer refuses, and the doc comment claiming otherwise
//      would be the only thing standing where the check should be.
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
  PROJECT_CLAUSES_HEADING,
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
 * `coreArticles` is the body to compare against. The caller owns the wording, so this
 * module reaches for no constant of its own and a caller holding article text from any
 * source can drive it.
 *
 * AN EMPTY BODY IS "NOTHING TO COMPARE AGAINST", NOT "THE RELEASE DEFINES NO ARTICLES".
 * The composer reads an empty `coreArticles` as ABSENT — leave the section alone — and
 * taking it here as a value instead would report every article in every record as
 * drift, telling a whole fleet of correct records they are stale. So it is the third
 * verdict, for the same reason any other unusable input is.
 */
export function detectCoreArticleDrift(
  current: string,
  coreArticles: readonly string[],
): CoreArticleDriftReport {
  const expected = meaningful(coreArticles);
  if (expected.length === 0) {
    return {
      verdict: "unrecognized",
      detail:
        "no core-article body was supplied to compare against, so neither drift nor currency is asserted; an empty body means ABSENT to the composer, never a claim that the running release defines no articles.",
    };
  }

  const lines = current.split("\n");

  // Recognition is the composer's, not a second opinion — and it is the composer's
  // WHOLE refusal set, not the convenient half of it (rule 3).
  const core = locateHeading(lines, CORE_ARTICLES_HEADING);
  if (!core.ok) return { verdict: "unrecognized", detail: core.detail };
  const articles = locateHeading(lines, CAPABILITY_ARTICLES_HEADING);
  if (!articles.ok) return { verdict: "unrecognized", detail: articles.detail };
  const clauses = locateHeading(lines, PROJECT_CLAUSES_HEADING);
  if (!clauses.ok) return { verdict: "unrecognized", detail: clauses.detail };

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
  // The remaining two guards do not bound the core section — they are what makes this
  // gate agree with the composer's. A record that fails either is one `/wf:constitution`
  // would refuse, so reporting it stale would emit a remedy that cannot succeed.
  if (clauses.index <= articles.index) {
    return {
      verdict: "unrecognized",
      detail: `the composed constitution record places \`${PROJECT_CLAUSES_HEADING}\` before \`${CAPABILITY_ARTICLES_HEADING}\`, which is not the structure a re-composition recognizes; neither drift nor currency is asserted, and the record is not modified.`,
    };
  }
  if (nextTopLevelHeading(lines, articles.index + 1) !== clauses.index) {
    return {
      verdict: "unrecognized",
      detail: `the composed constitution record carries an unrecognized section between \`${CAPABILITY_ARTICLES_HEADING}\` and \`${PROJECT_CLAUSES_HEADING}\`, which is not the structure a re-composition recognizes; neither drift nor currency is asserted, and the record is not modified.`,
    };
  }

  const observed = meaningful(lines.slice(core.index + 1, articles.index));
  if (sameSequence(observed, expected)) return { verdict: "current" };

  const { differences, unattributedLines } = attribute(observed, expected);
  return { verdict: "stale", differences, unattributedLines };
}

/**
 * Rendering caps, so the message is bounded in the record's size rather than linear
 * in it.
 *
 * THIS IS A RESOURCE BOUND, NOT COSMETICS. The rendered message is persisted into the
 * snapshot JSON and returned verbatim by every `resolve_inspect` call, and its inputs
 * are ids read out of a record this module does not control: an `unexpected` entry is
 * produced per record line matching the article shape, with an id of unbounded length.
 * Left unbounded, a large record amplifies straight into a large diagnostic that is
 * then written to disk and re-served on every query. The resolver already bounds its
 * other diagnostic sinks this way (`payloads.ts`'s per-count and per-byte caps,
 * `questions.ts`'s prompt-length cap); this keeps the new sink in line with them.
 *
 * The listing cap sits well above the nine articles the release defines, so a genuine
 * whole-section drift still names every one of them.
 */
const MAX_RENDERED_IDS = 20;
const MAX_RENDERED_ID_LENGTH = 64;

/** Render the id-by-id summary that names WHAT differs — the half of the success
 *  criterion a bare "you are stale" would miss, bounded per the caps above. */
function summarize(
  differences: readonly CoreArticleDifference[],
  unattributedLines: number,
): string {
  const clamp = (id: string): string =>
    id.length <= MAX_RENDERED_ID_LENGTH ? id : `${id.slice(0, MAX_RENDERED_ID_LENGTH)}…`;

  const parts: string[] = [];
  for (const state of ["changed", "absent", "unexpected"] as const) {
    const ids = differences.filter((entry) => entry.state === state).map((entry) => entry.id);
    if (ids.length === 0) continue;
    const shown = ids.slice(0, MAX_RENDERED_IDS).map(clamp).join(", ");
    const omitted = ids.length - MAX_RENDERED_IDS;
    parts.push(omitted > 0 ? `${shown} and ${omitted} more ${state}` : `${shown} ${state}`);
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
 * BOTH DIAGNOSTICS ARE DELIBERATELY ADVISORY, AND THE MECHANISM IS THE CODE PREFIX.
 * `isFailureSignal` (`failure.ts`) is true when a diagnostic's severity is `error` OR
 * when `categorizeCode` classifies its `code`. `categorizeCode` dispatches purely on
 * the code's prefix, and `constitution/` matches none of its families — so these stay
 * out of `resolve_gate`'s failure set, `healthy` is not flipped, and a delivery write
 * is not escalated from `continue` to `block`. The absent `category` field is a
 * CONSEQUENCE of that (it is only meaningful on a classified diagnostic), not the
 * guard itself: adding `category` to these literals would change nothing, and adding a
 * `constitution/` branch to `categorizeCode` would flip the gate no matter what this
 * comment said. The behaviour is pinned by an `isFailureSignal` assertion, not by the
 * field's absence.
 *
 * WHY ADVISORY IS THE RIGHT CALL. A composed constitution that trails the running
 * release is something the project should be TOLD, not a resolver failure that should
 * stop it committing; blocking every delivery write until someone re-composes would
 * make the honest signal something projects route around. Same reasoning as the
 * `ref-not-found` carve-out. The remedy rides in the message rather than in `recovery`,
 * which is only meaningful alongside a `category`.
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
