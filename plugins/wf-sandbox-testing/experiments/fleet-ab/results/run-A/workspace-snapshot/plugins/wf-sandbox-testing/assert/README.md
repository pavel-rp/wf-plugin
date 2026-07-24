# wf-sandbox-testing — the statistical assertion layer

Reference documentation for the assertion layer that judges the WF-345 hermetic runner's
outputs. Authoring/reference only — **not read by any skill at runtime**.

## Table of contents

- [What this is](#what-this-is)
- [Inputs: the runner's output tree](#inputs-the-runners-output-tree)
- [The three structural assertion families](#the-three-structural-assertion-families)
- [The statistical N-run protocol](#the-statistical-n-run-protocol)
- [The two tiers and their single-command invocation](#the-two-tiers-and-their-single-command-invocation)
- [The per-tier model settings key](#the-per-tier-model-settings-key)
- [Baseline comparison](#baseline-comparison)
- [Parallel dispatch: the /wf:fleet fleet-item shape](#parallel-dispatch-the-wffleet-fleet-item-shape)
- [The report](#the-report)
- [Files](#files)

## What this is

The container runner (`plugins/wf-sandbox-testing/runner/`) produces transcripts,
workspaces, and provider op logs, but nothing judges them. Exact-match judging is
structurally wrong — API-level determinism is unattainable and most prompt+model
combinations regress across silent model updates — so every verdict would be either flaky
or meaningless. This layer judges the runner's outputs **statistically** over N runs and
emits a report stating pass/fail with run counts, variance, and per-run token cost. Every
assertion is **structural** over transcript + workspace + op log; **none** exact-matches
transcript prose.

The layer is repo scripts in the `validate-registry.sh` / `registry-fixtures/run.sh`
family — no eval-framework dependency, no platform. `/wf:fleet` is the only parallel
dispatcher; this layer ships no orchestrator.

## Inputs: the runner's output tree

Each **run-output directory** has the shape `runner/run-skill.sh` writes:

```
<run>/transcript.jsonl                                stream-json (a JSON array or JSON-lines)
<run>/run.json                                        { verdict, fingerprints{ plugin_build, … }, … }
<run>/workspace-snapshot/…                            the resulting workspace files (excl. .git)
<run>/workspace-snapshot/_local/fake/op-log.jsonl     the fake provider op log
```

A **run set** is a directory OF such run-output directories — one per run of the same
scenario. The assertion layer **consumes** run sets; **producing** them (running the
container N times) is the runner's job. Because the layer only reads outputs, it needs no
container and no credentials — the committed canned run sets under `scenarios/` exercise
every criterion in CI.

## The three structural assertion families

| Family | Reads | Structural signature (never prose) |
|---|---|---|
| `terminal_block` | transcript | the fenced `NAME — status` block a skill ends with — its block name and status token |
| `files_touched` | workspace snapshot | the set of paths present in the resulting workspace (required/forbidden globs) |
| `ops_invoked` | op log | the set of `surface:op` pairs the fake op log recorded |

A scenario's `expect.json` declares each family's expectation and a per-family
`min_pass_rate` (the variance threshold). Example:

```json
{
  "scenario": "demo-branch",
  "families": {
    "terminal_block": { "name": "BRANCH", "status_ere": "^(created|already-active)$", "min_pass_rate": 1.0 },
    "files_touched":  { "required_globs": ["_local/fake/op-log.jsonl"], "forbidden_globs": ["src/*"], "min_pass_rate": 1.0 },
    "ops_invoked":    { "required_ops": ["delivery:branch-create"], "min_pass_rate": 1.0 }
  }
}
```

`status_ere` and `required_ops` are **shape** checks, not prose equality.

## The statistical N-run protocol

`protocol.sh` evaluates all three families on every run in a set, then judges each family
**variance-aware**:

- **pass rate** = (runs satisfying the family) / N.
- **PASS** when `pass_rate >= min_pass_rate`; **FAIL** otherwise.
- **variance:none** — every run identical and passing.
- **variance:drift** — runs vary but the pass rate holds at/above threshold (tolerated).
- **variance:regression** — the pass rate falls below threshold (a real failure, named).

This is what distinguishes **drift** (harmless run-to-run variation) from **regression** (a
genuine break) — the whole point of a statistical layer. Per-run **token cost** is parsed
from each transcript's stream-json `result` (`total_cost_usd`, plus a token sum from
`usage`) and reported per run with a mean.

Run it directly:

```
protocol.sh --set <run-set-dir> --expect <expect.json> [--tier <name>] [--model <id>] [--report <out-file>]
```

## The two tiers and their single-command invocation

Tiers exist because eval runs compete with the maintainer's subscription quota. Each tier
runs to completion from a **single command** and emits **one** report:

```
tiers.sh smoke       --scenario <dir> [--runs-dir <dir>] [--report <out-file>]
tiers.sh statistical --scenario <dir> [--runs-dir <dir>] [--report <out-file>]
```

- **SMOKE** — a cheap model and few runs; a fast trust check that prefers
  structural/deterministic assertions (so the future PR gate stays trustworthy).
- **STATISTICAL** — the full N-run protocol; **schedulable by the host operator into idle
  windows** (there is no in-repo scheduler — the operator's cron/CI window drives it).

`--scenario <dir>` expects `<dir>/expect.json` and, by default, `<dir>/runs-current`.
Point `--runs-dir` at any produced run set to judge it.

## The per-tier model settings key

The per-tier **model is a settings key** in `tiers.settings.json`. Changing it changes the
model the tier runs with and **never** touches harness code. Resolution precedence
(override > default — the same hybrid precedence the resolver applies to capability
profiles and per-skill settings):

1. env `WF_ASSERT_<TIER>_MODEL` / `WF_ASSERT_<TIER>_RUNS` — host-operator override
2. file `WF_ASSERT_SETTINGS_OVERRIDE` → `.tiers.<tier>.{model,runs}`
3. file `<workspace>/_local/wf-sandbox-testing/tiers.settings.json` → downstream project override
4. committed default `tiers.settings.json`

**Assumption-5 spec-time decision (WF-346 charter):** the charter left open whether the
per-tier model key rides the C014 **per-skill settings** tier or a **capability profile**
key. This layer is **shell scripts**, not a slotted skill the MCP resolver can query and
not a phase capability with an MCP-resolved profile — so it cannot make a `resolve_settings`
/ `resolve_profile` call. It therefore **adopts the same override>default precedence in
file form**: a committed default settings file plus a downstream `_local/` override (and an
env override for the host operator). This is the existing override *machinery* (the
precedence contract), reached the only way a shell script can. Inspect the resolved value
without running anything:

```
tiers.sh statistical --print-model      # → tier=statistical model=<resolved> runs=<resolved>
```

## Baseline comparison

`compare.sh` compares **two run sets** — typically a current-build set against a
**pinned-build baseline** set (the WF-345 pinned-build install option) — on the structural
families, and reports **EQUIVALENT** or **DIVERGENT** per family under a variance ceiling.
It compares the families' canonical structural signatures, **never** a transcript
exact-match. Internal drift within a set (below `--max-variance`) is not divergence; a
changed modal signature between the sets is. This is the comparison primitive the corpus
flagship (WF-347) instantiates per slot.

```
compare.sh --current <set-dir> --baseline <set-dir> [--max-variance <0..1>] [--report <out-file>]
```

## Parallel dispatch: the /wf:fleet fleet-item shape

When many scenarios (or many tier runs) should run in parallel, dispatch them through
**`/wf:fleet`** — the harness ships **no** scheduler, worker pool, or job queue of its own.
Each parallel unit is a **fleet item**: an independent, single-command STATISTICAL run over
one scenario, emitting its own report. The fleet-item invocation shape:

```
# one fleet item = one scenario, run to completion, one report:
tiers.sh statistical --scenario <scenarios/<name>> --report <out/<name>.report.txt>
```

Give `/wf:fleet` one such item per scenario (an explicit id/command list); `/wf:fleet`
handles the dependency ordering and parallel dispatch. Because each item is a standalone
command that reads only its own scenario's run set and writes only its own report, items
are order-independent and share no mutable state — no custom orchestration loop is needed
or shipped. `run.sh`'s grep guard enforces this: no `scheduler` / `worker pool` /
`job queue` / parallel-spawn construct appears in any harness script.

## The report

One report per scenario (`protocol.sh` / `tiers.sh`) — pass/fail per family with run
counts, variance, and per-run + mean token cost. Example (the demonstration scenario):

```
=== wf-sandbox-testing assertion report ===
Scenario:  demo-branch
Tier:      statistical    Model: claude-opus-4-8    Runs: 3
Assertion families (structural — never a transcript exact-match):
  terminal_block  PASS  pass-rate 1.000 (3/3)  distinct-obs 2  threshold 1  variance:drift — observed variance within threshold (drift, not regression)
  files_touched   PASS  pass-rate 1.000 (3/3)  distinct-obs 1  threshold 1  variance:none — stable across all runs
  ops_invoked     PASS  pass-rate 1.000 (3/3)  distinct-obs 1  threshold 1  variance:none — stable across all runs
Token cost (per run):  run1=$0.0121(2060tok) run2=$0.0119(2010tok) run3=$0.0125(2090tok)
Token cost (mean):    $0.012167 (2053 tok)
Verdict: PASS
```

## Files

| File | Role |
|---|---|
| `lib.sh` | shared primitives: extract terminal block / ops / files / token cost (functions only) |
| `assert-run.sh` | the three family evaluators over ONE run-output dir + `expect.json` |
| `protocol.sh` | the statistical N-run protocol + report emitter |
| `compare.sh` | two-run-set baseline comparison (structural, never exact-match) |
| `tiers.sh` | SMOKE / STATISTICAL invocable tiers; per-tier model settings resolution |
| `tiers.settings.json` | the per-tier model + run-count settings key (the default) |
| `run.sh` | the CI self-check suite (green + red + comparison + settings-flip + grep guards) |
| `scenarios/demo-branch/` | the demonstration scenario — canned green run sets |
| `scenarios/broken-branch/` | the deliberately broken fixture — canned red run set |
