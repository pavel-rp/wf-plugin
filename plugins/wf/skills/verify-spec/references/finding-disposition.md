# Finding disposition — vocabulary, derivation, and exclusions

The ops reference for the one recorded fate every loop finding carries. Read at runtime by
`verify-spec/SKILL.md` §"The finding ledger" (to render it) and by `verify-fix/SKILL.md` Phase 2
and Phase 7 (to copy it). Rationale: `finding-ledger-rationale.md` §"Disposition" (paired
reference, never read at runtime).

## Contents

[Vocabulary](#vocabulary) · [Ledger-row derivation](#ledger-row-derivation) · [The stop
predicate](#the-stop-predicate) · [Requirement items](#requirement-items) ·
[Transitions](#transitions) · [Exclusions](#exclusions) · [Copying it into the fix
log](#copying-it-into-the-fix-log)

## Vocabulary

A closed set of five values. Every ledger row, and every non-`PASS`/non-`N/A` requirement item,
carries exactly one. Nothing else is a disposition, and no row is ever left without one.

| Disposition | Meaning | Kernel state |
|---|---|---|
| `pending` | Open and blocking; the loop still has a cycle to spend on it. | open |
| `escalated` | Open and blocking at the loop's stop point — the round at which `/wf:run`'s stop gate fires when it drives the loop. | open |
| `fixed` | No longer reported by the latest round. | fixed |
| `refuted` | The critic disagreed with it (`critic: DISAGREE`). | refuted |
| `accepted` | Non-blocking and kept as-is: a `warn`, an advisory `fail` (one `verify-spec` matched to no extracted requirement), a critic-`UNVERIFIABLE` candidate, a pre-existing `fail`, a gate-accepted residue, or a drift residual (`certified-commit.ops.md` §"Drift-mode audit"). | accepted-warning |

The kernel column is the state a shared loop kernel reuses; the disposition is a projection of the
finding ledger's `status` (`finding-ledger.md` §"Status vocabulary") plus the stop predicate below —
never a second, independently-edited state.

## Ledger-row derivation

Derive each `## Ledger` row's disposition from its `status`, after §"Match / insert / retire" has
run for the current round:

- `fixed` → `fixed`
- `refuted` → `refuted`
- `accepted`, `warn`, `pre-existing` → `accepted`
- `open` → `escalated` when the stop predicate holds for this round; otherwise `pending`

The derivation is deterministic and artifact-only. It changes no status, no bucket, no blocking
set, and no `**Verdict:**`.

## The stop predicate

The same stop `/wf:run` §"The verify⇄fix stop gate" applies, evaluated by `verify-spec` on its own
artifacts so the stopped round's report already records the fate before the gate fires. It holds
when **all** of these hold:

1. Round `N` ≥ 2 (`finding-ledger.md` §"Round-number derivation").
2. The blocking set is non-empty (the report's `**Verdict:**` is not `PASS`).
3. **Either** the cap is reached — `N` ≥ 3, meaning two verify⇄fix cycles already ran in this
   loop — **or** there is no progress: every fingerprint `open` in round `N-1` of the fold is still
   `open` in round `N`, **and** round `N`'s `<passed>` requirement count does not exceed the
   `<passed>` count in round `N-1`'s header.

Round `N-1` is the most recent trail entry after the de-duplication step of §"Round-number
derivation" — the same entry the fold treats as the prior round. A later `extend` answer does not
change this round's record; the next round re-derives its own dispositions.

Round `N` counts audits, not gate firings, so a direct re-audit outside `/wf:run` advances it too.
There, `escalated` records that the loop has reached its stop point, not that a gate ran. Whether a
gate actually fired, and what it chose, is recorded only by the run evidence's `verify-loop:*`
records, never inferred from this label.

## Requirement items

Each numbered requirement item in `## Requirements` carries a `- Disposition:` line when its
verdict is not `PASS` or `N/A`:

- `FAIL` / `PARTIAL` → `escalated` when the stop predicate holds, otherwise `pending`.
- `UNVERIFIABLE` → `accepted` (non-blocking; re-audited next round).

Its cross-cycle identity is its list number, stable for the life of a loop (the spec never changes
mid-loop).

## Transitions

Because the disposition projects `status`, its transitions follow the ledger's fold:

| From | To | When |
|---|---|---|
| `pending` | `pending` / `escalated` | still open next round; `escalated` once the stop predicate holds |
| `pending`, `escalated`, `accepted` | `fixed` | the next round no longer reports it |
| `pending`, `escalated` | `accepted` | a gate `accept` demotes it (`finding-ledger.md` §"Gate-accept demotion"), or the critic returns `UNVERIFIABLE` |
| `pending`, `escalated` | `refuted` | the critic returns `DISAGREE` |
| `accepted` | `pending` / `escalated` | it comes back as a blocking finding |
| `fixed` | any | it is reported again (the ledger reopens it) |

An `escalated` row that meets a gate `stop`, or a `--headless` stop with no `--gate`, keeps
`escalated` as its final recorded fate. The run's own `RUN — blocked` terminal is unchanged.

## Exclusions

Outside this rule: every entry under `## Counterparts`, `## Adversarial findings`, and
`## Deviations from derived artifacts`. They are advisory by contract, never enter the ledger, carry
no fingerprint the fold tracks, and are re-derived from scratch every round. They get no disposition
and never gain one by being copied into the fix log.

## Copying it into the fix log

`/wf:verify-fix` never decides a disposition. It copies each one from the source `04_verify.md`:
every `## Ledger` row (fingerprint, first-seen round, disposition) and every requirement item's
`- Disposition:` line (fingerprint `path/to/file:L|R<n>`, as its Phase 2 mints it, or the bare
`R<n>` when the item carries no `Location`, as an `UNVERIFIABLE` item may not). If a report
predates the `Disposition` column, apply §"Ledger-row derivation" to its `Status` column, using
`pending` for `open`, because that report carries no stop evidence. If it has no `## Ledger` at all,
record `- none — source report carries no ledger`.
