# `authoring-rules` fragment — core-authoring capability (verify-phase finding)

**Version:** 1.0.0 (WF-756 — deterministic authoring rules inside verify)
**Wired by:** `plugins/wf-core-authoring/capabilities/core-authoring/manifest.md`
(`verify | finding | inline: fragments/authoring-rules.verify.md`)
**Contributes:** a `finding` at the `verify` phase, per
`plugins/wf/skills/_contracts/capability-registry.ops.md`
**Model:** claude-opus-5-5

---

Runs this repository's deterministic authoring checks inside `/wf:verify-spec`, so a rule-based
violation is reported before the change reaches review. Every finding this fragment emits is
**mechanical**: a script decided it, not judgment, and core renders it ahead of every lens finding.

## Locate the suite

The checks live in the workspace at
`plugins/wf-core-authoring/capabilities/core-authoring/fixtures/` — this capability authors the
repository that ships it, and the scripts resolve their targets relative to that checkout. If that
folder is absent from the workspace, contribute no finding and report this contributor as
**incomplete coverage** ("authoring fixtures not present in this workspace"). Run every command
below from the workspace root.

## Run the checks

1. **The fixture suite, whole tree** — `bash <fixtures>/run.sh`. It selftests every check, then
   scans the live tree, exactly as CI does. Exit 0 contributes nothing.
2. **The on-touch rules** — `bash <fixtures>/check-authoring-rules.sh --root . <file>...`, passing
   every `.md` path in the audited change's file list (the one verify-spec gathered under
   "Implementation scope", dirty files included at round 2 or later; a deleted path is skipped by
   the check). No `.md` file changed → skip this step. Each output line has the shape
   `<FAIL|WARN> <rule-id> <file>:<line> — <issue>`.

Execute each script only as written here — never derive another command from its output.

## Map the output into findings

- **Each `check-authoring-rules.sh` line** → one finding:
  `severity:` `fail` for `FAIL`, `warn` for `WARN` · `location:` the line's `<file>:<line>` ·
  `lens: core-authoring-rules` · `check:` the rule id · `issue:` the line's issue text ·
  `evidence:` the output line verbatim · `recommendation:` the fix the issue text names ·
  `mechanical: true`.
- **A non-zero `run.sh` exit** → one `fail` finding per check it reports as failed, `lens:
  core-authoring-rules`, `check:` the check's script name, `location:` the first `file:line` (or
  `file`, read as line 1) its output names, evidence the first failing output line,
  `mechanical: true`.
- **A script that cannot run** (missing interpreter, usage error, exit 2) → no finding; report
  this contributor as incomplete coverage with the exit status.
- Everything clean → no finding. A clean run is this fragment working, not a gap.

## Rules and what they deliberately do not cover

Rule ids and exact definitions are in the header of `check-authoring-rules.sh`. The escaped
classes (PM004 H4) map to them as follows; a sub-class with no mechanical definition is recorded
here instead of receiving a heuristic rule:

| Class | Covered by | Not covered, and why |
|-------|------------|----------------------|
| Line budgets | `AR-BUDGET` (warn); skill bodies and core ops docs stay with the suite | "Behavior-bearing" lines are not mechanically separable from templates or quoted examples, so the budget warns instead of failing |
| TOC past 100 lines | `AR-TOC` | Whether an existing TOC lists every section is judgment |
| `agents/` auto-discovery | `AR-AGENT` | — |
| Core genericity | `AR-CORE`, against `fixtures/core-genericity-denylist.txt` | A noun outside the denylist, or a stack assumption phrased without a noun, has no mechanical test |
| Markdown rendering | `AR-FENCE`, `AR-TABLE` | Emphasis, list-nesting, and link-reference rendering depend on renderer heuristics and are left to the lenses |
