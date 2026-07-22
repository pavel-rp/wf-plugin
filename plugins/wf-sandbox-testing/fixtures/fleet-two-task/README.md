# fleet-two-task — accepted fleet-cost measurement fixture

**Status: accepted.** This fixture is the immutable, derived-evidence reference the
`accounting/fleet-cost.mjs` fleet-cost tooling is measured against. It defines one hermetic
umbrella (`FLEET-1`) with **exactly two** independent synthetic runtime children (`FLEET-2`,
`FLEET-3`), each driven by its own ship orchestrator through the full ceremony (triage → spec →
plan → tasks → implement → verify → qa → pr → finalize), exercising the full role inventory
including all five audit lenses and a deterministic verify-fix + recheck per child.

## The one command

```
bash plugins/wf-sandbox-testing/fixtures/fleet-two-task/selfcheck.sh
```

It regenerates the synthetic bundle in a throwaway `_local/scratch/` dir, and **fails closed**
on any missing evidence or pipeline error. It proves, in order: a fresh `measure` reproduces the
immutable `reference/baseline-B.json` byte-for-byte; a fresh `evidence` reproduces
`reference/evidence.json` and its assertions (two children, five audit lenses, the full required
role mix) hold; candidate `C` compares in-band to baseline `B` under the directional ±10% band
with exact structure/shape; an output-inflated candidate correctly breaches the band; measuring an
absent bundle fails closed; and no raw transcript is tracked under the fixture.

## Why the raw bundle is not committed (outcome 9)

A session bundle is a set of raw transcripts, which must never be committed. So the bundle is
**regenerated deterministically** at runtime by `generate-bundle.mjs` — byte-identical every run,
with no timestamps or randomness — into a disposable projects root. Only the **derived** reference
JSON under `reference/` is committed. `seed.sh` owns the deterministic reset (and a `--prove-reset`
mode that proves the reset leaves no leakage); `generate-bundle.mjs` `rm -rf`s its out dir first so a
re-generate can never inherit stale state.

## Layout

| Path | Role |
|------|------|
| `generate-bundle.mjs` | Deterministic synthetic two-child session-bundle generator (raw transcripts, never committed). `--inflate-output <f>` scales output tokens to drive the out-of-band case. |
| `seed.sh` | Deterministic reset + materialize; `--prove-reset` proves no leakage survives a reset. |
| `selfcheck.sh` | The one exact acceptance command above. |
| `project/config.md` | The hermetic project config (sole `fake` provider); source-of-truth for `_local/config.md`. |
| `project/roles.json` | Declarative role/child inventory the evidence assertions check against. |
| `project/fake-scripts.json` | Scripted `fake` delivery/tracker responses for the two-child project. |
| `project/wf/FLEET-{1,2,3}/` | Umbrella + two child task-folder stubs. |
| `reference/baseline-B.json` | **Immutable** baseline `B`, measured from two clean runs. |
| `reference/candidate-C.json` | Candidate `C` — an accepted in-band candidate (byte-identical to `B`). |
| `reference/evidence.json` | Canonical repo-relative structural evidence + normalized per-child events. |

## Provenance (outcome 5)

The committed reference was captured on **2026-07-22** from the deterministic synthetic bundle
(`generate-bundle.mjs`, session `fleet-two-task-synthetic`) under Node.js (see the runtime pinned in
CI). Because the bundle is synthetic and deterministic, its "session id" and isolated projects root
are fixed by the generator rather than a live CLI run; the runner's own `session` block (emitted by
`runner/run-skill.sh`) records a real session id + isolated projects/transcript root for live runs.
The reference `capturedAt` field records the capture date; the model attribution across the fixture
files is `claude-opus-4-8`.
