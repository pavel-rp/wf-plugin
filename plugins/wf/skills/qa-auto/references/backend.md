# wf:qa-auto — API (endpoint-exercise) scenarios

How `/wf:qa-auto` runs a `Type: API` scenario: get the token from the live session, call the endpoint, assert status + response shape, revert any wiring. Loaded from `SKILL.md` Phase 6 the first time an `API` scenario (or a `Backend host required:` precondition) appears.

This is the path that makes a backend-only task actually get exercised instead of stub-passed. The runner already has an authenticated browser session from Phase 5 — that session is the token source, and the calls ride on it.

## Contents

- [Token capture](#token-capture)
- [Transports — fetch and curl, equal footing](#transports--fetch-and-curl-equal-footing)
- [Resolving the route](#resolving-the-route)
- [Backend host required — wire, poll, revert](#backend-host-required--wire-poll-revert)
- [Per-API-scenario procedure](#per-api-scenario-procedure)
- [Evaluating assertions](#evaluating-assertions)
- [Safety](#safety)
- [Recording in the report](#recording-in-the-report)

---

## Token capture

Right after Phase 5 auth succeeds, capture how the app authorizes calls — once, reused for every API scenario. Two realities:

1. **Bearer in storage** (the common Angular case — a JWT in `localStorage`/`sessionStorage`, attached by an `HttpInterceptor`). Discover it via `run_playwright_code`:

   ```js
   // Auto-discover a JWT-shaped value across both stores
   const isJwt = v => typeof v === 'string' && /^[\w-]+\.[\w-]+\.[\w-]+$/.test(v);
   const hit = {};
   for (const store of ['localStorage', 'sessionStorage']) {
     const s = window[store];
     for (let i = 0; i < s.length; i++) {
       const k = s.key(i); const v = s.getItem(k);
       if (isJwt(v) || /token|jwt|auth/i.test(k)) hit[store + ':' + k] = isJwt(v) ? 'jwt' : 'maybe';
     }
   }
   ({ candidates: Object.keys(hit) });
   ```

   If `{api-auth-token-source}` is set in config, use that exact key instead of discovering. Pick the JWT-shaped candidate; if several, prefer a key containing `access_token` > `id_token` > `token`. Read its value with `run_playwright_code` and hold it in working memory as `BEARER`. **Never write it to disk; never echo it in full** — mask as `••••<last 4>` if you must mention it.

2. **httpOnly cookie auth** (no JS-readable token). Discovery returns no JWT candidate. Then there's no bearer to read — but an in-browser `fetch` to the same origin sends the auth cookie automatically (`credentials: 'include'`). Use the fetch transport for these; curl would need the cookie exported, which httpOnly forbids, so curl is unavailable for cookie-auth apps (note it in the report if a scenario specifically wanted curl).

Record once at the top of the run which mode is in effect: `Auth: bearer (storage key <masked>)` or `Auth: cookie (httpOnly)`.

---

## Transports — fetch and curl, equal footing

Both are first-class. Pick per scenario; they assert identically.

### In-browser fetch (default)

Runs in the app origin via `run_playwright_code`, so same-origin cookies ride along and there's no CORS. Add the bearer header when in bearer mode. Return a **small** JSON — status + a bounded body, never the raw DOM:

```js
const res = await fetch('<absolute-url>', {
  method: '<METHOD>',
  credentials: 'include',
  headers: { 'Content-Type': 'application/json', ...(BEARER ? { Authorization: 'Bearer ' + BEARER } : {}) },
  body: <BODY ? JSON.stringify(BODY) : undefined>,
});
let body; const text = await res.text();
try { body = JSON.parse(text); } catch { body = text.slice(0, 500); }
({ status: res.status, isArray: Array.isArray(body),
   sample: Array.isArray(body) ? body.slice(0, 2) : body, len: Array.isArray(body) ? body.length : undefined });
```

Default to fetch for GET and JSON POST/PUT/PATCH/DELETE.

### Bash curl

Use when the scenario is a **multipart/file upload**, needs a verb or header fetch can't cleanly express, or when you want a copy-pasteable repro (the manual `/wf:qa-run` reuses these). Requires bearer mode (or JS-readable cookies):

```bash
curl -s -o - -w "\n__HTTP__%{http_code}" \
  -X <METHOD> \
  -H "Authorization: Bearer <BEARER>" \
  -H "Content-Type: application/json" \
  <absolute-url> \
  --data '<json body, omit for GET>'
```

Parse the trailing `__HTTP__<code>` for status; everything before it is the body. Truncate the body to the assertion-relevant fields before returning — never echo the full token in the command you record (mask it in any transcript).

---

## Resolving the route

The scenario's `Route:` is either an absolute path (`/api/provider-groups?accessLevelId=123`) or the placeholder `via backend host`.

- **Absolute path** → prepend the app base URL from `_local/qa-creds.md` (the Angular dev proxy forwards `/api/*` same-origin, so base + route is correct). `{api-base-path}` from config (default `/api`) is only needed if a scenario route omits the prefix — normally the plan already includes it.
- **`via backend host`** → resolve through `api-probe` (next section) and substitute the returned route.

---

## Backend host required — wire, poll, revert

When a scenario's preconditions include `Backend host required: <Service>.<method>`, treat the endpoint as a **fixture** with the same capture/validate discipline as a DB fixture:

1. **Probe.** Invoke `/wf:qa-host api-probe <Service>.<method>` (read `wf:qa-host/SKILL.md` once per run when first needed). Outcomes:
   - `EXPOSED — existing` → use the returned route. No wiring, no teardown.
   - `EPHEMERAL — wired` → use the returned `__qa` route; it needs the API to rebuild (step 2). Record that a host was scaffolded.
   - `api-probe` stops (can't wire cleanly / no controller) → `BLOCKED · setup: backend host could not be wired — <reason>`; skip the scenario's request.
2. **Poll until live.** A freshly-wired `.cs` action isn't reachable until the API recompiles. Poll the route with a lightweight GET (bounded: ~6 tries, a couple seconds apart). Stop polling as soon as it returns anything other than 404/connection-refused.
   - Becomes reachable → proceed to the request.
   - Still 404 after the bound → `BLOCKED · setup: backend host wired but API not rebuilt — restart the API (or run dotnet watch) and re-run`. Leave the wiring in place (the restart will pick it up); it's still reverted at end of run.
3. **Exercise** the scenario against the resolved route.
4. **Revert (teardown).** Invoke `/wf:qa-host api-revert <Service>.<method>`; confirm it reports the sentinel removed. This is fixture teardown — do it whether the scenario passed, failed, or blocked after wiring. Record in `Fixtures:`.

At **end of run**, if any ephemeral host was scaffolded this session, invoke `/wf:qa-host api-revert --all` as a safety sweep so no `WF-QA-EPHEMERAL` block can survive into a commit.

---

## Per-API-scenario procedure

For a `Type: API` `TC-NNN`:

1. **Preconditions.** Apply data/storage preconditions per [`preconditions.md`](preconditions.md) exactly as for browser scenarios. Resolve `Backend host required:` per the section above. If any setup fails → `BLOCKED · setup: <reason>`, skip the request, run partial teardown.
2. **Build the request** from the Request block: method, resolved absolute route, body (parse the inline JSON).
3. **Pick transport** — fetch (default) or curl (multipart / repro-wanted). Execute once. Capture `{ status, body-sample }` only.
4. **Evaluate assertions** (next section). Each Assertions-table row is its own PASS/FAIL.
5. **Verdict.** All rows pass → `PASS`. Any row fails → `FAIL`, observed = the failing status / body sample (truncated ~120 chars). On FAIL, save the full response to `artifacts/qa-api-TC-NNN-<UTC>.json` (truncated to ~2KB) — the API analog of a screenshot.
6. **Teardown.** Reverse data fixtures (reverse order, validate) and revert any ephemeral host.

---

## Evaluating assertions

Map each Assertions row to a check on the captured response — assert the **contract, never the data**:

| Assertion row shape | Check |
|---|---|
| `HTTP status` = `<N>` | `status === N` |
| `HTTP status is not 5xx` | `status < 500` |
| `HTTP status is not 401/403` | `status !== 401 && status !== 403` |
| `Response is an array` | `isArray === true` |
| `Each item has { id: number, name: string }` | on the first item (and spot-check the rest): property present AND `typeof` matches |
| `Response has field X` | `X in body` (or `body[0]`) |
| spec edge: `empty array when none match` | drive the param the spec names to an unlikely value (`0`/`-1`), assert `len === 0` |

Never assert exact row counts or specific field values — those depend on the database (same rule as `wf:test-page backend-smoke`). If an assertion row demands a specific value, treat the plan as over-specified and record a Note rather than a spurious FAIL.

---

## Safety

- **Token hygiene.** Never write the bearer to disk, never echo it in full in chat or in a recorded curl command. Mask to `••••<last 4>`.
- **Production guard (extends [`preconditions.md` § Cross-cutting](preconditions.md#cross-cutting-safety-rules)).** Before any **non-GET** API exercise (POST/PUT/PATCH/DELETE) or any DB fixture, check the app URL from `qa-creds.md`. If it looks production-shaped (no `localhost`/`dev`/`staging`/`qa`/`test` in the host), refuse: `BLOCKED · refused: <METHOD> against app URL "<url>" looks like production`. Read-only GETs are allowed but still never carry fixtures against production.
- **No source reads to explain a failure.** Black-box discipline holds for API scenarios too: a wrong status/shape is a FAIL, recorded as observed-vs-expected — don't open the controller/repository to rationalize it. (Diagnosis is `/wf:qa-followup`'s job.) Reading the *route* from the plan and the *token* from storage is not a source read.
- **Ephemeral wiring is never committed.** The runner reverts every host it scaffolds and sweeps `api-revert --all` at end of run. If a revert fails, surface it as loudly as a failed DB teardown and force the run `Status` to `INCOMPLETE`.

---

## Recording in the report

API scenarios use the same per-scenario verdict block as browser scenarios (PASS = one line; FAIL = the assertions table with observed values). Differences:

- The step table is the **Assertions** table (status + shape rows), not browser steps.
- `Screenshot:` is replaced by `Response:` → `artifacts/qa-api-TC-NNN-<UTC>.json` on FAIL.
- The `Fixtures:` line records the backend host: `scaffolded ephemeral backend host __qa/<route> then reverted`, `routed to existing endpoint <route>`, or `none`. A failed `api-revert` reads `⚠ ephemeral host revert failed — see /wf:qa-host api-revert --all` and forces `Status: INCOMPLETE`.
- The run header adds `Auth: bearer | cookie` so a reader knows how calls were authorized.
