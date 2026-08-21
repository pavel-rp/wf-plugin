---
name: test-node
description: Scaffolds and runs Node-based unit tests for pure TypeScript helpers (no Angular runtime) via the _local/_testkit/run.mjs harness. Use when the user wants to test a pure function, parser, or formatter locally — not for code that needs DI, zone.js, HttpClient, or Angular templates.
allowed-tools: [Read, Write, Edit, Glob, Grep, Bash, Task]
---

# /wf-node-ts:test-node — Node test harness for pure helpers

Scaffold and run lightweight Node-based unit tests for pure TypeScript helpers in this repo, using the `_local/_testkit` harness. Use when the user asks to "test this helper locally", "add a local test for X", "run the local tests", or wants to exercise a pure function without spinning up Karma/Angular. Not for code that needs the Angular runtime (DI, zone.js, templates, RxJS-with-NgZone).

The runner at `_local/_testkit/run.mjs` executes `*.test.ts` files anywhere
under `_local/` using Node's built-in test runner (`node --test`) and native
TypeScript stripping. No npm deps, no Karma, no Angular — pure Node 23.6+ / 24.

**This pack owns the runner.** It is installed from this pack's own
`node-ts` capability, declared in its manifest's `## Payloads` table
(`payloads/testkit-run.mjs` → `_local/_testkit/run.mjs`) and written by the
resolver when the capability is selected. A project that never selects
`node-ts` gets no runner and no `_testkit` directory — which is the point:
core ships no Node/TypeScript knowledge.

Everything lives under `_local/` which is **gitignored**, so tests and the
runner never enter commits.

---

## When to use this

Fit:
- Pure functions / modules with no Angular imports (helpers, parsers,
  formatters, state coercion helpers like `state.helpers.ts::fixDate`).
- Modules whose transitive imports are also pure TS (no `@angular/*`,
  no zone.js, no `HttpClient`, no Kendo UI, no `@codewithdan/observable-store`).

Not fit:
- Angular services (DI), components, pipes, directives.
- Anything that imports `rxjs` operators that rely on `NgZone` or the
  `TestBed`.
- End-to-end flows — use Chrome MCP / `/run-tests` for those.

If the target isn't pure, say so and stop. Don't try to fake an Angular
runtime under Node.

---

## Dispatch on arguments

Parse the first token. Recognized forms:

### `run` (or empty)  → run all local tests
```
node _local/_testkit/run.mjs
```
Stream output back verbatim.

### `run <path>`  → run a subset
`<path>` may be a file (`foo.test.ts`) or a directory. Resolve relative to
repo root.
```
node _local/_testkit/run.mjs <path>
```

### `new <task-id> <src-file> [exported-name]`  → scaffold a new test file

- `<task-id>`: the task folder name, matching the active tracker's id shape
  (e.g. `WF-205`, `ADO-6755`, or the bare-core `T001`). Use it verbatim as the
  folder name — do **not** re-prefix or normalize it. This is the same
  `{task-id}` core `/wf:qa-gen` scans for test coverage under
  `_local/{task-id}/tests/`, so the two must match exactly.
- `<src-file>`: path to the TS module under test, relative to repo root or
  absolute. Example: `src/app/shared/utils/date.helpers.ts`.
- `[exported-name]`: optional. If omitted, list the file's named exports
  and ask which one (or generate a skeleton that tests them all — your call
  based on how many there are).

Steps:
1. Ensure the runner exists (see "Bootstrap" below).
2. Ensure `_local/{task-id}/tests/` exists.
3. Compute the relative import path from the test file to the source,
   keeping the `.ts` extension (Node's type stripping needs it).
4. Write `_local/{task-id}/tests/<exported-name>.test.ts` with:
   - `import { test } from 'node:test';`
   - `import assert from 'node:assert/strict';`
   - `import { <exported-name> } from '<relative-path-with-.ts>';`
   - A handful of placeholder `test(...)` blocks covering obvious branches
     (null/undefined, happy path, error/edge). Read the source to pick
     meaningful cases — don't emit generic TODOs.
5. Run the new file immediately to confirm it executes:
   `node _local/_testkit/run.mjs _local/{task-id}/tests/<name>.test.ts`
6. Report pass/fail and the file path.

**After running the test**, invoke `/wf:index {task-id} tests "<exported-name>.test.ts · <pass|fail>"` to record it in the per-task index. Substitute the run outcome from step 5. The status cell auto-derives from the count of files under `_local/{task-id}/tests/`.

### Anything else  → treat as a freeform request

If the user typed something like "test the fixNumber helper", interpret it:
locate the function, find the most relevant task folder (or fall back to
`_local/scratch/tests/`), and follow the `new` flow.

---

## Bootstrap (if `_local/_testkit/run.mjs` is missing)

Only needed on a fresh clone or if someone wiped `_local/`. **Do not author a
replacement script.** The runner's bytes are owned by this pack's `node-ts`
capability, declared in its manifest's `## Payloads` table; re-authoring them
here would create a second, silently-divergent copy of the same file.

Re-run this pack's installer (`/wf-node-ts:init`) so the resolver reinstalls the
declared payload from the capability's own source. If the install reports the
payload as unavailable, report that and stop — a missing pack source is a
packaging defect, not something to paper over with a hand-written stand-in.

Do not add a `package.json` under `_local/` — it would pull Node into a
module-type decision we don't need.

---

## Test file conventions

- Filename: `<exported-name>.test.ts` (one file per exported function is
  fine; grouping is fine too if the functions are tightly related).
- Imports must use the `.ts` extension on the source module — Node's type
  stripping requires an explicit extension.
- Prefer `node:assert/strict` over `node:assert` for referential-equality
  sanity (`assert.equal` uses `===`).
- Use `test('descriptive sentence', () => { ... })` — no `describe` blocks
  needed unless nesting actually helps. Node's test reporter handles flat
  tests fine.
- When testing a spec-driven helper, name tests after the spec wording so a
  failure pinpoints which requirement regressed.

---

## Edge Cases

- **`ERR_UNKNOWN_FILE_EXTENSION`**: the import omitted `.ts`. Add it.
- **`MODULE_TYPELESS_PACKAGE_JSON` warning**: already silenced via the
  `--no-warnings` flag. If it reappears, check that flag is still in
  `run.mjs`.
- **Transitive Angular import**: if a test errors on `@angular/core` or
  `zone.js`, the target isn't pure. Tell the user; don't patch around it.
- **Node < 23.6**: type stripping isn't stable. Check `node --version`
  before running and warn if below 23.6.

---

## Final Output

End the turn with this block, after streaming the test output:

```
TEST-NODE — <pass | fail>

Ran:     <path, or "all local tests under _local/">
Result:  <N passed · M failed>
File:    _local/{task-id}/tests/<name>.test.ts   (new scaffolds only; omit for plain runs)
Next:    <branched on the result — see below>
```

The `Next:` line branches on the result:

- **pass** → `none — utility. Add DI-level coverage with /wf-angular:test-page <id> <component>, or more cases via /wf-node-ts:test-node new <id> <src>.`
- **fail** → `fix the source, then /wf-node-ts:test-node run <path> to re-check.`

**The final-output block must always be the very last thing output to chat.**
