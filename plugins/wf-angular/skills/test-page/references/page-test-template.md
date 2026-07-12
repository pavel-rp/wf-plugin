# Page-test archetype examples, file template, and writing conventions

Read on the write path — when scaffolding a `.page-test.ts` suite (the `new` flow). The two archetype examples illustrate the shapes the `## Test archetypes` decision in the SKILL body selects between; the file template and conventions are the skeleton and rules for the suite you write. Every test derives from the spec, not the implementation (the black-box rule in the SKILL body).

## Contents

- [Behavioral archetype example](#behavioral-archetype-example)
- [Wiring archetype example](#wiring-archetype-example)
- [`.page-test.ts` file template](#page-testts-file-template)
- [Writing conventions](#writing-conventions)

## Behavioral archetype example

The target declares methods with observable input/output. Tests exercise them:

```ts
test('setStartDate(Date) round-trips via getStartDate()', () => {
  const svc = injector.get(AppSharedStateService);
  const d = new Date('2025-01-01');
  svc.setStartDate(d);
  assertDeepEqual(svc.getStartDate(), d);
});
```

## Wiring archetype example

The target doesn't declare testable methods — it registers state, providers, or routes into the runtime. Tests verify the registration landed, without reaching into any one implementation:

```ts
test('DI resolution: AppSharedStateService is provided and constructible', () => {
  assertTruthy(injector.get(AppSharedStateService));
});

test('AppState.appShared is seeded with initialAppSharedState', () => {
  const appState = injector.get(AppStateService).state;
  assertDeepEqual(appState.appShared, initialAppSharedState);
});

test('rehydrate chain: AppSharedStateService singleton is live after init', () => {
  const svc = injector.get(AppSharedStateService);
  assertTruthy(svc);
  assertTruthy(svc.state);  // rehydrated slice exists
});
```

The black-box rule still applies — derive cases from the spec ("ticket says slice X goes in at initial state Y" → assert shape), not from the implementation file.

## `.page-test.ts` file template

File location: `{test-host-root}/{sandbox-host-folder}/_page-tests/<suite-name>.page-test.ts`. Filename must end in `.page-test.ts`. The `_page-tests/` folder is git-excluded (see the Bootstrap reference) so nothing from this skill enters commits.

Shape:

```ts
import { Injector } from '@angular/core';
import { runSuite, assertEqual, assertDeepEqual, assertNull, assertInstanceOf, assertTruthy } from './harness';
// Signature-only import from the target — do NOT read its implementation.
import { AppSharedStateService } from '../../../state/app-shared-state.service';

export async function run(injector: Injector): Promise<void> {
  await runSuite('AppSharedStateService', (test) => {

    test('freshly created service returns null from getSelectedFilterTypeNum()', () => {
      const svc = injector.get(AppSharedStateService);
      assertNull(svc.getSelectedFilterTypeNum());
    });

    test('setSkipEmptyCategories(true) is visible via getSkipEmptyCategories()', () => {
      const svc = injector.get(AppSharedStateService);
      svc.setSkipEmptyCategories(true);
      assertEqual(svc.getSkipEmptyCategories(), true);
    });

    // ...one test per spec bullet...
  });
}
```

## Writing conventions

- **Name tests after the spec.** If `00_reqs.md` says "getStartDate returns a Date when a Date was set", the test name should echo that phrasing. Grep-ability is the point.
- **One behavior per test.** A test that calls three setters and checks five getters won't pinpoint the regression.
- **Obtain DI instances inside each test**, not in suite setup. It keeps tests independent and readable.
- **Do not reach into private state.** No `(svc as any).foo` access. If the spec says "setting X persists to local storage", assert it via a second `injector.get(svc)` call or via the `LocalStorageService` — never by peeking at `svc['storageService']`.
- **Async tests** return `Promise<void>`. The runner awaits each.
- **Clean up state you mutated**, if the test has side effects visible to later tests (e.g., local storage). When in doubt, resolve via `injector.get(SameService)` returning the same singleton — so set sensible values at the start of each test rather than assuming a pristine instance.
