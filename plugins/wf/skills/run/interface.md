# /wf:run — interface declaration

The machine-readable, externally-bindable surface of `run`. A resolver reads
this file for the skill's declared slots and settings — **never** the SKILL.md
body. Everything in the body outside the declared surface below is freely
rewordable implementation; these sections are the stable, contracted surface
(invocation shape, terminal block, slots + merge policies, settings keys,
safety rules).

## Invocation

`/wf:run [<id>] [--auto | --step] [--from <phase>] [--to <phase>] [--no-triage] [--headless] [--gate <extend|accept|stop>] [--review-boundary <dir>]`

## Terminal block

`RUN — <advanced | gated | complete | blocked | error | handed-off>`

With the `qa` setting `off`, a `verify-spec` PASS ends the walk `RUN — complete`
with `Gate: auto-complete (QA disabled by config)` — the QA tail is stated as
skipped, never reported as passed.

## Slots

_(none)_

## Settings

| key | default | purpose                                                                                                   |
|-----|---------|-----------------------------------------------------------------------------------------------------------|
| qa  | on      | `on` runs the QA tail after a `verify-spec` PASS; `off` ends the chain there, stated as skipped by config |

Resolved through `resolve_settings` — per key, the personal
`_local/profiles/run.settings.json` override > the committed project override
`.wf/settings/run.settings.json` > this default. Any value other than `on` /
`off` halts the run `RUN — blocked`.

## Safety rules

**Allowed:** read any file in the repo; read-only resolution via
`workspace-root-resolve`, `current-branch-query`, and
`last-commit-timestamp-query`; resolve the `qa` setting via `resolve_settings`;
read `index.md` and the task's artifacts to derive state; dispatch an auto-front
phase (`triage` / `spec` / `plan` / `verify-spec` / `qa-gen`) to the
`wf:phase-runner` subagent in the default walk; prompt the operator at the
verify⇄fix stop gate in interactive mode; request run-evidence records through
`record_run_evidence` (the verify⇄fix gate choices and the
`qa-tail:skipped-by-config` record) and read them back through
`read_run_evidence`.

**Forbidden:** write or edit any file in its own context; run builds, tests,
installs, or any state-mutating delivery operation; execute a phase's logic
inline, or rescue a failed phase by doing its work; auto-advance into a gated
phase (`implement`, `lite`, `verify-fix`, `qa-followup`, `qa-auto`, `qa-run`);
report a skipped QA tail as a QA pass.
