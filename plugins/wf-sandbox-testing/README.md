# wf-sandbox-testing — the wf skill-eval harness pack

A Claude Code plugin that runs real headless `wf:*` skill invocations **hermetically**, judges
the run's **structural** outputs statistically over N runs, and reports pass/fail while separating
harmless **drift** from a real **regression**. It is the regression net for the `wf` skill suite —
installable downstream so a wf-project gets the same net without forking this repo's CI tooling.

Authoring/reference documentation. **No skill reads this file at runtime.**

## Table of contents

- [What the pack is](#what-the-pack-is)
- [Install and register](#install-and-register)
- [The harness layout](#the-harness-layout)
- [Authoring a fixture](#authoring-a-fixture)
- [Scripting a provider with wf-fake](#scripting-a-provider-with-wf-fake)
- [Writing assertions](#writing-assertions)
- [Running tiers](#running-tiers)
- [The CI SMOKE gate](#the-ci-smoke-gate)
- [The corpus — the worked reference example](#the-corpus--the-worked-reference-example)
- [The findings loop](#the-findings-loop)
- [Canned vs real runs (honest disclosure)](#canned-vs-real-runs)
- [Files](#files)

## What the pack is

Exact-match judging of a skill's transcript is structurally wrong: API-level determinism is
unattainable and most prompt+model combinations regress across silent model updates, so every
exact-match verdict is either flaky or meaningless. This harness instead:

1. **Runs** one real headless `wf:*` invocation per run in a fingerprinted container against a canned
   fixture (`runner/`), with auth/billing guards so a run never silently bills an API key or records a
   half-run as a pass.
2. **Judges** the runner's three **structural** signatures — the terminal `NAME — status` block, the
   resulting workspace file set, and the invoked contract-op set — over N runs, variance-aware
   (`assert/`). No assertion ever exact-matches transcript prose.
3. **Regresses** against a **corpus** of items, each mined retrofit-first from an already-observed
   failure with a resolvable provenance link (`corpus/`).

It is repo scripts in the `validate-registry.sh` / `registry-fixtures/run.sh` family — no
eval-framework dependency, no platform, no orchestrator (parallel dispatch is `/wf:fleet`'s job).

## Install and register

The pack is a marketplace-listed plugin. In a wf-initialized downstream repo:

```
/wf:init                    # once per repo, if not already initialized
# install wf-sandbox-testing from the wf marketplace, then:
/wf-sandbox-testing:init    # seeds sandbox-testing into the canonical /wf:init lifecycle
```

`/wf-sandbox-testing:init` is a compatibility alias onto the shared setup lifecycle: it seeds
`wf-sandbox-testing` into `/wf:init`'s selection round and owns no lifecycle step of its own — no
hand-edited registry, no `${CLAUDE_PLUGIN_ROOT}` probing, no registry write. The canonical run
registers a **presence-only** capability row (the pack owns no provider surface and attaches no
phase fragment), scaffolding bare core itself when the repo is not yet initialized, so there is no
half-configured stop to work around. Registry validation then acknowledges the pack and
`/wf:resolve` reports it.

`/wf:init` is the canonical command and does the same thing for every installed pack at once;
`/wf-sandbox-testing:init` remains a permanent entry point for anyone who already types it.

Fixtures that **script a provider** additionally need the **wf-fake** pack installed and registered —
see [Scripting a provider with wf-fake](#scripting-a-provider-with-wf-fake).

## The harness layout

| Folder | Role | Reference |
|--------|------|-----------|
| `accounting/` | deterministic fleet-session cost accounting, derived-only historical baseline, comparison command, and standard-fixture comparability finding ([README](accounting/README.md)) |
| `runner/` | the hermetic container runner — one real headless `wf:*` invocation per run, fingerprinting every input, asserting stream-json parseability, guarding auth/billing | (script headers) |
| `assert/` | the statistical assertion layer — three structural families judged over N runs, variance-aware, SMOKE/STATISTICAL tiers, baseline comparison | [`assert/README.md`](assert/README.md) |
| `corpus/` | the behavioral-regression corpus — items mined retrofit-first from observed failures, each with a resolvable provenance link | [`corpus/README.md`](corpus/README.md) |
| `fixtures/` | seed scripts that materialize a throwaway wf workspace for a run | (script headers) |
| `skills/init/` | `/wf-sandbox-testing:init` — self-registration | this README |
| `skills/new-experiment/` | `/wf-sandbox-testing:new-experiment` — interview in, runnable experiment kit out (manifest + kit files + an engine-derived runbook, self-linted) | [`experiments/engine/schema.md`](experiments/engine/schema.md) |

## Authoring a fixture

A **fixture** is the canned wf project a run boots from. It lives under `fixtures/<name>/`:

- A **`project/`** tree holding the wf project files a `wf:*` skill reads — `config.md` (with a
  `## Capabilities` registry), `_local/wf/<task>/` task folders, and any `fake-scripts.json` the run
  drives. The tree is committed under `project/` because the repo gitignores every literal `_local/`
  directory (so a real `_local/` can never be committed) — `seed.sh` reconstructs the real `_local/`
  layout at run time.
- A **`seed.sh`** that materializes the workspace: it copies `project/` into a throwaway dir under a
  real `_local/`, substitutes the wf-fake install-root placeholder, and gives the workspace a
  local-only git history (no remote → no egress). See `fixtures/demo-fake/seed.sh` for the reference
  shape.

The runner fingerprints the fixture `project/` tree by content (`runner/fingerprint.sh`), so a
byte-identical fixture always fingerprints identically and a fixture edit is a deliberate
re-fingerprint event.

## Scripting a provider with wf-fake

When a scenario must drive delivery/tracker behaviour (open a PR, read review threads, merge), it
does so hermetically through **wf-fake** — the in-memory provider that returns **scripted** responses
from a fixture-local `scripts.json` and records every operation to an op log
(`_local/fake/op-log.jsonl`). The scenario's assertions read that op log.

- The fixture's `config.md` registers `fake` (and nothing else) on the `delivery`/`tracker` surfaces.
- `runner/run-skill.sh` clean-installs `wf-fake` alongside `wf` into an isolated config dir, resolves
  the clean-installed `capabilities/fake/manifest.md`, and **fails loudly naming wf-fake** if the
  install produced none — never a silent scenario skip or a half-run reported as a verdict.
- This pack declares **no** manifest `requires: fake`: wf-fake is fixture-only (co-registering it
  beside a real `git`/`linear`/`ado` provider correctly trips the registry overlap check), so the
  dependency is a documented **per-fixture install pairing** enforced at run time, not a registry
  edge. A fixture using real providers needs no wf-fake at all.

## Writing assertions

Every assertion is **structural** over one of three families, declared in a scenario's `expect.json`
with a per-family `min_pass_rate` (the variance threshold):

| Family | Reads | Structural signature (never prose) |
|--------|-------|-------------------------------------|
| `terminal_block` | transcript | the fenced `NAME — status` block — its name + status token (`status_ere` is a **shape** check) |
| `files_touched` | workspace snapshot | required/forbidden path globs in the resulting workspace |
| `ops_invoked` | op log | the set of `surface:op` pairs the fake op log recorded |

The full `expect.json` schema, the N-run protocol (pass rate, `variance:none|drift|regression`), and
the report format are in [`assert/README.md`](assert/README.md).

## Running tiers

A **tier** runs a scenario to completion from a single command and emits one report:

```
assert/tiers.sh smoke        --scenario <dir> [--runs-dir <dir>] [--report <out>]
assert/tiers.sh statistical  --scenario <dir> [--runs-dir <dir>] [--report <out>]
assert/tiers.sh statistical  --print-model      # inspect the resolved model/runs without running
```

- **SMOKE** — a cheap model and few runs; a fast trust check that prefers structural/deterministic
  assertions (so a future PR gate stays trustworthy).
- **STATISTICAL** — the full N-run protocol; schedulable by the host operator into idle windows.

The per-tier **model and run count are a settings key** in `assert/tiers.settings.json`, resolved
override > default (env `WF_ASSERT_<TIER>_MODEL`/`_RUNS` → `WF_ASSERT_SETTINGS_OVERRIDE` file →
`_local/wf-sandbox-testing/tiers.settings.json` → committed default). Changing a model never touches
harness code.

## The CI SMOKE gate

The SMOKE tier runs automatically as a **PR check** on `.github/workflows/ci.yml` (the `smoke` job).
It is **new wiring on top of** the deterministic suites (`validate-registry.sh`,
`registry-fixtures/run.sh`, `assert/run.sh`, `corpus/run.sh`) — those stay untouched and gate every PR.

The gate **dogfoods the pack's own scripts**: the `smoke` job calls one wrapper,
[`ci/smoke-gate.sh`](ci/smoke-gate.sh), which resolves the SMOKE model/runs via
`assert/tiers.sh smoke --print-model` (no model string is hardcoded in CI), builds the hermetic
runner image, drives `runner/` N times against the gate scenario, and judges the fresh run set with
`assert/tiers.sh smoke` — emitting the variance-aware report as a job artifact. It is the identical
command a downstream user runs.

**Trigger semantics — path-gated.** The job runs on every PR, but its judged steps fire **only** when
the PR touches a trigger path — a **skill** (`plugins/*/skills/**`), a **capability/fragment**
(`plugins/*/capabilities/**`), or the **resolver** (`plugins/wf/mcp/**`). A PR touching only
non-trigger files skips the judged steps, so **no model quota is spent** on unaffected PRs.

**Inert-safe rollout.** The token is a repo secret; when it is **absent** the judged steps skip with
a stated reason and the job **succeeds** — a PR is never blocked red before the secret is provisioned.

### The one manual maintainer step

The gate is inert until a maintainer provisions the subscription token **once**:

```
claude setup-token          # on the host — mints a CLAUDE_CODE_OAUTH_TOKEN
# then, in the repo's GitHub settings → Secrets and variables → Actions:
#   add a repository secret named  CLAUDE_CODE_OAUTH_TOKEN  with that value
```

The token is injected into the container **only at runtime** (`docker run -e CLAUDE_CODE_OAUTH_TOKEN`,
name-only passthrough) — never a build arg, image layer, cache, log line, or artifact — and
`ANTHROPIC_API_KEY` is never set (billing is the subscription via the OAuth token).

### If GitHub Actions proves unsuitable (host-side fallback)

Running the Docker smoke job under GitHub Actions with the token as a repo secret is an unconfirmed
assumption (charter Assumption 6). If Actions proves unsuitable, the documented fallback — an explicit
amendment to charter OUT-5 — is a **host-side pre-merge smoke run**: the maintainer runs the same
wrapper on the host per trigger-path PR and records the verdict, e.g.

```
CLAUDE_CODE_OAUTH_TOKEN=<host-minted> \
  bash plugins/wf-sandbox-testing/ci/smoke-gate.sh --report smoke-report.txt
```

The outcome — a variance-aware SMOKE verdict before merge — is met by substitution, never quietly unmet.

## The corpus — the worked reference example

This repository's own `corpus/` is the reference example for everything above. It ships five
SMOKE-tier items, each mined from an observed failure with a resolvable `WF-<n>`/`C0<n>` provenance
link, judged purely structurally:

| # | Item | Kind | Observed failure it regresses |
|---|------|------|-------------------------------|
| 1 | empty-slot invariant — `ship.review` | comparison (per declared slot) | an unfilled slot must behave like the pre-slot baseline (C014 / WF-203) |
| 2 | review-gate five requirements | assertion vs scripted threads | a shipper merged while claiming no review landed (WF-313) |
| 3 | contribution survival across rewording | assertion vs scripted threads | a fill must bind to the slot marker, not Phase 4.5 prose (WF-203) |
| 4 | drift on model swap | assertion vs scripted responses | the gate must not drift its behaviour on a model swap (WF-203) |
| 5 | orphaned overrides at upgrade | assertion vs scripted responses | a personal override must supersede the pack fill under `replace` (WF-203) |

Walk `corpus/items/review-gate/item.md` to see one item end to end: the provenance, the five
requirements mapped to op-log evidence, the `expect.json`, and the seeded breakage that proves the
item turns red. The corpus self-check (`corpus/run.sh`) also audits provenance (zero unprovenanced
items) and enumerates the declared-slot set mechanically from source.

## The findings loop

New failures are not speculated into coverage — they are **retrofitted**: an observation becomes an
assertion authored **before or with its fix**. The step-by-step procedure — where the assertion
lives, how it is fingerprinted, and which tier it joins — plus an audit showing every shipped corpus
item conforms to it, is in [`docs/retrofit-procedure.md`](docs/retrofit-procedure.md).

## Canned vs real runs

Real containerized runs need Docker **and** a host-minted `CLAUDE_CODE_OAUTH_TOKEN`, both absent in
the authoring/CI environment. The committed run sets under `corpus/items/*/` and `assert/scenarios/*/`
are therefore **canned artifacts shaped exactly like the runner's output tree**; the `fake-scripts.json`
files are the real wf-fake scripts the scenarios drive, and `runner/run-skill.sh` regenerates the run
bytes from a live container when one is available. The assertion machinery is identical either way —
only the provenance of the run bytes changes. What ran canned and why is recorded in each `item.md`.

## Files

| Path | Role |
|------|------|
| `.claude-plugin/plugin.json` | the plugin manifest |
| `capabilities/sandbox-testing/manifest.md` | the feature-capability manifest (no fragments; the wf-fake pairing rationale) |
| `skills/init/SKILL.md` | `/wf-sandbox-testing:init` — self-registration |
| `skills/new-experiment/SKILL.md` | `/wf-sandbox-testing:new-experiment` — scaffolds an experiment kit from an interview and self-lints it |
| `experiments/scaffold-selftest/` | the kit `/wf-sandbox-testing:new-experiment` emitted, kept as its acceptance evidence |
| `accounting/` | fleet-session cost harness and derived-only references ([README](accounting/README.md)) |
| `runner/` | the hermetic container runner |
| `assert/` | the statistical assertion layer ([README](assert/README.md)) |
| `corpus/` | the behavioral-regression corpus ([README](corpus/README.md)) |
| `ci/smoke-gate.sh` | the SMOKE-tier PR-gate wrapper (produce N runs + judge) the CI `smoke` job and a host operator both call |
| `fixtures/` | fixture seed scripts |
| `docs/retrofit-procedure.md` | the findings-loop retrofit procedure (observation to assertion) |
