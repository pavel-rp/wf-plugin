# verify-spec: WF-554

**Source:** `_local/WF-554/00_reqs.md`
**Branch:** `feature/554-offer-one-explicit-user-gate-when-the`
**Commit:** `d045bebf926346d35d8e9b5b57f0fd21c042165a`  (base `831930f` — immediate parent commit; this task's own change is scoped to that single commit. Note: the local `main` ref in this worktree is stale — `git merge-base HEAD main` resolves to `8d3da85`, many merges behind — so a `main...HEAD` diff would spuriously include already-shipped sibling work (WF-522, WF-551, WF-552, WF-553, and others). The audit below is scoped to commit `d045beb` alone, which is exactly the four files this task's own plan lists as touched.)
**Tree:** clean
**Scope:** 4 files, +80/-12 vs parent commit `831930f`
**Verdict:** PARTIAL  (16/17 requirements — see Capability findings for the reason this is not a clean PASS)
**Audited by:** claude-sonnet-5
**Audited at:** 2026-09-04T19:50:00Z

## Requirements

1. [PASS] Given `Revisions used: 3 of 3` and ≥1 blocking finding, an interactive cap hit asks the user once (extend/accept/stop) and the choice is appended to the review log before anything else happens.
   - Evidence: `plugins/wf/skills/charter/SKILL.md:192` — "Check `03_review-log.md`'s `## Cap-gate decisions` first... Otherwise... interactive — ask once via `AskUserQuestion`... and append the choice to `## Cap-gate decisions`... *before* acting."

2. [PASS] Choosing extend dispatches exactly one more revision.
   - Evidence: `SKILL.md:192` — "extend raises `<cap>` by 1 in place... and falls through to 'Otherwise spend a revision' below", which increments `Revisions used` and dispatches once (`SKILL.md:193`).

3. [PASS] The review-log header's `Revisions used: <M> of <cap>` denominator is raised in place, grepped `M of cap` shape unchanged.
   - Evidence: `SKILL.md:192` — "raises `<cap>` by 1 in place (the grepped `M of cap` shape unchanged...)"; header line unchanged at `SKILL.md:99` and `SKILL.md:181`.

4. [PASS] Hitting the cap again re-asks the gate at most once per cap hit.
   - Evidence: `SKILL.md:192` — "The gate fires at most once per cap value — a later cap hit at the newly raised `<cap>` asks again."

5. [PASS] Choosing accept records residual findings' fingerprints under `## Accepted warnings`, sets `**Status:** Converged`, final block `CHARTER — Converged with warnings`.
   - Evidence: `SKILL.md:192` — "accept fingerprints every residual blocking finding under `## Accepted warnings` (rule 3's mechanism, reused unchanged), sets `**Status:** Converged`, ends `CHARTER — Converged with warnings`."

6. [PASS] Choosing stop ends `CHARTER — Blocked` listing residual findings, artifacts preserved — same shape as today's stop.
   - Evidence: `SKILL.md:192` — "stop ends `CHARTER — Blocked` (max rounds), residual findings listed" — identical wording to the prior unconditional stop.

7. [PASS] A recorded cap-gate choice is honored on a resumed run (after `/clear`) without re-asking.
   - Evidence: `SKILL.md:94` (new State-model row) — a recorded, not-yet-followed-through choice routes directly to "Phase 5 rule 4's recorded-choice branch... never re-dispatch Phase 4"; `SKILL.md:99` confirms durability. See Capability findings below — the literal "don't re-ask" behavior is present, but the follow-through this row triggers is not idempotent against a second resume in the same window (correctness/operational/consistency findings).

8. [PASS] A headless run at the cap with blocking findings still ends `CHARTER — Blocked` exactly as today — no gate, never a hang.
   - Evidence: `SKILL.md:192` — "For a headless run... skip the gate, stop `CHARTER — Blocked`... no gate, never a hang" — wording matches the pre-existing unconditional stop verbatim.

9. [PASS] `plugins/wf/skills/charter/SKILL.md` ends no longer than its start-of-slice line count (280 lines).
   - Evidence: `wc -l plugins/wf/skills/charter/SKILL.md` → 279.

10. [PASS] Rationale for the new gate lives in `references/convergence-loop.md`'s reserved SUB-4 section, not inline in `SKILL.md`.
    - Evidence: `plugins/wf/skills/charter/references/convergence-loop.md:322-395` — the SUB-4 placeholder is filled with the rationale; `SKILL.md`'s rule 4 stays a single dense operational paragraph with no "why" prose.

11. [PASS] Domain-noun grep of the touched core skill stays clean.
    - Evidence: `grep -inE 'angular|typescript|react|\.net|c#|node\.js|python|django|java\b|kotlin|swift|linear|jira|ado\b|azure devops|github|gitlab' plugins/wf/skills/charter/SKILL.md plugins/wf/skills/charter/references/convergence-loop.md` → 0 hits.

12. [PASS] Only the user can extend the cap — never auto-extended, headless never softens this.
    - Evidence: `SKILL.md:192` — extend is reachable only through the interactive `AskUserQuestion` branch; the headless branch never touches `<cap>`.

13. [PASS] Touched files limited to `SKILL.md`, the paired `references/` doc, and the two version manifests.
    - Evidence: `git show --stat d045beb` → exactly `.claude-plugin/marketplace.json`, `plugins/wf/.claude-plugin/plugin.json`, `plugins/wf/skills/charter/SKILL.md`, `plugins/wf/skills/charter/references/convergence-loop.md`.

14. [PASS] Headless runs must never hang waiting on a gate.
    - Evidence: `SKILL.md:192` headless clause is unconditional and synchronous (no wait state introduced).

15. [PASS] Phase 5 remains the sole retry owner — no other phase gains cap-adjacent state.
    - Evidence: the only new state-model wiring (`SKILL.md:94`) routes *into* Phase 5 rule 4 rather than introducing cap logic in any other phase; Phases 0–4 and 6 are untouched by the diff.

16. [PASS] Version bump is PATCH-tier and correctly applied to both manifests plus the marketplace top-level version.
    - Evidence: `plugins/wf/.claude-plugin/plugin.json:3` → `0.144.1`; `.claude-plugin/marketplace.json:14` (wf entry) → `0.144.1`; `.claude-plugin/marketplace.json:4` (top-level) → `0.190.3`. Pre-change values were `0.144.0`/`0.144.0`/`0.190.2` per the diff.

17. [UNVERIFIABLE] "Verification evidence": replay against `_local/C031`'s final on-disk state (round 4, `Revisions used: 3 of 3`, 7 residual findings).
    - `_local/C031` does not exist in this worktree — the spec itself notes the corpus is "gitignored, not present in this worktree." Cannot be statically replayed; would need a live interactive session against that fixture.

## Capability findings

**audit** (5 lenses dispatched: correctness, security, convention, consistency, operational — all delivered):

- **audit** — [FAIL] The recorded-choice resume path is not idempotent: a `/clear` between recording an "extend" (or "accept") choice and completing its follow-through causes the follow-through to be re-applied on the next resume, since nothing marks "already applied" the way the sibling snapshot-write and `consumed: yes/no` mechanisms in the same rule do. `plugins/wf/skills/charter/SKILL.md:94` (resume row) + `:192` (rule 4) vs. the existing guard idiom at `:193` ("skip it when round N's snapshot files already exist"). Independently raised by three lenses (correctness, operational, consistency) with matching evidence. — Remedy: give the `## Cap-gate decisions` entry an applied/pending marker (mirroring `consumed: yes/no`) that the recorded-choice branch checks before re-raising `<cap>` or re-writing `## Accepted warnings`/fingerprints.
- **audit** — [FAIL] The new `## Cap-gate decisions` section has no specified entry format, unlike its two named sibling gates (`## Growth authorizations` gives an explicit `- Round <N> | gap: <flag text> | status: pending` row shape at `SKILL.md:161`). Rule 4's "an entry already recorded for this exact `<M> of <cap>` pair" and the State-model's "last entry is a `## Cap-gate decisions` choice" both depend on a mechanical shape that is never defined. Independently raised by convention and consistency lenses. — Remedy: add an explicit row template to rule 4, e.g. `- Round <N> | <M> of <cap> | choice: extend|accept|stop`.
- **audit** — [WARN] The accept branch's "fingerprint every residual blocking finding under `## Accepted warnings`" (`SKILL.md:192`) has no stated dedup guard, so the same resume window that risks double-raising the cap on extend can double-fingerprint on accept.
- **audit** — [WARN] The rationale for what a cold resume's recorded-choice branch acts on (the last `## Round <N>`'s findings) is stated only in `references/convergence-loop.md` (explicitly "not read at runtime"), not in the runtime-read `SKILL.md` itself — unlike rule 1's growth gate, which is self-contained.
- **audit** — [WARN] `03_review-log.md` is built by verbatim-appending reviewer/tracker-sourced text with no fencing; the new resume logic scans for `##`-prefixed headings as structural control markers (`SKILL.md:94`, `:192`), so crafted `##`-prefixed content inside quoted evidence or an adopted tracker issue's description could in principle be misread as a `## Cap-gate decisions`/`## Round` heading and skew the resume decision. Pre-existing append pattern; new to this diff is that the scan now drives skipping Phase 4 entirely.
- **audit** — [WARN] The Loop-contract diagram's unchanged last line ("`no progress / rounds exhausted → stop honestly`", `SKILL.md:23`) now contradicts the diagram's own updated line just above it (`SKILL.md:21`, "revision cap, extendable once per cap hit") and rule 4 itself — "rounds exhausted" can now resolve via extend or accept, not only stop.

**author-caps** — [PASS] `validate_skill_interface` (scoped to the `charter` skill) and `validate_references` (scoped to `plugins/wf/skills/charter`) both report `status: pass`, 0 findings — no schema or dead-reference defects introduced.

## Deviations from derived artifacts (informational)

- `plugins/wf/README.md:115` still advertises "a ≤3-round cap" in the charter skill's one-line catalogue summary. This diff makes that phrase stale — the cap is now user-extendable past 3 in an interactive run. README was correctly out of the plan's declared touched-file scope (Constraints: "Touched files: `SKILL.md`, the `references/` doc, the two version manifests"), so this is not a requirement failure, but it is a real doc-drift the plan didn't anticipate.

## Recommended next actions

- Add an applied/pending (or equivalent) marker to `## Cap-gate decisions` entries so the recorded-choice resume branch never re-raises `<cap>` or re-writes `## Accepted warnings` a second time for one decision.
- Add an explicit row template for `## Cap-gate decisions` entries (parallel to `## Growth authorizations`'s), pinning both the "exact `<M>` of `<cap>` pair" match and the State-model "last entry is a choice" check to a mechanical shape.
- Consider a follow-up doc fix to `plugins/wf/README.md:115`'s "≤3-round cap" phrase (out of this task's scope, but now stale).
- Optional: reword `SKILL.md:23`'s Loop-contract diagram line to scope "stop honestly" to the no-progress case only, since "rounds exhausted" can now resolve via extend/accept.

---
