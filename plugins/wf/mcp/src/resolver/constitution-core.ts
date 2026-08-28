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
//      article, unwrapped). `constitution-compose.test.ts` asserts the two agree on
//      the unattended-gate clause, so an edit to one that forgets the other fails
//      the suite instead of shipping a second, silently divergent constitution.
//
// Deterministic and side-effect-free: a frozen string and a heading constant.

/** The heading whose BODY a core re-composition replaces. Exported so the contract
 *  tests assert the boundary mechanically rather than trusting a comment. */
export const CORE_ARTICLES_HEADING = "## Core articles (provenance: core)";

/**
 * The amended Article 2 clause, as its own constant.
 *
 * SEPARATE FROM THE BODY ON PURPOSE. It is the one sentence this release changes,
 * the one a downstream re-composition must be shown to pick up, and the one the
 * skill-prose agreement test pins. Naming it makes each of those an assertion
 * against a value rather than against a substring someone typed twice.
 */
export const UNATTENDED_GATE_CLAUSE =
  "A gate is approved by a human, or — in an **unattended run**, where no human is present to approve — by a **recorded self-approval**: a machine-checkable record, issued by the resolver into its declared run-evidence class, naming the gate it clears and filed before the next phase begins. An unattended run does not thereby skip the gate; it satisfies it with evidence. The record is requested by the agent it authorises and never written by it, so a self-approval that is absent, unmatched, or unverifiable leaves the gate **unapproved**, and the run is reported as unproven rather than as complete.";

/**
 * The core articles, in the shape the composed record presents them: a numbered
 * list, one entry per article, blank-line delimited from the headings around it.
 *
 * Matching that shape exactly is what makes a re-composition over an already-current
 * record byte-identical (the composer's rule 4) rather than merely equivalent.
 */
export const CORE_ARTICLES_BODY: readonly string[] = [
  "",
  "1. **The spec is the single source of truth.** A derived artifact (plan, task list) never overrides the spec; conformance is judged against the spec.",
  `2. **No phase skips its gate.** Every phase produces an artifact that feeds the next, and nothing advances past an unapproved gate. ${UNATTENDED_GATE_CLAUSE}`,
  "3. **Nothing writes outside `_local/`** except the designated source-mutating skills, and except the declared committed lifecycle artifacts the resolver runtime owns and manages under `.wf/`. That home is not a general writable one: an artifact is admitted only when it is both resolver-managed and of a declared class, and every other component reads it through the resolver while writing only inside `_local/`.",
  "4. **Every artifact carries model attribution.** A `**Model:** <id>` line (or a verb-shaped variant) records which model produced each artifact.",
  "5. **No AI attribution in commits.** Commit messages and PR descriptions carry no `Co-Authored-By` trailer, \"generated with\" footer, emoji, or promotional tagline.",
  "6. **Never commit to `main`.** All work happens on a feature branch (`feat/…`, `fix/…`, `chore/…`); pushing to `main` is forbidden regardless of registered capabilities. This holds even in bare-core mode, where every branch gate skips with a stated reason rather than silently permitting a `main` commit.",
  "7. **Project configuration lives in `_local/config.md`.** Project-specific values are read from config, never hardcoded into a skill.",
  "8. **Core never requires a capability.** Every core extension point ships a lean default and runs inert when no capability is registered; core never names or hard-depends on a specific capability.",
  "9. **Temp and scratch files live under `_local/`, and nothing is left behind.** Working, temporary, and scratch files route to a dedicated scratch area under `_local/` (`_local/scratch/`) — never the repo root, a system temp directory, or anywhere alongside tracked files. This *complements* the write-scope article above: that one bounds where writes may land; this one routes every throwaway to a single gitignored home inside that boundary. Placement alone does not discharge the article: every scratch file also carries a lifecycle, and both deletion obligations below are mandatory.",
  "   - **(a) Per-consumer immediate deletion.** Each scratch file is deleted the moment its consumer has run — deletion is that consumer's own last act on the file, in the same run that consumed it.",
  "   - **(b) Breadcrumb deletion by the run-ending skill.** Every run-scoped breadcrumb — the state, handoff, ledger, lock, and marker files a multi-step run writes to coordinate itself — is deleted by the skill that ends the run, whether the run ended in success or in failure.",
  "",
  "   The finalize-time scratch sweep is a **backstop, not a substitute**: it exists only to remove residue obligation (a) or (b) failed to remove, and neither obligation may be skipped, deferred, or weakened on the grounds that the sweep will catch it.",
  "",
];
