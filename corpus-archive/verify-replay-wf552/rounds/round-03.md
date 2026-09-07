# verify-spec: WF-552

**Source:** `_local/WF-552/00_reqs.md`
**Branch:** `feature/552-freeze-charter-scope-after-round-1`
**Commit:** `262f55538df5e1b85174f92f99f6bfb7e2679e31`  (base `8d3da8508602dbdb152c4742f25d7fede22fbe66`)
**Tree:** clean
**Scope:** 7 files vs `main`'s common ancestor, across this task's three commits `d9bb9a5`+`dbcf564`+`262f555` (`git diff d9bb9a5^..262f555 --stat` = 7 files, +65/-13). Note: `main...HEAD` is much larger because this branch stacks on several already-merged, unrelated tasks (WF-551, WF-522, …); only the three WF-552 commits are in scope for this audit.
**Verdict:** FAIL  (19/22 requirements, 2 PARTIAL, 1 UNVERIFIABLE)
**Audited by:** claude-sonnet-5
**Audited at:** 2026-09-04 15:40 UTC

Round 3 — re-audits the full requirement set fresh against the current on-disk `SKILL.md`/agents/reference doc (not just the 2 previously-failing items) per `05_verify-fix.md`'s "Round 2" section. Round 3 is the last cycle before this pipeline's verify⇄fix cap.

## Requirements

1. [PASS] Active `OUT`/`SUB` counts stay non-increasing whenever no growth authorization is in the log
   - Evidence: unchanged since round 2 — the dispatch-prompt trigger requires the entry's status to literally read `granted, consumed: no` (`plugins/wf/skills/charter/SKILL.md:140,158`), and Phase 5 rule 4's post-revision match requires the same status before treating a new id as authorized (`SKILL.md:192`). Growth with zero recorded entry is still blocked in every path.
   - Caveat (non-gating; see Capability findings, `audit` security warn): the check still does not scope a match to *this* dispatch's own entry, so a stale `granted, consumed: no` entry from an earlier gap could in principle be consumed by an unrelated later dispatch.

2. [PASS] Retirement uses the unchanged `~~OUT-n~~ retired: <why>` / `~~SUB-n~~ retired: <why>` form
   - Evidence: `plugins/wf/agents/charter-writer.md:24,39`, `plugins/wf/agents/charter-decomposer.md:21,32` — unchanged by round 3.

3. [PASS] Ids are never renumbered (pre-existing rule, unchanged by this diff)
   - Evidence: `plugins/wf/agents/charter-decomposer.md:32` — "Never renumber: retire (...) freely, but append a new id only when...".

4. [PASS] A reword/retire revision returning `Scope changed: yes` still re-dispatches the decomposer as today, and raises no growth finding (no id is new)
   - Evidence: `plugins/wf/skills/charter/SKILL.md:192` — the re-decompose clause is unchanged by round 3; the id-diff only fires on an actually-new id, which a reword/retire never produces.

5. [PASS] A finding / `## Open questions` entry / deferred Phase-3 `Flags:` choice needing a new id routes to `user` and is asked as the two-option gate, with the choice recorded in the review log
   - Evidence: `plugins/wf/agents/charter-reviewer.md:68`; `plugins/wf/skills/charter/SKILL.md:186` (two options: *accept gap as warning* / *authorize one growth revision*, both recorded). Unchanged since round 2; round 1's CORR-1 stays closed (no lens re-raised it).

6. [PARTIAL] Exactly one growth revision may add ids per recorded authorization, bounded to the authorized gap and count
   - Sub-claim "bounded to the authorized gap" — [PASS]. The growth-authorize branch of Phase 5 rule 1 now diffs active ids against a snapshot (reusing rule 4's write) and matches "the one new id addressing the entry's `<gap>`" before marking it `consumed: yes` (`SKILL.md:186`) — this closes round 2's core gap (no snapshot/diff at all existed in this branch).
   - Sub-claim "bounded to ... count" — [FAIL]. The branch defines only two outcomes: "the one new id addressing the entry's `<gap>` → consumed: yes" and "no new id → leave consumed: no". Unlike its sibling, rule 4 (`SKILL.md:192`), it has **no third outcome** for "any other new id" — two or more new ids, or a new id that doesn't address the granted `<gap>`. Rule 4 explicitly closes that case ("any other new id → unauthorized growth — raise a user-routed check to retroactively authorize ... or retire the extra id(s) back (headless: `CHARTER — Needs input`, never silently legitimized)"); rule 1's growth-authorize branch has no equivalent, so a dispatch that adds an unauthorized extra id alongside the authorized one is not caught by this branch's own text.
   - Location: `plugins/wf/skills/charter/SKILL.md:186` (missing case) vs `:192` (has it).
   - Remedy: append the same "any other new id → unauthorized growth — raise a user-routed check to retroactively authorize (record a fresh `consumed: yes` entry) or retire the extra id(s) back (headless: `CHARTER — Needs input`, never silently legitimized)" clause to rule 1's growth-authorize branch, mirroring rule 4 verbatim.
   - Corroborated independently by `audit` correctness, security, and consistency (all [FAIL], same citation pair `:186` vs `:192`) and `audit` convention ([WARN], same gap).

7. [PARTIAL] The host's post-revision id-diff check runs immediately after *every* revision-triggering dispatch and before the next Phase 4 review, catching unauthorized growth regardless of `Scope changed:`
   - Sub-claim "runs immediately after the dispatch" — [PASS]. Round 1/2's reachability defect (the check nested unreachably, or entirely absent, from this branch) is fixed: the growth-authorize branch now snapshots before dispatch and diffs immediately after (`SKILL.md:186`).
   - Sub-claim "before the next Phase 4 review" — [FAIL]. Unlike rule 4, which ends "Then re-review the **full artifact set** (Phase 4)", and rule 1's own ordinary-answer sub-path, which ends "...before re-review; that integration pass counts as a revision either way", the growth-authorize branch ends at "no new id → leave `consumed: no` — re-read this section before ever re-asking" with no instruction to return to Phase 4. A round resolved solely by a growth-authorize dispatch (no co-occurring rule-4 blocking finding) has no stated path back into review.
   - Sub-claim "catching unauthorized growth regardless of `Scope changed:`" — [FAIL]. Same root cause as requirement 6: the branch has no "any other new id" case, so an extra/mismatched id from this specific dispatch is not caught.
   - Location: `plugins/wf/skills/charter/SKILL.md:186` (both gaps) vs `:192` (has both: the third id-diff branch and the explicit re-review instruction).
   - Remedy: add the missing third id-diff branch (see requirement 6's remedy) and append an explicit re-review instruction to the growth-authorize branch, e.g. "...leave `consumed: no`; then re-review the full artifact set (Phase 4) before evaluating rules 2–4."
   - Corroborated independently by `audit` correctness (both the missing-branch and missing-re-review gaps), `audit` security, and `audit` consistency.

8. [PASS] A rule-1 user answer whose integration needs a new id is itself auto-recorded as the growth authorization, with no separate gate, and `Revisions used` increments once
   - Evidence: `SKILL.md:186` — the ordinary-answer sub-path (distinct from the growth-authorize sub-path in items 6/7) is unchanged by round 3 and remains fully self-contained: snapshot, dispatch, diff, auto-authorize, revision-count, and an explicit "before re-review" all in the same clause.

9. [PASS] A headless run needing growth ends `CHARTER — Needs input`; it never hangs
   - Evidence: `SKILL.md:186` — "**Headless run:** any `route: user` finding, or an unresolved `pending`/unauthorized growth item, ends the run at `CHARTER — Needs input` instead of a prompt" — unchanged since round 2.

10. [PASS] Writer revision-mode contract: fix/reword/retire freely; no new `OUT-n` id without a stated growth authorization; gap recorded under the existing `## Open questions` section; no new output-block field
    - Evidence: `plugins/wf/agents/charter-writer.md:24,31`; output contract (`:109-116`) field set unchanged; file untouched by round 3.

11. [PASS] Decomposer revision-mode contract: same, reported via `Flags: [growth] <one line>`; no new output-block field
    - Evidence: `plugins/wf/agents/charter-decomposer.md:21,32,97`; file untouched by round 3.

12. [PASS] Reviewer checklist: a finding needing a new outcome/sub-task (including a round ≥2 reviewer meeting a charter `## Open questions` entry) routes `user`; explicitly a routing rule only, never a growth detector
    - Evidence: `plugins/wf/agents/charter-reviewer.md:68`; file untouched by round 3.

13. [PASS] Phase 3: a revision-mode decomposer `[growth]`-tagged `Flags:` choice defers to the Phase 5 growth gate; every other choice keeps the immediate Phase 3 ask
    - Evidence: `SKILL.md:160` — the deferred flag is recorded immediately as `- Round <N> | gap: <flag text> | status: pending` under `## Growth authorizations`, unchanged since round 2 (closes round 1's C1).

14. [PASS] No new writer/decomposer output-block fields introduced
    - Evidence: both output contracts' field lists unchanged; `[growth]` is only a new value inside the existing `Flags:` / `## Open questions` free-text surfaces.

15. [PASS] The host records active `OUT`/`SUB` counts per round in the review log
    - Evidence: `SKILL.md:180` — `**Active:** OUT <n> · SUB <m>` line, worded as "a durable per-round audit trail; the growth check itself (Phase 5) always diffs the on-disk snapshot files, never this count line" — unchanged since round 2.
    - Caveat (non-gating; see Capability findings, `audit` operational [FAIL]): a newly-identified defect means this line's snapshot-time state and the on-disk snapshot file can now diverge in a *new* way (a multi-item growth round can clobber the round-N snapshot file after this line was already recorded) — see item 6/7's remedy area and the operational finding below.

16. [PASS] Roles keep their boundaries — growth-authorization and active-count records live only in `03_review-log.md`; the host never edits `01_charter.md`/`02_subtasks.md` beyond the pre-existing permitted metadata lines
    - Evidence: `SKILL.md:82` (host-owned outright), `:180`, `:186`.

17. [PASS] Core stays domain-free
    - Evidence: grep for stack/domain terms (`angular|node-ts|azure devops|linear\.app|typescript|c#|react\b|vue|django|rails`) across all five touched core files returned zero true hits.

18. [PASS] `SKILL.md` ends no higher than its line count at the start of the slice
    - Evidence: `git show d9bb9a5^:plugins/wf/skills/charter/SKILL.md | wc -l` = 280; current file = 280 lines — net 0 growth across all three commits.

19. [PASS] Version bump: PATCH
    - Evidence: `plugins/wf/.claude-plugin/plugin.json` and the marketplace's `wf` entry both `0.143.0`→`0.143.1`; marketplace top-level `0.190.0`→`0.190.1` (set in round 1/2, unchanged and still correct — round 3's single-line wording fix carries no new grepped-shape or argument-surface change, so no further bump is required).

20. [PASS] Touched files match exactly the constraint's list
    - Evidence: `git diff --numstat d9bb9a5^..262f555` shows exactly: `.claude-plugin/marketplace.json`, `plugins/wf/.claude-plugin/plugin.json`, `plugins/wf/agents/charter-decomposer.md`, `plugins/wf/agents/charter-reviewer.md`, `plugins/wf/agents/charter-writer.md`, `plugins/wf/skills/charter/SKILL.md`, `plugins/wf/skills/charter/references/convergence-loop.md` — no other file touched across all three commits.

21. [PASS] `references/convergence-loop.md`'s reserved `### SUB-2` section is filled with the slice's rationale
    - Evidence: `plugins/wf/skills/charter/references/convergence-loop.md:89-140` — covers why the host is the sole detector, the textual `[growth]` marker choice, id-diff vs. `Scope changed:`, the two-option gate, and rule-1 auto-authorization.
    - Round 2's caveat is now resolved: the doc's claim that growth detection "reuses SUB-1's snapshot mechanism directly" (line ~123) is now accurate for every branch, including the growth-authorize one, since it too now reuses rule 4's snapshot write. Confirmed independently by `audit` consistency this round (no stale rationale found).

22. [UNVERIFIABLE] The reqs' own "Verification evidence" — a replay of C031's final artifacts under the new contracts, and a first live run — showing non-increasing counts absent a logged authorization
    - Reason: requires executing the writer/decomposer/reviewer subagents against real inputs; cannot be confirmed from static code reading. No test/fixture file was added or required by this slice's touched-files constraint.

## Capability findings

**audit** (5 lenses dispatched: correctness, security, convention, consistency, operational — all delivered):

- **audit** (correctness) — [FAIL] Rule 1's growth-authorize branch (`SKILL.md:186`) has no fallback for "any other new id" (multiple new ids, or one that doesn't match the granted `<gap>`), unlike rule 4's parallel clause (`:192`). Folded into requirement 6 above. — Remedy: add rule 4's "any other new id → unauthorized growth" clause verbatim to rule 1's growth branch.
- **audit** (correctness) — [FAIL] The growth-authorize branch omits an explicit "re-review the full artifact set (Phase 4)" step, unlike rule 4 (`:192`, "Then re-review the **full artifact set**...") and rule 1's own ordinary-answer sub-path (same line, "...before re-review"). Folded into requirement 7 above. — Remedy: append an explicit re-review instruction after the branch's "leave `consumed: no`" outcome.
- **audit** (security) — [FAIL] Same "any other new id" gap as correctness above, independently derived: a second/non-matching new id slips past the WF-552 growth cap unflagged in this specific dispatch path. At `SKILL.md:186` vs `:192`.
- **audit** (security, warn) — [WARN, pre-existing, not newly introduced] The round-3 fix closes only the *temporal* half of the mis-attribution risk carried over from round 2 (snapshot-then-diff brackets *when* a new id can appear); it does not close the *identity* half — a match still resolves against "a `granted, consumed: no` entry" generically, not the specific entry minted for this dispatch, so a stale unconsumed entry from an earlier round remains eligible to be matched by an unrelated dispatch's new id. Folded into requirement 1's caveat above.
- **audit** (consistency) — [FAIL] Direct line-by-line comparison of all three parallel Phase-5 id-diff clauses (rule 1 growth-authorize, rule 1 ordinary-answer, rule 4) confirms the growth-authorize clause is still the only one missing the "id beyond what's expected/authorized" guard. At `SKILL.md:186` vs `:192`. Also confirmed `references/convergence-loop.md`'s "reuses SUB-1's snapshot mechanism directly" rationale is no longer stale (round 2's W2 is closed) and the ordinary-answer sub-path's lack of a "beyond-expected" branch is by design (an ordinary answer's own new id is always auto-legitimized, per `convergence-loop.md`'s "Why a rule-1 answer auto-authorizes" section) — not an inconsistency.
- **audit** (convention, warn) — [WARN] Same "any other new id" gap, rated as a naming/behavioral-parity nit rather than a functional fail. At `SKILL.md:186` vs `:192`.
- **audit** (convention, warn) — [WARN] Two references to the identical snapshot-write action within the same rule use inconsistent cross-reference phrasing: the growth clause says "snapshot the round just reviewed (the write in rule 4)"; the very next clause (same rule, same referent) says "snapshot the round just reviewed (the write below)". At `SKILL.md:186`.
- **audit** (operational) — [FAIL, newly introduced by the round-3 fix] Sequential per-item growth-authorize dispatches within one review round each independently re-execute "snapshot the round just reviewed" to the identical path (`{charter-folder}/snapshots/01_charter.round-<N>.md`/`02_subtasks.round-<N>.md`). If a round surfaces two or more `[growth]`-tagged items and both are authorized, the second item's snapshot write captures on-disk state *after* the first item's dispatch already mutated the artifacts — clobbering the true pre-round baseline that round `N+1`'s `verification`-mandate reviewer is meant to diff against, so the first item's newly-added id becomes invisibly "baked into" the baseline and round `N+1`'s growth check under-reports. This also means the `**Active:** OUT <n> · SUB <m>` line recorded once at Phase 4 (`:180`, fixed at true pre-round-N state) can silently diverge from the now-corrupted snapshot file for the same round. At `SKILL.md:186` (per-item snapshot-dispatch-diff cycle) vs `:180` (fixed baseline) and `:192` (the shared snapshot-write target). — Remedy: guard the round-N snapshot write to fire at most once per round transaction (skip if the round-N snapshot files already exist for this pass through Phase 5), or batch multiple authorized `[growth]` items in the same round into one dispatch+diff pass the way the ordinary-answer clause already batches multiple non-growth answers.
- **audit** (operational, warn) — [WARN, pre-existing, not newly introduced] A `granted, consumed: no` entry has no defined lifecycle across *later* rounds if the same `[growth]`-tagged gap resurfaces while an earlier grant is still unconsumed — no retry, expiry, or dedup rule (rule 4 has an analogous "No-progress guard" fingerprint for blocking findings; growth items have no equivalent). At `SKILL.md:186`.

**author-caps** — [PASS] `validate_manifest` (2 manifests, 0 findings), `validate_skill_interface` (charter skill, 0 findings), `validate_references` (charter skill folder: 2 files/14 refs, 0 findings). Round 3 touched only prose inside `SKILL.md` — no manifest, registry, or interface change — so the structural-validation and reference-existence fragments' "Applies when" gate is a no-op beyond the checks already re-run above.
**author-caps** — [FAIL, pre-existing, not introduced by this diff] Round 1/2's stale `## Plugin Roots` `CHECK-4` errors in `_local/config.md` are worktree-level drift unrelated to WF-552; unchanged and still not gating this verdict.

## Adversarial findings

Core independently identified the same defect class the capability findings above cover in depth (an unstated precondition — an "any other new id" guard — behind the growth-authorize branch's own consumption decision, `SKILL.md:186` changed-side vs. `:192` existing-side). Reconciliation:

- **core** — [assumption] the growth-authorize branch at `SKILL.md:186` derives its two-outcome consumption decision from an implicit assumption that only "zero" or "exactly one matching" new ids can appear, an assumption its own sibling clause (`:192`) explicitly does not make — withdrawn: covered by `audit` correctness's, security's, and consistency's findings above, all resting on the identical changed-side (`:186`) and existing-side (`:192`) evidence.

No other candidate met the closed two-class bound/unstated-assumption test with a citable existing-side line beyond what the five `audit` lenses already surfaced (the operational lens's snapshot-clobbering finding rests on its own distinct citation pair, `:186` vs `:180`/`:192`, and stands under `audit` provenance rather than as a second core candidate). Coverage: all five lenses delivered.

## Deviations from derived artifacts (informational)

None noted — `01_spec.md` and `02_plan.md` track `00_reqs.md` faithfully; the gaps found above are implementation defects, not spec/plan drift.

## Recommended next actions

- Add the missing third branch to Phase 5 rule 1's growth-authorize clause (`SKILL.md:186`): "any other new id → unauthorized growth — raise a user-routed check to retroactively authorize (record a fresh `consumed: yes` entry) or retire the extra id(s) back (headless: `CHARTER — Needs input`, never silently legitimized)" — mirroring rule 4 (`:192`) verbatim. This resolves requirement 6's residual gap and the correctness/security/consistency/convention findings above.
- Append an explicit "then re-review the full artifact set (Phase 4)" instruction to the same branch, so a round resolved solely by a growth-authorize dispatch has a stated path back into review — resolves requirement 7's residual gap.
- Guard the round-N snapshot write in the growth-authorize branch against being re-executed by a second `[growth]`-tagged item authorized in the same round (skip if already written this pass, or batch multiple authorized growth items into one dispatch+diff cycle) — resolves the newly-introduced operational finding.
- Non-blocking: scope a `## Growth authorizations` match to the entry minted for the current dispatch (not any `granted, consumed: no` entry), and define what happens when the same gap resurfaces while an earlier grant sits unconsumed (security/operational warns).
- Non-blocking: use one consistent cross-reference form for "the write in rule 4" in both places it's mentioned within rule 1 (convention warn).
- Re-run `/wf:verify-spec WF-552` after the above are addressed. This is the last cycle before the verify⇄fix cap — the residual gaps above are narrow and structurally identical (all three cite the same `:186` vs `:192` asymmetry), so a single focused edit to rule 1's growth-authorize clause is expected to resolve requirements 6 and 7 together.

---
