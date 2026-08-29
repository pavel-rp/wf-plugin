// wf resolver — the canonical core-articles body a re-composition carries (WF-492).
//
// THE PROBLEM THIS EXISTS FOR. `composeConstitutionRecord` replaces only the
// DERIVED capability section and preserves everything before it, core articles
// included — correctly, because the resolver did not author them. The cost of that
// correctness was that amended core article text reached nobody: a project whose
// `_local/constitution.md` was composed against an older release kept the older
// wording forever, and no re-run, no install and no validator ever noticed. The
// harness therefore shipped a constitution asserting that nothing advances past an
// unapproved gate while its own unattended driver existed to advance past exactly
// those gates.
//
// So the core articles get a MACHINE-READABLE HOME here, beside the composer that
// carries them, rather than existing only as skill prose the resolver cannot see.
// This module is the single value a re-composition renders the core section from.
//
// TWO RULES ARE CORRECTNESS, NOT PREFERENCE:
//
//   1. THIS IS RENDERED TEXT, NOT A PARSER TARGET. Nothing derives behaviour by
//      reading an article back out of this string. It is emitted into the composed
//      record and read by humans and by the verify phase, exactly as the skill's
//      own prose is. A consumer that started pattern-matching article bodies would
//      make every future wording change a breaking one.
//
//   2. THE WORDING IS THE SKILL'S, MIRRORED — NEVER INDEPENDENTLY EDITED. The
//      authoring source of an article is `skills/constitution/SKILL.md`; this
//      constant restates it in the shape the composed record uses (one entry per
//      article, unwrapped). `constitution-compose.test.ts` asserts that EVERY entry
//      here appears in that skill body, so an edit to one that forgets the other
//      fails the suite instead of shipping a second, silently divergent
//      constitution. Pinning only the article this release changed would leave the
//      other eight free to drift — the same two-copies-with-no-guard defect this
//      module exists to close, one level up.
//
// Deterministic and side-effect-free: two string constants and a frozen array of
// rendered lines. Frozen rather than merely `readonly`, which is erased at runtime:
// the body is shared by every caller that composes a record, so an in-place edit by
// one of them would silently change what every later composition writes.

/** The heading whose BODY a core re-composition replaces. Exported so the contract
 *  tests assert the boundary mechanically rather than trusting a comment. */
export const CORE_ARTICLES_HEADING = "## Core articles (provenance: core)";

/**
 * The unattended-gate clause (WF-492), as its own constant.
 *
 * SEPARATE FROM THE BODY ON PURPOSE. It is the densest run of obligation in the
 * whole record — twelve of the thirty the inventory tracks live in article 2, ten
 * of them here — it is the one a downstream re-composition must be shown to pick
 * up, and it is the one the skill-prose agreement test pins. Naming it makes each
 * of those an assertion against a value rather than against a substring someone
 * typed twice.
 *
 * COMPRESSED, NEVER WEAKENED (WF-500). The wording is terser than the sentence
 * WF-492 shipped; the obligations are the same ten, mapped 1:1 in
 * `skills/constitution/references/obligation-inventory.md` (rows O2.3–O2.12). What
 * was cut is the closing restatement — "an unattended run does not skip the gate,
 * it satisfies the gate with evidence, or it stops" — which asserted nothing the
 * halt-and-report obligation does not already assert.
 */
export const UNATTENDED_GATE_CLAUSE =
  "A human approves; or, where unattended mode is established independently of the agent, a resolver-issued run-evidence record does: naming the gate, binding the approved artifact by digest, filed before the next phase, valid only in its requesting run, requested by but never written by the agent it authorises. Absent, unmatched, unverifiable, foreign-run, or digest-stale, the gate is unapproved: the run halts there, reported unproven.";

/**
 * The core articles, in the shape the composed record presents them: one entry per
 * article, each a single unwrapped line, blank-line delimited from the headings
 * around it.
 *
 * Matching that shape exactly is what makes a re-composition over an already-current
 * record byte-identical (the composer's rule 4) rather than merely equivalent.
 *
 * EVERY ARTICLE CARRIES ITS ID (WF-500). `core.<n>` is rendered into the text rather
 * than left implicit in a list number, because an article is cited — by a project
 * clause that overrides it, by a contradiction report, by a review finding — and a
 * citation needs a name that survives the article moving. The same
 * `<provenance>.<n>` scheme covers the capability section (rendered by
 * `constitution-compose.ts`) and project clauses, so one clause-style contract
 * governs the whole record.
 *
 * BULLETS, NOT A NUMBERED LIST. With the id in the text, a markdown ordinal would
 * state the same number twice and drift the moment the two disagreed.
 *
 * THE INVENTORY GATES THE WORDING, NOT THE BYTE COUNT. These nine lines replace the
 * twelve that preceded them at ~54% of their bytes, and every one of the thirty
 * normative obligations they carried is still here — see
 * `skills/constitution/references/obligation-inventory.md`, which maps them 1:1 and
 * names the non-obligation text (rationale, restatement, anticipatory rebuttal,
 * cross-references) that the compression removed. A future edit that shortens an
 * article by dropping an obligation is a defect, and that file is where it is caught.
 */
export const CORE_ARTICLES_BODY: readonly string[] = Object.freeze([
  "",
  "- **core.1 — Spec is the source of truth.** A derived artifact (plan, task list) never overrides the spec; conformance is judged against the spec.",
  `- **core.2 — No phase skips its gate.** Each phase's artifact feeds the next; nothing advances past an unapproved gate. ${UNATTENDED_GATE_CLAUSE}`,
  "- **core.3 — Write scope.** Nothing writes outside `_local/` except the designated source-mutating skills and the resolver-owned declared lifecycle artifacts under `.wf/`, admitted only when both resolver-managed and of a declared class; every other component reads `.wf/` through the resolver and writes only inside `_local/`.",
  "- **core.4 — Model attribution.** Every artifact carries a `**Model:** <id>` line, or a verb-shaped variant, naming the model that produced it.",
  "- **core.5 — No AI attribution in commits.** Commit messages and PR descriptions carry no `Co-Authored-By` trailer, \"generated with\" footer, emoji, or promotional tagline.",
  "- **core.6 — Never commit to `main`.** All work happens on a feature branch (`feat/…`, `fix/…`, `chore/…`); pushing to `main` is forbidden whatever is registered, and in bare-core mode a branch gate skips with a stated reason rather than permit a `main` commit.",
  "- **core.7 — Config over hardcode.** Project-specific values are read from `_local/config.md`, never hardcoded into a skill.",
  "- **core.8 — Core never requires a capability.** Every core extension point ships a lean default and runs inert when no capability is registered; core never names or hard-depends on a specific capability.",
  "- **core.9 — Scratch discipline.** Scratch and temporary files live only under `_local/scratch/` — never the repo root, system temp, or beside tracked files. (a) A scratch file's consumer deletes it as its own last act in that same run, never deferring to a sweep. (b) The run-ending skill deletes that run's coordination files — state, handoff, ledger, lock, marker — as part of ending it, on success or failure. The finalize sweep is a backstop that excuses neither.",
  "",
]);
