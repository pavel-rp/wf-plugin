# Establishing the constitution at the end of the journey

Read on the Phase 10 path only — `/wf:init` reaches this file through
`resolve_content({ workspaceRoot, class: "references-template", skill: "init",
ref: "constitution-handoff.md" })`, never a raw `Read` of a plugin-cache path,
and never at boot.

This is Phase 10 in full. It is a hand-off, not a decision: the sibling skill
owns establish-or-update, and this phase owns only the routing and the
non-fatal degradation around it.

## Route the edge

Route this fixed sibling-Skill edge immediately before work: call
`resolve_routing` with `workspaceRoot: <the admitted root>`, `role:
"constitution"`, `unitIds: ["init:constitution"]`, `shapeEvidence: {
workSurface: "caller-context", atomicity: "atomic", unitCount: 1,
unitsIndependent: false, ambiguity: "none", risk: "low", toolWork: "none",
validation: "mechanical", contextIsolation: "none", independentReview: false,
returnContract: "mechanically-judgeable", requestedParallelism: 1 }`,
`supportsModelSelector: false`, and `supportsEffortSelector: false`. Include
`actualModel` only when the host exposes it; emit the compact operational
record; pass no selector.

## Invoke, or degrade without stopping

On `status: stop` or a non-null `diagnostic`, keep this phase **non-fatal**:
skip the constitution refresh, record the resolver's reason, and finish the run.

Otherwise obey the selected `inline` shape and **unconditionally** invoke
`/wf:constitution` through the Skill tool with no arguments. This skill carries
**no existence check of its own** — the sibling's establish-or-update default
handles both cases, writing a core-only record when the registry is empty and
updating idempotently when the file exists.

If invocation is unavailable, skip with a one-line note telling the user to run
`/wf:constitution` manually — never stop the run on it.

The Final Output's `_local/constitution.md` action line reports which of
`established | updated | unchanged | skipped — run /wf:constitution` occurred.
