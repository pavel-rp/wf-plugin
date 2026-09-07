# verify-spec: WF-552

**Source:** `_local/WF-552/00_reqs.md`
**Branch:** `feature/552-freeze-charter-scope-after-round-1`
**Commit:** `dbcf564e986d70f206001d7d4310caa8c464cb7c`  (base `398e7d0ea2cca30d5143c4ab4187c2ec53e7405b`)
**Tree:** clean
**Scope:** 7 files vs `main`'s common ancestor, across this task's two commits `d9bb9a5`+`dbcf564` (`git diff d9bb9a5^..dbcf564 --stat` = 7 files, +65/-14). Note: `main...HEAD` is much larger (123 files) because this branch stacks on several already-merged, unrelated tasks (WF-551, WF-522, …); only the two WF-552 commits are in scope for this audit.
**Verdict:** FAIL  (19/22 requirements, 1 UNVERIFIABLE)
**Audited by:** claude-sonnet-5
**Audited at:** 2026-09-04 15:30 UTC

Round 2 — re-audits the full requirement set fresh against the current on-disk `SKILL.md`/agents/reference doc (not just the 4 previously-failing items) per `05_verify-fix.md`'s stated fix.

## Requirements

1. [PASS] Active `OUT`/`SUB` counts stay non-increasing whenever no growth authorization is in the log
   - Evidence: the dispatch-prompt trigger now requires the entry's status to literally read `granted, consumed: no` (`plugins/wf/skills/charter/SKILL.md:140,158`), and Phase 5 rule 4's post-revision match requires the same status before treating a new id as authorized (`SKILL.md:192`) — growth with **zero** recorded entry is still blocked in every path. No id can appear absent an authorization on record.
   - Caveat (non-gating for this literal criterion, but see Capability findings S2): the check does not verify an entry belongs to *this* dispatch, so a stale `granted, consumed: no` entry from an earlier gap could in principle be consumed by an unrelated later dispatch — a mis-attribution risk, not a zero-authorization growth.

2. [PASS] Retirement uses the unchanged `~~OUT-n~~ retired: <why>` / `~~SUB-n~~ retired: <why>` form
   - Evidence: `plugins/wf/agents/charter-writer.md:24,39`, `plugins/wf/agents/charter-decomposer.md:21,32` — unchanged by this diff.

3. [PASS] Ids are never renumbered (pre-existing rule, unchanged by this diff)
   - Evidence: `plugins/wf/agents/charter-decomposer.md:32` — "Never renumber: retire (...) freely, but append a new id only when...".

4. [PASS] A reword/retire revision returning `Scope changed: yes` still re-dispatches the decomposer as today, and raises no growth finding (no id is new)
   - Evidence: `plugins/wf/skills/charter/SKILL.md:192` — the re-decompose clause is unchanged; the id-diff only fires on an actually-new id, which a reword/retire never produces.

5. [PASS] A finding / `## Open questions` entry / deferred Phase-3 `Flags:` choice needing a new id routes to `user` and is asked as the two-option gate, with the choice recorded in the review log
   - Evidence: `plugins/wf/agents/charter-reviewer.md:68`; `plugins/wf/skills/charter/SKILL.md:186` (two options: *accept gap as warning* / *authorize one growth revision*, both recorded).
   - Improvement over round 1: "accept gap as warning" now records the item's fingerprint under `## Accepted warnings` (`SKILL.md:186`), which the reviewer's Boundaries already honor unconditionally (`charter-reviewer.md:24`) — closing round 1's CORR-1 (the gate no longer re-fires on an already-accepted gap). No lens re-raised CORR-1 this round.

6. [FAIL] Exactly one growth revision may add ids per recorded authorization, bounded to the authorized gap and count
   - Expected: every path that can spend a growth authorization verifies the grant's actual bounds (one new id, matching the named `<gap>`) before marking it consumed.
   - Found: **fixed for the rule-4 blocking-findings path** — `SKILL.md:192` now diffs against a written snapshot and explicitly separates "no new id" / "exactly one new id matching a `granted, consumed: no` entry's gap" / "any other new id → unauthorized growth". **Not fixed for rule 1's own "authorize one growth revision" path** (`SKILL.md:186`): after granting the entry and dispatching, it only says "mark it `consumed: yes` if the dispatch added a new id" — no snapshot is taken first, so there is nothing to diff against, no check that *exactly* one id appeared (vs. zero, or more than one), and no check that the id matches the granted `<gap>`.
   - Location: `plugins/wf/skills/charter/SKILL.md:186` (unbounded) vs `:192` (bounded, correct).
   - Corroborated by `audit` correctness, security, and operational (see Capability findings) — all three independently flagged the same rule-1 authorize-branch gap.

7. [FAIL] The host's post-revision id-diff check runs immediately after *every* revision-triggering dispatch and before the next Phase 4 review, catching unauthorized growth regardless of `Scope changed:`
   - Expected: unconditional — every dispatch Phase 5 can trigger gets a post-revision check.
   - Found: round 1's specific defect (the check nested unreachably inside rule 4) **is fixed** — rule 1's *"every other (non-`[growth]`) answer"* sub-path now carries its own complete snapshot-then-diff check ("snapshot the round just reviewed ... then diff active ids against that snapshot"), independent of whether rule 4 fires. However rule 1's *"authorize one growth revision"* sub-path — also a revision-triggering dispatch, reachable on its own with no co-occurring ordinary answer or rule-4 blocking finding that round — has **no** post-revision check of any kind: no snapshot write, no diff, nothing. This is the same reachability defect class as round 1's CORR-2, now confined to a narrower, but still live, sub-path.
   - Location: `plugins/wf/skills/charter/SKILL.md:186` (growth-authorize clause, no check) vs the immediately adjacent non-growth clause (has one) and `:192` (has one).
   - Corroborated independently by `audit` correctness, security, consistency, and operational (4 of 5 lenses; see Capability findings) — the strongest cross-lens agreement in this round.

8. [PASS] A rule-1 user answer whose integration needs a new id is itself auto-recorded as the growth authorization, with no separate gate, and `Revisions used` increments once
   - Evidence: `SKILL.md:186` — "a new id here is always auto-recorded as a fresh `consumed: yes` growth authorization (the answer itself justifies it, no separate prompt) before re-review; that integration pass counts as a revision either way." This is the ordinary-answer sub-path (distinct from the "authorize one growth revision" sub-path in item 6/7 above) and is now fully self-contained: snapshot, dispatch, diff, auto-authorize, and revision-count all in the same clause.

9. [PASS] A headless run needing growth ends `CHARTER — Needs input`; it never hangs
   - Evidence: `SKILL.md:186` — "**Headless run:** any `route: user` finding, or an unresolved `pending`/unauthorized growth item, ends the run at `CHARTER — Needs input` instead of a prompt" — broadened since round 1 to explicitly cover an unresolved `pending`/unauthorized item, not just a bare `route: user` finding.

10. [PASS] Writer revision-mode contract: fix/reword/retire freely; no new `OUT-n` id without a stated growth authorization; gap recorded under the existing `## Open questions` section; no new output-block field
    - Evidence: `plugins/wf/agents/charter-writer.md:24,31`; output contract (`:109-116`) field set unchanged.

11. [PASS] Decomposer revision-mode contract: same, reported via `Flags: [growth] <one line>`; no new output-block field
    - Evidence: `plugins/wf/agents/charter-decomposer.md:21,32,97`.

12. [PASS] Reviewer checklist: a finding needing a new outcome/sub-task (including a round ≥2 reviewer meeting a charter `## Open questions` entry) routes `user`; explicitly a routing rule only, never a growth detector
    - Evidence: `plugins/wf/agents/charter-reviewer.md:68` — "This is a **routing** rule only... comparing ids against the prior-round snapshot is exclusively the host's Phase 5 job."

13. [PASS] Phase 3: a revision-mode decomposer `[growth]`-tagged `Flags:` choice defers to the Phase 5 growth gate; every other choice keeps the immediate Phase 3 ask
    - Evidence: `SKILL.md:160` — the deferred flag is now recorded immediately as `- Round <N> | gap: <flag text> | status: pending` under `## Growth authorizations`, closing round 1's C1 (a resumed run between Phase 3 and Phase 5 no longer loses it). No lens re-raised C1 this round.

14. [PASS] No new writer/decomposer output-block fields introduced
    - Evidence: both output contracts' field lists unchanged; `[growth]` is only a new value inside the existing `Flags:` / `## Open questions` free-text surfaces.

15. [PASS] The host records active `OUT`/`SUB` counts per round in the review log
    - Evidence: `SKILL.md:180` — `**Active:** OUT <n> · SUB <m>` line, now worded as "a durable per-round audit trail; the growth check itself (Phase 5) always diffs the on-disk snapshot files, never this count line" — the round-1 C2 finding (a false "resumed run reads back" claim) is removed; the line no longer overclaims.
    - Caveat (non-gating; see Capability findings, `audit` operational W3): because item 6/7's gap can leave a round's snapshot unwritten, the `**Active:**` count and the snapshot-based check can diverge with no reconciliation step defined — a consequence of item 6/7, not a new defect in this line itself.

16. [PASS] Roles keep their boundaries — growth-authorization and active-count records live only in `03_review-log.md`; the host never edits `01_charter.md`/`02_subtasks.md` beyond the pre-existing permitted metadata lines
    - Evidence: `SKILL.md:82` (host-owned outright), `:180`, `:186`.

17. [PASS] Core stays domain-free
    - Evidence: grep for stack/domain terms (`angular|node-ts|azure devops|linear\.app|typescript|c#|react\b|vue|django|rails`) across all five touched core files returned zero true hits (the only substring hits were "ado**pt**"/"Ado**pted**" — pre-existing generic vocabulary, not the tracker capability).

18. [PASS] `SKILL.md` ends no higher than its line count at the start of the slice
    - Evidence: `git show d9bb9a5^:plugins/wf/skills/charter/SKILL.md | wc -l` = 280; current file = 280 lines — net 0 growth across both commits.

19. [PASS] Version bump: PATCH
    - Evidence: `plugins/wf/.claude-plugin/plugin.json` and the marketplace's `wf` entry both `0.143.0`→`0.143.1`; marketplace top-level `0.190.0`→`0.190.1`. No grepped final-output block shape or argument surface changed.

20. [PASS] Touched files match exactly the constraint's list
    - Evidence: `git diff --numstat d9bb9a5^..dbcf564` shows exactly: `.claude-plugin/marketplace.json`, `plugins/wf/.claude-plugin/plugin.json`, `plugins/wf/agents/charter-decomposer.md`, `plugins/wf/agents/charter-reviewer.md`, `plugins/wf/agents/charter-writer.md`, `plugins/wf/skills/charter/SKILL.md`, `plugins/wf/skills/charter/references/convergence-loop.md` — no other file touched by either commit.

21. [PASS] `references/convergence-loop.md`'s reserved `### SUB-2` section is filled with the slice's rationale
    - Evidence: `plugins/wf/skills/charter/references/convergence-loop.md:89-140` — covers why the host is the sole detector, the textual `[growth]` marker choice, id-diff vs. `Scope changed:`, the two-option gate, and rule-1 auto-authorization. Rationale stays in the reference doc, not the runtime body.
    - Caveat: `audit` consistency (W2) notes the doc's claim that growth detection "reuses SUB-1's snapshot mechanism directly" is inaccurate for the specific rule-1 authorize-branch identified in items 6/7 (which has no snapshot to reuse) — the rationale will be accurate once that branch is fixed.

22. [UNVERIFIABLE] The reqs' own "Verification evidence" — a replay of C031's final artifacts under the new contracts, and a first live run — showing non-increasing counts absent a logged authorization
    - Reason: requires executing the writer/decomposer/reviewer subagents against real inputs; cannot be confirmed from static code reading. No test/fixture file was added or required by this slice's touched-files constraint.

## Capability findings

**audit** (5 lenses dispatched: correctness, security, convention, consistency, operational — all delivered):

- **audit** (correctness) — [FAIL] The "authorize one growth revision" branch of Phase 5 rule 1 (`SKILL.md:186`) dispatches a revision-mode writer/decomposer without ever writing the round-just-reviewed snapshot, unlike its sibling clause and rule 4 (`:192`) — breaking Phase 4's `verification`-mandate snapshot-pair resolution (`:164`) for a growth-only round. Folded into requirements 6/7 above.
- **audit** (correctness) — [FAIL] The same branch never instructs incrementing `Revisions used`, unlike its sibling clause ("that integration pass counts as a revision either way"), so a run consisting entirely of authorized-growth rounds is unbounded by the 3-revision cap (`SKILL.md:191`). At `SKILL.md:186`.
- **audit** (security, S1) — [FAIL] The dispatch-prompt trigger (`SKILL.md:140,158`) checks only "does a `granted, consumed: no` entry exist anywhere in the log," not whether it belongs to *this* dispatch's routed findings/answers or was granted this round — a stale grant can re-arm on an unrelated later dispatch. Folded into requirement 1's caveat above.
- **audit** (security, S2) — [FAIL] The "authorize one growth revision" branch has no snapshot/diff bound on the dispatch it triggers and no fallback when the dispatch adds zero ids (the entry is left `granted, consumed: no` indefinitely rather than declined/expired). Same root cause as requirement 6/7; recommends snapshot-then-diff exactly as rule 4 does, plus an explicit decline/expire step on a zero-id outcome.
- **audit** (security, S3) — [FAIL] Because a mis-scoped `granted, consumed: no` entry (S1) is never invalidated, rule 4's fuzzy "plausibly addresses" match (`SKILL.md:192`) could auto-consume a stale standing grant against an unrelated new id in a later round — reopening a bounded version of the original unbounded-growth failure. Recommends scoping a grant to the round/dispatch it was minted for and declining/expiring anything that survives past it.
- **audit** (consistency) — [FAIL] Same root defect as above, confirmed independently by direct comparison of the three dispatch-triggering clauses in `SKILL.md` Phase 5: the growth-authorize clause lacks the snapshot step both of its siblings have. At `SKILL.md:186`.
- **audit** (consistency, W2) — [WARN] `convergence-loop.md:118-124`'s rationale ("the check reuses SUB-1's snapshot mechanism directly rather than adding a second one") disagrees with the shipped mechanism for the one branch identified above, which has no snapshot to reuse. Becomes accurate once the branch is fixed; no separate doc change needed.
- **audit** (operational) — [FAIL] A `[growth]`-tagged item can in principle be re-granted after already `consumed: yes` — the rule's own verb ("set (or mint) the entry") permits overwriting a consumed entry, and there is no fingerprint/equality guard analogous to the no-progress guard's `route|check|artifact-section` fingerprint (`SKILL.md:190`). At `SKILL.md:186`.
- **audit** (operational) — [FAIL] Same snapshot-write gap as above, re-derived independently via the mandate-resolution angle: a growth-only round leaves `{charter-folder}/snapshots/...round-<N>...` unwritten, yet Phase 4 (`:164`,`:180`) still resolves `verification` mandate for round N+1 and hands it snapshot paths that don't exist on disk — no fallback is defined for this case (only for a folder that predates the mechanism entirely, `Edge Cases` at `:249`). At `SKILL.md:186` vs `:164,180`, `charter-reviewer.md:19,34`.
- **audit** (operational, W3) — [WARN] The `**Active:** OUT <n> · SUB <m>` line and the snapshot-based check are declared independent signal sources with no reconciliation step; the snapshot gap above makes a real (not merely hypothetical) divergence between them possible. At `SKILL.md:180`.
- **audit** (convention, W1) — [WARN] `## Growth authorizations`' entry format is specified with materially less rigor than the sibling `## Accepted warnings` fingerprint it is modeled on — only the mint-time row (`SKILL.md:160`) gets a concrete template; later state transitions (`:186`,`:192`) are described only as value changes, with no field recording which subagent (writer vs. decomposer) the authorization targets. Recommends one canonical row grammar stated once and referenced by every consumer, mirroring how the reviewer's Boundaries states the Accepted-warnings fingerprint once.
- **audit** (convention, W2) — [WARN] The new `[growth]` `Flags:` value's bare bracket-tag shape (`plugins/wf/agents/charter-decomposer.md:97`) diverges from its two sibling `label: value` enum values — carried over unchanged from round 1 (not addressed by this fix, by the fix author's own stated design choice; see `05_verify-fix.md` "Not changed (by design)").

**author-caps** — [PASS] `validate_manifest` (2 manifests, 0 findings), `validate_skill_interface` (charter skill, 0 findings), `validate_references` (charter skill folder: 2 files/14 refs, 0 findings; agents folder: 10 files/24 refs, 0 findings).
**author-caps** — [FAIL, pre-existing, not introduced by this diff] `validate_registry` reports 6 `CHECK-4` errors — the same stale `## Plugin Roots` entries noted in round 1 (`wf-git`, `wf-audit` ×2, `wf-author-caps`, `wf-sandbox-testing`, `wf-linear`), unchanged by this branch's history (`_local/config.md` untouched). Worktree-level drift unrelated to WF-552; does not gate this verdict.

## Adversarial findings

Core independently identified the same defect class the capability findings above cover in depth (an unstated precondition — a written round snapshot — behind the "authorize one growth revision" dispatch's own consumption decision, `SKILL.md:186` changed-side vs. `:164` existing-side). Reconciliation:

- **core** — [assumption] the growth-authorize dispatch at `SKILL.md:186` derives "mark it `consumed: yes` if the dispatch added a new id" from an implicit precondition (a comparable prior-id snapshot) that this same clause never establishes — withdrawn: covered by `audit` correctness's, security's (S2), consistency's, and operational's findings above, all resting on the identical changed-side (`:186`) and existing-side (`:164`/`:192`) evidence.

No other candidate met the closed two-class bound/unstated-assumption test with a citable existing-side line beyond what the five `audit` lenses already surfaced. Coverage: all five lenses delivered.

## Deviations from derived artifacts (informational)

None noted — `01_spec.md` and `02_plan.md` track `00_reqs.md` faithfully; the gaps found above are implementation defects, not spec/plan drift. `05_verify-fix.md`'s own "Not changed (by design)" section for the two convention warnings is consistent with what this round's convention lens still finds outstanding.

## Recommended next actions

- Give Phase 5 rule 1's "authorize one growth revision" branch (`SKILL.md:186`) the same snapshot-then-diff treatment its sibling clause and rule 4 already have: write the round-just-reviewed snapshot before dispatch, diff after it, confirm exactly one new id matching the granted `<gap>`, and explicitly decline/expire the entry on a zero-id outcome. This single change resolves requirements 6 and 7, and the correctness/security(S2)/consistency/operational findings above — it is the one remaining structural gap blocking convergence.
- Add an explicit "increment `Revisions used`" instruction to that same branch so an all-growth-authorization run is still bounded by the 3-revision cap.
- Scope a `## Growth authorizations` entry to the specific dispatch/round it was minted for (a fingerprint, not free-text `<gap>` matching alone), and require it to be explicitly declined/expired rather than overwritable, closing the security S1/S3 mis-attribution risk.
- Non-blocking: state one canonical `## Growth authorizations` row grammar once (fields, status vocabulary, target subagent) and have every consumer reference it, mirroring the `## Accepted warnings` fingerprint's single-source-of-truth treatment (convention W1).
- Re-run `/wf:verify-spec WF-552` after the above are addressed.

---
