# Fixture registry — stack capabilities (angular host + node-ts) compose with browser-qa engine (passes)

Exercises WF-26: the `angular` capability's `qa-execution` provider `surface: host` composes
with `browser-qa`'s `surface: engine` (different surfaces — no partition collision), `node-ts`
attaches a single `implement | guidance` fragment (WF-177 — aggregate kind, empty scope, no
partition accounting), and all four capability names are unique +
filesystem-safe. Paths point at the **real** capability folders (the validator resolves
repo-relative paths against the real repo root), so this fixture also asserts the shipped
manifests parse. After the OUT-7 tracker-agnostic drops (WF-255/256/258), only `migration`
(which stays in wf-caps) still carries `requires: git, ado`; the three extracted caps
(`browser-qa`, `node-ts`, `angular`) carry `requires: git` only. `git` and `ado` are both
registered here — pointing at the real `wf-git`/`wf-ado` capability folders — so `migration`'s
`git, ado` requirement and the three extracted caps' `git` requirement are all satisfied and
the registry stays green. WF-255: `browser-qa` ships in the standalone `wf-browser-qa` plugin
(path repointed). WF-256: `node-ts` ships in the standalone `wf-node-ts` plugin (path
repointed). WF-258: `angular` ships in the standalone `wf-angular` plugin (path repointed) and
dropped `ado`, so it stays green on the `git` provider alone while composing (`surface: host`)
with `browser-qa`'s `surface: engine`.

## Capabilities

| Capability | Path                                          |
|------------|-----------------------------------------------|
| migration  | plugins/wf-caps/capabilities/migration        |
| browser-qa | plugins/wf-browser-qa/capabilities/browser-qa |
| angular    | plugins/wf-angular/capabilities/angular       |
| node-ts    | plugins/wf-node-ts/capabilities/node-ts       |
| git        | plugins/wf-git/capabilities/git               |
| ado        | plugins/wf-ado/capabilities/ado               |
