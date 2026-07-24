# `test-authoring` fragment — node-ts capability (implement-phase guidance)

**Version:** 1.0.0 (WF-177 — the node-ts `implement`-phase test-authoring guidance fragment)
**Wired by:** `plugins/wf-node-ts/capabilities/node-ts/manifest.md` (`implement | guidance | inline: fragments/test-authoring.md`)
**Model:** claude-opus-4-8

---

Guidance a core skill follows when it fires the `implement` phase with node-ts active and the
work under review **authors unit tests for pure TypeScript helpers**. `guidance` aggregates
additively in registry order — these idioms join the phase's generic authoring guidance, they
do not replace it.

**Scope — test authoring only.** This fragment governs how to WRITE tests, never how to write
production code. When the `implement` work is production source with no pure-helper test to
author, it contributes **nothing** (the no-op — see bottom); it never redirects
production-idiom authoring toward test shapes.

## Applies when

The change under implementation authors or extends unit tests for a **pure** TS helper — a
function/module with no Angular-runtime dependency (no `@angular/*`, no `zone.js`, no
`HttpClient`, no DI, no template). If the target is not pure (a service, component, pipe,
directive, or a module whose transitive imports pull in the Angular runtime), this fragment
does not apply — say so and author no Node test for it, rather than faking a runtime.

## Idioms (follow when authoring)

- **Runner + assert.** Use Node's built-in test runner: `import { test } from 'node:test';`
  and `import assert from 'node:assert/strict';`. No external test deps, no Karma, no Angular.
- **Import with the `.ts` extension.** Import the module under test by its real relative path
  keeping the `.ts` extension — Node's type stripping requires an explicit extension.
- **One file per exported unit.** Name the file `<exported-name>.test.ts`; group only
  tightly-related exports into one file.
- **Flat, sentence-named tests.** `test('descriptive sentence', () => { ... })`; skip
  `describe` blocks unless nesting genuinely clarifies. Name each test after the behavior (or
  the spec wording) it checks, so a failure names the requirement that regressed.
- **Strict equality.** Assert with `node:assert/strict` (`assert.equal` is `===`), not the
  loose `node:assert`.
- **Cover branches deliberately.** Read the source and pick real cases — happy path, each
  null/undefined/empty input, each boundary and error branch. Never emit generic `TODO`
  placeholders.
- **Keep tests under `_local/`.** Tests and their runner live under the gitignored `_local/`
  tree, so they never enter a commit.
- **Run after authoring.** Execute the new test file immediately to confirm it runs green
  before reporting.

## No-op

When the `implement` work under review authors no pure-helper unit test — a production-only
change, or a target that needs the Angular runtime — this fragment contributes **nothing**;
the phase proceeds on its generic authoring guidance alone.
