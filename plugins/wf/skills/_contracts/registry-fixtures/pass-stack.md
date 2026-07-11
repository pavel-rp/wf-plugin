# Fixture registry — stack capabilities (angular host + node-ts) compose with browser-qa engine (passes)

Exercises WF-26: the `angular` capability's `qa-execution` provider `surface: host` composes
with `browser-qa`'s `surface: engine` (different surfaces — no partition collision), `node-ts`
attaches a single `implement | guidance` fragment (WF-177 — aggregate kind, empty scope, no
partition accounting), and all four capability names are unique +
filesystem-safe. Paths point at the **real** capability folders (the validator resolves
repo-relative paths against the real repo root), so this fixture also asserts the shipped
manifests parse. The three extracted stack caps (`browser-qa`, `node-ts`, `angular`) each
carry `requires: git` only; `git` is registered here — pointing at the real `wf-git` capability
folder — so all three requirements are satisfied and the registry stays green. WF-255:
`browser-qa` ships in the standalone `wf-browser-qa` plugin (path repointed). WF-256: `node-ts`
ships in the standalone `wf-node-ts` plugin (path repointed). WF-258: `angular` ships in the
standalone `wf-angular` plugin (path repointed) and requires `git` only, so it stays green on
the `git` provider alone while composing (`surface: host`) with `browser-qa`'s `surface: engine`.

## Capabilities

| Capability | Path                                          |
|------------|-----------------------------------------------|
| browser-qa | plugins/wf-browser-qa/capabilities/browser-qa |
| angular    | plugins/wf-angular/capabilities/angular       |
| node-ts    | plugins/wf-node-ts/capabilities/node-ts       |
| git        | plugins/wf-git/capabilities/git               |
