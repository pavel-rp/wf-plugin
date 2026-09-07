# verify-spec: WF-552

**Source:** `_local/WF-552/00_reqs.md`
**Branch:** `feature/552-freeze-charter-scope-after-round-1`
**Commit:** `febf5335e3f84ae7178921ca4e05364374eeb1c2`  (base `8d3da8508602dbdb152c4742f25d7fede22fbe66`)
**Tree:** clean
**Scope:** 7 files vs `main`'s common ancestor, across this task's four commits `d9bb9a5`+`dbcf564`+`262f555`+`febf533` (`git diff d9bb9a5^..febf533 --stat` = 7 files, +82/-14). Note: `main...HEAD` is much larger because this branch stacks on several already-merged, unrelated tasks (WF-551, WF-522, …); only the four WF-552 commits are in scope for this audit.
**Verdict:** FAIL  (21/22 requirements, 1 UNVERIFIABLE) — gated by three residual capability findings (see below), not by any generic requirement
**Audited by:** claude-sonnet-5
**Audited at:** 2026-09-04 16:05 UTC

Round 4 — re-audits the full requirement set fresh against the current on-disk `SKILL.md`/reference doc (not just requirements 6 and 7, which round 3 left PARTIAL) per `febf533`'s stated fix ("close the growth-authorize branch's id-diff gaps"). Round 3's own text flagged itself as "the last cycle before this pipeline's verify⇄fix cap"; this round runs per explicit instruction despite that, and the residual findings below should be weighed against that stated cap rather than assumed to trigger an automatic fifth cycle.

## Requirements

1. [PASS] Active `OUT`/`SUB` counts stay non-increasing whenever no growth authorization is in the log
   - Evidence: unchanged — the dispatch-prompt trigger requires the entry's status to literally read `granted, consumed: no` (`plugins/wf/skills/charter/SKILL.md:140,158`), and Phase 5 rule 4's post-revision match requires the same status before treating a new id as authorized (`SKILL.md:192`). Growth with zero recorded entry is still blocked in every path.
   - Caveat (non-gating; see Capability findings, `audit` correctness FAIL / security warn): rule 1's growth-authorize branch (`SKILL.md:186`) now matches only "this dispatch's own entry's `<gap>`" — closing round 3's mis-attribution risk on that path — but rule 4 (`SKILL.md:192`) is unchanged and still matches any `granted, consumed: no` entry generically, so the same stale-entry mis-attribution risk survives on the blocking-findings path.

2. [PASS] Retirement uses the unchanged `~~OUT-n~~ retired: <why>` / `~~SUB-n~~ retired: <why>` form
   - Evidence: `plugins/wf/agents/charter-writer.md:24,39`, `plugins/wf/agents/charter-decomposer.md:21,32` — unchanged by round 4.

3. [PASS] Ids are never renumbered (pre-existing rule, unchanged by this diff)
   - Evidence: `plugins/wf/agents/charter-decomposer.md:32` — "Never renumber: retire (...) freely, but append a new id only when...".

4. [PASS] A reword/retire revision returning `Scope changed: yes` still re-dispatches the decomposer as today, and raises no growth finding (no id is new)
   - Evidence: `plugins/wf/skills/charter/SKILL.md:192` — the re-decompose clause is unchanged by round 4; the id-diff only fires on an actually-new id, which a reword/retire never produces.

5. [PASS] A finding / `## Open questions` entry / deferred Phase-3 `Flags:` choice needing a new id routes to `user` and is asked as the two-option gate, with the choice recorded in the review log
   - Evidence: `plugins/wf/agents/charter-reviewer.md:68`; `plugins/wf/skills/charter/SKILL.md:186` (two options: *accept gap as warning* / *authorize one growth revision*, both recorded). Unchanged since round 3.

6. [PASS] Exactly one growth revision may add ids per recorded authorization, bounded to the authorized gap and count
   - Sub-claim "bounded to the authorized gap" — [PASS]. Unchanged from round 3: the growth-authorize branch diffs active ids against a snapshot and matches "the one new id addressing this dispatch's own entry's `<gap>`" before marking it `consumed: yes` (`SKILL.md:186`).
   - Sub-claim "bounded to ... count" — [PASS, round 3's residual gap now closed]. The branch now carries a third outcome — "any other new id → unauthorized growth — raise a user-routed check to retroactively authorize (record a fresh `consumed: yes` entry) or retire the extra id(s) back (headless: `CHARTER — Needs input`, never silently legitimized)" (`SKILL.md:186`) — matching rule 4's parallel clause (`:192`) verbatim in structure. Independently confirmed by `audit` convention (round 4): "warn #1 (missing 'any other new id' fallback) — now carries the identical unauthorized-growth clause used in rule 4 — verbatim match."

7. [PASS] The host's post-revision id-diff check runs immediately after *every* revision-triggering dispatch and before the next Phase 4 review, catching unauthorized growth regardless of `Scope changed:`
   - Sub-claim "runs immediately after the dispatch" — [PASS]. Unchanged from round 3.
   - Sub-claim "before the next Phase 4 review" — [PASS, round 3's residual gap now closed]. The growth-authorize branch now ends "Then re-review the **full artifact set** (Phase 4) before evaluating rules 2–4" (`SKILL.md:186`), matching rule 4's equivalent instruction (`:192`).
   - Sub-claim "catching unauthorized growth regardless of `Scope changed:`" — [PASS, for this dispatch's own check]. The "any other new id" fallback (item 6) means this specific dispatch's own diff no longer misses an extra/mismatched id.
   - Caveat (non-gating for the three literal sub-claims above; see Capability findings, `audit` operational FAIL): the round-N snapshot the growth-authorize branch's own check relies on can still be overwritten *after* this dispatch's check completes, by the sibling "every other (non-`[growth]`) answer" branch firing later in the same round — see item 15's caveat.

8. [PASS] A rule-1 user answer whose integration needs a new id is itself auto-recorded as the growth authorization, with no separate gate, and `Revisions used` increments once
   - Evidence: `SKILL.md:186` — the ordinary-answer sub-path (distinct from the growth-authorize sub-path in items 6/7) is unchanged by round 4 and remains fully self-contained: snapshot, dispatch, diff, auto-authorize, revision-count, and an explicit "before re-review" all in the same clause.

9. [PASS] A headless run needing growth ends `CHARTER — Needs input`; it never hangs
   - Evidence: `SKILL.md:186` — "**Headless run:** any `route: user` finding, or an unresolved `pending`/unauthorized growth item, ends the run at `CHARTER — Needs input` instead of a prompt" — unchanged since round 2.

10. [PASS] Writer revision-mode contract: fix/reword/retire freely; no new `OUT-n` id without a stated growth authorization; gap recorded under the existing `## Open questions` section; no new output-block field
    - Evidence: `plugins/wf/agents/charter-writer.md:24,31`; output contract (`:109-116`) field set unchanged; file untouched by round 4.

11. [PASS] Decomposer revision-mode contract: same, reported via `Flags: [growth] <one line>`; no new output-block field
    - Evidence: `plugins/wf/agents/charter-decomposer.md:21,32,97`; file untouched by round 4.

12. [PASS] Reviewer checklist: a finding needing a new outcome/sub-task (including a round ≥2 reviewer meeting a charter `## Open questions` entry) routes `user`; explicitly a routing rule only, never a growth detector
    - Evidence: `plugins/wf/agents/charter-reviewer.md:68`; file untouched by round 4.

13. [PASS] Phase 3: a revision-mode decomposer `[growth]`-tagged `Flags:` choice defers to the Phase 5 growth gate; every other choice keeps the immediate Phase 3 ask
    - Evidence: `SKILL.md:160` — the deferred flag is recorded immediately as `- Round <N> | gap: <flag text> | status: pending` under `## Growth authorizations`, unchanged since round 2.

14. [PASS] No new writer/decomposer output-block fields introduced
    - Evidence: both output contracts' field lists unchanged; `[growth]` is only a new value inside the existing `Flags:` / `## Open questions` free-text surfaces.

15. [PASS] The host records active `OUT`/`SUB` counts per round in the review log
    - Evidence: `SKILL.md:180` — `**Active:** OUT <n> · SUB <m>` line, unchanged since round 2.
    - Caveat (non-gating; see Capability findings, `audit` operational FAIL): round 3's operational finding (a round with two or more authorized `[growth]` items could clobber the round-N snapshot) is now closed for that specific scenario — the growth-authorize branch writes the snapshot "at most once per round, skipping it when this round's snapshot files already exist" and diffs "disregarding any id already marked `consumed: yes` earlier in this round" (`SKILL.md:186`). A **related but distinct** scenario remains open: the sibling "every other (non-`[growth]`) answer" branch, evaluated under the same rule 1 in the same round, still writes "snapshot the round just reviewed (the write below)" **unconditionally** — with neither the "skip if this round's snapshot files already exist" guard nor the "disregarding ids already consumed this round" discount. A round that surfaces both a `[growth]`-tagged item and an ordinary charter-changing answer can therefore still have its round-N baseline overwritten by the ordinary-answer branch's write, after the growth branch already wrote (and relied on) that same baseline — reintroducing round 3's clobbering defect via a different pair of branches than the one round 3 named.

16. [PASS] Roles keep their boundaries — growth-authorization and active-count records live only in `03_review-log.md`; the host never edits `01_charter.md`/`02_subtasks.md` beyond the pre-existing permitted metadata lines
    - Evidence: `SKILL.md:82` (host-owned outright), `:180`, `:186`.

17. [PASS] Core stays domain-free
    - Evidence: grep for stack/domain terms (`angular|node-ts|azure devops|linear\.app|typescript|c#|react\b|vue|django|rails`) across both files touched by `febf533` (`SKILL.md`, `references/convergence-loop.md`) returned zero hits.

18. [PASS] `SKILL.md` ends no higher than its line count at the start of the slice
    - Evidence: `git show d9bb9a5^:plugins/wf/skills/charter/SKILL.md | wc -l` = 280; current file = 280 lines — net 0 growth across all four commits (`febf533` replaced one long line with another, no line-count change).

19. [PASS] Version bump: PATCH
    - Evidence: `plugins/wf/.claude-plugin/plugin.json` and the marketplace's `wf` entry both `0.143.0`→`0.143.1`; marketplace top-level `0.190.0`→`0.190.1` (set in round 1/2, unchanged and still correct — `febf533` is a prose-only wording/rationale fix carrying no new grepped-shape or argument-surface change, so no further bump is required).

20. [PASS] Touched files match exactly the constraint's list
    - Evidence: `git diff --numstat d9bb9a5^..febf533` shows exactly: `.claude-plugin/marketplace.json`, `plugins/wf/.claude-plugin/plugin.json`, `plugins/wf/agents/charter-decomposer.md`, `plugins/wf/agents/charter-reviewer.md`, `plugins/wf/agents/charter-writer.md`, `plugins/wf/skills/charter/SKILL.md`, `plugins/wf/skills/charter/references/convergence-loop.md` — no other file touched across all four commits.

21. [PASS] `references/convergence-loop.md`'s reserved `### SUB-2` section is filled with the slice's rationale
    - Evidence: `plugins/wf/skills/charter/references/convergence-loop.md:89-163` — now also covers, in two new paragraphs added by `febf533`, "Why every id-diff branch carries the same three outcomes" and "Why the round snapshot is written at most once per round," addressing round 3's three residual gaps (the missing fallback, the missing re-review instruction, and the snapshot-clobber risk).
    - Caveat (non-gating for the coverage claim above; see Capability findings, `audit` consistency FAIL / convention warn): the first new paragraph's opening claim — "every dispatch path that can grow the artifacts states all three [outcomes]" — is not quite accurate. Rule 1's *ordinary-answer* sub-path (same rule, same line, unchanged) states only one outcome ("a new id here is always auto-recorded as a fresh `consumed: yes` growth authorization"), by design — the doc's own adjacent "Why a rule-1 answer auto-authorizes rather than asking twice" paragraph explains that path is deliberately exempt from the three-outcome/unauthorized-growth check. The new paragraph's next sentence narrows correctly ("the authorized path exactly as it is on the blocking-findings path"), so the doc is internally inconsistent rather than functionally wrong — no runtime behavior is affected, but the opening sentence overclaims and should be scoped to the two paths it actually holds for.

22. [UNVERIFIABLE] The reqs' own "Verification evidence" — a replay of C031's final artifacts under the new contracts, and a first live run — showing non-increasing counts absent a logged authorization
    - Reason: requires executing the writer/decomposer/reviewer subagents against real inputs; cannot be confirmed from static code reading. No test/fixture file was added or required by this slice's touched-files constraint.

## Capability findings

**audit** (5 lenses dispatched: correctness, security, convention, consistency, operational — all delivered):

- **audit** (correctness) — [FAIL] Rule 4's id-diff (`SKILL.md:192`) still matches any pending `granted, consumed: no` entry generically, not "this dispatch's own entry" the way rule 1's growth-authorize branch (`:186`) was just fixed to require — a blocking-findings revision can wrongly consume an unrelated stale authorization. The new `references/convergence-loop.md:142-148` rationale states the "own entry, rather than any unconsumed one" scoping is meant to keep "a stale grant from an earlier round from silently absorbing an unrelated id" — a claim rule 4's unchanged text contradicts. Folded into requirement 1's caveat above. — Remedy: scope rule 4's match to a specific pending entry the current blocking-dispatch round is meant to satisfy (if any), mirroring rule 1's fix, or narrow the rationale's claim if rule 4's dispatch is genuinely never tied to one particular growth entry.
- **audit** (security, warn) — [WARN] Same rule-4/rule-1 scoping asymmetry, independently derived, rated non-blocking: "the round-3 fix closes only the temporal half of the mis-attribution risk... it does not close the identity half" on rule 4's path specifically (rule 1's own path is now closed). At `SKILL.md:192` vs the fixed `:186`.
- **audit** (consistency) — [FAIL] `references/convergence-loop.md:142-144`'s new claim "every dispatch path that can grow the artifacts states all three [outcomes]" contradicts the doc's own adjacent "Why a rule-1 answer auto-authorizes rather than asking twice" paragraph and the actual ordinary-answer sub-path (`SKILL.md:186`, unchanged), which states only one outcome and is, by that same doc's own explanation, deliberately not subject to the three-outcome check. Folded into requirement 21's caveat above. — Remedy: scope the claim to the two paths it actually holds for (the growth-authorize branch and rule 4), or explicitly except the ordinary-answer sub-path.
- **audit** (convention, warn) — [WARN] Same overclaim as consistency above, rated a lower-severity precision nit rather than a functional inconsistency. Also confirms round 3's two prior warns are now both resolved on disk: the "any other new id" fallback is present verbatim, and both snapshot-write cross-references within rule 1 now consistently read "(the write below)" (the earlier "(the write in rule 4)" wording is gone).
- **audit** (operational) — [FAIL] The "write the round snapshot at most once per round" guard `febf533` added (`SKILL.md:186`) covers only the `[growth]`-tagged branch's own write. The sibling "every other (non-`[growth]`) answer" branch in the same rule still writes the identical round-N snapshot path unconditionally, with neither the existence check nor the consumed-id discount — so a round mixing a growth item with an ordinary charter-changing answer can still clobber the pre-round baseline the growth branch's own check already established. Folded into requirement 15's caveat above. — Remedy: state the once-per-round guard as a property of the shared "(the write below)" snapshot procedure itself (both branches point to the same write), or restate it verbatim in the "every other answer" branch, so it applies regardless of which branch fires first in a round surfacing both kinds of `route: user` items.
- **audit** (operational, non-finding note) — the diff-side fix is independently confirmed correct: "disregarding any id already marked `consumed: yes` earlier in this round" (`SKILL.md:186`) correctly excludes a first authorized growth item's id from a second item's "any other new id" check, and the pre-existing WARN about no lifecycle for a resurfacing `[growth]` gap while an earlier grant sits unconsumed remains unaddressed as expected (out of this slice's scope, not re-reported as new).

**author-caps** — [PASS] `validate_skill_interface` (charter skill, 0 findings), `validate_references` (charter skill folder: 2 files/14 refs, 0 findings), `validate_manifest` (2 manifests, 0 findings). `febf533` touched only prose inside `SKILL.md` and `references/convergence-loop.md` — no manifest, registry, slot-marker, or invocation-reference change — so this gate is a no-op beyond the checks already re-run above.
**author-caps** — [FAIL, pre-existing, not introduced by this diff] The same stale `## Plugin Roots` `CHECK-4` errors noted in rounds 1–3 (`wf-git`, `wf-audit` ×2, `wf-author-caps`, `wf-sandbox-testing`, `wf-linear`) remain in `_local/config.md`; worktree-level drift unrelated to WF-552, unchanged this round, does not gate this verdict.

## Adversarial findings

Core independently identified the same three defect classes the capability findings above cover in depth — each an unstated assumption behind a change this round makes. Reconciliation:

- **core** — [assumption] `references/convergence-loop.md:142-148`'s new rationale asserts "every id-diff branch" now scopes its match to "this dispatch's own entry," an assumption `SKILL.md:192` (rule 4, unchanged) does not establish — withdrawn: covered by `audit` correctness's FAIL and security's warn above, both resting on the identical changed-side (`convergence-loop.md:142-148`) and existing-side (`SKILL.md:192`) evidence.
- **core** — [assumption] `references/convergence-loop.md:142-144`'s new rationale asserts "every dispatch path that can grow the artifacts states all three [outcomes]," an assumption the unchanged ordinary-answer sub-path at `SKILL.md:186` does not establish (it states one outcome, by design) — withdrawn: covered by `audit` consistency's FAIL and convention's warn above, both resting on the identical changed-side (`convergence-loop.md:142-144`) and existing-side (`SKILL.md:186`, ordinary-answer clause) evidence.
- **core** — [assumption] the growth-authorize branch's new "write snapshot at most once per round" guard (`SKILL.md:186`) assumes it is the round's only writer of the round-N snapshot, an assumption the unchanged, immediately-following "every other (non-`[growth]`) answer" clause in the same line does not honor (it writes unconditionally) — withdrawn: covered by `audit` operational's FAIL above, resting on the identical changed-side (`SKILL.md:186`, growth-branch guard) and existing-side (`SKILL.md:186`, ordinary-answer clause) evidence.

No other candidate met the closed two-class bound/unstated-assumption test with a citable existing-side line beyond what the five `audit` lenses already surfaced. Coverage: all five lenses delivered.

## Deviations from derived artifacts (informational)

None noted — `01_spec.md` and `02_plan.md` track `00_reqs.md` faithfully; the gaps found above are implementation defects, not spec/plan drift.

## Recommended next actions

- Apply the same "this dispatch's own entry" scoping rule 1's growth-authorize branch just received (`SKILL.md:186`) to rule 4's match clause (`SKILL.md:192`) — resolves the correctness FAIL / security warn asymmetry and requirement 1's residual caveat.
- Extend the "write snapshot at most once per round, skip if this round's snapshot files already exist" guard to the "every other (non-`[growth]`) answer" branch as well — or, more robustly, hoist it out of the growth branch into the single shared "(the write below)" procedure both branches already point to by name — so a round mixing a growth item and an ordinary answer cannot still clobber the baseline. Resolves the operational FAIL and requirement 15's residual caveat.
- Narrow `references/convergence-loop.md:142-144`'s "every dispatch path that can grow the artifacts states all three [outcomes]" claim to the two paths that actually gate on authorization (the growth-authorize branch and rule 4), or explicitly except the by-design single-outcome ordinary-answer sub-path — resolves the consistency FAIL / convention warn and requirement 21's residual caveat.
- All three residual gaps above are documentation/asymmetry issues narrower in scope than round 3's — none re-opens a generic requirement to FAIL or PARTIAL, and all three are citable in one place each (`SKILL.md:192`, `SKILL.md:186`'s ordinary-answer clause, and `convergence-loop.md:142-148`). Round 3 named this round as the last cycle before the verify⇄fix cap; the remaining gaps are narrow enough for a single small follow-up edit, but given the stated cap, weigh a targeted fix-and-close against accepting the two documentation-only findings (consistency/convention) as warnings and fixing only the two functional asymmetries (correctness/operational) before shipping.
- Re-run `/wf:verify-spec WF-552` after any of the above are addressed.
</content>

---
