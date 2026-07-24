# Per-sub-task fixture-relative deltas — collation (spend-free, independent of any A/B pilot)

**Model:** claude-sonnet-5
**Collated:** 2026-07-23, at WF-382 implement time.
**Fixture:** every delta below is **taken over the WF-373/WF-401 `fleet-two-task` fixture**
(`plugins/wf-sandbox-testing/fixtures/fleet-two-task/`), reported **fixture-relative** —
**never** summed into a baseline-relative figure (spec Constraints; design doc §7.4).
**Scope:** design doc §7.4 — "a collation job over each sub-task's shipped evidence,
independent of the A/B." This is that collation; it does not run anything. A missing
delta **blocks** the umbrella verdict unless the sub-task is one of the two stated
exceptions below.

---

## Collation table

| sub-task | shipped | fixture-relative delta located? | disposition |
|---|---|---|---|
| WF-374 — stop paying for gated-off lenses / per-lens contract refetches | merged, PR #203 | **Not found.** No `fleet-two-task`-relative before/after cost figure in the shipped evidence located during this collation (verify/QA artifacts checked; no dollar figure tied to the fixture). | **Verdict-blocker — backfill required.** Re-run the fixture's `selfcheck.sh` accounting path against WF-374's before/after state (or locate the original measurement if one exists outside this checkout) before the umbrella verdict can cite it. |
| WF-375 — settle `/wf:pr`/`/wf:tf` dispatch shape | merged, PR #209 | **Not found.** Scoreboard note (`_local/fleet/scoreboard.md`) records "decision-only: keep pr+tf inline; version bumps only" — no fixture-relative dollar figure. | **Verdict-blocker — backfill required.** |
| WF-376 — complexity-aware model routing (charter C025, umbrella of WF-394–400) | merged, all 7 children | **Not found** — the routing wave landed as its own charter/umbrella (`_local/fleet/scoreboard-WF-376-complete.md`) before the WF-373 harness existed to measure against; no fixture-relative figure. | **Indicative-only, per the issue's stated exception** — a missing or near-zero figure does **not** block the umbrella. Recorded here as "no figure available" rather than assumed positive. |
| WF-377 — cut blocked shell calls in dispatched shippers | merged, PR #202 | **Not applicable to this mechanism.** Design doc §3/§7.2: no hooks in either A/B arm, so WF-377's blocked-call delta is invisible to both the fixture and the A/B; it is judged on its own shipped evidence directly. | **Not a fixture-delta gap** — explicitly out of this mechanism's measurement scope per the design doc, not a missing backfill. |
| WF-378 — hold a ship run under a stated context ceiling | merged, PR #210 | **Not found — caveated in the shipped record.** Scoreboard note: "CAVEAT: live ceiling-crossing acceptance NOT exercised ... Not simulated; in-repo checks pass. FOLLOW-UP: run a real crossing once 0.85.0 installed." | **Verdict-blocker — backfill required.** The follow-up run itself would supply the fixture-relative figure once performed. |
| WF-379 — write single-row index updates in the caller's context | merged, PR #211 | **Not found — explicitly unverifiable in the shipped record.** Scoreboard note: "SC-1 on-fixture spawn-delta UNVERIFIABLE (cached pre-migration runtime); core sites static grep+inspection." | **Verdict-blocker — backfill required.** Needs a fresh on-fixture measurement under the currently-installed runtime (the caveat that made it unverifiable at ship time no longer applies once the runtime is current). |
| WF-380 — decide the verify fan-out shape on measured evidence | merged, PR #204 | **Not applicable.** WF-380 is a *decision* sub-task (evidence-limited "do not collapse" conclusion), not an optimization shipping a measurable delta of its own. | **Not a fixture-delta gap** — WF-380 produced a decision, not a code change with its own before/after; nothing to backfill. |
| WF-381 — collapse the verify lenses (conditional on WF-380) | **Canceled**, per WF-380's "do not collapse" conclusion | N/A — not shipped. | **Recorded closed-unmet, citing WF-380's decision.** Per spec success criteria, this does **not** by itself fail the umbrella. |

---

## Verdict-blocking summary

As collated on 2026-07-23, **WF-374, WF-375, WF-378, and WF-379 each lack a located
fixture-relative delta** and are verdict-blockers under the spec's success criteria
("an unmeasured sub-task blocks the verdict rather than being assumed positive") —
**this must be backfilled before WF-382's umbrella verdict is written**, independent of
whatever the A/B pilot in this kit finds. WF-376 is recorded indicative-only per its
stated exception. WF-377 and WF-380 are out of this mechanism's scope by design, not
gaps. WF-381 is a legitimate closed-unmet, not a blocker.

**This collation is spend-free and ships with the buildable kit (plan STEP-004).**
Backfilling the four blocking deltas is downstream work, gated on someone actually
running the fixture's accounting path (`fleet-two-task/selfcheck.sh`'s measurement
primitive) against each sub-task's before/after state — out of scope for this
plan, which builds the kit only.
