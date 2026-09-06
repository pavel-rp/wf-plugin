# verify-spec: WF-554

**Source:** `_local/WF-554/00_reqs.md`
**Branch:** `feature/554-offer-one-explicit-user-gate-when-the`
**Commit:** `ba0351df621a641a49ed9ea0f90133938468d83a`  (base `831930f` — immediate parent commit; this task's own change is scoped to the two commits `d045beb` and `ba0351d` on top of it. Note: the local `main` ref in this worktree is stale — `git merge-base HEAD main` resolves to `8d3da85`, many merges behind — so a `main...HEAD` diff would spuriously include already-shipped sibling work (WF-522, WF-551, WF-552, WF-553, and others). The audit below is scoped to `831930f..HEAD`, which is exactly the four files this task's own plan lists as touched.)
**Tree:** clean
**Scope:** 4 files, +109/-13 vs parent commit `831930f` (2 commits: `d045beb` gate + `ba0351d` idempotency-marker follow-up)
**Verdict:** PARTIAL  (16/17 requirements — see Capability findings for the reason this is not a clean PASS)
**Audited by:** claude-sonnet-5
**Audited at:** 2026-09-04T20:05:00Z

## Requirements

1. [PASS] Given `Revisions used: 3 of 3` and ≥1 blocking finding, an interactive cap hit asks the user once (extend/accept/stop) and the choice is appended to the review log before anything else happens.
   - Evidence: `plugins/wf/skills/charter/SKILL.md:192` — "interactive — ask once via `AskUserQuestion`... and append the choice as a `status: pending` row to `## Cap-gate decisions`... *before* acting."

2. [PASS] Choosing extend dispatches exactly one more revision.
   - Evidence: `SKILL.md:192` — "extend raises `<cap>` by 1 in place... and falls through to 'Otherwise spend a revision' below", which increments `Revisions used` and dispatches once (`SKILL.md:193`).

3. [PASS] The review-log header's `Revisions used: <M> of <cap>` denominator is raised in place, grepped `M of cap` shape unchanged.
   - Evidence: `SKILL.md:192` — "raises `<cap>` by 1 in place (the grepped `M of cap` shape unchanged...)"; header line unchanged at `SKILL.md:99` and `SKILL.md:181`.

4. [PASS] Hitting the cap again re-asks the gate at most once per cap hit.
   - Evidence: `SKILL.md:192` — "The gate fires at most once per cap value — a later cap hit at the newly raised `<cap>` is a new pair, asked fresh."

5. [PASS] Choosing accept records residual findings' fingerprints under `## Accepted warnings`, sets `**Status:** Converged`, final block `CHARTER — Converged with warnings`.
   - Evidence: `SKILL.md:192` — "accept fingerprints every residual blocking finding under `## Accepted warnings` (rule 3's mechanism, reused unchanged), sets `**Status:** Converged`, ends `CHARTER — Converged with warnings`."

6. [PASS] Choosing stop ends `CHARTER — Blocked` listing residual findings, artifacts preserved — same shape as today's stop.
   - Evidence: `SKILL.md:192` — "stop ends `CHARTER — Blocked` (max rounds), residual findings listed" — identical wording to the prior unconditional stop.

7. [PASS] A recorded cap-gate choice is honored on a resumed run (after `/clear`) without re-asking.
   - Evidence: `SKILL.md:94` (State-model row) — a row with `status: pending` routes directly to "Phase 5 rule 4's recorded-choice branch... never re-dispatch Phase 4." The literal "don't re-ask" behavior holds in the ordinary case. See Capability findings below: three lenses independently found the `status: applied` write lands too early relative to the branch's actual follow-through, so a `/clear` landing in that narrower window is not fully honored (correctness/operational/consistency findings) — this is a residual defect on top of the requirement, not a failure of the literal "no re-ask" text.

8. [PASS] A headless run at the cap with blocking findings still ends `CHARTER — Blocked` exactly as today — no gate, never a hang.
   - Evidence: `SKILL.md:192` — "For a headless run... skip the gate, stop `CHARTER — Blocked`... no gate, never a hang" — wording matches the pre-existing unconditional stop verbatim.

9. [PASS] `plugins/wf/skills/charter/SKILL.md` ends no longer than its start-of-slice line count (280 lines).
   - Evidence: `wc -l plugins/wf/skills/charter/SKILL.md` → 279 (unchanged from the prior audit's commit — `ba0351d` touched no line count in `SKILL.md` net).

10. [PASS] Rationale for the new gate lives in `references/convergence-loop.md`'s reserved SUB-4 section, not inline in `SKILL.md`.
    - Evidence: `plugins/wf/skills/charter/references/convergence-loop.md:341-386` — `ba0351d` added two new rationale paragraphs ("Why a `pending`/`applied` marker..." and "Why an explicit row shape...") to this same section; `SKILL.md`'s rule 4 stays a single dense operational paragraph with no "why" prose.

11. [PASS] Domain-noun grep of the touched core skill stays clean.
    - Evidence: `grep -inE 'angular|typescript|react|\.net|c#|node\.js|python|django|java\b|kotlin|swift|linear|jira|ado\b|azure devops|github|gitlab' plugins/wf/skills/charter/SKILL.md plugins/wf/skills/charter/references/convergence-loop.md` → 0 hits.

12. [PASS] Only the user can extend the cap — never auto-extended, headless never softens this.
    - Evidence: `SKILL.md:192` — extend is reachable only through the interactive `AskUserQuestion` branch; the headless branch never touches `<cap>`.

13. [PASS] Touched files limited to `SKILL.md`, the paired `references/` doc, and the two version manifests.
    - Evidence: `git diff --stat 831930f HEAD` → exactly `.claude-plugin/marketplace.json`, `plugins/wf/.claude-plugin/plugin.json`, `plugins/wf/skills/charter/SKILL.md`, `plugins/wf/skills/charter/references/convergence-loop.md`. The second commit (`ba0351d`) touched only `SKILL.md` and the references doc — no further manifest bump, consistent with one version bump per task/PR.

14. [PASS] Headless runs must never hang waiting on a gate.
    - Evidence: `SKILL.md:192` headless clause is unconditional and synchronous (no wait state introduced).

15. [PASS] Phase 5 remains the sole retry owner — no other phase gains cap-adjacent state.
    - Evidence: the only new state-model wiring (`SKILL.md:94`) routes *into* Phase 5 rule 4 rather than introducing cap logic in any other phase; Phases 0–4 and 6 are untouched by the diff.

16. [PASS] Version bump is PATCH-tier and correctly applied to both manifests plus the marketplace top-level version.
    - Evidence: `plugins/wf/.claude-plugin/plugin.json:3` → `0.144.1`; `.claude-plugin/marketplace.json:14` (wf entry) → `0.144.1`; `.claude-plugin/marketplace.json:4` (top-level) → `0.190.3`. Unchanged by the follow-up commit `ba0351d`, which needed no new bump on top of the already-bumped `d045beb`.

17. [UNVERIFIABLE] "Verification evidence": replay against `_local/C031`'s final on-disk state (round 4, `Revisions used: 3 of 3`, 7 residual findings).
    - `_local/C031` does not exist in this worktree — the spec itself notes the corpus is "gitignored, not present in this worktree." Cannot be statically replayed; would need a live interactive session against that fixture.

## Capability findings

**audit** (5 lenses dispatched: correctness, security, convention, consistency, operational — all delivered):

- **audit** — [FAIL] The `status: applied` marker for the recorded cap-gate choice is written too early relative to the branch's actual follow-through, reopening the same resume gap the marker was added to close: for **extend**, "its branch's action" reads as the cap-raise clause alone, which ends before "falls through to 'Otherwise spend a revision'" (the snapshot write, writer/decomposer dispatch, and Phase-4 re-review); once the row is `applied`, the State model (`SKILL.md:94`) only special-cases `status: pending`, so a `/clear` landing between the cap-raise and the completed revision spend is invisible to the resumer — it falls through to the generic "Draft or In review → Phase 4" row (a fresh, unrevised review) rather than resuming the interrupted spend, or (per a second reading) the raise could be re-applied a second time if the resumer instead re-entered rule 4's text from the top. `plugins/wf/skills/charter/SKILL.md:192` vs the State-model row at `SKILL.md:94` vs the sibling guard idiom at `SKILL.md:193` ("skip it when round N's snapshot files already exist"). Independently raised by three lenses (correctness, operational, consistency) with matching evidence and file:line citations. — Remedy: write `status: applied` only after the full branch follow-through completes (cap raise + revision spend + re-review dispatch for extend; fingerprint + status write for accept), or add a State-model branch that routes a same-pair `applied` row back into completing rule 4's unfinished action rather than falling through to plain Phase 4.
- **audit** — [WARN] A `## Cap-gate decisions` row that reaches `status: applied` via the **stop** branch has no corresponding State-model resume route: charter `**Status:**` stays `In review` (stop never changes it), so a resumed stop-blocked charter falls through to the generic "Draft or In review → Phase 4" row and re-dispatches a full review — most likely reproducing the same blocking set and ending `CHARTER — Needs input` instead of re-emitting the already-decided `CHARTER — Blocked`. `SKILL.md:94` vs `:192`. — Remedy: add a State-model row (or extend rule 4) so an `applied` row for the current `<M> of <cap>` pair short-circuits to re-emitting that branch's recorded terminal outcome.
- **audit** — [WARN] The new `## Cap-gate decisions` row grammar drops the field label on its second column, breaking the labeled-field pattern the same sentence says it mirrors from `## Growth authorizations`: the sibling row (`SKILL.md:161`) is `- Round <N> | gap: <flag text> | status: pending` (every field after `Round <N>` is a `label: value` pair), while the new row (`SKILL.md:192`) is `- Round <N> | <M> of <cap> | choice: extend|accept|stop | status: pending|applied` — the second field has no label, unlike `choice:` and `status:` beside it. — Remedy: label the second field, e.g. `- Round <N> | revision: <M> of <cap> | choice: extend|accept|stop | status: pending|applied`.
- **audit** — [WARN] The Loop-contract diagram's cap-gate edge now overstates the gate's reach: it reads unconditionally "rounds exhausted → the cap gate (extend / accept / stop)" (`SKILL.md:23`), but rule 4 makes the three-choice gate interactive-only — headless still takes the unconditional `CHARTER — Blocked` with no gate at all (`SKILL.md:192`). — Remedy: qualify the diagram edge, e.g. "rounds exhausted → the cap gate, interactive only (extend / accept / stop); headless → Blocked."

**author-caps** — [PASS] `validate_skill_interface` and `validate_references` both report `status: pass` project-wide (62 skills / 126 files scanned), 0 findings — no schema or dead-reference defects introduced by either commit.

## Deviations from derived artifacts (informational)

- `plugins/wf/README.md:115` still advertises "a ≤3-round cap" in the charter skill's one-line catalogue summary. This diff makes that phrase stale — the cap is now user-extendable past 3 in an interactive run. README was correctly out of the plan's declared touched-file scope (Constraints: "Touched files: `SKILL.md`, the `references/` doc, the two version manifests"), so this is not a requirement failure, but it is a real doc-drift the plan didn't anticipate. (Unchanged since the prior audit — the follow-up commit did not touch the README.)

## Recommended next actions

- Fix the `status: applied` write-timing bug: mark the row `applied` only after the chosen branch's full follow-through completes (not merely its first mutating step), or give the State model an explicit resume route into rule 4's unfinished action for a same-pair row that is already `applied`.
- Add a State-model route for an `applied` row left by the **stop** branch, so a resumed stop-blocked charter re-emits `CHARTER — Blocked` instead of re-dispatching Phase 4.
- Label the `## Cap-gate decisions` row's second field (e.g. `revision:`) for parity with `## Growth authorizations`'s fully-labeled row shape.
- Qualify the Loop-contract diagram's cap-gate edge as interactive-only, since headless still takes the unconditional `Blocked` path with no gate.
- Consider a follow-up doc fix to `plugins/wf/README.md:115`'s "≤3-round cap" phrase (out of this task's scope, but now stale).

---
