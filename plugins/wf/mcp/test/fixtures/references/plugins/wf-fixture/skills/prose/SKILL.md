# /wf-fixture:prose — legitimate prose that must NOT be flagged

FIXTURE (WF-354). Every line below MENTIONS a reference without instructing an
invocation. These are the shapes `out4-skill-read-guard.sh`'s header enumerates
as legitimate, on the axis this tool reuses. `validate_references` must return
`pass` with zero findings — even though several tokens name nothing that exists.

## A skill table, the README shape

| Command | What it does |
|---------|--------------|
| `/wf-fixture:tc` | a retired command, listed here for historical reference |
| `/wf-fixture:ghost` | never shipped |

## Cited call shapes

The resolution is the same one mirrored by `plugins/wf/skills/spec/SKILL.md` —
a prose citation of a path, not a load step.

The harness loads the skill's `SKILL.md` by invocation, never by a filesystem
read; the `subagent_type: wf-fixture:ghost-runner` value is quoted here purely
to show the shape a dispatch declaration takes.

## Non-directive verbs

A spawn no longer eagerly loads the full caller-facing body, so loading
`/wf-fixture:tc` is not something this skill does at all. `load`, `loads`, and
`loading` are excluded from the verb family by deliberate decision.
