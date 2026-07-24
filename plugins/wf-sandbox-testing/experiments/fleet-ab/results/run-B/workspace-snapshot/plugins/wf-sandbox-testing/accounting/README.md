# Standard fleet-cost measurement fixture

**Model:** gpt-5.6-sol[1m]

## Status

**INCOMPARABLE — rejected as the charter measurement fixture.** This committed candidate is intentionally retained because WF-373 defines discovering incomparability as a successful outcome. Later optimization items must not use its absolute cost as their before-point; they remain blocked on a fixture that exercises the full role mix below.

## Repeatable clean-state run

The candidate is the synthetic session under `testdata/`. It is dependency-free, deterministic, and rerunnable from any clean checkout:

```sh
node plugins/wf-sandbox-testing/accounting/fleet-cost.mjs measure --session session-fixture --root plugins/wf-sandbox-testing/accounting/testdata
```

To regenerate its committed reference, first remove the prior output in a disposable checkout, then run:

```sh
node plugins/wf-sandbox-testing/accounting/fleet-cost.mjs measure --session session-fixture --root plugins/wf-sandbox-testing/accounting/testdata --capture-date 2026-07-22 --output plugins/wf-sandbox-testing/accounting/fixture-reference.json
node plugins/wf-sandbox-testing/accounting/fleet-cost.mjs compare --actual plugins/wf-sandbox-testing/accounting/fixture-reference.json --reference plugins/wf-sandbox-testing/accounting/fixture-reference.json --tolerance 0.01
```

`selfcheck.sh` performs the same measurement in `_local/scratch/`, compares it, exercises missing-input failure, and removes its temporary output. No merged work items or durable provider state are involved, so each invocation starts clean.

## Intended umbrella shape

A valid replacement standard fixture must be a two-task umbrella whose two independent children each traverse:

`triage → spec → plan → tasks → implement → verify → qa → pr → finalize`

The role mix must contain two ship orchestrators, implement agents, verify-spec/fix, all configured audit roles, QA, PR/finalize, classifier, branch, commit, and index bookkeeping. It must run through the hermetic sandbox runner with scripted fake delivery/tracker state reset by fixture seeding before each invocation. The exact invocation shape is:

```sh
plugins/wf-sandbox-testing/runner/run-skill.sh --fixture <accepted-two-task-fixture> --skill "/wf:fleet <umbrella-id>" --out _local/scratch/fleet-cost-standard
node plugins/wf-sandbox-testing/accounting/fleet-cost.mjs measure --session <session-id-from-run> --root <isolated-claude-projects-root>
```

Do not fill those placeholders or adopt the run until the fixture contains and proves all roles above.

## Shape-comparability finding

The candidate and historical baseline share the **same output table schema** and exercise message maxima, tool-block dedup, mixed model pricing, phase/role attribution, dollar sorting, fingerprints, and context growth.

They are **not run-shape comparable**:

- candidate: one synthetic orchestrator + two synthetic agents; historical: two real ship orchestrators + 51 subagents;
- candidate phases: ship orchestration, verify, implement; historical also includes triage, spec, plan, classify, QA, PR, finalize, and bookkeeping;
- candidate verify has one verify-spec role and no audit fan-out or fix/recheck; historical verify has 24 agents;
- candidate performs no real skill invocation, provider operation, branch, PR, checks, or merge.

Accordingly `fixture-reference.json` is a mechanics regression reference only. It is not a cost baseline for WF-374 onward.
