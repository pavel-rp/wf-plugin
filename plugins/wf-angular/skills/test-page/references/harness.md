# wf-caps:test-page — the harness (`_page-tests/harness.ts`)

Shared runner + assertion helpers. Minimal — no framework. Created on first run; reused thereafter. Keep it framework-free — no imports beyond `@angular/core` types (and those are type-only — the runner doesn't need DI).

## API surface

- `runSuite(name: string, build: (test: TestFn) => void): Promise<void>` — prints a delimited block to `console.log`:

  ```
  ==== PAGE-TEST RUN <iso-timestamp> ====
  SUITE CraSharedStateService
    PASS freshly created service returns null from getSelectedFilterTypeNum()
    PASS setSkipEmptyCategories(true) is visible via getSkipEmptyCategories()
    FAIL setStartDate(Date) round-trips via getStartDate()
      Error: assertEqual failed: expected Date(2025-01-01), got null
      at _page-tests/cra-shared-state.page-test.ts:42:9
  DONE CraSharedStateService: 2 passed, 1 failed, 0 skipped (47ms)
  ==== PAGE-TEST END ====
  ```

- `type TestFn = (name: string, fn: () => void | Promise<void>) => void` — records one test. Body may be sync or async.

## Assertion helpers

All throw `Error` on failure; the runner catches and records:

- `assertEqual<T>(actual: T, expected: T, msg?: string)` — `Object.is`.
- `assertDeepEqual<T>(actual: T, expected: T, msg?: string)` — structural equality for objects/arrays; uses `JSON.stringify` as a tie-breaker (good enough for state shapes, not meant for cyclic graphs).
- `assertNull(v: unknown, msg?: string)` — passes for `null` and `undefined`. Use `assertEqual(v, null)` if you specifically want `null` only.
- `assertTruthy(v: unknown, msg?: string)` / `assertFalsy(v: unknown, msg?: string)` — boolean coerce.
- `assertInstanceOf<T>(v: unknown, ctor: new (...a: any[]) => T, msg?: string)`.
- `assertThrows(fn: () => void, match?: RegExp | string, msg?: string)` — for negative-path tests.

## Console prefix

Everything `console.log`s with a `[page-test]` prefix so it survives in mixed console output.
