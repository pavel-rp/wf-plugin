# Fixture registry — the real audit capability, alone (passes)

Purpose-built minimal registry for the core lean adversarial pass's **second** measurement:
the **real, shipped** audit capability (`plugins/wf-audit/capabilities/audit`) and **nothing
else**. It is the sibling of `pass-empty.md` — the two registries bracket the reconciliation
rule, run over the same fixture change (`../adversarial-fixtures/defective-change.md`):

| Registry | What the run shows |
|----------|--------------------|
| `pass-empty.md` | what core's lean pass does with no contributor at all |
| `pass-audit-only.md` | that the five lenses' findings survive, provenance-tagged, and that the lean pass does not duplicate them |

One row is the entire point. This repo's own registry carries **eight** capabilities, several
of which contribute at the `verify` phase, so a run against it fires seven other
contributions and pollutes exactly the non-duplication comparison being measured. Registering
the real manifest rather than a synthetic stand-in is what makes the fan-out real: the
manifest resolves to **five** `verify | finding | subagent:` rows, so the run this fixture
backs dispatches five lenses, unchanged — `docs/verify-fanout-decision.md` keeps that
fan-out as it is, and the core default is strictly additive to it.

Core itself never reads this file and names no capability; the fixture exists so a
measurement can register one. The expectations the run is judged against live in
`../adversarial-fixtures/audit-registered.md`.

## Capabilities

| Capability | Path                                 |
|------------|--------------------------------------|
| audit      | plugins/wf-audit/capabilities/audit  |
