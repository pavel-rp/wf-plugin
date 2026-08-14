# wf:qa-gen — API (endpoint-exercise) scenarios

How `/wf:qa-gen` covers a **backend task** — one whose deliverable is a backend endpoint, a service method, or a data-layer (repository/provider) method rather than a frontend view. Loaded from `SKILL.md` Phase 3 when a criterion classifies as **API**.

The point: a backend task is not "verified by build." A type that compiles is not a method that returns the right rows. The `API` category exists so backend criteria get *exercised over HTTP with a real token*, not stamped PASS because they typecheck. This is the fix for the failure mode where a pure data-layer task produced a stub PASS report.

## Contents

- [When a criterion is API vs Build/static](#when-a-criterion-is-api-vs-buildstatic)
- [Endpoint vs service-only — the backend host](#endpoint-vs-service-only--the-backend-host)
- [Host-unavailable annotation](#host-unavailable-annotation)
- [API scenario template](#api-scenario-template)
- [API baseline health](#api-baseline-health)
- [Backend-diff signals (Phase 2)](#backend-diff-signals-phase-2)

---

## When a criterion is API vs Build/static

The line is **existence/shape (static)** vs **behavior through a call (API)**.

| Criterion describes… | Category | Why |
|---|---|---|
| "type `Widget` is exported", "DTO has field `Name`", "method signature is `(int) => Task<List<T>>`" | **Build/static** | Verified by compile / grep. No runtime behavior. |
| "endpoint returns the widgets for the access level", "repository filters out inactive rows", "POST creates the record and returns 201", "service returns an empty list when none match" | **API** | A behavior only a real call can confirm. Exercise it. |

Split a straddling criterion the same way Phase 3 already splits wiring-vs-behavior: "the service is registered in DI **and** its method returns the right shape" → registration half is **Build/static**, the returns-the-right-shape half is **API**. Don't double-count.

**Black-box still holds.** You read the endpoint's route declaration, HTTP verb, parameters, and return type, and the response/DTO type's field names/types — those are the *public signature*, the same allowance the browser path has for selectors and labels. Stop at the first `{` of any method body. Derive the *expected* response shape from the spec's response-shape definition, not from how the data layer builds it. If the spec doesn't pin a shape, assert the contract you can (status, array-ness, presence of the spec-named fields) and add a `<!-- AMBIGUOUS: <criterion> · response shape not pinned in spec -->` comment.

---

## Endpoint vs service-only — the backend host

For each API criterion, decide how the behavior is reachable:

1. **An endpoint already exists** — an endpoint/route-handler on the branch (or pre-existing) exposes the behavior. The scenario names the real `Method` + `Route`. No host needed.
2. **Service/data-layer method only, no endpoint** — the deliverable is a service or data-layer method the task did not (yet) expose over HTTP. The behavior is still testable: the runner temporarily wires the method to the most appropriate endpoint/route-handler (the active backend capability names the concrete handler type), exercises it, and reverts the wiring before anything is committed. Emit a precondition:

   ```
   Backend host required: <Service-or-Repository>.<method>
   ```

   This is the backend analog of `Host required:` for an un-routed frontend component. Generation resolves the `qa-execution:host` provider once. When it is available, `/wf:qa-auto` sends the scenario block to that provider in a prepare request, forwards its safe resolved route/readiness metadata to the engine, and guarantees a provider-native teardown request afterward. When it is unavailable, generation retains the scenario but adds the stable unavailable-host annotation below. Set the scenario's `Route:` to `via backend host` — the engine substitutes the safe route returned by host preparation.

Determining which: inspect the endpoint/route-handler signatures already identified by the branch-diff read, plus any endpoint roots named by the active capability's backend material, for a handler that calls the target service method. If one is found, it's case 1; otherwise case 2. The concrete file-name patterns and route-declaration syntax are stack-specific — they live in the active backend capability's material, not here.

---

## Host-unavailable annotation

Generation resolves `qa-execution:host` once before scenario authoring. If that record is not `state: ok`, add this exact line to every scenario carrying either a browser `Host required:` or API `Backend host required:` precondition:

```markdown
**Host availability:** unavailable
```

For API scenarios place it immediately after `**Type:** API`; for browser scenarios place it immediately after `**Priority:**`. This is a plan-state annotation, not a result marker: retain the scenario and its steps/request/assertions unchanged. Do not add it to scenarios without a host requirement. The plan renders the corresponding single capability gap once; runners use this exact annotation to exclude unavailable host work while preserving all other runnable scenarios.

---

## API scenario template

Same outer shape as a browser scenario (`Validates` / `Priority` / `Preconditions` / `Teardown`) so the report and traceability roll up identically — only the body differs: a **Request** block + an **Assertions** table instead of a **Steps** table. The `**Type:** API` line is what tells the runners to dispatch to the API path.

```markdown
### TC-NNN: <title — echo the spec wording>

**Validates:** SC-<N> — <criterion, abbreviated>
**Priority:** P0 | P1 | P2
**Type:** API
**Host availability:** unavailable
<!-- Include the line above ONLY when `Backend host required:` is present and generation preflight found no host owner. -->

**Preconditions:**

- Authenticated session (the runner reuses the logged-in token).
- <Data state, if any — same shapes/recipes as browser scenarios, e.g. "At least one Widget exists for access level 123">
- Backend host required: <Service>.<method>   <!-- ONLY when no endpoint exists yet; omit otherwise -->

**Request:**

- **Method:** GET | POST | PUT | PATCH | DELETE
- **Route:** /api/<path>?<query>            <!-- or `via backend host` when temp-wired -->
- **Body:** none                            <!-- or inline JSON for POST/PUT/PATCH -->

**Assertions:**

| # | Assertion | Expected |
|---|---|---|
| 1 | HTTP status | 200 |
| 2 | Response is an array | true |
| 3 | Each item has `{ id: number, name: string }` | true |

**Teardown:**

- <none | revert the data fixture | ephemeral backend host is auto-reverted by the runner>
```

Writing rules specific to API scenarios:

- **One assertion per row.** Status is its own row; each shape/value check is its own row. A partial pass is then legible.
- **Assert the contract, not the data.** Status code, array-ness vs object, presence and type of spec-named fields, and spec-stated edge behavior ("empty array when none match — use an id unlikely to have data, e.g. `0` or `-1`"). **Never assert exact row counts or specific values** — those depend on the database, exactly as the stack's backend-smoke page-test already cautions.
- **Negative/error cases at `full` scope.** Bad input → 400, missing/forbidden → 401/403, not-found → 404 — when the spec defines them. These are first-class API scenarios, not afterthoughts.
- **Route is real.** Use the actual route template from the endpoint's route/verb declaration (signature read — the stack's route-declaration syntax, whatever the active backend capability names it). Placeholder `via backend host` is allowed *only* for the service-only case, where the route does not exist until the registered host provider's prepare result supplies it.

---

## API baseline health

The Baseline-health suite is always present (SKILL.md Phase 3.5). When the task **has a reachable UI route**, emit the normal browser baseline. When the task is **backend-only** (no route the change affects), do **not** stamp the old `[N/A: no runnable UI]` — emit an **API baseline** instead, so the plan still has a runnable floor:

```markdown
### TC-NNN: Primary endpoint responds without a server error

**Validates:** — (baseline health, API)
**Priority:** P1
**Type:** API

**Preconditions:**

- Authenticated session.
- Backend host required: <Service>.<method>   <!-- only if the primary surface is service-only -->

**Request:**

- **Method:** GET
- **Route:** <the primary endpoint this task adds or changes, or `via backend host`>

**Assertions:**

| # | Assertion | Expected |
|---|---|---|
| 1 | HTTP status is not 5xx | true |
| 2 | HTTP status is not 401/403 (token accepted) | true |
```

Keep the standing bar small — this one API baseline scenario, no more. Only fall back to a single `[N/A: no runnable surface]` scenario when the task has *neither* a route *nor* any callable service/endpoint (pure type/config/helper work) — the genuinely-nothing-to-run case.

---

## Backend-diff signals (Phase 2)

When inspecting the set of files changed on this branch relative to the base branch in Phase 2, flag a file as a backend surface (signature-only read, per the black-box rule) by its **role**, not its stack-specific file-name pattern. The three roles:

- **Endpoint / route-handler files** — read each handler's HTTP verb, route template, parameters, and return type. New or changed handlers are **endpoint** API surfaces (case 1).
- **Service / data-layer files** (service, repository, provider, or whatever the stack calls its business- and data-access layer) — read public method signatures. A new/changed public method with no endpoint handler calling it is a **service-only** API surface (case 2 → `Backend host required:`).
- **Response-shape types** (DTO, model, or record types referenced by the above) — read field names + types to derive the expected response shape.

The concrete file-name patterns, route/verb declaration syntax, and data-layer naming that identify each role are **stack-specific** — they live in the active backend capability's material (for a source→target migration, the migration capability's parity-suite fragment carries the concrete endpoint/service/data-layer/response-type file patterns and route-attribute read examples). This reference names the role; the capability names the pattern.

A task whose entire diff is backend data-layer files with no frontend target is the canonical **backend-only** task: classify its behavioral criteria as **API**, emit `Backend host required:` for the service-only ones, and give it the API baseline.
