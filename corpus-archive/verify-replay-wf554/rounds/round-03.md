# verify-spec: WF-554

**Source:** `_local/WF-554/00_reqs.md`
**Branch:** `feature/554-offer-one-explicit-user-gate-when-the`
**Commit:** `84868d6cb4cc3de497d0706674c73c08a4d7eca8`  (base `831930f` — immediate parent commit; this task's own change is scoped to the three commits `d045beb`, `ba0351d`, and `84868d6` on top of it. Note: the local `main` ref in this worktree is stale — `git merge-base HEAD main` resolves to `8d3da85`, many merges behind — so a `main...HEAD` diff would spuriously include already-shipped sibling work (WF-522, WF-551, WF-552, WF-553, and others). The audit below is scoped to `831930f..HEAD`, which is exactly the four files this task's own plan lists as touched.)
**Tree:** clean
**Scope:** 4 files, +120/-13 vs parent commit `831930f` (3 commits: `d045beb` gate + `ba0351d` idempotency-marker follow-up + `84868d6` applied-at-completion / stop-resume follow-up)
**Verdict:** PARTIAL  (16/17 requirements — see Capability findings for the reason this is not a clean PASS)
**Audited by:** claude-sonnet-5
**Audited at:** 2026-09-04T20:13:55Z

## Requirements

1. [PASS] Given `Revisions used: 3 of 3` and ≥1 blocking finding, an interactive cap hit asks the user once (extend/accept/stop) and the choice is appended to the review log before anything else happens.
   - Evidence: `plugins/wf/skills/charter/SKILL.md:192` — "interactive asks once via `AskUserQuestion` (*extend by one revision* / *accept the residual as warnings* / *stop*) and appends the choice as a new `status: pending` row (create the section on first use) *before* acting."

2. [PASS] Choosing extend dispatches exactly one more revision.
   - Evidence: `SKILL.md:192` — extend "raise[s] `<cap>` by 1 in place... and fall[s] through to it" ("Otherwise spend a revision", `SKILL.md:193`), which increments `Revisions used` and dispatches once.

3. [PASS] The review-log header's `Revisions used: <M> of <cap>` denominator is raised in place, grepped `M of cap` shape unchanged.
   - Evidence: `SKILL.md:192` — "raise `<cap>` by 1 in place now (the grepped `M of cap` header shape unchanged...)"; header line unchanged at `SKILL.md:99` and `SKILL.md:181`.

4. [PASS] Hitting the cap again re-asks the gate at most once per cap hit.
   - Evidence: `SKILL.md:192` — "The gate itself is asked at most once per cap value — a later hit at a newly raised `<cap>` is a new pair, asked fresh."

5. [PASS] Choosing accept records residual findings' fingerprints under `## Accepted warnings`, sets `**Status:** Converged`, final block `CHARTER — Converged with warnings`.
   - Evidence: `SKILL.md:192` — "accept fingerprints every residual blocking finding under `## Accepted warnings` (rule 3's mechanism, reused unchanged), sets `**Status:** Converged`, marks the row `applied`, ends `CHARTER — Converged with warnings`, and goes to Phase 6."

6. [PASS] Choosing stop ends `CHARTER — Blocked` listing residual findings, artifacts preserved — same shape as today's stop.
   - Evidence: `SKILL.md:192` — "stop ends `CHARTER — Blocked` (max rounds), residual findings listed, and marks the row `applied` (idempotent to repeat on every resume)" — same terminal shape as the prior unconditional stop, now with resume support (Requirement 7).

7. [PASS] A recorded cap-gate choice is honored on a resumed run (after `/clear`) without re-asking.
   - Evidence: `SKILL.md:94` (State-model row) — "Both present, `**Status:** In review`, and `03_review-log.md`'s last `## Cap-gate decisions` row is `status: pending`, or `choice: stop` (any status)" routes directly to "Phase 5 rule 4's recorded-choice branch... never re-dispatch Phase 4." This commit closes two gaps the prior audit found: the stop branch is now resumable (State-model row now matches `choice: stop` regardless of status), and `status: applied` is now written only once each branch's *entire* outcome completes rather than at its first step. The literal "no re-ask" behavior holds. See Capability findings below — two lenses independently found the completion-timing fix still leaves a *narrower* residual window open (the extend branch's post-raise dispatch/re-review, and the accept branch's fingerprint write, still lack their own once-per-round idempotency guard) — a residual defect on top of the requirement, not a failure of the literal "no re-ask" text.

8. [PASS] A headless run at the cap with blocking findings still ends `CHARTER — Blocked` exactly as today — no gate, never a hang.
   - Evidence: `SKILL.md:192` — "**headless** stops `CHARTER — Blocked` (max rounds), residual findings listed, no gate, exactly as before" — wording matches the pre-existing unconditional stop verbatim.

9. [PASS] `plugins/wf/skills/charter/SKILL.md` ends no longer than its start-of-slice line count (280 lines).
   - Evidence: `wc -l plugins/wf/skills/charter/SKILL.md` → 279.

10. [PASS] Rationale for the new gate lives in `references/convergence-loop.md`'s reserved SUB-4 section, not inline in `SKILL.md`.
    - Evidence: `plugins/wf/skills/charter/references/convergence-loop.md:323-434` — the follow-up commit added three further rationale paragraphs ("Why a `choice: stop` row resumes differently...", "Why the denominator moves in place...", "Why a resumed run needs a State-model-level check...") explaining the completion-timing and stop-resume fixes; `SKILL.md`'s rule 4 stays a single dense operational paragraph with no "why" prose.

11. [PASS] Domain-noun grep of the touched core skill stays clean.
    - Evidence: `grep -inE 'angular|typescript|react|\.net|c#|node\.js|python|django|java\b|kotlin|swift|linear|jira|ado\b|azure devops|github|gitlab' plugins/wf/skills/charter/SKILL.md plugins/wf/skills/charter/references/convergence-loop.md` → 0 hits.

12. [PASS] Only the user can extend the cap — never auto-extended, headless never softens this.
    - Evidence: `SKILL.md:192` — extend is reachable only through the interactive `AskUserQuestion` branch; the headless branch never touches `<cap>`.

13. [PASS] Touched files limited to `SKILL.md`, the paired `references/` doc, and the two version manifests.
    - Evidence: `git diff --stat 831930f HEAD` → exactly `.claude-plugin/marketplace.json`, `plugins/wf/.claude-plugin/plugin.json`, `plugins/wf/skills/charter/SKILL.md`, `plugins/wf/skills/charter/references/convergence-loop.md`. `git show --stat 84868d6` → only `SKILL.md` and the references doc — no further manifest bump, consistent with one version bump per task/PR.

14. [PASS] Headless runs must never hang waiting on a gate.
    - Evidence: `SKILL.md:192` headless clause is unconditional and synchronous (no wait state introduced).

15. [PASS] Phase 5 remains the sole retry owner — no other phase gains cap-adjacent state.
    - Evidence: the only state-model wiring touching this mechanism (`SKILL.md:94`) routes *into* Phase 5 rule 4 rather than introducing cap logic in any other phase; Phases 0–4 and 6 are untouched by the diff.

16. [PASS] Version bump is PATCH-tier and correctly applied to both manifests plus the marketplace top-level version.
    - Evidence: `plugins/wf/.claude-plugin/plugin.json:3` → `0.144.1`; `.claude-plugin/marketplace.json:14` (wf entry) → `0.144.1`; `.claude-plugin/marketplace.json:4` (top-level) → `0.190.3`. Unchanged by the follow-up commit `84868d6`, which needed no new bump on top of the already-bumped `d045beb`.

17. [UNVERIFIABLE] "Verification evidence": replay against `_local/C031`'s final on-disk state (round 4, `Revisions used: 3 of 3`, 7 residual findings).
    - `_local/C031` does not exist in this worktree — the spec itself notes the corpus is "gitignored, not present in this worktree." Cannot be statically replayed; would need a live interactive session against that fixture.

## Capability findings

**audit** (5 lenses dispatched: correctness, security, convention, consistency, operational — all delivered). This follow-up commit (`84868d6`) directly targeted the prior audit's four findings — it fixes all four: the `status: applied` timing bug (now set only at full branch completion), the stop-branch resume gap (now `choice: stop` resumes/re-emits regardless of status), the unlabeled row field (`revision:` label added), and the diagram overstating the gate's reach (now qualified "interactive only... headless → Blocked"). A fresh pass against the fixed state surfaced one residual defect the fix narrowed but did not close, plus one new wording inconsistency introduced by the fix itself:

- **audit** — [FAIL] The completion-timing fix guards only the `<cap>` raise's own idempotency (frozen-vs-current comparison); the steps that follow it in the shared "Otherwise spend a revision" bullet — incrementing `Revisions used`, the writer/decomposer re-dispatch, and the Phase-4 re-review dispatch — have no once-per-round completion guard analogous to that bullet's own snapshot-write guard ("skip it when round N's snapshot files already exist"). A `/clear` landing after the raise but before the row is marked `applied` (i.e., during or just after the dispatch/re-review) leaves the row `status: pending`; on resume, the State model routes back into the same extend branch, which sees the cap already raised and "skip[s] straight to 'Otherwise spend a revision'" — re-running the unguarded increment and re-dispatching a second live writer/decomposer call and a second Phase-4 review for what should be one revision spend. This directly contradicts the State-model row's own claim that the recorded-choice branch "never re-dispatch[es] Phase 4." `plugins/wf/skills/charter/SKILL.md:94` vs `:192`–`193`. Independently raised by two lenses (correctness, operational) with matching evidence and file:line citations. — Remedy: give the increment/dispatch/re-review sequence its own once-per-round guard (e.g., key it to the same snapshot-file check, or record a distinct "revision spent" marker on the cap-gate row before dispatching) so a resume after that sequence already ran falls through to marking `applied` instead of re-running it.
- **audit** — [WARN] The accept branch's fingerprint write ("fingerprints every residual blocking finding under `## Accepted warnings`") has no dedup/idempotency guard of its own; a `/clear` landing after fingerprinting but before the row is marked `applied` causes a resumed run to re-fingerprint the same residual findings under `## Accepted warnings` a second time. `SKILL.md:192`. — Remedy: before fingerprinting, check whether this cap-hit round's residual findings are already recorded under `## Accepted warnings` (or gate on `**Status:** Converged` already being set) and skip straight to marking the row `applied` if so.
- **audit** — [WARN] Rule 4's new parenthetical — an applied extend/accept row "is never 'the last entry' once its own branch has actually finished" — is inaccurate for both branches it names: accept always ends the loop (`## Cap-gate decisions` gets no further row after it), and extend's fall-through review can itself converge (Clean or Warnings-only), in which case its row also stays permanently last. The parenthetical states a row-position invariant that doesn't hold; the actual resume-safety invariant is that `**Status:**` has already left `In review` by the time either branch fully completes (a precondition the State-model row itself requires). `SKILL.md:192`. — Remedy: drop or correct the "never the last entry" clause and state the real invariant (`**Status:**` leaving `In review`) instead.

**author-caps** — [PASS] `validate_skill_interface` and `validate_references` both report `status: pass` project-wide (62 skills / 126 files scanned), 0 findings — no schema or dead-reference defects introduced by any of the three commits.

## Deviations from derived artifacts (informational)

- `plugins/wf/README.md:115` still advertises "a ≤3-round cap" in the charter skill's one-line catalogue summary. This diff makes that phrase stale — the cap is now user-extendable past 3 in an interactive run. README was correctly out of the plan's declared touched-file scope (Constraints: "Touched files: `SKILL.md`, the `references/` doc, the two version manifests"), so this is not a requirement failure, but it is a real doc-drift the plan didn't anticipate. (Unchanged since the prior two audits — no commit in this task has touched the README.)

## Recommended next actions

- Give the extend branch's post-raise sequence (increment `Revisions used`, writer/decomposer re-dispatch, Phase-4 re-review) its own once-per-round completion guard, so a resume after that sequence already ran doesn't repeat a live dispatch and a second re-review.
- Give the accept branch's fingerprint write a dedup guard so a resume between fingerprinting and the `applied` write doesn't double-record the same residual findings under `## Accepted warnings`.
- Correct rule 4's "never the last entry" parenthetical — state the real resume-safety invariant (`**Status:**` leaving `In review`) rather than a row-position claim that doesn't hold for either named branch.
- Consider a follow-up doc fix to `plugins/wf/README.md:115`'s "≤3-round cap" phrase (out of this task's scope, but now stale).

---
