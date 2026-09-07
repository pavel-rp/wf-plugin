# verify-spec: WF-552

**Source:** `_local/WF-552/00_reqs.md`
**Branch:** `feature/552-freeze-charter-scope-after-round-1`
**Commit:** `d9bb9a551f5865d67046f7a004cecfd679a79056`  (base `398e7d0ea2cca30d5143c4ab4187c2ec53e7405b`)
**Tree:** clean
**Scope:** 7 files vs `main` (single commit `d9bb9a5`; `git diff origin/main HEAD --stat` = 7 files, +54/-14)
**Verdict:** FAIL  (17/22 requirements, 1 UNVERIFIABLE)
**Audited by:** claude-sonnet-5
**Audited at:** 2026-09-04 15:05 UTC

## Requirements

1. [FAIL] Active `OUT`/`SUB` counts stay non-increasing whenever no growth authorization is in the log
   - Expected: growth is possible only while a currently-valid authorization exists.
   - Found: a `## Growth authorizations` entry, once written, is never marked consumed or scoped to the one dispatch it granted. The dispatch-prompt trigger (`plugins/wf/skills/charter/SKILL.md:140,158`) and the post-revision match (`SKILL.md:192`) both test only *presence* of an entry, not whether it has already been spent.
   - Location: `plugins/wf/skills/charter/SKILL.md:140,158,192`
   - Corroborated independently by three lenses: `audit` operational (F-OP.1), `audit` security (S1), `audit` correctness (CORR-3) — see Capability findings.

2. [PASS] Retirement uses the unchanged `~~OUT-n~~ retired: <why>` / `~~SUB-n~~ retired: <why>` form
   - Evidence: `plugins/wf/agents/charter-writer.md:24`, `plugins/wf/agents/charter-decomposer.md:21,32`.

3. [PASS] Ids are never renumbered (pre-existing rule, unchanged by this diff)
   - Evidence: `plugins/wf/agents/charter-decomposer.md:32` — "Never renumber: retire (...) freely, but append a new id only when...".

4. [PASS] A reword/retire revision returning `Scope changed: yes` still re-dispatches the decomposer as today, and raises no growth finding (no id is new)
   - Evidence: `plugins/wf/skills/charter/SKILL.md:192` — the pre-existing re-decompose clause is unchanged, and the new id-diff logic only fires on an actually-new id, which a reword/retire never produces.

5. [PASS] A finding / `## Open questions` entry / deferred Phase-3 `Flags:` choice needing a new id routes to `user` and is asked as the two-option gate, with the choice recorded in the review log
   - Evidence: `plugins/wf/agents/charter-reviewer.md:68`; `plugins/wf/skills/charter/SKILL.md:186`.
   - Caveat (non-gating for this literal criterion): see CORR-1 under Capability findings — "accept gap as warning" has no suppression on recurrence, so the identical gate re-fires every later round.

6. [FAIL] Exactly one growth revision may add ids per recorded authorization, bounded to the authorized gap and count
   - Expected: the check verifies the grant's actual bounds — one new id, matching the named `<gap>`, from one dispatch.
   - Found: the check tests only "does *a* recorded entry exist," never which entry, whether it was already spent, or whether the count/gap of what actually appeared matches what was granted.
   - Location: `plugins/wf/skills/charter/SKILL.md:140,158,192`; rationale in `plugins/wf/skills/charter/references/convergence-loop.md` confirms no consumption/matching design was ever specified.

7. [FAIL] The host's post-revision id-diff check runs immediately after *every* revision (both a rule-1 integration dispatch and a rule-4 blocking-findings dispatch) and before the next Phase 4 review, catching unauthorized growth regardless of `Scope changed:`
   - Expected: unconditional — the check fires after any revision-triggering dispatch.
   - Found: the "Post-revision growth check" sentence is textually nested entirely inside Phase 5 rule 4's own conditional block (`SKILL.md:192`, third bullet). Rules 1–4 are independently gated ("Apply these rules... in order"; rule 1's own text: "Evaluate rules 2–4 only when no unintegrated answers remain"). A round resolved by rule 1 alone — an ordinary answer-integration revision with no coexisting CRITICAL/HIGH finding that round — falls through to rule 2 (Clean) or rule 3 (Warnings only) and never reaches rule 4's block, so the growth check the text claims runs "after rule 1's integration dispatch" is in that case never executed at all.
   - Location: `plugins/wf/skills/charter/SKILL.md:184-192` (rule structure), `:192` (the check itself).
   - Independently confirmed by `audit` correctness (CORR-2, severity high, confidence high) and directly re-verified by re-reading the cited lines.

8. [FAIL] A rule-1 user answer whose integration needs a new id is itself auto-recorded as the growth authorization, with no separate gate, and `Revisions used` increments once
   - Expected: unconditional auto-recording whenever a rule-1 integration dispatch produces a new id.
   - Found: the auto-recording clause ("a new id with no authorization from rule 1's answer-integration dispatch auto-records that answer as the authorization") is the same rule-4-nested sentence identified in item 7 — unreachable whenever rule 4 does not independently fire that round. A rule-1-only round that produces a new id gets neither a check nor an authorization record.
   - Location: `plugins/wf/skills/charter/SKILL.md:192`.

9. [PASS] A headless run needing growth (a `[growth]`-tagged `route: user` item reaching Phase 5 rule 1) ends `CHARTER — Needs input`; it never hangs
   - Evidence: `plugins/wf/skills/charter/SKILL.md:186` — "Headless run: any `route: user` finding ends the run at `CHARTER — Needs input`" is unconditional within rule 1 itself, independent of the rule-4 nesting issue in items 7-8 (a *missed* detection is a silent gap, not a hang).

10. [PASS] Writer revision-mode contract: fix/reword/retire freely; no new `OUT-n` id without a stated growth authorization; gap recorded under the existing `## Open questions` section; no new output-block field
    - Evidence: `plugins/wf/agents/charter-writer.md:24,31`; output contract (`:110-116`) unchanged field set.

11. [PASS] Decomposer revision-mode contract: same, reported via `Flags: [growth] <one line>`; no new output-block field (a new value within the existing enum)
    - Evidence: `plugins/wf/agents/charter-decomposer.md:21,32,97`.

12. [PASS] Reviewer checklist: a finding needing a new outcome/sub-task (including a round ≥2 reviewer meeting a charter `## Open questions` entry) routes `user`; explicitly a routing rule only, never a growth detector
    - Evidence: `plugins/wf/agents/charter-reviewer.md:68` — "This is a **routing** rule only... comparing ids against the prior-round snapshot is exclusively the host's Phase 5 job."

13. [PASS] Phase 3: a revision-mode decomposer `[growth]`-tagged `Flags:` choice defers to the Phase 5 growth gate; every other choice (including an irreducible size overrun) keeps the immediate Phase 3 ask
    - Evidence: `plugins/wf/skills/charter/SKILL.md:160`.
    - Caveat (non-gating for this literal criterion): see C1 under Capability findings — the deferred flag itself is never persisted to any artifact between Phase 3 and Phase 5, so a run resumed in that window silently loses it, contradicting the skill's own "resume from artifacts, not memory" rule.

14. [PASS] No new writer/decomposer output-block fields introduced
    - Evidence: both output contracts' field lists are unchanged; `[growth]` is only a new value inside the existing `Flags:` / `## Open questions` free-text surfaces.

15. [PASS] The host records active `OUT`/`SUB` counts per round in the review log
    - Evidence: `plugins/wf/skills/charter/SKILL.md:180` — `**Active:** OUT <n> · SUB <m>` line.
    - Caveat (non-gating for this literal criterion): see C2 under Capability findings — this line is written but never read back anywhere; the actual growth check diffs the on-disk snapshot files, not this count line, so its stated purpose ("a resumed run reads back instead of trusting memory") is unimplemented.

16. [PASS] Roles keep their boundaries — growth-authorization and active-count records live only in `03_review-log.md` (already host-owned outright); the host never edits `01_charter.md`/`02_subtasks.md` beyond the pre-existing permitted metadata lines
    - Evidence: `plugins/wf/skills/charter/SKILL.md:82` (host-owned outright), `:180`, `:186`.

17. [PASS] Core stays domain-free
    - Evidence: grep for stack/domain terms (`angular|node-ts|ado|azure devops|linear\.app|typescript|C#|react|vue|django|rails|...`) across all five touched core files returned zero hits.

18. [PASS] `SKILL.md` ends no higher than its line count at the start of the slice
    - Evidence: `git show origin/main:plugins/wf/skills/charter/SKILL.md | wc -l` = 280; current file = 280 lines. `git diff --numstat` shows 6 insertions / 6 deletions (net 0) — no line-count growth occurred, so the constraint's "free lines from Phase 6 first" fallback was not needed.

19. [PASS] Version bump: PATCH
    - Evidence: `plugins/wf/.claude-plugin/plugin.json` and the marketplace's `wf` entry both `0.143.0`→`0.143.1`; marketplace top-level `0.190.0`→`0.190.1`. No grepped final-output block shape or argument surface changed, consistent with the PATCH tier.

20. [PASS] Touched files match exactly the constraint's list
    - Evidence: `git diff --numstat origin/main HEAD` shows exactly: `.claude-plugin/marketplace.json`, `plugins/wf/.claude-plugin/plugin.json`, `plugins/wf/agents/charter-decomposer.md`, `plugins/wf/agents/charter-reviewer.md`, `plugins/wf/agents/charter-writer.md`, `plugins/wf/skills/charter/SKILL.md`, `plugins/wf/skills/charter/references/convergence-loop.md` — no other file touched.

21. [PASS] `references/convergence-loop.md`'s reserved `### SUB-2` section is filled with the slice's rationale
    - Evidence: `plugins/wf/skills/charter/references/convergence-loop.md:89-140` — covers why the host is the sole detector, why a textual `[growth]` marker rather than a new field, why growth is detected from the id diff rather than `Scope changed:`, why the gate is two options, and why a rule-1 answer auto-authorizes. Rationale lives in the reference doc, not the runtime body, per the constraint.

22. [UNVERIFIABLE] The reqs' own "Verification evidence" — a replay of C031's final artifacts under the new contracts, and a first live run — showing non-increasing counts absent a logged authorization
    - Reason: requires executing the writer/decomposer/reviewer subagents against real inputs; cannot be confirmed from static code reading. No test/fixture file was added or required by this slice's touched-files constraint, so no automated substitute exists in this diff either.

## Capability findings

**audit** (5 lenses dispatched: correctness, security, convention, consistency, operational — all delivered):

- **audit** (correctness, CORR-1) — [FAIL] severity high, confidence high — "accept gap as warning" for a `[growth]`-tagged item is recorded only under `## Growth authorizations`; the reviewer's only suppression source is the separate `## Accepted warnings` fingerprint list, and the reviewer's growth-routing rule re-reports a non-empty charter `## Open questions` growth entry unconditionally at round ≥2 — so the identical two-option gate re-fires every subsequent round for a decision the user already made once. At `plugins/wf/skills/charter/SKILL.md:186` vs `plugins/wf/agents/charter-reviewer.md:24,68`.
- **audit** (correctness, CORR-2) — [FAIL] severity high, confidence high — the post-revision growth check is reachable only when Phase 5 rule 4 fires the same round; a rule-1-only revision skips it entirely (folded into requirement 7 above).
- **audit** (correctness, CORR-3) — [FAIL] severity medium, confidence medium — no defined match/consumption key for a `## Growth authorizations` entry (folded into requirements 1 and 6 above).
- **audit** (security, S1) — [FAIL] check: authorization gaps — the mechanical check enforces only "an authorization exists," not the grant's scope (one id, the named gap, not already spent); recommends recording the gap text and an expected count, confirming exactly one matching new id, and marking the entry consumed. At `plugins/wf/skills/charter/SKILL.md:140,158,192`.
- **audit** (operational, F-OP.1) — [FAIL] check: idempotency — a granted authorization behaves as a standing blank check for all later rounds up to the revision cap, reopening the exact unbounded-growth failure (C020/C031) this slice exists to close. At `plugins/wf/skills/charter/SKILL.md:186,192,140,158`.
- **audit** (consistency, C1) — [FAIL] check: guard completeness — the deferred Phase-3 `[growth]`-tagged `Flags:` choice is never persisted to any artifact before Phase 5 consumes it, so a run resumed between Phase 3 and Phase 5 silently loses it, contradicting the skill's own "resume from artifacts, not memory" rule. At `plugins/wf/skills/charter/SKILL.md:91,93-95,160,186`.
- **audit** (consistency, C2) — [WARN] check: persistence/response alignment — the `**Active:** OUT <n> · SUB <m>` line's stated purpose ("a resumed run reads back") is never implemented; the actual growth check reads the on-disk snapshot files instead. At `plugins/wf/skills/charter/SKILL.md:180,192`.
- **audit** (convention, check 1) — [WARN] naming parity — the new `"[growth] <one line>"` `Flags:` value's shape (`[tag] text`) diverges from its two sibling enum values' `label: text` shape. At `plugins/wf/agents/charter-decomposer.md:97`.
- **audit** (convention, check 2) — [WARN] behavioral parity — `## Growth authorizations` is never given an entry-format/match-key specification, unlike its explicitly-modeled-on sibling `## Accepted warnings`, whose fingerprint format is fully specified. At `plugins/wf/skills/charter/SKILL.md:186,192` vs `plugins/wf/agents/charter-reviewer.md:24`.

**author-caps** — [PASS] `validate_manifest` (2 manifests checked, 0 findings), `validate_skill_interface` (charter skill, 0 findings), `validate_references` (charter skill folder: 2 files, 14 references resolved, 0 findings; agents folder: 10 files, 24 references resolved, 0 findings).
**author-caps** — [FAIL, pre-existing, not introduced by this diff] `validate_registry` reported 6 `CHECK-4` errors — stale `## Plugin Roots` entries for `wf-git`, `wf-audit` (×2 rows), `wf-author-caps`, `wf-sandbox-testing`, `wf-linear` in `_local/config.md`, each pointing at an installed version older than what `resolve_registry`'s self-heal actually found. `git diff origin/main HEAD -- _local/config.md` is empty and the file is untouched by this branch's history — this is worktree-level registry drift unrelated to WF-552's changes, not a regression this task introduced. Recorded here for completeness; does not gate this task's verdict. Remedy: re-run each named pack's `init` to refresh its `## Plugin Roots` row (out of this task's scope).

## Adversarial findings

Clean pass: no core candidate met the closed two-class bound/unstated-assumption test with a citable existing-side line beyond what the `audit` capability's five lenses already surfaced in depth above (all five delivered). No candidate withdrawn, no coverage gap. Section omitted per the clean-change rule — nothing to add beyond the Capability findings section.

## Deviations from derived artifacts (informational)

None noted — `01_spec.md` and `02_plan.md` track `00_reqs.md` faithfully for the parts implemented; the gaps found above are implementation defects, not spec/plan drift.

## Recommended next actions

- Give each `## Growth authorizations` entry a concrete match key (the authorized `<gap>` text, an expected count of one, and a per-round scope) and mark it consumed immediately after the one dispatch it covers, in the same host step that records it (`plugins/wf/skills/charter/SKILL.md:140,158,192`) — addresses requirements 1 and 6, and findings CORR-3/S1/F-OP.1.
- Pull the "Post-revision growth check" out of Phase 5 rule 4's conditional block into its own unconditional step, run after *any* revision-triggering dispatch (rule 1's integration dispatch or rule 4's blocking-findings dispatch), before the next Phase 4 review (`SKILL.md:184-192`) — addresses requirements 7 and 8, and finding CORR-2.
- Give an "accept gap as warning" choice the same fingerprint-based suppression `## Accepted warnings` already has, so the reviewer stops re-reporting a growth item the user already resolved (finding CORR-1).
- Persist the deferred Phase-3 `[growth]`-tagged `Flags:` choice to `03_review-log.md` the same round it is deferred, so a resumed run can recover it (finding C1).
- Either wire the `**Active:** OUT <n> · SUB <m>` line into the actual growth check, or drop its "a resumed run reads back" claim if it is intentionally just a durable audit trail (finding C2).
- Re-run `/wf:verify-spec WF-552` after the above are addressed.
</content>
