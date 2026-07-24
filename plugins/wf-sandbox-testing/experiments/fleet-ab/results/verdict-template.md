# WF-382 umbrella verdict — TEMPLATE (fill after the pilot + analysis)

**Status:** scaffold — not yet a verdict. The verdict-writer fills every `‹…›` and
resolves the **incomparability gate** below *before* stating any aggregate-vs-baseline
claim. This file exists so design §9's fallback can never be silently skipped: the gate is
a required, answered branch here, not a rule the writer has to remember.

**Written by:** ‹model id›
**Analysis inputs:** `results/measure-A.json`, `results/measure-B.json`,
`results/totals-comparison.txt`, `results/mechanism-table.json`, `results/deltas.md`
**Run provenance:** arm A `run.json` ‹session id, host, day› · arm B `run.json` ‹…›

---

## 0. Incomparability gate (design §9 — resolve FIRST, both branches are real)

> Arm A's workload is prose-vs-TS relative to the historical $114.55 baseline, so arm A is
> **unlikely** to validate against the baseline's shape. Decide explicitly; do not default.

**Does arm A's shape validate against the $114.55 baseline** — agent count, role mix, and
phase distribution all within reason? Compare arm A's `provenance`/`byAgent` shape against
the baseline narrative (design §7.1, §9). Answer: **‹YES | NO›**

- **YES →** state the aggregate claim: "arm B total ‹$X› vs the committed $114.55 baseline"
  *and* the always-stated arm B vs arm A controlled delta (§1 below).
- **NO → the aggregate-vs-$114.55 claim is explicitly DROPPED.** The umbrella closes on the
  **stronger substitute**, per the charter's fallback clause: the controlled arm A/arm B
  delta + the §7.2 mechanism table + the §7.3 blind quality comparison + the per-sub-task
  fixture-relative deltas (`deltas.md`). State this as the stronger evidence, not a
  consolation — never a bare number against a non-comparable baseline.

---

## 1. Cost — arm B vs arm A (always stated, regardless of the gate)

- Arm A total: ‹$X› · Arm B total: ‹$Y› · delta (B − A): ‹$Z (±P%)›
- Direction: ‹arm B cheaper | arm B MORE EXPENSIVE — state plainly, never reframe | no change›
- Aggregate-vs-baseline claim: ‹stated per gate=YES | DROPPED per gate=NO›

## 2. Per-mechanism assertions (design §7.2 — from `mechanism-table.json`)

| mechanism | assertion | status |
|---|---|---|
| WF-376 | bookkeeping roles cheaper-tier in B; A all-opus | ‹GREEN \| RED-indicative \| NOT-MEASURED› |
| WF-378 | max ship-orchestrator context bounded in B vs A | ‹observed A/B vs ship/SKILL.md ceiling› |
| WF-379 | zero wf:index subagents in B | ‹GREEN \| RED› |
| WF-374 | zero gated-off lens boots / finding-contract refetches | ‹manual transcript pass› |
| WF-375 | pr/tf dispatch shape + bounded caller-side context | ‹manual transcript pass› |
| WF-377 | not measurable here — judged on shipped evidence | ‹note› |

## 3. Quality — "no worse" (design §7.3, BLIND)

- Confirmed-real defects/PRs — arm A: ‹n› · arm B: ‹n›. Judge anonymized before compare: ‹confirm›
- Verdict: ‹no worse | REGRESSION — a cheaper arm B with fewer confirmed reals FAILS the charter›

## 4. Per-sub-task fixture-relative deltas (design §7.4 — from `deltas.md`)

- Every shipped C024 sub-task carries its fixture-relative delta: ‹all present | BLOCKED: missing ‹ids››
- WF-376 indicative-only exception noted: ‹yes› · WF-381 closed-unmet (WF-380 decision), not a blocker: ‹yes›
- A missing non-exempt delta **blocks the verdict** — do not state a verdict until backfilled.

## 5. Umbrella verdict

‹One paragraph. If gate=NO, lead with the substitute evidence. If arm B is not lower,
state it plainly with no reframing. Cite the mechanism table, the blind quality result,
and the fixture deltas as the load-bearing evidence.›

**Verdict:** ‹MET | MET-via-fallback | NOT-MET | BLOCKED-pending-backfill›
