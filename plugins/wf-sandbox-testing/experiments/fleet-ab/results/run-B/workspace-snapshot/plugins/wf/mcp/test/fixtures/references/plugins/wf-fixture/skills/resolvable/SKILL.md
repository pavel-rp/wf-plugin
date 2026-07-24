# /wf-fixture:resolvable — references that all resolve

FIXTURE (WF-354). Every reference below is an invocation instruction whose
target EXISTS in this fixture tree. `validate_references` must return `pass`
with zero findings — the control proving the checker is not simply flagging
every verb-governed token it sees.

## Phase 1

Invoke `/wf-fixture:prose` to gather the prose shapes, then run
`/wf-fixture:dead-ref` for the contrast case.

## Phase 2

Invoke the Task tool with `subagent_type: wf-fixture:helper` and forward its
final block unchanged.
