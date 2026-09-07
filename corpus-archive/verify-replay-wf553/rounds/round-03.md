# verify-spec: WF-553

**Source:** `_local/WF-553/00_reqs.md`
**Branch:** `feature/553-wf-553`
**Commit:** `c2c1a0c36f1b173ecf678fb142f09ef8a098dfda`  (base `19ec254b7f640d837b9f4a0415e2a79a93e2db02`)
**Tree:** clean
**Scope:** 6 files, +126/-9 vs base (`main` is several merged PRs behind this stacked branch; `19ec254` — the tip of the merged WF-552 branch — is the true divergence point and an ancestor of HEAD)
**Verdict:** PARTIAL  (23/23 requirements; 2 capability FAIL, 1 capability WARN)
**Audited by:** claude-sonnet-5
**Audited at:** 2026-09-04T18:23:02Z

> Note: the branch has three commits beyond the previous audit round's HEAD — `d2421c9` and `bc5d0f8` (the two the caller flagged) plus one more, `c2c1a0c` (`WF-553: describe the SKILL.md constraint as the slice states it`), which landed after `bc5d0f8` and is included in this audit's scope.

## Requirements

1. [PASS] Decomposer contract states the per-`SUB-n`-block (40 lines) and total (220 lines) budgets for `02_subtasks.md`.
   - Evidence: `plugins/wf/agents/charter-decomposer.md:22` — "each `## SUB-n` block stays within **40 lines**; `02_subtasks.md` as a whole stays within **220 lines**."

2. [PASS] Decomposer instructed to stay within both budgets by cutting implementation-detail prose, never by dropping an acceptance scenario or retiring a sub-task.
   - Evidence: `plugins/wf/agents/charter-decomposer.md:22` — "Stay inside both by cutting implementation-detail prose — never by dropping an acceptance scenario, a constraint, an assumption, or a verification-evidence entry, and never by retiring a sub-task to make room." (Enumeration widened since the last audit round — see correctness-auditor FAIL and convention-auditor WARN below on a residual gap in this same enumeration.)

3. [PASS] Writer contract states the total-line budget (140 lines) for `01_charter.md`.
   - Evidence: `plugins/wf/agents/charter-writer.md:25` — "`01_charter.md` stays within **140 lines** total."

4. [PASS] Writer instructed to stay within budget without dropping an outcome, a constraint, or a non-goal.
   - Evidence: `plugins/wf/agents/charter-writer.md:25` — "never by dropping an outcome, a constraint, or a non-goal."

5. [PASS] Reviewer checklist gains a row flagging an overrun, routed to the owning role by artifact, naming the block/measured-vs-allowed size.
   - Evidence: `plugins/wf/agents/charter-reviewer.md:58` — checklist row 15; `Route` names only the owning roles (`decomposer` / `charter-writer`); the naming-the-block/measured-vs-allowed-size instruction is in the `Pass condition` cell, which now also directs the finding to be "scored ... under the HIGH severity floor below."

6. [PASS] The overrun check blocks in every round irrespective of WF-551's changed-text rule, stated as a named exception beside that rule.
   - Evidence: `plugins/wf/agents/charter-reviewer.md:29` (`full-audit` mandate) — "**Exception:** check 15 (size budget) carries the HIGH severity floor below, so every finding it raises tags `blocking: yes` here too"; `:35` (`verification` mandate) — the matching round-≥2 exception, unchanged in substance from the prior round. `:66` adds a "**Size-budget floor.** Check 15 is never scored below **HIGH** ... This is what makes an overrun blocking in round 1 under the host's plain CRITICAL/HIGH rule, exactly as the Mandate's exception makes it blocking in round ≥2." Cross-checked against `plugins/wf/skills/charter/SKILL.md:188-189` (Phase 5 rules 3–4, unmodified by this branch): rule 3 gates the non-blocking path on "no CRITICAL or HIGH," and rule 4 makes round-1 CRITICAL/HIGH findings blocking — since check 15 can now never score below HIGH, a round-1 check-15 finding can never fall into rule 3's path. **The previous round's correctness-auditor FAIL on this exact point (the round-1 gap) is now closed** — confirmed independently this round by the correctness-auditor lens (see Capability findings, "confirmed fixed" note).

7. [PASS] Decomposer: an irreducible overrun is reported as a product choice on `Flags:`, content kept, never truncated.
   - Evidence: `plugins/wf/agents/charter-decomposer.md:22`.

8. [PASS] Writer: the symmetric case is recorded under `## Open questions`, never truncated.
   - Evidence: `plugins/wf/agents/charter-writer.md:25` — "record it under `## Open questions` as `- product choice needed: <one line naming the overrun> (blocks: <what it blocks>)`, matching the section's own required shape."

9. [PASS] Rationale for the chosen numbers lives in the `references/` doc, not the runtime bodies.
   - Evidence: `plugins/wf/skills/charter/references/convergence-loop.md:165-284` (SUB-3 section) carries the full justification, now including a new paragraph ("Why the round-1 half of that is a severity floor rather than a host rule," `:241-253`) added since the last audit round; the three agent files state only the bare numbers with no rationale prose. This item is about *placement*, not the rationale's internal accuracy — see the consistency-auditor FAIL below on a genuine self-consistency defect in this same section's per-block-figure framing.

10. [PASS] AC1 — a `02_subtasks.md` with one `SUB-n` block over its per-block budget → reviewer emits exactly one finding for this check, routed to `decomposer`, naming the block and measured vs. allowed size.
    - Evidence: `plugins/wf/agents/charter-reviewer.md:58`, `Pass condition` cell: "name the offending block (for `02_subtasks.md`) plus the measured vs. allowed size in the finding's `fix:` text"; `Route` cell: "decomposer (`02_subtasks.md`)."

11. [PASS] AC2 — `02_subtasks.md` over its total budget with every block within its per-block budget → one finding routed to `decomposer`.
    - Evidence: `plugins/wf/agents/charter-reviewer.md:58` — the pass condition is a conjunction ("every `## SUB-n` block ≤40 lines **and** the file ≤220 lines total"), so a total-only overrun still trips the same single check.

12. [PASS] AC3 — `01_charter.md` over its total budget → one finding routed to `charter-writer`, naming measured vs. allowed size.
    - Evidence: `plugins/wf/agents/charter-reviewer.md:58`, `Route` cell: "charter-writer (`01_charter.md`)"; the measured-vs-allowed-size instruction is in the same row's `Pass condition` cell.

13. [PASS] AC4 — both artifacts within budget → this check emits no finding.
    - Evidence: `plugins/wf/agents/charter-reviewer.md:58` pass condition, plus the Mandate's standing "report every finding you identify" — nothing to report when the condition holds.

14. [PASS] AC5 — a decomposer revision that successfully brings `02_subtasks.md` back within budget (without removing acceptance scenarios or retiring sub-tasks) reports the change in its output block.
    - Evidence: `plugins/wf/agents/charter-decomposer.md:22` — "**Report a successful trim** via `Flags: trimmed to size budget: <one line>`"; `:98` — the Output contract's `Flags:` enumeration lists `"trimmed to size budget: <one line>"` alongside the other literals.

15. [PASS] AC6 — a writer revision that successfully brings `01_charter.md` back within budget (without dropping an outcome/constraint/non-goal) reports the change in its output block.
    - Evidence: `plugins/wf/agents/charter-writer.md:25` — "**Report a successful trim** via `Flags: trimmed to size budget: <one line>` in your output block"; `:116` — the `Flags:` line in the Output contract.

16. [PASS] AC7 — an irreducible overrun: decomposer keeps the content, leaves the overrun, reports it as a product choice on `Flags:`, never truncates.
    - Evidence: `plugins/wf/agents/charter-decomposer.md:22`, verbatim match to the requirement.

17. [PASS] Out-of-scope items correctly left untouched — no budget added to the review log; scope-freeze, WF-551's convergence rules, and the cap gate are untouched.
    - Evidence: `git diff --stat 19ec254..HEAD` touches only the 6 files listed under Scope; no `03_review-log.md` template or `SKILL.md` Phase-5 cap-gate logic is in the diff (confirmed `plugins/wf/skills/charter/SKILL.md` has zero diff against base and is still 280 lines).

18. [PASS] Exact numeric budgets are grounded in the converged corpus (`C025–C028` decompositions at 112–220 lines; charters at 107–140 lines).
    - Evidence: `plugins/wf/skills/charter/references/convergence-loop.md:167-172` now states direct per-charter measurements — `02_subtasks.md` ran 112 (C026), 177 (C027), 198 (C028), 220 (C025) lines; `01_charter.md` ran 107 (C025), 111 (C028), 121 (C027), 140 (C026) lines — matching this requirement's cited 112–220/107–140 bands exactly, and explicitly disclaiming the prior round's faulty "see 'The non-convergence pattern' above" citation. **This closes the previous round's consistency-auditor FAIL on the totals' citation** (confirmed by this round's consistency-auditor). `_local/` is gitignored and worktree-local, so the underlying corpus files are not present in this worktree to independently re-measure; this item still rests on the document's own (now internally consistent) direct-measurement assertion. Note this PASS is scoped to the two *total-file* budgets (220/140) the requirement text names; see the consistency-auditor FAIL below for a distinct, newly-found defect in how the *per-block* 40-line figure's derivation is framed in this same section.

19. [PASS] Core stays domain-free.
    - Evidence: `grep -inE "angular|react|typescript|c#|\.net|node\.js|azure devops|jira\b"` across all four touched prose files returns 0 hits; the files use only wf's own generic vocabulary (`SUB-n`, `OUT-n`, `charter`, `decomposer`).

20. [PASS] Reviewer stays read-only.
    - Evidence: `plugins/wf/agents/charter-reviewer.md:21` (unchanged) — "Read-only — no Write, no Edit, no tracker calls." This round's edits (Mandate exceptions, checklist row 15, Severity floor bullet) add no write path.

21. [N/A] `SKILL.md`, if touched, ends no higher than its line count at the start of this slice.
    - `plugins/wf/skills/charter/SKILL.md` is absent from the diff (still 280 lines, zero-line diff against base) — the constraint is vacuously satisfied.

22. [PASS] Version bump follows the charter tier rule (PATCH by default; MINOR only if a shape must change).
    - Evidence: `plugins/wf/.claude-plugin/plugin.json` and the `wf` entry in `.claude-plugin/marketplace.json` both still read `0.144.0`; the marketplace top-level version still reads `0.190.2`, unchanged since the prior round's MINOR bump (recorded in `05_verify-fix.md`). The three commits audited this round are wording-only fixes to already-shipped fields — no further shape change, so no additional bump is needed. `npm run build` in `plugins/wf/mcp` exits 0 (this worktree's `node_modules` had to be restored via `npm ci` first — an environment gap, not a defect in the diff), confirming both JSON manifests still parse.

23. [PASS] Touched files are limited to the three role agents, the `references/` doc, and the two version manifests.
    - Evidence: `git diff --stat 19ec254..HEAD` lists exactly `.claude-plugin/marketplace.json`, `plugins/wf/.claude-plugin/plugin.json`, `plugins/wf/agents/charter-decomposer.md`, `plugins/wf/agents/charter-reviewer.md`, `plugins/wf/agents/charter-writer.md`, `plugins/wf/skills/charter/references/convergence-loop.md` — nothing more, across all commits since base.

## Capability findings

- **audit** (correctness-auditor) — [FAIL] `d2421c9`'s decomposer size-budget escape hatch (commit message: "Mirror the writer's closed enumeration in the decomposer's escape hatch") does not actually mirror `charter-writer.md:25`'s protected pair. The writer protects "an outcome, a constraint, or a non-goal"; the decomposer's new enumeration protects only "an acceptance scenario, a constraint, an assumption, or a verification-evidence entry" — omitting the SUB-block's direct analogues of the writer's two protected categories: `**Desired outcome:**` (the outcome analogue) and `**Out of scope:**` (`charter-decomposer.md:74`, "especially work owned by a sibling SUB" — the non-goal analogue). As written, a decomposer trimming toward the 40/220-line budget can shrink or drop a SUB's `Desired outcome` or `Out of scope` content as "implementation-detail prose" without ever triggering the "keep the content, report `product choice needed`" escape valve — contradicting the shared rationale's own statement (`convergence-loop.md:255-256`, unchanged) that cutting "would silently delete acceptance scenarios, outcomes, constraints, or non-goals," and weakening reviewer checks 3 (No overlap), 7 (Scope discipline), 8 (Vertical value), and 11 (Testability), which rely on those fields. at `plugins/wf/agents/charter-decomposer.md:22` vs `plugins/wf/agents/charter-writer.md:25` and `plugins/wf/skills/charter/references/convergence-loop.md:255-256` — Remedy: extend the protected enumeration in `charter-decomposer.md:22` to also name the SUB-level outcome/scope-boundary fields, e.g. "...never by dropping a desired outcome, an out-of-scope exclusion, an acceptance scenario, a constraint, an assumption, or a verification-evidence entry...".
- **audit** (correctness-auditor) — [PASS, confirmed fixed] The previous round's FAIL (round-1 dispatch not honoring the check-15 blocking exception) and its companion WARN (Severity section's LOW bullet contradicting the exception) are both independently confirmed closed this round: the new "Size-budget floor" bullet (`charter-reviewer.md:66`) makes every check-15 finding score HIGH, which `SKILL.md` Phase 5 rules 3–4 (unmodified, `:188-189`) already treat as blocking in round 1 — no host change was needed.
- **audit** (consistency-auditor) — [FAIL] `d2421c9`'s SUB-3 rewrite (`convergence-loop.md:167-190`) opens by asserting a single uniform derivation for all three budget numbers — "All three are the corpus's own converged ceiling, not a headroom-padded guess" (`:168`) and "Each budget is set at the top of the range charters that actually reached `Converged` already lived inside — a budget any of those four runs would have passed without a single size-related revision" (`:173-175`) — but this holds only for the two *total-file* budgets (220, 140), which the same paragraph directly measures against the four `Converged` charters. The 40-line *per-block* figure is never measured against those four converged charters at all (no per-block sizes are given for C025–C028 anywhere in the document); the very next sentences (`:179-190`) derive it by a different method entirely — halving the *runaway, non-converged* files' (C029/C030) observed per-block average, then cross-checking against the decomposer template's field count. A number whose framing sentence claims "top of the converged range" provenance while its actual worked derivation two sentences later uses an unrelated formula against the non-converged population is the same species of defect as the FAIL this rewrite was meant to fix (a load-bearing claim resting on evidence that doesn't establish it), reintroduced for the per-block figure specifically. at `plugins/wf/skills/charter/references/convergence-loop.md:167-175` vs `:179-190` — Remedy: narrow the "top of the converged range" framing sentence (`:173-175`) to the two total-file budgets only, and let the per-block paragraph stand on its own (bloat-average-halved, field-count cross-checked) without implying it shares the converged-range grounding — or add actual per-block measurements from the four `Converged` charters if the intent is to ground 40 the same way.
- **audit** (consistency-auditor) — [PASS, confirmed fixed] The previous round's FAIL (the SUB-3 rationale's numbers citing "The non-convergence pattern," a section that doesn't support them) and its companion WARN (the field-count arithmetic: "about ten fields"/"four lines per field" not matching the doc's own 12–13-field list) are both confirmed closed: the rewrite states direct per-charter measurements instead of that citation, and corrects the field count to "thirteen" with "roughly three lines per field," which is now arithmetically consistent (40÷13 ≈ 3.08) with the fully-enumerated 13-field list in the same sentence.
- **audit** (convention-auditor) — [WARN] Same underlying gap as the correctness-auditor FAIL above, convention angle: the decomposer's `d2421c9` enumeration was written specifically to "mirror" the writer's closed enumeration but the two "closed enumeration" escape hatches diverge on exactly the content categories (outcome / non-goal analogues) the mirroring commit was meant to make consistent, with no stated reason for the asymmetry. at `plugins/wf/agents/charter-decomposer.md:22` vs `plugins/wf/agents/charter-writer.md:25` — Remedy: as above, add the SUB-n analogues of the writer's protected pair, or state explicitly (next to the enumeration) that Desired-outcome/Out-of-scope trimming is intentionally permitted so the asymmetry reads as a deliberate choice.
- **audit** (security-auditor) — [PASS] No security-relevant surface in this prose-only role-contract change (no injection sinks, auth logic, secrets, resource limits, concurrency constructs, or error-leakage paths); confirmed against the three newest commits as well as the full diff.
- **audit** (operational-auditor) — [PASS] No operational surface (dependencies, logging, accessibility, idempotency, migrations, configuration) is touched by this prose-only change; the two version-manifest fields are unchanged from the prior round.
- **author-caps** (structural-validation) — clean — the applies-when condition (a capability `manifest.md`, registry row, or `SKILL.md`/`interface.md` pair) is not met by this diff; no validation work performed, per the fragment's own no-op rule.
- **author-caps** (reference-existence) — clean — `validate_references` (scoped to every plugin's `skills`/`agents` trees): 126 files scanned, 370 references resolved, 0 findings.

## Deviations from derived artifacts (informational)

- `02_plan.md`'s Resolution Summary still describes the version bump as PATCH `0.143.1 → 0.143.2`. The branch's actual final state is MINOR `0.144.0`, per `05_verify-fix.md`'s recorded rationale (the writer's output-block shape change). `02_plan.md` was never updated to reflect this — informational only, unchanged from the previous round.

## Recommended next actions

- Extend `charter-decomposer.md:22`'s protected-content enumeration to cover the SUB-level analogues of the writer's outcome/non-goal protections (`Desired outcome`, `Out of scope`) — closes both the correctness-auditor FAIL and the convention-auditor WARN in one edit.
- Narrow `convergence-loop.md:173-175`'s "top of the converged range" framing sentence so it no longer claims the per-block 40-line figure shares the two total-file budgets' converged-corpus derivation, since its actual derivation (a few sentences later) uses the runaway files' bloat data instead — closes the consistency-auditor FAIL.
- Note for the record: this round confirms both of the *previous* round's FAILs (the round-1 blocking gap; the SUB-3 citation gap) are genuinely closed, alongside all three of that round's WARNs — the residual findings above are new, introduced by the same three commits (`d2421c9`, `bc5d0f8`, `c2c1a0c`) that closed the old ones.

Next: fix the two findings above in `charter-decomposer.md` and `references/convergence-loop.md`, then re-run `/wf:verify-spec WF-553`. Neither open finding carries a single-literal `Expected` value at a cited line (both are wording/scope edits requiring a judgment call on the replacement phrasing), so no `/wf:verify-fix` mechanical-fix suggestion applies this round.

---
