# /wf-fixture:indeterminate — the D-3 case

FIXTURE (WF-354). The reference below names a plugin that is NOT present in this
workspace at all. That makes it INDETERMINATE, not proven dead: the tool cannot
see the plugin's tree, so it cannot say the skill is missing from it.

Per decision D-3 it must be excluded from `findings` entirely and counted in
`summary` instead — which keeps the findings-empty-iff-pass invariant exact and
is why no `warning` severity tier was added.

## Phase 1

Invoke `/wf-absent-pack:whatever` to reach the surface this pack owns.
