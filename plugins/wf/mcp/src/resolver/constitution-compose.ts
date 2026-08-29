// wf resolver — the pure composed-constitution renderer (WF-455).
//
// The DECISION half of the constitution target, held to exactly the discipline
// `apply-install.ts` and `apply-targets.ts` hold: deterministic, body-free, and
// side-effect-free. Nothing here opens a file, canonicalizes a path, takes a
// lock, or writes a byte. The record's CURRENT bytes go in, the new bytes come
// out, and the caller decides what to do with them.
//
// FOUR RULES ARE CORRECTNESS, NOT PREFERENCE:
//
//   1. THE PROJECT'S OWN WRITING IS PRESERVED BYTE-FOR-BYTE. Everything from the
//      `## Project clauses (provenance: project)` heading to end of file is the
//      PROJECT'S, not this composer's — human-authored content that outranks every
//      capability article and that no other copy exists of. It is carried across
//      verbatim: not re-rendered, not re-wrapped, not normalized, not trimmed. A
//      composition that regenerated the whole document would destroy it, which is
//      the single most damaging defect available to this item.
//
//   2. ONLY A DERIVED SECTION IS REPLACED. The capability-articles section is a
//      pure function of the registered capability set, so it is always rendered.
//      The core-articles section is rendered ONLY when the caller supplies the
//      core body (WF-492) — because core article text is not the resolver's to
//      invent, but it IS the caller's to carry, and a composer that could never
//      replace it left every already-composed record frozen at the article wording
//      of whichever release first composed it. The preamble (title, attribution,
//      precedence) is preserved unconditionally, for the same reason as rule 1.
//
//      Omitting the core body preserves that section exactly as before, so a caller
//      that has no core text to carry cannot start refusing records it used to
//      compose.
//
//   3. A DOCUMENT THIS COMPOSER CANNOT UNDERSTAND IS A REFUSAL, NEVER A SILENT
//      RESET. A missing, duplicated, or out-of-order section heading means the
//      record's structure is not the one this composer knows. Re-emitting it
//      anyway would risk exactly the destruction rule 1 forbids, so it refuses
//      before the transaction opens — the same fail-closed posture the WRITE path
//      of `parseDocument` takes in `apply-targets.ts`.
//
//   4. A RECORD THAT WOULD NOT CHANGE IS NOT A TARGET. `changed` is compared
//      against the CURRENT BYTES, so a recomposition over an unchanged capability
//      set leaves `_local/constitution.md` untouched down to its inode.

import type { ConstitutionInput } from "./types.js";
import { CORE_ARTICLES_HEADING } from "./constitution-core.js";

/** The heading whose BODY this composer renders. Exported so the contract tests
 *  assert the boundary mechanically rather than trusting a comment. */
export const CAPABILITY_ARTICLES_HEADING = "## Capability articles (provenance: each capability)";

/** The heading at which preservation begins. Everything from this line to end of
 *  file is the project's own writing (rule 1). */
export const PROJECT_CLAUSES_HEADING = "## Project clauses (provenance: project)";

/** The single derived preamble line this composer refreshes. Everything else in
 *  the preamble — including `**Composed:**` and `**Model:**`, which attribute the
 *  human/model composition that the resolver is not — is preserved. */
const REGISTRY_LINE_PREFIX = "**Registry:** ";

/** One capability's declared articles, in the order the composed record presents
 *  them. The caller supplies REGISTRY ORDER; this module never re-sorts, because
 *  registry order is the project's own injection order and re-deriving it here
 *  would be a second, silently-divergent answer to a settled question. */
export interface ConstitutionCapabilityArticles {
  capability: string;
  articles: readonly { key: string; value: string }[];
}

export interface ConstitutionCompositionInput {
  /** The composed record's CURRENT bytes. The caller establishes presence; an
   *  absent record never reaches this module (it is deferred, not composed). */
  current: string;
  /** Every registered capability's articles, in registry order. A capability
   *  declaring no article contributes no block. */
  capabilities: readonly ConstitutionCapabilityArticles[];
  /** Every registered capability name, in registry order — the value the
   *  `**Registry:**` preamble line is refreshed to. */
  registryNames: readonly string[];
  /**
   * The core-articles section BODY to carry into the record — the lines between
   * that section's heading and the next top-level heading (WF-492).
   *
   * ABSENT MEANS PRESERVE, NOT EMPTY. Omitting it (or passing `null`) leaves the
   * core section exactly as it is found, which is this composer's pre-WF-492
   * behaviour and the reason a caller holding no core text can never newly refuse
   * a record. Supplying it replaces the section — the path by which an amended core
   * article reaches a constitution composed against an earlier release.
   *
   * The caller owns the wording. `constitution-core.ts` is the shipped body every
   * in-repo caller passes; the parameter exists so this module stays a renderer
   * over an explicit shape rather than reaching for a constant of its own.
   */
  coreArticles?: readonly string[] | null;
}

export type ConstitutionComposition =
  | { ok: true; content: string; changed: boolean }
  | { ok: false; detail: string };

/** Index of a top-level heading line, or a refusal when it is absent or repeated.
 *
 *  Matched on the WHOLE line (after trailing whitespace), so an INDENTED mention —
 *  the ordinary way a heading is quoted in prose or inside a fence — cannot be
 *  mistaken for the section boundary. An UNINDENTED heading line inside a fenced
 *  block still matches: fences are not tracked. That is deliberate rather than
 *  overlooked, and it is the fail-closed direction, because the real heading is
 *  then seen twice and the duplicate branch below refuses. */
function locateHeading(
  lines: readonly string[],
  heading: string,
): { ok: true; index: number } | { ok: false; detail: string } {
  const found: number[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].trimEnd() === heading) found.push(index);
  }
  if (found.length === 0) {
    return {
      ok: false,
      detail: `the composed constitution record carries no \`${heading}\` section, so this composer does not recognize its structure; it is not rewritten, and nothing that is there now is lost.`,
    };
  }
  if (found.length > 1) {
    return {
      ok: false,
      detail: `the composed constitution record carries ${found.length} \`${heading}\` sections, so the section boundary is ambiguous; it is not rewritten, and nothing that is there now is lost.`,
    };
  }
  return { ok: true, index: found[0] };
}

/** The index of the next top-level `## ` heading at or after `from`, or the line
 *  count when there is none. */
function nextTopLevelHeading(lines: readonly string[], from: number): number {
  for (let index = from; index < lines.length; index += 1) {
    if (lines[index].startsWith("## ")) return index;
  }
  return lines.length;
}

/** Render the capability-articles section BODY — the lines after its heading and
 *  before the next top-level heading.
 *
 *  The shape mirrors the record `/wf:constitution` composes: one `###` block per
 *  contributing capability, each article a `- **<id> — <key>:** <value>` bullet,
 *  blank lines between blocks. Matching it exactly is what makes a recomposition
 *  over an unchanged capability set byte-identical (rule 4) rather than merely
 *  equivalent.
 *
 *  THE ID IS PART OF THE RENDERED TEXT (WF-500). Every article in the record —
 *  core, capability, project — carries an explicit `<provenance>.<n>` id, because
 *  an article gets cited: by a project clause recorded to override it, by an
 *  intake contradiction report, by a review finding. A citation needs a name that
 *  survives the article moving within its section.
 *
 *  NUMBERED PER CAPABILITY, FROM 1 — never across the whole section. The
 *  provenance segment already separates the namespaces, so `sr.1` and `audit.1`
 *  coexist; numbering across the section instead would renumber every later
 *  capability's articles whenever an earlier one gained or lost one, which is the
 *  churn the id exists to prevent. Within a capability the order is the manifest's
 *  own, which `articlesByCapability` preserves and this module never re-sorts. */
function renderArticleBody(capabilities: readonly ConstitutionCapabilityArticles[]): string[] {
  const contributing = capabilities.filter((entry) => entry.articles.length > 0);
  if (contributing.length === 0) {
    return ["", "No registered capability declares a constitution article.", ""];
  }
  const out: string[] = [];
  for (const entry of contributing) {
    out.push("", `### ${entry.capability}`, "");
    entry.articles.forEach((article, index) => {
      out.push(`- **${entry.capability}.${index + 1} — ${article.key}:** ${article.value}`);
    });
  }
  out.push("");
  return out;
}

/** Refresh the single `**Registry:** …` preamble line, when there is exactly one.
 *
 *  Absent or repeated, the preamble is left EXACTLY as it is: a derived line this
 *  composer cannot locate unambiguously is one it has no business rewriting, and
 *  rule 2 says the preamble is preserved by default. */
function refreshRegistryLine(preamble: readonly string[], registryNames: readonly string[]): string[] {
  const hits: number[] = [];
  for (let index = 0; index < preamble.length; index += 1) {
    if (preamble[index].startsWith(REGISTRY_LINE_PREFIX)) hits.push(index);
  }
  if (hits.length !== 1) return [...preamble];
  const out = [...preamble];
  // Carry the line's own trailing `\r`. Rewriting it without one would leave a
  // single bare LF in an otherwise-CRLF record — the mixed-ending defect one line
  // wide, in the only preamble line this function is allowed to touch.
  const eol = preamble[hits[0]].endsWith("\r") ? "\r" : "";
  out[hits[0]] = `${REGISTRY_LINE_PREFIX}${registryNames.join(", ")}${eol}`;
  return out;
}

/**
 * Compose the record: always render the capability-articles body, render the
 * core-articles body when — and only when — the caller carries one, preserve the
 * preamble and the project's own clauses unconditionally, and refuse rather than
 * reset a document this composer does not recognize.
 *
 * Pure: identical inputs always produce a deep-equal result, and no input is
 * mutated.
 */
export function composeConstitutionRecord(
  input: ConstitutionCompositionInput,
): ConstitutionComposition {
  const lines = input.current.split("\n");

  const articles = locateHeading(lines, CAPABILITY_ARTICLES_HEADING);
  if (!articles.ok) return articles;
  const clauses = locateHeading(lines, PROJECT_CLAUSES_HEADING);
  if (!clauses.ok) return clauses;

  // ORDER IS PART OF THE STRUCTURE. The project clauses close the document and
  // outrank every capability article; a record whose clauses precede the articles
  // is not the shape this composer knows, and guessing at the author's intent is
  // precisely the silent reset rule 3 forbids.
  if (clauses.index <= articles.index) {
    return {
      ok: false,
      detail: `the composed constitution record places \`${PROJECT_CLAUSES_HEADING}\` before \`${CAPABILITY_ARTICLES_HEADING}\`, which is not the structure this composer recognizes; it is not rewritten, and nothing that is there now is lost.`,
    };
  }

  const articleSectionEnd = nextTopLevelHeading(lines, articles.index + 1);

  // The derived section must be the one the project clauses follow. Any other
  // top-level section between them is content this composer did not author and
  // cannot place, so it refuses rather than absorb or displace it.
  if (articleSectionEnd !== clauses.index) {
    return {
      ok: false,
      detail: `the composed constitution record carries an unrecognized section between \`${CAPABILITY_ARTICLES_HEADING}\` and \`${PROJECT_CLAUSES_HEADING}\`; it is not rewritten, and nothing that is there now is lost.`,
    };
  }

  // --- the core section (WF-492) -------------------------------------------
  // Only when the caller carries core text. With none, `coreStart` stays at the
  // capability heading and the emitted document is byte-for-byte the pre-WF-492
  // one — which is what keeps a caller holding no core body from newly refusing a
  // record it used to compose.
  // AN EMPTY ARRAY IS ABSENT, NOT "RENDER NOTHING". `??` alone would take `[]` as a
  // value and emit the heading with no body — silently deleting the whole core
  // section and reporting `ok: true`. A caller with nothing to carry means "leave it
  // alone"; a caller that genuinely wanted the section emptied would have to say so
  // some other way, and no caller does.
  const coreArticles =
    input.coreArticles !== undefined && input.coreArticles !== null && input.coreArticles.length > 0
      ? input.coreArticles
      : null;
  let coreStart = articles.index;
  let coreSection: string[] = [];

  if (coreArticles !== null) {
    const core = locateHeading(lines, CORE_ARTICLES_HEADING);
    if (!core.ok) return core;

    // Same structural discipline the capability section is held to, for the same
    // reason: a core section that does not precede the derived one, or that is
    // separated from it by a section this composer did not author, is not the
    // shape it knows — and guessing is the silent reset rule 3 forbids.
    if (core.index >= articles.index) {
      return {
        ok: false,
        detail: `the composed constitution record places \`${CORE_ARTICLES_HEADING}\` at or after \`${CAPABILITY_ARTICLES_HEADING}\`, which is not the structure this composer recognizes; it is not rewritten, and nothing that is there now is lost.`,
      };
    }
    if (nextTopLevelHeading(lines, core.index + 1) !== articles.index) {
      return {
        ok: false,
        detail: `the composed constitution record carries an unrecognized section between \`${CORE_ARTICLES_HEADING}\` and \`${CAPABILITY_ARTICLES_HEADING}\`; it is not rewritten, and nothing that is there now is lost.`,
      };
    }

    coreStart = core.index;
    coreSection = [lines[core.index].trimEnd(), ...coreArticles];
  }

  // THE REGISTRY LINE IS SEARCHED OVER THE SAME REGION AS BEFORE — everything above
  // the capability heading — and only THEN split at `coreStart`. Narrowing the search
  // to the preamble would change two behaviours silently: a `**Registry:**` line
  // sitting inside the core section would stop being found (and then be destroyed by
  // the replacement below rather than refreshed), and a record carrying two such
  // lines would drop from the deliberate "ambiguous, so leave it alone" branch back
  // into being rewritten. Neither is this change's business.
  const refreshed = refreshRegistryLine(lines.slice(0, articles.index), input.registryNames);
  const preamble = refreshed.slice(0, coreStart);
  // RULE 1, mechanically: the tail is sliced, never parsed and never re-rendered.
  const preservedClauses = lines.slice(clauses.index);

  // PRESERVE THE RECORD'S OWN LINE ENDING. `split("\n")` leaves a trailing `\r` on
  // every line of a CRLF record; joining with a bare `\n` would emit the rendered
  // sections LF while the sliced preamble and tail stayed CRLF, quietly turning a
  // user-owned file mixed. The record's dominant ending is used instead, and the
  // rendered lines are normalized to match it.
  const crlf = /\r\n/.test(input.current) && !/(^|[^\r])\n/.test(input.current);
  const emit = (line: string): string => (crlf ? `${line.replace(/\r$/, "")}\r` : line);

  const content = [
    ...preamble,
    ...coreSection.map(emit),
    emit(lines[articles.index].trimEnd()),
    ...renderArticleBody(input.capabilities).map(emit),
    ...preservedClauses,
  ].join("\n");

  return { ok: true, content, changed: content !== input.current };
}

/** Project the snapshot's flat `constitutionInputs` into per-capability blocks,
 *  preserving the order the snapshot produced (registry order) for both the
 *  capabilities and each capability's own articles.
 *
 *  A separate function from the composer so the composer stays a pure renderer
 *  over an explicit shape, and so a caller holding articles from any other source
 *  can drive it without inventing a snapshot. */
export function articlesByCapability(
  inputs: readonly ConstitutionInput[],
): ConstitutionCapabilityArticles[] {
  const order: string[] = [];
  const byCapability = new Map<string, { key: string; value: string }[]>();
  for (const input of inputs) {
    const bucket = byCapability.get(input.capability);
    if (bucket === undefined) {
      order.push(input.capability);
      byCapability.set(input.capability, [{ key: input.key, value: input.value }]);
      continue;
    }
    bucket.push({ key: input.key, value: input.value });
  }
  return order.map((capability) => ({
    capability,
    articles: byCapability.get(capability) ?? [],
  }));
}
