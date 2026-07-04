# Fixture registry — stack capabilities (angular host + node-ts) compose with browser-qa engine (passes)

Exercises WF-26: the `angular` capability's `qa-execution` provider `surface: host` composes
with `browser-qa`'s `surface: engine` (different surfaces — no partition collision), `node-ts`
is a skills-only `feature` with no fragment rows, and all four capability names are unique +
filesystem-safe. Paths point at the **real** capability folders (the validator resolves
repo-relative paths against the real repo root), so this fixture also asserts the shipped
manifests parse. WF-126: all four wf-caps manifests now carry `requires: git, ado`, so `git`
and `ado` are registered here too — pointing at the real `wf-git`/`wf-ado` capability folders
— so the registry satisfies those requirements and stays green.

## Capabilities

| Capability | Path                                    |
|------------|-----------------------------------------|
| migration  | plugins/wf-caps/capabilities/migration  |
| browser-qa | plugins/wf-caps/capabilities/browser-qa |
| angular    | plugins/wf-caps/capabilities/angular    |
| node-ts    | plugins/wf-caps/capabilities/node-ts    |
| git        | plugins/wf-git/capabilities/git         |
| ado        | plugins/wf-ado/capabilities/ado         |
