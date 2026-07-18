# /wf-fixture:dead-ref — the WF-337 defect class

FIXTURE (WF-354). Every reference below is a deliberate DEAD reference: an
invocation instruction naming something that does not exist in this fixture
tree. `validate_references` must return `fail` and name the file, the 1-based
line, and the token.

This reproduces WF-337 exactly: `plugins/wf/skills/fleet/SKILL.md` shipped an
instruction invoking `/wf:tc` after the `tc` skill had been removed, and nothing
structural caught it.

## Phase 1

Invoke `/wf-fixture:tc` to transcribe the change set, then continue.

## Phase 2

Invoke the Task tool with `subagent_type: wf-fixture:ghost-runner` and forward
its final block.
