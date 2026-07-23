# WF-375 — `/wf:pr` and `/wf:tf` dispatch-shape decision

**Recorded:** 2026-07-23
**Decision:** Keep **both** `/wf:pr` and `/wf:tf` inline — no dispatch-shape change ships.
**Tier:** PATCH (decision-only; no invocation-contract change, all three final-output blocks preserved verbatim).

This decision is produced **after** the measurement gate (STEP-002), never before. The measured
attribution is recorded in the task folder at `_local/WF-375/research/measurement.md`; its headline
figures are cited below.

## Result

For a single `/wf:ship` shipper, the recoverable **caller-side** context on the pr/tf tail is
narrow, and the one genuinely-inline step (`/wf:tf`) cannot be isolated without exceeding the
proven `host → agent → agent` nesting depth. Both steps therefore **stay inline**. This is the
spec's explicitly-complete "keep both inline, no source change" outcome (Success Criterion 3), and
it fixes the home `/wf:tf` is left in for the serialized downstream chain (WF-378 context ceiling,
WF-379 index inlining).

## Measured basis (dedup-corrected, dollar-ranked)

From the committed WF-373 harness output `plugins/wf-sandbox-testing/accounting/baseline-reference.json`
(the raw baseline session is unreachable, so attribution is from the committed reference — stated
provenance). Shipper under study `ship-sm-2`: **$20.26 · 174 msgs · context 43,000 → 422,000
(+379,000) · inflation 1.74** (`byAgent[ship-sm-2]`; 17.7% of the $114.55 run).

Dollar-ranked phase attribution, marked isolated vs inline **relative to the shipper's own context**:

| Phase | Isolated / inline | Cost | JSON field |
|---|---|---|---|
| verify | isolated | $37.16 | `byPhase[verify]` |
| ship orchestration (the two shippers, inline) | **inline** | $33.67 | `byPhase[ship orchestration]` |
| implement | isolated | $16.46 | `byPhase[implement]` |
| qa | isolated | $5.45 | `byPhase[qa]` |
| plan | isolated | $4.42 | `byPhase[plan]` |
| triage | isolated | $3.81 | `byPhase[triage]` |
| spec | isolated | $3.42 | `byPhase[spec]` |
| **pr** | isolated | $3.15 | `byPhase[pr]` |
| **finalize** | separate transcripts | $1.71 | `byPhase[finalize]` |
| classify | isolated | $0.50 | `byPhase[classify]` |

The heavy surfaces (verify $37.16, implement $16.46) are **already** isolated and already out of the
shipper. The shipper's own $20.26 / 379K is dominated by orchestration turns plus the 1.74×
cache-read re-payment (`totals.rawUsageRecords` 2522 vs `totals.messages` 1145 ≈ 2.2× raw-record
duplication, collapsed by the per-`message.id` dedup before costing).

## Decision for `/wf:pr` — keep inline

**Measured caller-side contribution: the two result blocks only.** `/wf:pr`'s bulk (the full diff,
all artifacts) is already held inside two Task subagents (`wf:commit`, then the `wf:pr` agent); the
harness accounts that work as the **separate** `pr` phase ($3.15 / 41 msgs), held **out of** the
shipper's $20.26. What remains inline is two short status blocks — structurally negligible and not
separately dollar-quantified in the committed reference.

**Nesting also forecloses the alternative.** Making `/wf:pr` a shipper-dispatched subagent would
produce `fleet → shipper → pr-host → wf:pr` — 4 deep, exceeding the proven `host → agent → agent`
depth. `/wf:pr` keeps its orchestration inline **precisely** so the shipper itself is the host for
its two agent→agent Task calls. Keep inline; nothing to recover.

## Decision for `/wf:tf` — keep inline

**Measured caller-side contribution: inline, within the shipper's $20.26, not a shown-large slice.**
`/wf:tf` has no `agents/tf.md`; it runs in the caller's context, so its execution accrues inside
ship-sm-2's $20.26 / 379K growth. The committed reference does **not** carve the tf slice out of that
total, and the `finalize`-tagged transcripts ($1.71) are separate files aggregating the whole run —
they cannot be equated to the inline tf. There is **no affirmative measured evidence** of a material
recoverable inline-tf slice.

**Nesting-depth check rejects isolation on Criterion 7.** Today, inline `/wf:tf` dispatches its
`wf:index` update at `fleet → shipper → wf:index` = host → agent → agent = **3, within the cap**.
Isolating `/wf:tf` into a shipper-dispatched `wf:tf` agent would add a level, so that same `wf:index`
dispatch becomes `fleet → shipper → wf:tf → wf:index` = **4, exceeding** the proven depth — exactly
the over-nesting `/wf:pr`'s inline-in-shipper design deliberately avoids. Per spec Criterion 7, an
isolation that nests deeper than `host → agent → agent` is rejected on that ground and the
alternative (keep inline) is chosen.

**Conclusion.** An unquantified, not-shown-large recoverable win does not justify a new agent body, a
split `tf` procedure, and a depth-4 `wf:index` nest. Keep `/wf:tf` inline. Isolating it belongs (if
ever) to the context-ceiling work (WF-378), where a hand-off protocol — not a deeper nest — is the
right lever.

## Consequences and contract guard

- **No source change to dispatch shape.** `plugins/wf/agents/tf.md` is **not** created;
  `plugins/wf/skills/ship/SKILL.md` Phase 5 keeps its inline `/wf:tf` Skill-tool call;
  `plugins/wf/skills/tf/SKILL.md` is unchanged.
- **Frozen blocks preserved verbatim.** `SHIP — <Merged | Blocked>`, `PR — <created | exists>`, and
  `TF — <finalized | already-finalized | partial>` are byte-for-byte unchanged; no downstream
  consumer of any of them is affected (grep-confirmed across `plugins/`).
- **No fixture-confirming run required.** The `fleet-two-task` confirming run (Criterion 4) is
  conditional on a shipped shape change; none shipped, so the grep confirmation alone closes the
  contract-guard step (Criterion 6).
- **Scope.** Only `plugins/wf` version metadata + the marketplace top-level `version` row are
  touched in tracked source, plus this repo-level decision record (mirroring the WF-380 sibling
  decision's `docs/verify-fanout-decision.md`).

## Reopen criteria

Revisit `/wf:tf` isolation only when (a) a captured transcript with per-child attribution quantifies
the inline `/wf:tf` slice as a material fraction of the shipper's growth, **and** (b) the `wf:index`
nesting is resolved so isolation stays within `host → agent → agent` (e.g. the WF-378 context-ceiling
hand-off, or an inlined index update inside an isolated `wf:tf`). Absent both, inline remains correct.
