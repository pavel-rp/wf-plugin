# Fixture registry — stack capabilities (angular host + node-ts) compose with browser-qa engine (passes)

Exercises WF-26: the `angular` capability's `qa-execution` provider `surface: host` composes
with `browser-qa`'s `surface: engine` (different surfaces — no partition collision), `node-ts`
attaches a single `implement | guidance` fragment (WF-177 — aggregate kind, empty scope, no
partition accounting), and all four capability names are unique +
filesystem-safe. Paths point at the **real** capability folders (the validator resolves
repo-relative paths against the real repo root), so this fixture also asserts the shipped
manifests parse. WF-126: the migration/angular wf-caps manifests carry
`requires: git, ado`, so `git` and `ado` are registered here too — pointing at the real
`wf-git`/`wf-ado` capability folders — so the registry satisfies those requirements and stays
green. WF-255: `browser-qa` now ships in the standalone `wf-browser-qa` plugin (its path
repointed) and is tracker-agnostic (`requires: git` only), so it stays green on the `git`
provider alone. WF-256: `node-ts` now ships in the standalone `wf-node-ts` plugin (its path
repointed) and is likewise tracker-agnostic (`requires: git` only).

## Capabilities

| Capability | Path                                          |
|------------|-----------------------------------------------|
| migration  | plugins/wf-caps/capabilities/migration        |
| browser-qa | plugins/wf-browser-qa/capabilities/browser-qa |
| angular    | plugins/wf-caps/capabilities/angular          |
| node-ts    | plugins/wf-node-ts/capabilities/node-ts       |
| git        | plugins/wf-git/capabilities/git               |
| ado        | plugins/wf-ado/capabilities/ado               |
