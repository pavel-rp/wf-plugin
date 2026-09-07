# verify-spec: WF-553

**Source:** `_local/WF-553/00_reqs.md`
**Branch:** `feature/553-wf-553`
**Commit:** `158ab1b3eb68f14b77103d44efba49793f3f8b30`  (base `19ec254b7f640d837b9f4a0415e2a79a93e2db02`)
**Tree:** clean
**Scope:** 6 files, +142/-9 vs base (`main` is several merged PRs behind this stacked branch; `19ec254` — the tip of the merged WF-552 branch — is the true divergence point and an ancestor of HEAD)
**Verdict:** PARTIAL  (23/23 requirements; 1 capability FAIL, 3 capability WARN)
**Audited by:** claude-sonnet-5
**Audited at:** 2026-09-04T18:32:40Z

> Note: this is the third audit round. Two commits landed since the previous round's HEAD (`c2c1a0c`): `6e0469f` ("protect the SUB-block outcome and scope-boundary fields from a size trim") and `158ab1b` ("scope the population-separation claim to the total-file budgets"), both included in this audit's scope.

## Requirements

1. [PASS] Decomposer contract states the per-`SUB-n`-block (40 lines) and total (220 lines) budgets for `02_subtasks.md`.
   - Evidence: `plugins/wf/agents/charter-decomposer.md:22` — "each `## SUB-n` block stays within **40 lines**; `02_subtasks.md` as a whole stays within **220 lines**."

2. [PASS] Decomposer instructed to stay within both budgets by cutting implementation-detail prose, never by dropping an acceptance scenario or retiring a sub-task.
   - Evidence: `plugins/wf/agents/charter-decomposer.md:22` — "never by dropping a desired outcome, an out-of-scope exclusion, an acceptance scenario, a constraint, an assumption, or a verification-evidence entry, and never by retiring a sub-task to make room." The enumeration was widened this round (`6e0469f`) to add "a desired outcome, an out-of-scope exclusion" — closing the previous round's correctness-auditor FAIL and convention-auditor WARN on this exact gap (both independently confirmed closed by this round's lenses — see Capability findings). A residual, narrower divergence from the writer's list (`Assumptions`) and two unprotected traceability fields (`Covers`, `Depends on`) are newly flagged this round — see Capability findings below.

3. [PASS] Writer contract states the total-line budget (140 lines) for `01_charter.md`.
   - Evidence: `plugins/wf/agents/charter-writer.md:25` — "`01_charter.md` stays within **140 lines** total." (Unchanged by this round's two commits.)

4. [PASS] Writer instructed to stay within budget without dropping an outcome, a constraint, or a non-goal.
   - Evidence: `plugins/wf/agents/charter-writer.md:25` — "never by dropping an outcome, a constraint, or a non-goal."

5. [PASS] Reviewer checklist gains a row flagging an overrun, routed to the owning role by artifact, naming the block/measured-vs-allowed size.
   - Evidence: `plugins/wf/agents/charter-reviewer.md:58` — checklist row 15; `Route` names only the owning roles (`decomposer` / `charter-writer`); the naming-the-block/measured-vs-allowed-size instruction is in the `Pass condition` cell. Unchanged by this round's two commits.

6. [PASS] The overrun check blocks in every round irrespective of WF-551's changed-text rule, stated as a named exception beside that rule.
   - Evidence: `plugins/wf/agents/charter-reviewer.md:29` (`full-audit` exception) and `:35` (`verification` exception), both unchanged this round; `:66`'s "Size-budget floor" bullet still makes every check-15 finding score HIGH, which `SKILL.md` Phase 5 rules 3–4 (`:188-189`, unmodified) already treat as blocking in round 1. Confirmed still closed by this round's correctness-auditor (no new finding on this point).

7. [PASS] Decomposer: an irreducible overrun is reported as a product choice on `Flags:`, content kept, never truncated.
   - Evidence: `plugins/wf/agents/charter-decomposer.md:22`. See the correctness-auditor FAIL below on a distinct gap: the shared `Flags:` slot's behavior when a trim and an irreducible overrun co-occur in the same dispatch is unspecified.

8. [PASS] Writer: the symmetric case is recorded under `## Open questions`, never truncated.
   - Evidence: `plugins/wf/agents/charter-writer.md:25` — "record it under `## Open questions` as `- product choice needed: <one line naming the overrun> (blocks: <what it blocks>)`, matching the section's own required shape."

9. [PASS] Rationale for the chosen numbers lives in the `references/` doc, not the runtime bodies.
   - Evidence: `plugins/wf/skills/charter/references/convergence-loop.md:165-297` (SUB-3 section, now 302 lines total in-file) carries the full justification, including two new paragraphs this round — the population-separation scoping (`:176-181`) and "Why the two protected lists are not word-for-word identical" (`:270-279`); the three agent files state only the bare numbers with no rationale prose. This item is about *placement*, not the rationale's internal accuracy — see requirement 18 and the consistency-auditor entry below, both now clean.

10. [PASS] AC1 — a `02_subtasks.md` with one `SUB-n` block over its per-block budget → reviewer emits exactly one finding for this check, routed to `decomposer`, naming the block and measured vs. allowed size.
    - Evidence: `plugins/wf/agents/charter-reviewer.md:58`, `Pass condition` cell.

11. [PASS] AC2 — `02_subtasks.md` over its total budget with every block within its per-block budget → one finding routed to `decomposer`.
    - Evidence: `plugins/wf/agents/charter-reviewer.md:58` — the pass condition is a conjunction ("every `## SUB-n` block ≤40 lines **and** the file ≤220 lines total"), so a total-only overrun still trips the same single check.

12. [PASS] AC3 — `01_charter.md` over its total budget → one finding routed to `charter-writer`, naming measured vs. allowed size.
    - Evidence: `plugins/wf/agents/charter-reviewer.md:58`, `Route` cell.

13. [PASS] AC4 — both artifacts within budget → this check emits no finding.
    - Evidence: `plugins/wf/agents/charter-reviewer.md:58` pass condition, plus the Mandate's standing "report every finding you identify."

14. [PASS] AC5 — a decomposer revision that successfully brings `02_subtasks.md` back within budget (without removing acceptance scenarios or retiring sub-tasks) reports the change in its output block.
    - Evidence: `plugins/wf/agents/charter-decomposer.md:22` and `:98` (`Flags:` enumeration).

15. [PASS] AC6 — a writer revision that successfully brings `01_charter.md` back within budget (without dropping an outcome/constraint/non-goal) reports the change in its output block.
    - Evidence: `plugins/wf/agents/charter-writer.md:25` and `:116` (`Flags:` line).

16. [PASS] AC7 — an irreducible overrun: decomposer keeps the content, leaves the overrun, reports it as a product choice on `Flags:`, never truncates.
    - Evidence: `plugins/wf/agents/charter-decomposer.md:22`, verbatim match to the requirement.

17. [PASS] Out-of-scope items correctly left untouched — no budget added to the review log; scope-freeze, WF-551's convergence rules, and the cap gate are untouched.
    - Evidence: `git diff --stat 19ec254..158ab1b` touches only the 6 files listed under Scope; `plugins/wf/skills/charter/SKILL.md` still has zero diff against base and is still 280 lines.

18. [PASS] Exact numeric budgets are grounded in the converged corpus (`C025–C028` decompositions at 112–220 lines; charters at 107–140 lines).
    - Evidence: `plugins/wf/skills/charter/references/convergence-loop.md:169-174` states the direct per-charter measurements (unchanged this round) — `02_subtasks.md` ran 112 (C026), 177 (C027), 198 (C028), 220 (C025) lines; `01_charter.md` ran 107 (C025), 111 (C028), 121 (C027), 140 (C026) lines. This round's two commits (`6e0469f`, `158ab1b`) rewrote the surrounding framing so the "top of the converged range" and "separates the two populations cleanly" claims (`:176-181`) now explicitly scope to the two *total-file* budgets only, and the per-block 40-line figure's own derivation paragraph (`:182-190`) is cross-referenced rather than implied to share that grounding (`:195-196`: "This is the argument for the two total-file budgets; the per-block figure's own derivation is the paragraph above."). **This closes the previous round's consistency-auditor FAIL** — independently re-verified line-by-line this round by the consistency-auditor lens, which found no residual joint/uniform-derivation claim anywhere in the section (see Capability findings).

19. [PASS] Core stays domain-free.
    - Evidence: `grep -inE "angular|react|typescript|c#|\.net|node\.js|azure devops|jira\b"` across the diff from `19ec254` to `158ab1b` returns 0 hits.

20. [PASS] Reviewer stays read-only.
    - Evidence: `plugins/wf/agents/charter-reviewer.md:21` (unchanged) — "Read-only — no Write, no Edit, no tracker calls." This round touched no reviewer file.

21. [N/A] `SKILL.md`, if touched, ends no higher than its line count at the start of this slice.
    - `plugins/wf/skills/charter/SKILL.md` is absent from the diff (still 280 lines, zero-line diff against base) — the constraint is vacuously satisfied.

22. [PASS] Version bump follows the charter tier rule (PATCH by default; MINOR only if a shape must change).
    - Evidence: `plugins/wf/.claude-plugin/plugin.json` and the `wf` entry in `.claude-plugin/marketplace.json` both still read `0.144.0`; the marketplace top-level version still reads `0.190.2`, unchanged since the round-2 MINOR bump. This round's two commits are wording-only fixes to already-shipped fields — no further shape change, so no additional bump is needed. `npm run build` in `plugins/wf/mcp` exits 0, confirming both JSON manifests still parse.

23. [PASS] Touched files are limited to the three role agents, the `references/` doc, and the two version manifests.
    - Evidence: `git diff --stat 19ec254..158ab1b` lists exactly `.claude-plugin/marketplace.json`, `plugins/wf/.claude-plugin/plugin.json`, `plugins/wf/agents/charter-decomposer.md`, `plugins/wf/agents/charter-reviewer.md`, `plugins/wf/agents/charter-writer.md`, `plugins/wf/skills/charter/references/convergence-loop.md` — nothing more, across all commits since base.

## Capability findings

- **audit** (correctness-auditor) — [FAIL] The decomposer's single-line `Flags:` output field cannot represent a dispatch where some oversized `SUB-n` blocks trim successfully while another is an irreducible overrun — one of the two required signals is silently dropped. `charter-decomposer.md:22` defines both "Report a successful trim via `Flags: trimmed to size budget: ...`" and "report it via `Flags: product choice needed: ...`" as alternatives with no combination rule, and the output contract (`:98`) exposes only one mutually-exclusive `Flags:` slot; the host's read logic (`SKILL.md:160`) has no branch for a co-occurring trim message and a product-choice message. at `plugins/wf/agents/charter-decomposer.md:22,98` vs `plugins/wf/skills/charter/SKILL.md:160` — Remedy: state a precedence rule in the Boundaries bullet (e.g. "when both occur in the same dispatch, report `product choice needed` — it always wins; note the trim inline in the same line") and align the output-contract row and `SKILL.md:160`'s read logic to match.
- **audit** (correctness-auditor) — [WARN] The previous round's FAIL (decomposer's escape hatch omitting the writer's SUB-block analogues) is confirmed closed — "a desired outcome, an out-of-scope exclusion" now mirrors the writer's "an outcome ... a non-goal." A narrower residual gap remains: the decomposer's protected enumeration still leaves `Covers` and `Depends on` (the coverage-map/dependency-order traceability fields) unprotected, with no stated reason, even though dropping either during a trim would undermine reviewer checks 1/2/10 (coverage, orphans, dependency validity) the same way dropping the six already-listed fields would undermine checks 3/7/8/11. at `plugins/wf/agents/charter-decomposer.md:22` — Remedy: either add `Covers` and `Depends on` to the protected enumeration, or state explicitly that they're out of trimming scope because checks 1/2/10 already guard them.
- **audit** (consistency-auditor) — [PASS, confirmed fixed] The previous round's FAIL — the SUB-3 rationale's "top of the converged range"/"separates the two populations" framing implying a uniform derivation for all three budget numbers when the 40-line per-block figure is actually derived by an unrelated method — is independently re-verified closed: every joint/uniform-derivation sentence in the current section (`convergence-loop.md:165-297`) is explicitly scoped to the two total-file budgets, and the per-block paragraph is cross-referenced rather than folded into that claim. No residual or newly-introduced consistency defect found elsewhere in the round's diff.
- **audit** (convention-auditor) — [WARN] The previous round's WARN (decomposer/writer protected-list divergence on the outcome/non-goal analogues) is confirmed closed. A distinct, narrower asymmetry remains: the writer's protected list ("an outcome, a constraint, or a non-goal," `charter-writer.md:25`) omits `Assumptions`, while the decomposer's parallel list explicitly protects `an assumption` (`charter-decomposer.md:22`) — yet the writer's own Writing rules (`:41`, "Assumption hygiene... Nothing shapes scope silently") and reviewer checklist row 13 (`charter-reviewer.md:56`, "`[unconfirmed]` ones that shape scope become user questions, not silent defaults") treat an unconfirmed Assumptions-table row as exactly the kind of scope-shaping content the size-budget escape hatch exists to protect. A size-budget trim under the writer's current boundary could legally delete such a row. at `plugins/wf/agents/charter-writer.md:25` vs `plugins/wf/agents/charter-decomposer.md:22`, `charter-writer.md:41`, `charter-reviewer.md:56` — Remedy: add "an assumption" to the writer's protected list, and note the charter's Assumptions & decisions table as a fourth protected category in `convergence-loop.md`'s "Why the two protected lists are not word-for-word identical" section.
- **audit** (security-auditor) — [PASS] No security-relevant surface in this prose-only role-contract change.
- **audit** (operational-auditor) — [WARN] The same three size-budget thresholds (40/220/140 lines) are hardcoded and duplicated verbatim across three separate role-contract files (`charter-decomposer.md:22`, `charter-writer.md:25`, `charter-reviewer.md:58`) with no single source of truth — a future tuning of any one number could land in only one or two of the three files and silently desync the writer/decomposer's trim target from the reviewer's enforced check-15 pass condition. Pre-existing (present since the task's first commits, not introduced by this round's two commits), and not previously flagged by this lens. at `plugins/wf/agents/charter-decomposer.md:22`, `plugins/wf/agents/charter-writer.md:25`, `plugins/wf/agents/charter-reviewer.md:58` — Remedy: extract the three numbers into one shared reference the three agent files quote or point to.
- **author-caps** (structural-validation) — clean — the applies-when condition (a capability `manifest.md`, registry row, or `SKILL.md`/`interface.md` pair) is not met by this diff; no validation work performed, per the fragment's own no-op rule.
- **author-caps** (reference-existence) — clean — `validate_references` (scoped to every plugin's `skills`/`agents` trees): 126 files scanned, 370 references resolved, 0 findings.

## Deviations from derived artifacts (informational)

- `02_plan.md`'s Resolution Summary still describes the version bump as PATCH `0.143.1 → 0.143.2`. The branch's actual final state is MINOR `0.144.0`, per `05_verify-fix.md`'s recorded rationale. `02_plan.md` was never updated to reflect this — informational only, unchanged from previous rounds.

## Recommended next actions

- Define a precedence rule for the decomposer's `Flags:` slot when a successful trim and an irreducible overrun co-occur in the same dispatch, and align `SKILL.md:160`'s read logic to it — closes the correctness-auditor FAIL.
- Add `an assumption` to `charter-writer.md:25`'s protected list (mirroring the decomposer) and extend `convergence-loop.md`'s "Why the two protected lists are not word-for-word identical" section to cover it — closes the convention-auditor WARN.
- Add `Covers`/`Depends on` to the decomposer's protected enumeration, or state they're intentionally out of scope — closes the correctness-auditor WARN.
- Extract the 40/220/140 figures into one shared reference the three role contracts quote — closes the operational-auditor WARN.
- Note for the record: this round confirms both of the *previous* round's findings (the decomposer/writer outcome-analogue gap; the SUB-3 per-block-derivation framing) are genuinely closed — the residual findings above are new or narrower variants surfaced by this round's fresh lens passes, not regressions of what was just fixed.

Next: fix the FAIL above in `charter-decomposer.md` (and `SKILL.md:160`'s read logic), then re-run `/wf:verify-spec WF-553`. The FAIL requires a judgment call on the precedence wording rather than a single-literal `Expected` value at one cited line, so no `/wf:verify-fix` mechanical-fix suggestion applies this round.
---
