# wf:test-page — `backend-smoke` subcommand

Smoke-test a newly added .NET controller endpoint by adding a thin Angular service method and wiring it into the wf:test-page harness.

## When to use

Some ADO tasks are pure backend — a new controller endpoint, a ported repository method, etc. There's no Angular target to test yet, but the endpoint can be smoke-tested from the browser by adding a thin service method to the **closest existing Angular service** and wiring it into the page-test harness.

Invoke with `/wf:test-page backend-smoke <ado-id> [suite-name]`.

## Arguments

- `<ado-id>`: same normalization as the `new` subcommand.
- `[suite-name]`: optional; derived from the controller/endpoint name if omitted (e.g., `CraSharedController` → `cra-shared-api`).

## Steps

1. **Read the spec.** Open `_local/<ADO-id>/00_reqs.md` (fall back to `01_spec.md`). Identify the endpoint(s) added: route, HTTP method, query/body parameters, expected response shape.

2. **Find the closest Angular service.** Convention: for `SomethingController` at route `api/something`, look for `something.service.ts` or `something-shared.service.ts` under `AuditTrakker.Web/src/app/`. If none exists, create one following the nearest sibling pattern (e.g., `CptSharedService` for `CraSharedController`). New services go in the same folder as their sibling and must be `providedIn: 'root'`.

3. **Add the service method.** Mirror the endpoint signature. Mark the method with `//MIGRATION NOTE: Added for ADO-<id> endpoint smoke test` so it's clear this is forward work. The method is real production code — it will be used by the downstream Angular feature — so follow existing service patterns (use `HttpService`, `firstValueFrom`, `catchError(this.handleError)`). **The new service file is NOT git-excluded** — it's a legitimate deliverable, same as the backend endpoint itself.

4. **Ensure the harness exists** — same Bootstrap as the `new` subcommand (see parent SKILL.md).

5. **Write the page-test file** in `_page-tests/<suite-name>.page-test.ts`. Tests are async and call the real API via the service method. Assert:
   - The call resolves without error (non-error HTTP status).
   - The response is an array (or object, per spec).
   - Array items have the expected shape (property names and types from the spec's DTO definition).
   - Edge cases from the spec (e.g., "empty array when no periods exist" — use an accessLevelId unlikely to have data, such as `0` or `-1`).

   Do NOT assert exact row counts or specific data values — those depend on the database. Shape and non-error-ness are the contract.

6. **Inject into the component** — same as the `new` subcommand (see parent SKILL.md).

7. **Typecheck before handoff.** Run `{verify-command}` from `_local/config.md` and confirm exit 0. This catches the common failure modes for this flow: a typo in the new service method's return type, an `HttpService` method signature drift, or a mismatched DTO shape in the page-test's assertions. If errors reference the new service file, the new page-test, or the component's `PAGE-TEST-HARNESS-*` markers, do not report success — show the TSC output and offer to fix the error or roll back (delete both new files + `/wf:test-page clean` the markers). Errors outside these files get flagged as pre-existing.

8. **Report** the new/modified service file, the page-test file, the component injection, and `Typecheck: PASS`. Remind the user the API backend must be running for these tests to pass.

**After typecheck passes** (and before the user runs the suite), invoke `/wf:index <ado-id> page-tests "<suite-name>.page-test.ts · backend smoke · <n> cases"` to record the scaffold in the per-task index. The `backend smoke` token in the summary differentiates this from a behavioral/wiring page-test scaffold; the slot itself stays the same.

## Runtime requirements

Because these tests hit the real API, they require:

- The .NET API running (typically via Visual Studio or `dotnet run`).
- The Angular proxy config forwarding `/api/*` to the API port.
- A logged-in session with a valid entity selected.

Call this out in the report. If the test returns a network error, the most likely cause is the API not running or the proxy not configured.
