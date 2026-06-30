---
name: test-page
description: Scaffolds black-box TypeScript tests for Angular-runtime targets — behavioral (services, components, pipes, guards, interceptors, directives) and wiring/registration (state models, app initializers, modules, routes, DI configs) — and injects them into the CodeTrakkerModuleTestComponent sandbox page. The user loads the page in a browser and pastes the console output back for verdict. Tests derive from the spec, not the implementation. Use when a target needs the Angular runtime (DI, zone.js, HttpClient) and can't be exercised by /wf-caps:test-node.
user-invocable: true
allowed-tools: [Read, Write, Edit, Glob, Grep, Bash]
---

# /wf-caps:test-page — Browser-run black-box tests for Angular targets

Some migration targets (Angular services, components, pipes, guards,
interceptors, directives) can't be tested with `/wf-caps:test-node` because they
need the Angular runtime — DI, zone.js, `HttpClient`, observable-store,
Kendo, RxJS-with-NgZone, etc.

This skill installs a **black-box test harness** into the existing
`CodeTrakkerModuleTestComponent` (a long-standing sandbox page). You
scaffold test files once, the user loads
`/code-trakker/code-trakker-module-test` in the running app, and the
suite runs in the real browser context and prints delimited results to
`console.log`. The user pastes the log back into chat; the model
verifies pass/fail against the spec.

---

## Stack profile (read first)

This skill carries no project path. The Angular stack paths come from the `angular` capability's **profile**: read them from the downstream override `_local/profiles/angular.profile.json` when present, else from the capability default template `plugins/wf-caps/capabilities/angular/profile.template.json` (precedence: **override > capability default**). If neither resolves, stop and direct the user to `/wf:init` (which seeds the override on divergence). The slots this skill uses, referenced as placeholders below:

- `{test-host-root}` — root under which the sandbox module-test component and its `_page-tests/` folder live (e.g. `AuditTrakker.Web/src/app/code-trakker`). The sandbox component folder is `{test-host-root}/code-trakker-module-test/`.
- `{verify-command}` — the typecheck/build command run before handoff.

Concrete paths in the procedures below (`AuditTrakker.Web/...`) are **illustrative examples of one filled profile**; substitute the resolved slot value. Stack identifiers that are not project paths — the sandbox component name `CodeTrakkerModuleTestComponent` / `code-trakker-module-test`, Angular DI/zone.js/`HttpClient` — are the stack's and stay as-is.

---

## The black-box rule (important — this is the whole point)

When scaffolding tests, you derive cases from the **spec**, not from the
implementation. Your inputs, in order of preference:

1. `_local/ADO-<id>/00_reqs.md` — the ADO-authored requirements (source
   of truth).
2. `_local/ADO-<id>/01_spec.md` — the LLM-authored spec, only if the
   requirements are thin. Prefer `00_reqs.md` when both exist.
3. The C# / MVC source the target was migrated from, if the spec
   references it. Read it the same way — as a behavioral contract, not
   a template to copy.

You may read the target's **public signatures** (exported class /
function names, method names, parameter types, return types) only when
you cannot write a call-site without them. That is a tight exception,
not a default. Do NOT read method bodies, private state, transformation
code, or neighboring implementation files to "understand" how the target
works. The whole value of this harness is that the tests fail loudly
when implementation drifts from spec — they cannot do that if they were
derived from the implementation.

If the spec is ambiguous, flag the ambiguity in a `//MIGRATION QUESTION
(<initials>):` comment inside the test file and test the stricter
interpretation. Do not guess from the code.

---

## Test archetypes: behavioral vs wiring

Two kinds of tests live in this harness. Pick the one that matches the
target's shape — some targets warrant both.

### Behavioral

The target declares methods with observable input/output. Tests exercise them:

```ts
test('setStartDate(Date) round-trips via getStartDate()', () => {
  const svc = injector.get(CraSharedStateService);
  const d = new Date('2025-01-01');
  svc.setStartDate(d);
  assertDeepEqual(svc.getStartDate(), d);
});
```

Fit (file suffixes): `.service.ts`, `.component.ts`, `.pipe.ts`,
`.guard.ts`, `.interceptor.ts`, `.directive.ts`.

Spec-wording cues: "when I call X, returns Y", "formats", "filters",
"emits", "redirects".

### Wiring

The target doesn't declare testable methods — it registers state,
providers, or routes into the runtime. Tests verify the registration
landed, without reaching into any one implementation:

```ts
test('DI resolution: CraSharedStateService is provided and constructible', () => {
  assertTruthy(injector.get(CraSharedStateService));
});

test('AppState.craShared is seeded with initialCraSharedState', () => {
  const appState = injector.get(AppStateService).state;
  assertDeepEqual(appState.craShared, initialCraSharedState);
});

test('rehydrate chain: CraSharedStateService singleton is live after init', () => {
  const svc = injector.get(CraSharedStateService);
  assertTruthy(svc);
  assertTruthy(svc.state);  // rehydrated slice exists
});
```

Fit (file suffixes): `.models.ts` (state-shape declarations),
`.initializer.ts` (app-init chains), `.module.ts`, `.routes.ts`,
`.config.ts`.

Spec-wording cues: "add X to Y", "register X", "inject X into the
chain", "wire X", "provide X as a dependency".

The black-box rule still applies — derive cases from the spec
("ticket says slice X goes in at initial state Y" → assert shape), not
from the implementation file.

---

## When to use this

Fit:
- Angular services that require DI (anything annotated `@Injectable`
  with constructor-injected dependencies).
- Pipes, directives, guards, interceptors — anything whose construction
  path requires the Angular runtime.
- Behavioral contracts: "when I call `setX(v)`, `getX()` must return
  `v`"; "interceptor appends header `Y` to outgoing requests"; "pipe
  formats `Date` to `M/d/yyyy`"; "guard redirects to `/login` when
  unauthenticated".
- Anything that passes through observable-store, local storage, or
  other Angular-wired singletons — you want the real thing, not a
  hand-mocked copy.
- Registration / wiring: state-slice shape declarations, app
  initializers, module/route/config files. The target doesn't expose
  methods to exercise — testing is by DI resolution and shape
  assertions (wiring archetype; see "Test archetypes" above).

Not fit:
- Pure helper functions (`state.helpers.ts::fixDate`, etc.) — use
  `/wf-caps:test-node` instead. This harness is heavier and slower.
- Full user flows across pages — use Chrome MCP / `/run-tests`.
- Anything that needs a specific logged-in user, entity selection, or
  backend data. The test page is behind `AuthGuard` and `SetEntityGuard`;
  if the required state isn't trivially reachable, call it out and stop.

---

## Dispatch on arguments

Parse the first token. Recognized forms:

### empty (no arguments)  → infer target from branch and scaffold

Default mode. When `/wf-caps:test-page` is invoked with no arguments, pick a sensible target automatically and run the `new` flow on it.

Steps:

1. **Resolve the ADO ID** from the current branch: extract the first 3+-digit run from `git branch --show-current`. If extraction fails (e.g., on `main`), stop: "Can't infer an ADO ID from the current branch. Pass an explicit target: `/wf-caps:test-page new <ado-id> <src-path>`."

2. **Find candidate targets.** In order of preference:
   - Read `_local/ADO-<id>/02_plan.md` if present — extract paths from the `Relevant Files` section (Must change + May change).
   - Otherwise, take the union of three git views (users often want to scaffold before committing; committed-only misses that window):
     - `git diff --name-only main...HEAD` — committed on this branch.
     - `git diff --name-only HEAD` — uncommitted, tracked.
     - `git status --porcelain` → new `.ts` files — untracked.
   - Filter to Angular-runtime eligible files. Two archetype-linked categories (see "Test archetypes" above):
     - **Behavioral**: `.service.ts`, `.component.ts`, `.pipe.ts`, `.guard.ts`, `.interceptor.ts`, `.directive.ts`.
     - **Wiring**: `.models.ts`, `.initializer.ts`, `.module.ts`, `.routes.ts`, `.config.ts`.
   - Drop pure helpers and utilities (`*.helpers.ts`, `*.utils.ts`) — those belong to `/wf-caps:test-node`.
   - Drop targets that already have a sibling `<suite-name>.page-test.ts` under `_page-tests/` (already scaffolded). Re-scaffolding isn't supported here — use `clean` then `new` explicitly.

3. **Pick or ask:**
   - **0 eligible, 0 changed `.ts` files at all** → stop: "No Angular targets in this branch's changes. Use `/wf-caps:test-node` for pure helpers, or pass a target explicitly: `/wf-caps:test-page new <ado-id> <src-path>`."
   - **0 eligible, but changed `.ts` files exist** → diagnostic mode. List each changed `.ts` file with a one-line exclusion reason (`pure helper → /wf-caps:test-node`, `already has a page-test`, `unrecognized suffix (<name>.ts)`, etc.) and ask: `None of these match the eligible-suffix list. Proceed with a wiring-test scaffold on <best-guess>, or pick another? (yes / <filename> / skip)`. The user's reply decides whether to bypass the filter for one file. Do not silently bypass — and do not try to guess when the file has no Angular imports at all (`grep -l '@angular' <file>` → empty) — tell the user it looks like node-territory in that case.
   - **1 candidate** → scaffold for it; no prompt needed. Archetype falls out of the suffix and the spec (see the `new` flow below).
   - **2+ candidates** → list them annotated with their archetype guess (`behavioral` / `wiring`) and ask the user which to scaffold. Offer "all" as an explicit option.

4. **Scaffold and inject** following the `new` flow below (read spec → write `.page-test.ts` → inject harness into component).

5. **Report** the scaffolded suite(s) and the run instructions: the user opens `/code-trakker/code-trakker-module-test` in the running dev server, copies the `==== PAGE-TEST RUN ...` block from devtools console, and pastes it back for verdict.

### `new <ado-id> <src-path> [suite-name]`  → scaffold + inject

- `<ado-id>`: ticket folder, e.g. `6757` or `ADO-6757`. Normalize to
  `ADO-<digits>`. Verify `_local/<ADO-id>/` exists; if not, ask the user
  before creating it.
- `<src-path>`: path to the target TS module, relative to repo root or
  absolute. Example: `AuditTrakker.Web/src/app/state/cra-shared-state.service.ts`.
- `[suite-name]`: optional. If omitted, derive from the src filename
  (kebab-case, drop `.service`/`.component`/etc. suffix). Example:
  `cra-shared-state.service.ts` → `cra-shared-state`.

Steps:
1. **Read the spec first.** Open `_local/<ADO-id>/00_reqs.md` (fall back
   to `01_spec.md` only if missing). Extract the requirements that apply
   to this target. **Pick the archetype** (see "Test archetypes" above)
   from the target suffix and spec wording:
   - Registration-style phrasing ("add X to Y", "register X", "inject X
     into the chain", "wire X", "provide X") → **wiring**.
   - Behavior-style phrasing ("when I call X, returns Y", "formats",
     "filters", "emits", "redirects") → **behavioral**.
   - Wiring suffix with behavioral hooks in the spec, or a behavioral
     suffix that also ships registration (e.g., a service whose ticket
     says "add it to the rehydrate chain AND round-trip its getters") →
     emit both archetypes in one `runSuite` block.
   Do not open the target's .ts file yet.
2. If (and only if) you can't write the test call-sites without knowing
   public signatures, read the target — signatures only. Stop reading at
   the first `{` of any method body.
3. Ensure the harness exists (see "Bootstrap" below).
4. Write `{test-host-root}/code-trakker-module-test/_page-tests/<suite-name>.page-test.ts`.
   The file exports `export async function run(injector: Injector): Promise<void>` and
   calls `runSuite('<SuiteName>', (test) => { ... })` with one `test(...)`
   per spec-grounded case (behavioral or wiring — see "Test archetypes").
   Each test name should echo the spec wording so a failure pinpoints the
   regressed requirement.
5. Inject the harness call into `code-trakker-module-test.component.ts`
   (see "Component injection" below). Replace any existing
   `PAGE-TEST-HARNESS-*` block — one suite at a time. If the user wants
   multiple suites in one page load, chain them inside the same
   `.page-test.ts` file.
6. **Typecheck before handoff.** Confirm the scaffolded test and the
   component injection compile. Never hand off a broken tree — a dev
   server watching the files will hot-reload the error into the user's
   browser.

   Run `{verify-command}` from `_local/config.md`.

   - **Exit 0** → continue to Report.
   - **Errors touching the new `_page-tests/<suite-name>.page-test.ts`
     or the component's `PAGE-TEST-HARNESS-*` markers** → do not
     report success. Show the failing TSC output, identify the likely
     cause (missing signature-only import, wrong generic parameter,
     renamed/removed export in the target, stale import path after a
     target rename), and offer two paths:
     (a) fix the specific error and re-run the typecheck;
     (b) roll back — delete the new `.page-test.ts`, then run
         `/wf-caps:test-page clean` to remove the component markers.
     Wait for the user's choice.
   - **Errors only in files this skill did not touch** → flag as
     pre-existing: the repo was already broken before the scaffold.
     Report the scaffold as complete but prepend
     `⚠ Pre-existing TypeScript errors detected outside the scaffolded
     files (N errors in M files) — not caused by this skill.` so the
     user doesn't mis-attribute them.
7. Report:
   - The path of the new `.page-test.ts` file and the number of test
     cases it contains.
   - The component file was modified (show the injected block).
   - `Typecheck: PASS` (always include — makes the verification visible).
   - A one-liner for the user: "open `/code-trakker/code-trakker-module-test`
     in the running dev server; copy the `==== PAGE-TEST RUN ...` block
     from devtools console and paste it back here."

**After typecheck passes** (and before the user runs the suite in the
browser), invoke `/wf:index <ado-id> page-tests "<suite-name>.page-test.ts
· <n> cases · scaffolded"` to record the scaffold in the per-task index.
Substitute the suite name and the test-case count. `page-tests` is a
string slot — the file lives in the source tree (not under `_local/`),
so the index records the act of scaffolding rather than counting files.
When the user pastes back the run output, the verdict goes into chat
only — the index is not updated again.

### `clean`  → remove the harness injection

1. Open `code-trakker-module-test.component.ts`.
2. Remove the marked block inside `ngOnInit` (`// PAGE-TEST-HARNESS-BEGIN`
   … `// PAGE-TEST-HARNESS-END`).
3. Remove the marked injector field (`// PAGE-TEST-HARNESS-INJECTOR-BEGIN`
   … `// PAGE-TEST-HARNESS-INJECTOR-END`) if present.
4. Do NOT delete the `_page-tests/` folder. The user may want to re-run
   later; test files are cheap to keep, the component mutation is what
   matters.
5. Report the file as restored.

### `backend-smoke <ado-id> [suite-name]`  → Angular service method + page-test for a .NET endpoint

Smoke-test a newly added .NET controller endpoint by adding a thin Angular service method and wiring it into the harness. Full procedure, argument handling, and runtime requirements in [references/backend-smoke.md](references/backend-smoke.md).

### anything else → freeform

If the user typed something like "page-test the interceptor", interpret
it: locate the target, find the most relevant ADO folder (or ask), and
follow the `new` flow.

---

## Test file conventions

File location: `{test-host-root}/code-trakker-module-test/_page-tests/<suite-name>.page-test.ts`

Filename must end in `.page-test.ts`. The `_page-tests/` folder is
git-excluded (see "Bootstrap") so nothing from this skill enters
commits.

Shape:

```ts
import { Injector } from '@angular/core';
import { runSuite, assertEqual, assertDeepEqual, assertNull, assertInstanceOf, assertTruthy } from './harness';
// Signature-only import from the target — do NOT read its implementation.
import { CraSharedStateService } from '../../../state/cra-shared-state.service';

export async function run(injector: Injector): Promise<void> {
  await runSuite('CraSharedStateService', (test) => {

    test('freshly created service returns null from getSelectedFilterTypeNum()', () => {
      const svc = injector.get(CraSharedStateService);
      assertNull(svc.getSelectedFilterTypeNum());
    });

    test('setSkipEmptyCategories(true) is visible via getSkipEmptyCategories()', () => {
      const svc = injector.get(CraSharedStateService);
      svc.setSkipEmptyCategories(true);
      assertEqual(svc.getSkipEmptyCategories(), true);
    });

    // ...one test per spec bullet...
  });
}
```

Conventions:
- **Name tests after the spec.** If `00_reqs.md` says "getStartDate
  returns a Date when a Date was set", the test name should echo that
  phrasing. Grep-ability is the point.
- **One behavior per test.** A test that calls three setters and
  checks five getters won't pinpoint the regression.
- **Obtain DI instances inside each test**, not in suite setup. It
  keeps tests independent and readable.
- **Do not reach into private state.** No `(svc as any).foo` access.
  If the spec says "setting X persists to local storage", assert it
  via a second `injector.get(svc)` call or via the `LocalStorageService`
  — never by peeking at `svc['storageService']`.
- **Async tests** return `Promise<void>`. The runner awaits each.
- **Clean up state you mutated**, if the test has side effects visible
  to later tests (e.g., local storage). When in doubt, resolve via
  `injector.get(SameService)` returning the same singleton — so set
  sensible values at the start of each test rather than assuming a
  pristine instance.

---

## The harness (`_page-tests/harness.ts`)

Shared runner + assertion helpers. Minimal, framework-free. Created on first run; reused thereafter. Test files import `runSuite` plus the assertion helpers they need from `./harness`.

Full API surface, output format, and the complete assertion-helper list: [references/harness.md](references/harness.md). Read it when writing tests (for the full helper list) or when verifying pasted run output (for the block delimiters).

---

## Component injection

Target: `{test-host-root}/code-trakker-module-test/code-trakker-module-test.component.ts`.

Two marker-wrapped edits (`PAGE-TEST-HARNESS-INJECTOR-*` for the `Injector` field, `PAGE-TEST-HARNESS-*` for the `runSuite` call inside `ngOnInit`) so the `clean` subcommand can reverse them surgically. Required during the `new` flow and reversed during `clean`.

Exact edit locations, code to insert, and clean-up rules: [references/component-injection.md](references/component-injection.md).

---

## Bootstrap (first run)

Three one-time setup steps: write the harness file, add the `_page-tests/` path to `.git/info/exclude` (local-only, not `.gitignore`), and sanity-check the exclude took effect via `git check-ignore`. Skip if `_page-tests/harness.ts` already exists — re-running is harmless but wasteful.

Full steps and exact commands: [references/bootstrap.md](references/bootstrap.md).

---

## Running the tests (what the user does)

After `/wf-caps:test-page new ...` reports success, the user:

1. Has the Angular dev server running (`npm start` under `AuditTrakker.Web/`,
   or one of the optimized-serve variants from user memory).
2. Navigates to `https://localhost:4200/code-trakker/code-trakker-module-test`
   (login + entity selection required — same as any guarded page).
3. Opens devtools → console. Finds the block between
   `==== PAGE-TEST RUN ...` and `==== PAGE-TEST END ====`.
4. Copies the whole block (including the delimiters) and pastes it into
   chat.

If you need to walk them through this, keep it tight — one or two
sentences. Don't re-explain it on every run.

---

## Verifying pasted results (after the user comes back)

When the user pastes a `==== PAGE-TEST RUN ... ==== PAGE-TEST END ====`
block, you produce a short verdict:

1. Summarize: `N passed, M failed, K skipped`.
2. For each `FAIL`, state:
   - The requirement it maps to (cite the spec line / `00_reqs.md`
     section).
   - Whether the failure means the implementation is wrong, or the test
     mis-read the spec. If the latter, propose the correction and offer
     to rewrite the test.
3. If `SUITE LOAD FAILED` appears, read the stack — most likely cause
   is a broken import path, a missing ctor dependency that the sandbox
   page's module doesn't provide, or a target that needs a provider
   not declared at the component level. Suggest concrete next steps;
   don't hand-wave.

Do NOT mark a requirement "verified" from a `PASS` alone if you suspect
the test itself was weak. Say so — the user would rather hear "test is
weak, tightening it would actually probe X" than a false green.

---

## Edge Cases

- **Target needs a provider the sandbox page doesn't have.** `injector.get(X)`
  throws `NullInjectorError`. The target depends on something that's
  usually provided by a feature module not loaded on this page. Options:
  add `providers: [X]` to `CodeTrakkerModuleTestComponent`'s `@Component`
  decorator (only for test-safe providers), or switch to a different
  host component. Call it out — do not silently inject providers that
  change production behavior.
- **Target hits the network.** `HttpClient` in the sandbox page goes
  against the real API proxy. Either mock `HttpClient` via
  `providers: [{ provide: HttpClient, useValue: fakeHttp }]` in the
  test block, or restrict the suite to methods that don't call out.
  Don't let tests quietly pass because the server returned `200` with
  unexpected data.
- **Stale harness after refactor.** If the target moved, the import in
  the `.page-test.ts` breaks and the console shows
  `SUITE LOAD FAILED`. Fix the import, nothing else.
- **User pastes a truncated log.** If the block lacks the `PAGE-TEST END`
  delimiter, ask for the rest before verdict — partial results are
  misleading.
- **Exclude entry missing.** If `git status` starts showing
  `_page-tests/` files as untracked after scaffold, the bootstrap step
  didn't complete. Re-run the `.git/info/exclude` append.
- **`inject()` added outside a construction context.** The injector
  field uses `inject(Injector)` at field-initialization time, which is
  supported in Angular 14+. If a future refactor turns it into a method
  call, it will throw `NG0203`. Keep it as a field initializer.

---

## Final Output

This skill ends a turn at one of two points — emit the matching block.

Scaffolded (suite written, awaiting the browser run):

```
TEST-PAGE — scaffolded

Suite:     <suite-name>.page-test.ts (<n> cases)
Typecheck: PASS
Next:      open /code-trakker/code-trakker-module-test in the dev server, run the suite, paste the ==== PAGE-TEST RUN … PAGE-TEST END ==== block back here.
```

Verdict (after the user pastes the run block):

```
TEST-PAGE — <pass | fail>

Result: <N passed · M failed · K skipped>
Next:   <branched on the result — see below>
```

The verdict `Next:` branches:

- **pass** → `none — utility. Tighten the suite if a green looks weak, or add more cases via /wf-caps:test-page <id> <component>.`
- **fail (implementation wrong)** → `fix the source, re-run the suite in the browser, paste the block back.`
- **fail (test mis-read the spec)** → `rewrite the test (offer to), re-run, paste back.`

**The final-output block must always be the very last thing output to chat.**
