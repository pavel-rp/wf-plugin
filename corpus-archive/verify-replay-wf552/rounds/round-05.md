# verify-spec: WF-552

**Source:** `_local/WF-552/00_reqs.md`
**Branch:** `feature/552-freeze-charter-scope-after-round-1`
**Commit:** `2ae1037b24e7d985438c3efc82ece2b6ac8364f4`  (base `8d3da8508602dbdb152c4742f25d7fede22fbe66`)
**Tree:** clean
**Scope:** 7 files vs `main`'s common ancestor, across this task's five commits `d9bb9a5`+`dbcf564`+`262f555`+`febf533`+`2ae1037` (`git diff d9bb9a5^..2ae1037 --stat` = 7 files, +87/-14). Note: `main...HEAD` is much larger because this branch stacks on several already-merged, unrelated tasks (WF-551, WF-522, …); only the five WF-552 commits are in scope for this audit.
**Verdict:** FAIL  (21/22 requirements, 1 UNVERIFIABLE) — gated by capability findings (see below), not by any generic requirement
**Audited by:** claude-sonnet-5
**Audited at:** 2026-09-04 16:14 UTC

Round 5 — the confirming re-audit, run fresh against the current on-disk `SKILL.md`/reference doc, per `2ae1037`'s stated fix ("make the growth-authorization rules symmetric") for round 4's three residual capability findings (correctness FAIL, consistency FAIL, operational FAIL). Two of the three are now genuinely closed; the third (the doc's outcome-count claim) is narrowed but still inaccurate, and the fix that closed the operational finding exposes an adjacent, previously-masked gap in the same branch. None of this reopens a generic requirement — every gap below is confined to the capability findings, consistent with rounds 3/4.

## Requirements

1. [PASS] Active `OUT`/`SUB` counts stay non-increasing whenever no growth authorization is in the log
   - Evidence: unchanged — the dispatch-prompt trigger requires the entry's status to literally read `granted, consumed: no` (`plugins/wf/skills/charter/SKILL.md:140,158`), and Phase 5 rule 4's post-revision match requires the same status before treating a new id as authorized (`SKILL.md:192`). Growth with zero recorded entry is still blocked in every path.
   - Caveat (non-gating; see Capability findings, `audit` security FAIL / correctness warn): rule 4's match is now scoped to an entry "recorded for this round" rather than any unconsumed entry anywhere in the log, closing round 4's cross-round mis-attribution risk. `audit` correctness traces the control flow and reports the fix fully closes the finding; `audit` security, reasoning about the same text, still rates it a residual identity-scoping gap when more than one entry could share "this round." Both readings are preserved below, unreconciled, as their own lenses' findings.

2. [PASS] Retirement uses the unchanged `~~OUT-n~~ retired: <why>` / `~~SUB-n~~ retired: <why>` form
   - Evidence: `plugins/wf/agents/charter-writer.md:24,39`, `plugins/wf/agents/charter-decomposer.md:21,32` — unchanged by round 5.

3. [PASS] Ids are never renumbered (pre-existing rule, unchanged by this diff)
   - Evidence: `plugins/wf/agents/charter-decomposer.md:32` — "Never renumber: retire (...) freely, but append a new id only when...".

4. [PASS] A reword/retire revision returning `Scope changed: yes` still re-dispatches the decomposer as today, and raises no growth finding (no id is new)
   - Evidence: `plugins/wf/skills/charter/SKILL.md:192` — the re-decompose clause is unchanged by round 5; the id-diff only fires on an actually-new id, which a reword/retire never produces.

5. [PASS] A finding / `## Open questions` entry / deferred Phase-3 `Flags:` choice needing a new id routes to `user` and is asked as the two-option gate, with the choice recorded in the review log
   - Evidence: `plugins/wf/agents/charter-reviewer.md:68`; `plugins/wf/skills/charter/SKILL.md:186` (two options: *accept gap as warning* / *authorize one growth revision*, both recorded). Unchanged since round 3.

6. [PASS] Exactly one growth revision may add ids per recorded authorization, bounded to the authorized gap and count
   - Sub-claim "bounded to the authorized gap" — [PASS]. Unchanged in substance: the growth-authorize branch diffs active ids against a snapshot and matches "the one new id addressing this dispatch's own entry's `<gap>`" before marking it `consumed: yes` (`SKILL.md:186`).
   - Sub-claim "bounded to ... count" — [PASS]. Rule 4's parallel "any other new id → unauthorized growth" clause (`:192`) is unchanged in shape; both branches still carry the third outcome.
   - Caveat (non-gating; see Capability findings, `audit` operational FAIL): the ordinary-answer sub-path's own id-diff (`SKILL.md:186`) still auto-records *any* new id it sees as a fresh authorization with no "disregarding ids already consumed earlier in this round" discount — unlike the growth-authorize branch and rule 4, both of which now carry that discount. Because the snapshot the ordinary-answer branch diffs against is (correctly, since this round's fix) the same undisturbed round-N baseline an earlier same-round dispatch may have already diffed, an id that dispatch already consumed can still read as "new" here and get a second, redundant `consumed: yes` entry minted for it. This does not itself let an extra id past the cap (the id was already accounted for), but it corrupts the authorization log with a duplicate/conflicting record for one id.

7. [PASS] The host's post-revision id-diff check runs immediately after *every* revision-triggering dispatch and before the next Phase 4 review, catching unauthorized growth regardless of `Scope changed:`
   - All three sub-claims — [PASS], unchanged from round 4's closure: the growth-authorize branch ends "Then re-review the **full artifact set** (Phase 4) before evaluating rules 2–4" (`SKILL.md:186`), matching rule 4 (`:192`); the "any other new id" fallback is present verbatim in both.
   - Caveat (non-gating; see requirement 15's caveat and Capability findings, `audit` operational note): the once-per-round snapshot guard that requirement 15 covers is confirmed, on close reading, to now bind both of rule 1's branches (not just the growth-authorize one) — this closes round 4's clobbering risk for this requirement's own claim.

8. [PASS] A rule-1 user answer whose integration needs a new id is itself auto-recorded as the growth authorization, with no separate gate, and `Revisions used` increments once
   - Evidence: `SKILL.md:186` — the ordinary-answer sub-path remains self-contained: snapshot, dispatch, diff, auto-authorize, revision-count, and an explicit "before re-review" all in the same clause. Unaffected by this round's diff in its own literal terms.
   - Caveat: see requirement 6's caveat — the same clause's missing "disregard already-consumed ids" discount is a risk of a spurious *duplicate* authorization record when this branch runs after an earlier same-round dispatch, not a risk to the "no separate gate" or "increments once" claims themselves, which still hold.

9. [PASS] A headless run needing growth ends `CHARTER — Needs input`; it never hangs
   - Evidence: `SKILL.md:186` — "**Headless run:** any `route: user` finding, or an unresolved `pending`/unauthorized growth item, ends the run at `CHARTER — Needs input` instead of a prompt" — unchanged since round 2.

10. [PASS] Writer revision-mode contract: fix/reword/retire freely; no new `OUT-n` id without a stated growth authorization; gap recorded under the existing `## Open questions` section; no new output-block field
    - Evidence: `plugins/wf/agents/charter-writer.md:24,31`; output contract (`:109-116`) field set unchanged; file untouched by round 5.

11. [PASS] Decomposer revision-mode contract: same, reported via `Flags: [growth] <one line>`; no new output-block field
    - Evidence: `plugins/wf/agents/charter-decomposer.md:21,32,97`; file untouched by round 5.

12. [PASS] Reviewer checklist: a finding needing a new outcome/sub-task (including a round ≥2 reviewer meeting a charter `## Open questions` entry) routes `user`; explicitly a routing rule only, never a growth detector
    - Evidence: `plugins/wf/agents/charter-reviewer.md:68`; file untouched by round 5.

13. [PASS] Phase 3: a revision-mode decomposer `[growth]`-tagged `Flags:` choice defers to the Phase 5 growth gate; every other choice keeps the immediate Phase 3 ask
    - Evidence: `SKILL.md:160` — the deferred flag is recorded immediately as `- Round <N> | gap: <flag text> | status: pending` under `## Growth authorizations`, unchanged since round 2.

14. [PASS] No new writer/decomposer output-block fields introduced
    - Evidence: both output contracts' field lists unchanged; `[growth]` is only a new value inside the existing `Flags:` / `## Open questions` free-text surfaces.

15. [PASS] The host records active `OUT`/`SUB` counts per round in the review log
    - Evidence: `SKILL.md:180` — `**Active:** OUT <n> · SUB <m>` line, unchanged since round 2.
    - Round 4's operational caveat here is now resolved: rule 4's snapshot-write clause (`SKILL.md:192`) states "**every** reference to this write, here and in rule 1, performs it **at most once per round**: skip it when round `N`'s snapshot files already exist" — this generically covers both of rule 1's own references to "the write below" (the growth-authorize branch's and the ordinary-answer branch's), so a round mixing a growth item and an ordinary answer can no longer have its baseline clobbered by whichever branch writes second. Independently confirmed by `audit` operational: "The once-per-round snapshot-write hoist itself ... is unqualified as to which rule-1 occurrence it binds ... that half of the claimed fix holds up under close reading and is not a defect."

16. [PASS] Roles keep their boundaries — growth-authorization and active-count records live only in `03_review-log.md`; the host never edits `01_charter.md`/`02_subtasks.md` beyond the pre-existing permitted metadata lines
    - Evidence: `SKILL.md:82` (host-owned outright), `:180`, `:186`.

17. [PASS] Core stays domain-free
    - Evidence: grep for stack/domain terms (`angular|node-ts|azure devops|linear\.app|typescript|c#|react\b|vue|django|rails`) across all five touched core files (`SKILL.md`, `references/convergence-loop.md`, the three role agents) returned zero hits.

18. [PASS] `SKILL.md` ends no higher than its line count at the start of the slice
    - Evidence: `git show d9bb9a5^:plugins/wf/skills/charter/SKILL.md | wc -l` = 280; current file = 280 lines — net 0 growth across all five commits.

19. [PASS] Version bump: PATCH
    - Evidence: `plugins/wf/.claude-plugin/plugin.json` and the marketplace's `wf` entry both `0.143.0`→`0.143.1`; marketplace top-level `0.190.0`→`0.190.1` (set in `d9bb9a5`, unchanged since). `2ae1037` touches only `SKILL.md` prose (Phase 5 rules 1/4) and reference-doc rationale — no new grepped shape or argument-surface change — so no further bump is required, matching round 4's identical reasoning for `febf533`.

20. [PASS] Touched files match exactly the constraint's list
    - Evidence: `git diff --numstat d9bb9a5^..2ae1037` shows exactly: `.claude-plugin/marketplace.json`, `plugins/wf/.claude-plugin/plugin.json`, `plugins/wf/agents/charter-decomposer.md`, `plugins/wf/agents/charter-reviewer.md`, `plugins/wf/agents/charter-writer.md`, `plugins/wf/skills/charter/SKILL.md`, `plugins/wf/skills/charter/references/convergence-loop.md` — no other file touched across all five commits.

21. [PASS] `references/convergence-loop.md`'s reserved `### SUB-2` section is filled with the slice's rationale
    - Evidence: `plugins/wf/skills/charter/references/convergence-loop.md:142-150` — the section is renamed "Why the authorization-consuming branches carry the same three outcomes" and narrowed to state the three-outcome claim only for rule 1's growth-authorize branch and rule 4, adding "Rule 1's ordinary-answer path deliberately states only two" for the excluded third path.
    - Caveat (non-gating for the coverage claim above; see Capability findings, `audit` consistency FAIL / convention warn): the narrowing overshot. The ordinary-answer clause (`SKILL.md:186`) states exactly **one** explicit outcome ("a new id here is always auto-recorded as a fresh `consumed: yes` growth authorization") — it never spells out a "no new id → proceed" branch the way the growth-authorize clause and rule 4 both do. So the doc's revised claim ("states only two") is still not derived from the text it describes, which states one. This is the same derivation-consistency defect round 4 found, now attached to a different, still-incorrect count — independently confirmed by both `audit` consistency (FAIL) and `audit` convention (WARN).

22. [UNVERIFIABLE] The reqs' own "Verification evidence" — a replay of C031's final artifacts under the new contracts, and a first live run — showing non-increasing counts absent a logged authorization
    - Reason: requires executing the writer/decomposer/reviewer subagents against real inputs; cannot be confirmed from static code reading. No test/fixture file was added or required by this slice's touched-files constraint.

## Capability findings

**audit** (5 lenses dispatched: correctness, security, convention, consistency, operational — all delivered):

- **audit** (correctness) — round-4 finding status: **resolved**. Tracing the control flow: any `[growth]`-tagged item's growth-authorize dispatch always forces a full re-review before rules 2–4 are ever evaluated (`SKILL.md:186`), and so does the ordinary-answer branch's own integration pass ("Evaluate rules 2–4 only when no unintegrated answers remain"). So rule 4 can only ever fire on a round whose own rule-1 pass minted zero growth entries; any `granted, consumed: no` entry still open when rule 4 runs was therefore minted in a strictly earlier round, and the new "recorded for this round" filter (`:192`) reliably excludes it — closing the "wrongly consume an unrelated stale authorization" defect round 4 described.
- **audit** (correctness, warn) — [WARN] The Phase 2/3 dispatch-prompt injection trigger ("When a `granted, consumed: no` entry is on record for this dispatch...", `SKILL.md:140,158`) is untouched by `2ae1037` and still has no round or dispatch-identity scoping, unlike the now-scoped rule 4 (`:192`). A stale cross-round grant that is never transitioned to `declined`/`consumed: yes` can keep re-asserting a false `Authorized: ...` line into future, unrelated dispatch prompts. Rated non-blocking: the round-scoped id-diff in rules 1/4 still independently catches any resulting id as unauthorized growth, so no silent mis-legitimization results — only a spurious/misleading prompt message and a possible unnecessary escalation. — Remedy: scope the injection condition the same way rule 4 was just fixed ("a `granted, consumed: no` entry recorded for this round").
- **audit** (security) — [FAIL] Rule 4's match ("an entry ... recorded for this round", `:192`) is a round+status set-membership filter, not a pointer to one specific entry the way rule 1's "this dispatch's own entry" (`:186`) is. The spec's own text (rule 1's "disregarding any id already marked `consumed: yes` earlier in this round"; rule 4's once-per-round snapshot carve-out) confirms more than one growth dispatch — and so potentially more than one still-open `granted, consumed: no` entry — can coexist within a single round. When two such entries are simultaneously eligible, rule 4's fuzzy "plausibly addresses" match has no tiebreak, so a rule-4 dispatch's new id could be credited against the wrong pending entry rather than being caught as unauthorized growth. — Remedy: give rule 4 the same per-dispatch identity anchor rule 1 uses (e.g. match only the single most-recently-granted unconsumed entry for the round, or refuse to auto-match and route to user adjudication whenever more than one `granted, consumed: no` entry is recorded for the round).
- **audit** (security, warn) — [WARN] Same finding as correctness's warn above (`SKILL.md:140,158` untouched, no round scoping), independently derived.
- **audit** (consistency) — [FAIL] `references/convergence-loop.md:147-150`'s new claim "Rule 1's ordinary-answer path deliberately states only two [outcomes]" is not true of the on-disk `SKILL.md:186` text for that sub-path, which states exactly one explicit outcome (the round-4 finding's own characterization, still accurate) — the same derivation-consistency defect as round 4, now attached to a different, still-wrong count. Folded into requirement 21's caveat above. — Remedy: either add an explicit "no new id → proceed" branch to the ordinary-answer clause so the text actually states two outcomes, or revise the doc to stop asserting a specific outcome-count for a clause that only ever writes out one.
- **audit** (convention, warn) — [WARN] Same overclaim as consistency above, rated a lower-severity doc-precision nit: "the round-4 fix narrows the overclaim from 'three' to 'two' ... but the actual `SKILL.md` text for that sub-path still names only one outcome, so the doc's rationale still misdescribes the rule it explains — the round-4 WARN is not actually resolved, just made less wrong."
- **audit** (operational) — [FAIL] The once-per-round snapshot-write hoist (`SKILL.md:192`, "every reference to this write, here and in rule 1, performs it at most once per round") correctly covers both of rule 1's branches, closing round 4's clobbering defect. But the ordinary-answer branch's id-diff (`:186`) never gained the sibling "disregarding any id already marked `consumed: yes` earlier in this round" discount that the growth-authorize branch and rule 4 both carry. Because the shared baseline this branch diffs against now correctly survives an earlier same-round dispatch (thanks to the fix above), that earlier dispatch's already-consumed id will still read as "new" here, and the ordinary-answer branch will auto-mint a second, conflicting `consumed: yes` entry for it — a double-processing bug that the pre-2ae1037 clobbering bug had incidentally been masking (a clobbered snapshot would have hidden the earlier id from this diff entirely). — Remedy: add the same "disregarding any id already marked `consumed: yes` earlier in this round" qualifier to the ordinary-answer branch's diff step (`:186`), matching the phrasing already used in its two siblings.
- **audit** (operational, non-finding note) — the once-per-round snapshot-write hoist itself is confirmed correct and unqualified as to which rule-1 occurrence it binds — both the growth-authorize branch's explicit cross-reference and the ordinary-answer branch's bare "(the write below)" resolve to the identical skip-if-exists procedure. That half of the claimed fix holds up under close reading.

**author-caps** — [PASS] `validate_skill_interface` (charter skill, 0 findings), `validate_references` (charter skill folder + all three role agents: 5 files/22 refs total, 0 findings), `validate_manifest` (2 manifests, 0 findings). `2ae1037` touched only prose inside `SKILL.md` and `references/convergence-loop.md` — no manifest, registry, slot-marker, or invocation-reference change — so this gate is a no-op beyond the checks already re-run above.
**author-caps** — [FAIL, pre-existing, not introduced by this diff] The same stale `## Plugin Roots` `CHECK-4` errors noted in rounds 1–4 (`wf-git`, `wf-audit` ×2, `wf-author-caps`, `wf-sandbox-testing`, `wf-linear`) remain in `_local/config.md`; worktree-level drift unrelated to WF-552, unchanged this round, does not gate this verdict.

## Adversarial findings

Core independently identified the same two defect classes the capability findings above cover in depth, each an unstated assumption behind a control decision this round's fix makes. Reconciliation:

- **core** — [assumption] rule 4's new "entry ... recorded for this round" match (`SKILL.md:192`, changed) assumes at most one such entry can be open per round, an assumption the entry-recording mechanics that permit multiple same-round growth items (`SKILL.md:186`, unchanged: "disregarding any id already marked `consumed: yes` earlier in this round") do not establish — withdrawn: covered by `audit` security's FAIL above, resting on the identical changed-side (`:192`) and existing-side (`:186`) evidence.
- **core** — [assumption] the ordinary-answer branch's diff step (`SKILL.md:186`, unchanged text, sibling of the changed line) assumes the round-N baseline it diffs against reflects only its own dispatch's mutations, an assumption the newly-hoisted once-per-round guard (`SKILL.md:192`, changed) actually falsifies by design — the guard's whole point is to let the baseline survive an *earlier* same-round dispatch, which the ordinary-answer branch's own diff step then has no discount for — withdrawn: covered by `audit` operational's FAIL above, resting on the identical changed-side (`:192`) and existing-side (`:186`) evidence.

No other candidate met the closed two-class bound/unstated-assumption test with a citable existing-side line beyond what the five `audit` lenses already surfaced. Coverage: all five lenses delivered.

## Deviations from derived artifacts (informational)

None noted — `01_spec.md` and `02_plan.md` track `00_reqs.md` faithfully; the gaps found above are implementation defects, not spec/plan drift.

## Recommended next actions

- Add the missing "disregarding any id already marked `consumed: yes` earlier in this round" discount to rule 1's ordinary-answer branch (`SKILL.md:186`) — resolves the operational FAIL, the only finding this round that is a genuine (if narrow) functional gap rather than a documentation or identity-scoping nit.
- Either state an explicit "no new id → proceed" branch in the ordinary-answer clause, or stop asserting a specific outcome-count for it in `references/convergence-loop.md:147-150` — resolves the consistency FAIL / convention warn and requirement 21's residual caveat. This is the third round running this exact claim has been re-narrowed without becoming accurate; consider dropping the outcome-count framing for that clause entirely rather than attempting a fourth wording.
- Optional, given the divided correctness/security read on the same text: if rule 4's identity-scoping is meant to be airtight rather than "round+status is good enough in practice," give it the same single-entry anchor rule 1 uses, or route to user adjudication whenever more than one `granted, consumed: no` entry shares a round.
- Optional: scope the Phase 2/3 dispatch-prompt injection trigger (`SKILL.md:140,158`) to match rule 4's round-scoped criteria, so the prompt shown to the writer/decomposer can never claim an authorization Phase 5 will not actually honor.
- All residual findings are narrower than round 4's, and none reopens a generic requirement. Weigh a further fix-and-close pass against accepting the doc-accuracy findings (consistency/convention) and the disputed identity-scoping finding (security) as documented, non-blocking residue, while still closing the one clear functional gap (operational) before shipping.
- Re-run `/wf:verify-spec WF-552` after any of the above are addressed.

---
