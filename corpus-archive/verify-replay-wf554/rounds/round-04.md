# verify-spec: WF-554

**Source:** `_local/WF-554/00_reqs.md`
**Branch:** `feature/554-offer-one-explicit-user-gate-when-the`
**Commit:** `bbbb06af1fb2f711929033dd76a4047b1a717e8f`  (base `831930f` — immediate parent commit; this task's own change is scoped to the four commits `d045beb`, `ba0351d`, `84868d6`, and `bbbb06a` on top of it. Note: the local `main` ref in this worktree is stale — `git merge-base HEAD main` resolves many merges behind — so a `main...HEAD` diff would spuriously include already-shipped sibling work (WF-522, WF-551, WF-552, WF-553, and others). The audit below is scoped to `831930f..HEAD`, which is exactly the four files this task's own plan lists as touched.)
**Tree:** clean
**Scope:** 4 files, +150/-13 vs parent commit `831930f` (4 commits: `d045beb` gate + `ba0351d` idempotency-marker follow-up + `84868d6` applied-at-completion/stop-resume follow-up + `bbbb06a` one-rule re-entrancy follow-up)
**Verdict:** PARTIAL  (16/17 requirements — see Capability findings for the reason this is not a clean PASS)
**Audited by:** claude-sonnet-5
**Audited at:** 2026-09-04T20:36:00Z

## Requirements

1. [PASS] Given `Revisions used: 3 of 3` and ≥1 blocking finding, an interactive cap hit asks the user once (extend/accept/stop) and the choice is appended to the review log before anything else happens.
   - Evidence: `plugins/wf/skills/charter/SKILL.md:192` — "interactive asks once via `AskUserQuestion`... and appends the choice as a new `status: pending` row... *before* acting." Unchanged by `bbbb06a`.

2. [PASS] Choosing extend dispatches exactly one more revision.
   - Evidence: `SKILL.md:192` — extend "raise[s] `<cap>` by 1 in place... then fall[s] through to 'Otherwise spend a revision' below." The revision-count semantics are unchanged; only the resume-completion facts around this sequence were rewritten by `bbbb06a`. See Capability findings for a residual defect in how the writer/decomposer sub-step of that fall-through is guarded on resume.

3. [PASS] The review-log header's `Revisions used: <M> of <cap>` denominator is raised in place, grepped `M of cap` shape unchanged.
   - Evidence: `SKILL.md:192` — "raise `<cap>` by 1 in place (the grepped `M of cap` header shape unchanged...)"; header line unchanged at `SKILL.md:99` and `SKILL.md:181`.

4. [PASS] Hitting the cap again re-asks the gate at most once per cap hit.
   - Evidence: `SKILL.md:192` — "The gate itself is asked at most once per cap value — a later hit at a newly raised `<cap>` is a new pair, asked fresh."

5. [PASS] Choosing accept records residual findings' fingerprints under `## Accepted warnings`, sets `**Status:** Converged`, final block `CHARTER — Converged with warnings`.
   - Evidence: `SKILL.md:192` — "accept fingerprints every residual blocking finding under `## Accepted warnings`... and sets `**Status:** Converged`... then marks the row `applied`, ends `CHARTER — Converged with warnings`." `bbbb06a` additionally states the fingerprint step is drawing from a "fingerprint set... so one already recorded is never written twice," closing the prior audit's dedup WARN. All three lenses that examined this branch (correctness, operational, consistency) independently returned PASS for it.

6. [PASS] Choosing stop ends `CHARTER — Blocked` listing residual findings, artifacts preserved — same shape as today's stop.
   - Evidence: `SKILL.md:192` — "stop ends `CHARTER — Blocked` (max rounds), residual findings listed, and marks the row `applied` — it writes no artifact state, so it is idempotent by construction." All lenses that examined this branch returned PASS (operational flagged a harmless internal wording nit: the clause both "marks the row `applied`" and claims to write "no artifact state" — the `applied` mark is itself a review-log write, just not charter/subtask artifact state; cosmetic only).

7. [PASS] A recorded cap-gate choice is honored on a resumed run (after `/clear`) without re-asking.
   - Evidence: `SKILL.md:94` (State-model row), corrected by `bbbb06a` to read "never a fresh Phase 4 to re-derive those findings; only the extend branch's own re-review of the *next* round, under that rule's re-entrancy facts" — this fixes the prior audit's finding that the row over-claimed "never re-dispatch Phase 4" (the consistency lens independently confirmed this row now matches rule 4's actual chain and the parallel claim in `references/convergence-loop.md:462-464`). `bbbb06a` also replaces the prior audit's flagged inaccurate "never the last entry" parenthetical with a completion-based invariant ("`applied` therefore means every fact is on disk and no step remains") — a `grep` for "last entry" across both touched files returns no hits, confirming no orphaned reference to the removed language remains. The literal "no re-ask" behavior holds in every case examined. However, three lenses (correctness, operational, consistency) independently found that the *fact* this commit assigns to the extend branch's "writer/decomposer dispatch" step is coarser than the two-dispatch action it must guard, so a resume landing inside that window does not re-ask the gate but can still reach an incorrect outcome — see the `[FAIL]` capability finding below. This is a residual defect on top of the requirement, not a failure of the literal "no re-ask" text (matching the pattern of the two prior audit cycles on this task).

8. [PASS] A headless run at the cap with blocking findings still ends `CHARTER — Blocked` exactly as today — no gate, never a hang.
   - Evidence: `SKILL.md:192` — "**headless** stops `CHARTER — Blocked` (max rounds), residual findings listed, no gate, exactly as before." Unchanged by `bbbb06a`.

9. [PASS] `plugins/wf/skills/charter/SKILL.md` ends no longer than its start-of-slice line count (280 lines).
   - Evidence: `wc -l plugins/wf/skills/charter/SKILL.md` → 279. `bbbb06a` is a net two-line replacement inside the file (no line-count change).

10. [PASS] Rationale for the new gate lives in `references/convergence-loop.md`'s reserved SUB-4 section, not inline in `SKILL.md`.
    - Evidence: `plugins/wf/skills/charter/references/convergence-loop.md:379-405` — `bbbb06a` added the "Why the guard is stated once for the whole follow-through rather than per step" rationale block, and `references/convergence-loop.md:459-464` amends the closing SUB-4 paragraph to explain the extend branch's re-review scope. `SKILL.md`'s rule 4 stays a single dense operational paragraph with no "why" prose.

11. [PASS] Domain-noun grep of the touched core skill stays clean.
    - Evidence: `grep -inE 'angular|typescript|react|\.net|c#|node\.js|python|django|java\b|kotlin|swift|linear|jira|ado\b|azure devops|github|gitlab' plugins/wf/skills/charter/SKILL.md plugins/wf/skills/charter/references/convergence-loop.md` → 0 hits.

12. [PASS] Only the user can extend the cap — never auto-extended, headless never softens this.
    - Evidence: `SKILL.md:192` — extend is reachable only through the interactive `AskUserQuestion` branch; the headless branch never touches `<cap>`. Unchanged by `bbbb06a`.

13. [PASS] Touched files limited to `SKILL.md`, the paired `references/` doc, and the two version manifests.
    - Evidence: `git diff --stat 831930f HEAD` → exactly `.claude-plugin/marketplace.json`, `plugins/wf/.claude-plugin/plugin.json`, `plugins/wf/skills/charter/SKILL.md`, `plugins/wf/skills/charter/references/convergence-loop.md`. `git show --stat bbbb06a` → only `SKILL.md` and the references doc — no further manifest bump, consistent with one version bump per task/PR (the manifests were already bumped at `d045beb`).

14. [PASS] Headless runs must never hang waiting on a gate.
    - Evidence: `SKILL.md:192` headless clause is unconditional and synchronous (no wait state introduced).

15. [PASS] Phase 5 remains the sole retry owner — no other phase gains cap-adjacent state.
    - Evidence: the only state-model wiring touching this mechanism (`SKILL.md:94`) routes *into* Phase 5 rule 4 rather than introducing cap logic in any other phase; Phases 0–4 and 6 are untouched by `bbbb06a`.

16. [PASS] Version bump is PATCH-tier and correctly applied to both manifests plus the marketplace top-level version.
    - Evidence: `plugins/wf/.claude-plugin/plugin.json:3` → `0.144.1`; `.claude-plugin/marketplace.json:14` (wf entry) → `0.144.1`; `.claude-plugin/marketplace.json:4` (top-level) → `0.190.3`. Unchanged by `bbbb06a`, which needed no new bump on top of the already-bumped `d045beb` (one bump per task/PR, per repo convention).

17. [UNVERIFIABLE] "Verification evidence": replay against `_local/C031`'s final on-disk state (round 4, `Revisions used: 3 of 3`, 7 residual findings).
    - `_local/C031` does not exist in this worktree — the spec itself notes the corpus is "gitignored, not present in this worktree." Cannot be statically replayed; would need a live interactive session against that fixture. (Known-and-accepted per task scope — not re-litigated.)

## Capability findings

**audit** (5 lenses dispatched against `bbbb06a` specifically, adversarially scoped to its freshly added text: correctness, security, convention, consistency, operational — all delivered). This follow-up commit directly targeted the prior audit's three residual findings (one FAIL, two WARN, all about the cap-gate follow-through's idempotency) by replacing the per-branch ad-hoc guards with one stated re-entrancy rule. It closes the prior FAIL's core scenario (a resume between the cap raise and the ordinary increment/dispatch/re-review sequence no longer re-runs that whole sequence) and both prior WARNs (the accept branch's fingerprint write is now explicitly a dedup'd set; the inaccurate "never the last entry" parenthetical is replaced with a completion-based invariant). A fresh, adversarial pass against this same new text surfaced one new defect that is more severe than what it replaced, plus several smaller residuals:

- **audit** — [FAIL] The new re-entrancy rule assigns a single compound fact — "the on-disk artifacts differ from round `<N>`'s snapshot" — to what rule 193 (unchanged) can require as **two** sequential, conditionally-dependent dispatches: the writer, then the decomposer only when the writer reports `Scope changed: yes`. `Scope changed: yes` is a conversational report, never persisted to disk. If a `/clear` lands after the writer has already edited `01_charter.md` (satisfying the compound fact) but before the required decomposer re-dispatch, a resumed run sees the dispatch step's fact already true, skips straight to checking the re-review fact (`## Round <N+1>` heading), finds it absent, and dispatches Phase 4 to review a charter/subtasks pair that rule 193 itself calls invalid ("a changed charter invalidates the decomposition") — silently omitting a mandatory decomposer re-dispatch rather than merely repeating one. Independently raised with matching evidence and file:line citations by three lenses (correctness, operational, consistency). `plugins/wf/skills/charter/SKILL.md:192` vs `:193`. The disclosed residual in `references/convergence-loop.md:395-397` ("a revision whose writer provably changed nothing... is re-dispatched on resume") describes only the benign sibling case and does not mention this materially riskier one — the operational lens flagged this disclosure gap as its own finding. — Remedy: split the dispatch fact in two — writer-differs-from-round-`<N>`-snapshot, and (only when `Scope changed: yes` was reported) a separate decomposer-differs-from-round-`<N>`-snapshot fact — so a resume cannot conflate "the writer ran" with "the decomposer also ran."
- **audit** — [WARN] Between the writer/decomposer dispatch and the Phase-4 re-review, rule 193's unchanged text also performs an id-diff / `consumed: yes|no` growth-authorization step (and a possible unauthorized-growth `AskUserQuestion`). The new re-entrancy chain names no fact for this step, so a resume landing after dispatch completes but before the id-diff/consumed-marking finishes has no instruction to still run it, and could proceed straight to re-review once the (also-satisfied) dispatch fact is seen — silently skipping unauthorized-growth detection for that revision. `SKILL.md:192` vs `:193`. Raised by the correctness lens. — Remedy: name an explicit fact for the id-diff/consumed step (e.g., "this round's `Growth authorizations` entries are all resolved to `consumed`/`declined`") or fold it explicitly into the dispatch step's own completion fact.
- **audit** — [WARN] The `## Round <N+1>` heading fact for "re-review already ran" is a plain substring/heading match over `03_review-log.md`, which is built by verbatim-appending reviewer/writer output that ultimately traces back to tracker-sourced, potentially untrusted text. Nothing in the new rule requires the heading to be a genuine structural marker written only by the skill's own append step, rather than incidental text appearing inside quoted/appended prose (e.g. a literal `## Round 5` substring in a reviewer's evidence quote). A crafted appearance of that heading text could make a resume believe the re-review already ran, skip it, and mark the row `applied` without the review actually happening. Raised by the security lens. `SKILL.md:192`. — Remedy: match only a genuine top-of-block heading anchored at the start of the most-recently-appended section, not a raw substring search over the whole file.
- **audit** — [WARN] The new "on-disk fact" vocabulary (`SKILL.md:192`) is a fourth, unrelated name for a concept the file already names three other ways: the growth mechanism's `consumed: yes/no` marker (`:187`, `:193`), the once-per-round snapshot guard ("skip it when round N's snapshot files already exist," `:193`), and the Phase 6 publish **ledger** (`:99`, `:212`). Raised by the convention lens. — Remedy: reuse the established vocabulary (e.g. "durable marker"/"ledger entry") rather than introducing "fact" as a parallel term for the same idea.
- **audit** — [WARN] `SKILL.md:192` retains the pre-existing "marks the row `status: applied` only once its entire outcome below is reached, never earlier" clause immediately alongside the new "One re-entrancy rule governs every branch... mark `applied` when the last step's fact is present" sentence — both assert the identical completion-only-then-`applied` constraint in two vocabularies back to back. Raised by the convention lens. — Remedy: delete the superseded "never earlier" clause or fold it into the new sentence.

**author-caps** — [PASS] `validate_skill_interface` and `validate_references`, both scoped to the `charter` skill, report `status: pass` — 0 findings (skill-interface: 1 skill checked; references: 2 files scanned, 14 references resolved against the tree). No schema or dead-reference defects introduced by `bbbb06a`.

## Deviations from derived artifacts (informational)

- `plugins/wf/README.md:115` still advertises "a ≤3-round cap" in the charter skill's one-line catalogue summary. This diff makes that phrase stale — the cap is now user-extendable past 3 in an interactive run. README was correctly out of the plan's declared touched-file scope (Constraints: "Touched files: `SKILL.md`, the `references/` doc, the two version manifests"), so this is not a requirement failure, but it is a real doc-drift the plan didn't anticipate. (Unchanged since the prior three audits — no commit in this task has touched the README.)

## Recommended next actions

- Split the extend branch's "writer/decomposer dispatch" fact into two independently-checked facts (writer-vs-snapshot, and — only when `Scope changed: yes`) — decomposer-vs-snapshot, so a resume between the two sub-dispatches can no longer skip a decomposer re-dispatch that rule 193 requires.
- Name an explicit on-disk fact for the id-diff / growth-`consumed` step between dispatch and re-review, so a resume mid-window doesn't silently skip unauthorized-growth detection.
- Anchor the `## Round <N+1>` re-review fact to a genuine structural heading (start of the most-recently-appended block), not a raw substring match over verbatim-appended, potentially untrusted review-log text.
- Consolidate the "fact" vocabulary with the file's existing idempotency idioms (`consumed: yes/no`, the once-per-round snapshot guard, the publish ledger) and drop the now-redundant "never earlier" clause superseded by the new re-entrancy sentence.
- Consider a follow-up doc fix to `plugins/wf/README.md:115`'s "≤3-round cap" phrase (out of this task's scope, but now stale).
