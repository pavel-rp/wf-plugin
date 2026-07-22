# Evidence-gated routing calibration

This document is the repeatable adoption gate for changing a production agent role's shipped model or effort default. It complements the routing contract; it does not alter precedence, execution-shape selection, return contracts, or parent-owned bounded escalation.

A cheaper candidate is not eligible because it is cheaper. Correctness against the role's terminal and return contracts is binding. Missing comparison evidence, failed correctness, or unresolved ownership permits only `retain` or `defer`.

## Calibration procedure

Run one calibration per role and representative workload revision.

1. **Fix the comparison boundary.** Record the role and path, owning issue, current selection (`inherit` is a selection), candidate model tiers and effort values, exact workload or fixture revision, invocation arguments, selector support, and the role's terminal/return contract. Keep execution shape fixed unless execution shape itself is the subject of a separately owned comparison.
2. **Collect comparable runs.** Run every candidate on the same workload and environment enough times to expose result variance. Link the commands, fixtures, raw structured results, validation output, and runtime measurements. A future WF-373 harness may produce these references, but its implementation is not a prerequisite.
3. **Gate on correctness.** Validate contract completion, required fields, determinism where required, side-effect boundaries, and role-specific quality. Any candidate with a failed contract or unresolved correctness finding is ineligible. Record retained successful units and parent-owned retry/escalation evidence separately; do not credit child-owned replacement work.
4. **Compare latency and context.** Record elapsed duration, input/output context or token counts, retry count, effective parallelism, and any truncation or context-pressure observation. Explain material variance rather than reducing it to one duration number.
5. **Compare cost.** Record normalized per-run and aggregate cost when available, the price source/date, and any unavailable value. Cost may distinguish candidates only after correctness and ownership gates pass.
6. **Decide.** Use exactly one outcome: `adopt` when a candidate passes correctness, has comparable latency/context and cost evidence, and ownership permits the change; `retain` when the current selection remains preferred or evidence rejects a candidate; `defer` when evidence or ownership is incomplete. State the rationale and the next evidence or owner action.
7. **Apply atomically.** An `adopt` updates the runtime default, disposition matrix, and this record in one change. `retain` and `defer` leave runtime selection unchanged. Re-run the disposition tests before review.

## Durable record schema

Each record must contain these fields, either as a table row below or in a linked role-specific report:

- stable record id, role (linked from its disposition row and agent path), owner issue, evaluated date, and workload/evidence references;
- current selection and candidate tiers/efforts;
- correctness result against the terminal/return contract;
- latency/context result and cost result;
- ownership state;
- `adopt`, `retain`, or `defer`, with rationale and next evidence/action.

Evidence references must be reproducible paths, revisions, commands, or tracker links. `missing` is a valid evidence state but can never support `adopt`.

## Compact measurement projection

`projectRoutingMeasurement(decision)` exposes the routing fields measurement consumers need without adding a new selection input:

- role, execution shape and reason;
- selected model and effort plus aggregate source and basis;
- attempt and escalation origin;
- model/effort fallback and masking state;
- actual runtime model when the host reports it.

These fields are compatible inputs for WF-373/WF-382 measurements; consumers can start recording them before either issue ships. Artifact producer attribution such as `**Model:**` remains distinct: it identifies who authored an artifact and is never read as routing selection or actual-runtime evidence.

## Current adoption records

The initial records deliberately preserve every unresolved role. `inherit` means no static model or effort is introduced at this layer. Candidate tiers enumerate the comparison set; they do not authorize a default. WF-400 makes the audit/QA/index records operational at capability dispatch callsites without changing any `retain`/`defer` outcome; compact routing facts are now available for future matched evidence.

| Record | Role | Owner | Evaluated | Current | Candidate tiers | Correctness | Latency/context | Cost | Ownership | Evidence refs | Decision | Rationale / next evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| <a id="cal-charter-reviewer"></a>`CAL-charter-reviewer` | `charter-reviewer` | WF-398 | 2026-07-21 | `inherit` | `inherit, haiku, sonnet, opus` | `missing` | `missing` | `missing` | `resolved` | `none — comparison not run` | `retain` | Fresh-eyes findings need matched charter fixtures and contract-scored comparisons before a default changes. |
| <a id="cal-commit"></a>`CAL-commit` | `commit` | WF-398 | 2026-07-21 | `inherit` | `inherit, haiku, sonnet` | `missing` | `missing` | `missing` | `resolved` | `none — comparison not run` | `retain` | Compare message validity, diff grounding, and delivery side effects on identical changes. |
| <a id="cal-pr"></a>`CAL-pr` | `pr` | WF-398 | 2026-07-21 | `inherit` | `inherit, haiku, sonnet` | `missing` | `missing` | `missing` | `resolved` | `none — comparison not run` | `retain` | Compare artifact synthesis, tracker linkage, and terminal PR contract before adoption. |
| <a id="cal-audit-retrospective"></a>`CAL-audit-retrospective` | `audit-retrospective` | WF-398 | 2026-07-21 | `inherit` | `inherit, haiku, sonnet, opus` | `missing` | `missing` | `missing` | `resolved` | `none — comparison not run` | `retain` | Composite verification requires role-specific finding-quality and omission comparisons. |
| <a id="cal-consistency-auditor"></a>`CAL-consistency-auditor` | `consistency-auditor` | WF-380/WF-381 | 2026-07-21 | `inherit` | `inherit, haiku, sonnet, opus` | `missing` | `missing` | `missing` | `unresolved` | `none — owner decision pending` | `defer` | Audit shape and ownership must settle before role-level routing changes. |
| <a id="cal-convention-auditor"></a>`CAL-convention-auditor` | `convention-auditor` | WF-380/WF-381 | 2026-07-21 | `inherit` | `inherit, haiku, sonnet, opus` | `missing` | `missing` | `missing` | `unresolved` | `none — owner decision pending` | `defer` | Audit shape and ownership must settle before role-level routing changes. |
| <a id="cal-correctness-auditor"></a>`CAL-correctness-auditor` | `correctness-auditor` | WF-380/WF-381 | 2026-07-21 | `inherit` | `inherit, haiku, sonnet, opus` | `missing` | `missing` | `missing` | `unresolved` | `none — owner decision pending` | `defer` | Audit shape and ownership must settle before role-level routing changes. |
| <a id="cal-operational-auditor"></a>`CAL-operational-auditor` | `operational-auditor` | WF-380/WF-381 | 2026-07-21 | `inherit` | `inherit, haiku, sonnet, opus` | `missing` | `missing` | `missing` | `unresolved` | `none — owner decision pending` | `defer` | Audit shape and ownership must settle before role-level routing changes. |
| <a id="cal-security-auditor"></a>`CAL-security-auditor` | `security-auditor` | WF-380/WF-381 | 2026-07-21 | `inherit` | `inherit, haiku, sonnet, opus` | `missing` | `missing` | `missing` | `unresolved` | `none — owner decision pending` | `defer` | Preserve the role's bounded third-attempt exception; audit ownership and matched high-severity fixtures must settle first. |
| <a id="cal-index"></a>`CAL-index` | `index` | WF-379 | 2026-07-21 | `inherit` | `inherit, haiku` | `missing` | `missing` | `missing` | `unresolved` | `none — owner decision pending` | `defer` | WF-379 owns removal or caller-context inlining; do not calibrate a role that may disappear. |
| <a id="cal-qa-engine"></a>`CAL-qa-engine` | `qa-engine` | WF-398 | 2026-07-21 | `inherit` | `inherit, haiku, sonnet, opus` | `missing` | `missing` | `missing` | `resolved` | `none — comparison not run` | `retain` | Browser verdict accuracy, observation discipline, and failure evidence need matched scenarios. |
| <a id="cal-qa-host"></a>`CAL-qa-host` | `qa-host` | WF-398 | 2026-07-21 | `inherit` | `inherit, haiku, sonnet, opus` | `missing` | `missing` | `missing` | `resolved` | `none — comparison not run` | `retain` | Source-mutating scaffolding needs build-validity and convention-parity comparisons. |

No record above authorizes a downgrade. Audit, QA, verification, and removal-owned work remains evidence-gated and inherited until both evidence and ownership gates pass.
