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

export { CORE_ARTICLES_HEADING };

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
 *  Matched at the START of a line and on the WHOLE line (after trailing
 *  whitespace), so a heading quoted inside a fenced block or referenced mid-prose
 *  cannot be mistaken for the section boundary. */
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
 *  contributing capability, each article a `- **key:** value` bullet, blank lines
 *  between blocks. Matching it exactly is what makes a recomposition over an
 *  unchanged capability set byte-identical (rule 4) rather than merely equivalent. */
function renderArticleBody(capabilities: readonly ConstitutionCapabilityArticles[]): string[] {
  const contributing = capabilities.filter((entry) => entry.articles.length > 0);
  if (contributing.length === 0) {
    return ["", "No registered capability declares a constitution article.", ""];
  }
  const out: string[] = [];
  for (const entry of contributing) {
    out.push("", `### ${entry.capability}`, "");
    for (const article of entry.articles) {
      out.push(`- **${article.key}:** ${article.value}`);
    }
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
  out[hits[0]] = `${REGISTRY_LINE_PREFIX}${registryNames.join(", ")}`;
  return out;
}

/**
 * Compose the record: replace only the capability-articles body, preserve
 * everything else, and refuse rather than reset a document this composer does not
 * recognize.
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
  const coreArticles = input.coreArticles ?? null;
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

  const preamble = refreshRegistryLine(lines.slice(0, coreStart), input.registryNames);
  // RULE 1, mechanically: the tail is sliced, never parsed and never re-rendered.
  const preservedClauses = lines.slice(clauses.index);

  const content = [
    ...preamble,
    ...coreSection,
    lines[articles.index].trimEnd(),
    ...renderArticleBody(input.capabilities),
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
