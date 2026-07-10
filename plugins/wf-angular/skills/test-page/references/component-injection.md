# wf-angular:test-page — component injection

Target file: `{test-host-root}/{sandbox-host-folder}/{sandbox-host-folder}.component.ts` (the `{test-host-root}` and `{sandbox-host-folder}` slots from the `angular` profile — see SKILL.md "Stack profile").

Two edits, both marker-wrapped so the `clean` subcommand can reverse them surgically.

## 1. Injector field

The component's ctor takes an `Injector` and passes it to `super(injector)` but doesn't store it. Add a field initialized via `inject(Injector)` so tests can reach DI from `ngOnInit`. Put this among the existing class fields, above the ctor:

```ts
  // PAGE-TEST-HARNESS-INJECTOR-BEGIN — managed by /wf-angular:test-page; do not edit
  private readonly _pageTestInjector = inject(Injector);
  // PAGE-TEST-HARNESS-INJECTOR-END
```

Update the `@angular/core` import to include `inject` if missing.

## 2. Test runner call

Inside `async ngOnInit`, immediately BEFORE `this.endLoad();`:

```ts
    // PAGE-TEST-HARNESS-BEGIN — managed by /wf-angular:test-page; do not edit
    try {
      const mod = await import('./_page-tests/<suite-name>.page-test');
      await mod.run(this._pageTestInjector);
    } catch (err) {
      console.log('[page-test] SUITE LOAD FAILED', err);
    }
    // PAGE-TEST-HARNESS-END
```

The try/catch ensures a broken test file doesn't wedge the rest of the sandbox page. The `await import(...)` is dynamic so webpack keeps the test file out of the production chunk when the page isn't rendered.

## Clean-up behavior

On `clean`, remove both marker blocks. Leave the `inject` import alone — it's harmless if already unused, and another harness run may re-add the field.

Do NOT modify anything else on the component. The sandbox page hosts dozens of other manual tests; preserve all of them verbatim.
