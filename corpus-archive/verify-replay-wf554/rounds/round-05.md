# verify-spec: WF-554

**Source:** `_local/WF-554/00_reqs.md`
**Branch:** `feature/554-offer-one-explicit-user-gate-when-the`
**Commit:** `55e292ad3161da51947b5abfb405c7ebed41cc56`  (base `831930f` — immediate parent commit; this task's own change is scoped to the five commits `d045beb`, `ba0351d`, `84868d6`, `bbbb06a`, and `55e292a` on top of it. Note: the local `main` ref in this worktree is stale — a `main...HEAD` diff would spuriously include already-shipped sibling work (WF-522, WF-551, WF-552, WF-553, and others). The audit below is scoped to `831930f..HEAD`, which is exactly the four files this task's own plan lists as touched.)
**Tree:** clean
**Scope:** 4 files, +171/-13 vs parent commit `831930f` (5 commits: `d045beb` gate + `ba0351d` idempotency-marker follow-up + `84868d6` applied-at-completion/stop-resume follow-up + `bbbb06a` one-rule re-entrancy follow-up + `55e292a` per-artifact resume-marker follow-up)
**Verdict:** PARTIAL  (16/17 requirements — see Capability findings for the reason this is not a clean PASS)
**Audited by:** claude-sonnet-5
**Audited at:** 2026-09-04T21:10:00Z

## Requirements

1. [PASS] Given `Revisions used: 3 of 3` and ≥1 blocking finding, an interactive cap hit asks the user once (extend/accept/stop) and the choice is appended to the review log before anything else happens.
   - Evidence: `plugins/wf/skills/charter/SKILL.md:192` — "interactive asks once via `AskUserQuestion`... and appends the choice as a new `status: pending` row... *before* acting." Unchanged by `55e292a`.

2. [PASS] Choosing extend dispatches exactly one more revision.
   - Evidence: `SKILL.md:192` — extend "raise[s] `<cap>` by 1 in place... then fall[s] through to 'Otherwise spend a revision' below." The revision-count semantics are unchanged; `55e292a` only splits the follow-through's completion markers per artifact. See Capability findings for a new residual defect in the id-diff/unauthorized-growth sub-step's own marker.

3. [PASS] The review-log header's `Revisions used: <M> of <cap>` denominator is raised in place, grepped `M of cap` shape unchanged.
   - Evidence: `SKILL.md:192` — "raise `<cap>` by 1 in place (the grepped `M of cap` header shape unchanged...)"; header line unchanged at `SKILL.md:99` and `SKILL.md:181`.

4. [PASS] Hitting the cap again re-asks the gate at most once per cap hit.
   - Evidence: `SKILL.md:192` — "The gate itself is asked at most once per cap value — a later hit at a newly raised `<cap>` is a new pair, asked fresh." Unchanged by `55e292a`.

5. [PASS] Choosing accept records residual findings' fingerprints under `## Accepted warnings`, sets `**Status:** Converged`, final block `CHARTER — Converged with warnings`.
   - Evidence: `SKILL.md:192` — "accept fingerprints every residual blocking finding under `## Accepted warnings`... and sets `**Status:** Converged`... then marks the row `applied`, ends `CHARTER — Converged with warnings`." Text unchanged by `55e292a` (the commit's diff hunk reflows this same sentence but does not alter its wording).

6. [PASS] Choosing stop ends `CHARTER — Blocked` listing residual findings, artifacts preserved — same shape as today's stop.
   - Evidence: `SKILL.md:192` — "stop ends `CHARTER — Blocked` (max rounds), residual findings listed... it writes no artifact state, so it is idempotent by construction and safe to re-emit on every resume." Unchanged by `55e292a`.

7. [PASS] A recorded cap-gate choice is honored on a resumed run (after `/clear`) without re-asking.
   - Evidence: `SKILL.md:94` (State-model row) and `SKILL.md:192`. `55e292a` replaces the single compound "on-disk fact" the prior audit found insufficiently granular with one marker per artifact — the writer keyed to `01_charter.md` vs `01_charter.round-<N>.md`, the decomposer keyed to `02_subtasks.md` vs `02_subtasks.round-<N>.md` — plus an explicit tie-break: since `Scope changed: yes` reaches no artifact, a resume finding the writer's marker present and the decomposer's absent re-dispatches the decomposer. All five lenses that examined this branch (correctness, consistency) independently confirmed the split closes the prior audit's FAIL scenario (a resume can no longer silently carry an unrevised decomposition into re-review), and confirmed the decomposer's dispatch stays correctly gated by `Scope changed:` on the straight-through path (no spurious forced dispatch). The literal "no re-ask" behavior holds in every case examined. However, two lenses (correctness, consistency) independently found that the **new** id-diff/`consumed:`-marking marker this same commit adds is itself defective in a way that can cause a resume to silently skip the unauthorized-growth check — see the `[FAIL]` capability finding below. This is a residual defect on top of the requirement, not a failure of the literal "no re-ask" text (matching the pattern of the three prior audit cycles on this task).

8. [PASS] A headless run at the cap with blocking findings still ends `CHARTER — Blocked` exactly as today — no gate, never a hang.
   - Evidence: `SKILL.md:192` — "**headless** stops `CHARTER — Blocked` (max rounds), residual findings listed, no gate, exactly as before." Unchanged by `55e292a`.

9. [PASS] `plugins/wf/skills/charter/SKILL.md` ends no longer than its start-of-slice line count (280 lines).
   - Evidence: `wc -l plugins/wf/skills/charter/SKILL.md` → 279. `55e292a` is a net two-line replacement inside the file (one bullet reworded, one State-model cross-reference reworded) — no line-count change.

10. [PASS] Rationale for the new gate lives in `references/convergence-loop.md`'s reserved SUB-4 section, not inline in `SKILL.md`.
    - Evidence: `plugins/wf/skills/charter/references/convergence-loop.md:323` opens `### SUB-4 — the cap gate and user-authorized extensions`, the file's last `###` section (no `SUB-5` follows). `55e292a`'s new "Why the dispatch step carries one marker per artifact rather than one for the pair" rationale block and the "Two residuals are disclosed rather than closed" paragraph land at `convergence-loop.md:398-424`, inside that same section. `SKILL.md`'s rule 4 stays a single dense operational paragraph with no "why" prose.

11. [PASS] Domain-noun grep of the touched core skill stays clean.
    - Evidence: `grep -inE 'angular|typescript|react|\.net|c#|node\.js|python|django|java\b|kotlin|swift|linear|jira|ado\b|azure devops|github|gitlab' plugins/wf/skills/charter/SKILL.md plugins/wf/skills/charter/references/convergence-loop.md` → 0 hits.

12. [PASS] Only the user can extend the cap — never auto-extended, headless never softens this.
    - Evidence: `SKILL.md:192` — extend is reachable only through the interactive `AskUserQuestion` branch; the headless branch never touches `<cap>`. Unchanged by `55e292a`.

13. [PASS] Touched files limited to `SKILL.md`, the paired `references/` doc, and the two version manifests.
    - Evidence: `git diff --stat 831930f HEAD` → exactly `.claude-plugin/marketplace.json`, `plugins/wf/.claude-plugin/plugin.json`, `plugins/wf/skills/charter/SKILL.md`, `plugins/wf/skills/charter/references/convergence-loop.md`. `git show --stat 55e292a` → only `SKILL.md` and the references doc — no further manifest bump, consistent with one version bump per task/PR (the manifests were already bumped at `d045beb`).

14. [PASS] Headless runs must never hang waiting on a gate.
    - Evidence: `SKILL.md:192` headless clause is unconditional and synchronous (no wait state introduced). Unchanged by `55e292a`.

15. [PASS] Phase 5 remains the sole retry owner — no other phase gains cap-adjacent state.
    - Evidence: the only state-model wiring touching this mechanism (`SKILL.md:94`) routes *into* Phase 5 rule 4 rather than introducing cap logic in any other phase; Phases 0–4 and 6 are untouched by `55e292a`.

16. [PASS] Version bump is PATCH-tier and correctly applied to both manifests plus the marketplace top-level version.
    - Evidence: `plugins/wf/.claude-plugin/plugin.json:3` → `0.144.1`; `.claude-plugin/marketplace.json:14` (wf entry) → `0.144.1`; `.claude-plugin/marketplace.json:4` (top-level) → `0.190.3`. Unchanged by `55e292a`, which needed no new bump on top of the already-bumped `d045beb` (one bump per task/PR, per repo convention).

17. [UNVERIFIABLE] "Verification evidence": replay against `_local/C031`'s final on-disk state (round 4, `Revisions used: 3 of 3`, 7 residual findings).
    - `_local/C031` does not exist in this worktree — the spec itself notes the corpus is "gitignored, not present in this worktree." Cannot be statically replayed; would need a live interactive session against that fixture. (Known-and-accepted per task scope — not re-litigated.)

## Capability findings

**audit** (5 lenses dispatched against `55e292a` specifically, adversarially scoped to its freshly added text: correctness, security, convention, consistency, operational — all delivered). This follow-up commit directly targeted the prior audit's five residual findings (one FAIL, four WARN) by splitting the single compound re-entrancy marker into one marker per artifact, adding a marker for the id-diff/`consumed:` step, anchoring the `## Round <N+1>` marker to a line-start heading, renaming "fact" to "marker" throughout, and deleting the redundant "never earlier" clause. A fresh, adversarial pass against this same new text confirms four of the five prior items are genuinely closed, but surfaces one new defect that is more severe than what the id-diff marker was meant to fix, plus two smaller residuals:

- **audit** — [FAIL] The new id-diff/`consumed:`-marking marker is vacuously satisfied in the ordinary case, silently defeating the very unauthorized-growth guard it was added to protect. `SKILL.md:192` defines this step's marker as "every `## Growth authorizations` entry recorded for this round reading `consumed: yes`" — a universally-quantified condition over a set that is legitimately **empty** whenever no `[growth]`-tagged question was asked this round (the ordinary case; entries are minted only via the rule-1 growth-ask flow at `SKILL.md:187`, or retroactively by this same id-diff step's own "unauthorized growth" branch at `SKILL.md:193`). "Every element of the empty set satisfies P" is vacuously true, so the marker reads **present** before the id-diff step has ever executed — in precisely the round where the id-diff step's whole job (per `SKILL.md:193`: "any other new id → unauthorized growth — raise a user-routed check...") is to catch a new id with **no** matching authorization at all. A resume landing after the writer/decomposer markers are set but before the id-diff step has actually run will read this marker as satisfied and skip unauthorized-growth detection entirely — the exact failure mode `references/convergence-loop.md:411-412` and the commit message claim this marker closes ("so a resume cannot pass over unauthorized-growth detection"). Independently raised with matching file:line evidence by two lenses (correctness, consistency); the writer and decomposer markers added in the same commit do not share this flaw because they compare concrete file content, never a possibly-empty collection. — Remedy: give the id-diff step a non-vacuous completion marker — e.g. an explicit per-round line the id-diff step itself writes on completion, independent of whether any `## Growth authorizations` entry exists for the round — rather than deriving "done" from a universally-quantified property that is trivially true of an empty set.
- **audit** — [WARN] The `## Round <N+1>` marker's "anchored at the start of a line, never as a substring" fix (`SKILL.md:192`) closes the flat mid-line-substring forgery the prior audit flagged, but not a same-shape variant reached through the unchanged verbatim append at `SKILL.md:181` ("appends the returned block verbatim... beneath the host-written heading, with no fencing, no escaping"). The reviewer's own output contract mandates reproducing quoted artifact text verbatim per finding (`plugins/wf/agents/charter-reviewer.md:25,81`), and nothing constrains that quoted text to a single line or forbids it from itself beginning with `## Round <N+1>` once spliced in — round numbers are small, predictable, sequential integers. Independently raised by two lenses on related but distinct evidence (security: a newline embedded inside the reviewer's `quote:` field; correctness: the reviewer's returned block itself containing a line that already starts with the marker text) — both stand, one defect seen twice through different vectors. — Remedy: before appending the reviewer's returned block to `03_review-log.md`, either escape/collapse embedded newlines in the block's field values so untrusted content can never start a fresh line, or have the resume check track round headings by the host's own append count/position rather than by re-scanning the file's raw text for a pattern untrusted content can also produce.
- **audit** — [WARN] `SKILL.md:192`'s writer clause ("the writer (marker: `01_charter.md` differs from `01_charter.round-<N>.md`)") lacks the explicit conditional qualifier the decomposer clause carries ("dispatched on the straight-through path exactly when that bullet's own condition calls for it"), even though the same sentence calls both "two conditionally-dependent dispatches" and the writer is just as conditional per the unchanged `SKILL.md:193` ("if any blocking finding routes to `charter-writer`, dispatch the writer... If findings route only to `decomposer`, dispatch it alone"). Raised by the convention lens as a clarity risk — a future editor could misread the bare writer clause as unconditional. The correctness lens independently confirmed this causes **no functional defect** today: unlike `Scope changed:` (an ephemeral, unpersisted report), whether findings route to `charter-writer` is always re-derivable from the round's findings already persisted verbatim under `## Round <N>` (`SKILL.md:181`), so the writer's own dispatch condition carries no resume-time ambiguity. Reported as a documentation-clarity WARN, not a behavioral one. — Remedy: give the writer clause the same explicit qualifier the decomposer clause has, so both halves of "two conditionally-dependent dispatches" read symmetrically.

**author-caps** — [PASS] `validate_skill_interface` and `validate_references`, both scoped to the `charter` skill, report `status: pass` — 0 findings (skill-interface: 1 skill checked; references: 2 files scanned, 14 references resolved against the tree). No schema or dead-reference defects introduced by `55e292a`.

## Adversarial findings

The lean core pass (closed two-class check: out-of-range bound; unstated assumption behind a derivation) identified two candidates against `55e292a`'s new text, both of which fully overlap the aggregated capability findings above on the same changed-side citation and the same existing-side evidence, so both withdraw rather than double-report:

Withdrawn:

- **core** — [assumption] the id-diff step's derivation of "already ran" from a universally-quantified `consumed: yes` check at `SKILL.md:192`, requiring the unstated precondition that `## Growth authorizations` entries for the round are non-empty, not established at `SKILL.md:187`/`:193` — withdrawn: covered by the `audit` capability's `[FAIL]` finding above on the identical changed- and existing-side evidence.
- **core** — [assumption] the `## Round <N+1>` marker's derivation of "re-review already ran" from a line-start text match at `SKILL.md:192`, requiring the unstated precondition that only the host's own append step can produce such a line, not established at `SKILL.md:181` (verbatim, unescaped append) — withdrawn: covered by the `audit` capability's `[WARN]` finding above on the identical changed-side citation and the same verbatim-append existing-side evidence.

## Deviations from derived artifacts (informational)

- `plugins/wf/README.md:115` still advertises "a ≤3-round cap" in the charter skill's one-line catalogue summary. This diff makes that phrase stale — the cap is now user-extendable past 3 in an interactive run. README was correctly out of the plan's declared touched-file scope (Constraints: "Touched files: `SKILL.md`, the `references/` doc, the two version manifests"), so this is not a requirement failure, but it is a real doc-drift the plan didn't anticipate. (Unchanged since the prior three audits — no commit in this task has touched the README.)

## Recommended next actions

- Give the id-diff/`consumed:`-marking step a non-vacuous completion marker (e.g. an explicit per-round line it writes itself) instead of deriving "done" from a universally-quantified check over a set that is legitimately empty in the ordinary case — this is the one item that actually regresses unauthorized-growth detection on resume.
- Escape or collapse embedded newlines in the reviewer's verbatim-appended returned block (in particular the `quote:` field), or track round headings by the host's own append position, so untrusted/quoted content can never produce a forged line-start `## Round <N+1>` match.
- Give the writer's dispatch clause the same explicit "dispatched exactly when that bullet's own condition calls for it" qualifier the decomposer clause has, for textual symmetry (no functional defect today, but a future-editor risk).
- Consider a follow-up doc fix to `plugins/wf/README.md:115`'s "≤3-round cap" phrase (out of this task's scope, but now stale).

---
