# wf-caps:qa-engine — Precondition handling (browser-level state)

How `/wf-caps:qa-engine` reaches the **browser-level** state each scenario asserts in its `Preconditions:` block. Loaded from `SKILL.md` Phase 5a step 1.

The engine's default disposition is **"reach the precondition, run the test"** — not "BLOCKED if state isn't already there." Skip to BLOCKED only when the precondition genuinely can't be reached via the recipes here.

**Scope.** This engine reaches **browser-level** state only — storage, URL, viewport. Preconditions that need a database row, a backend-host endpoint, or any server-side fixture are **out of this engine's scope**: mark the scenario `BLOCKED · setup: requires non-browser state (out of engine scope)`. A separate stack capability owns those surfaces.

## Contents

- [Lifecycle](#lifecycle)
- [Categories](#categories)
- [Auth preconditions](#auth-preconditions)
- [URL preconditions](#url-preconditions)
- [Storage preconditions](#storage-preconditions)
- [Environment preconditions](#environment-preconditions)
- [Cross-cutting safety rules](#cross-cutting-safety-rules)
- [Teardown failure handling](#teardown-failure-handling)
- [Recording fixtures in the report](#recording-fixtures-in-the-report)

---

## Lifecycle

For every scenario, before driving its steps:

1. **Parse** preconditions one by one. Classify each into a category below.
2. **Plan** setup actions and capture-prior-state for each non-trivial precondition.
3. **Execute setup** in the order: storage → auth → URL. (Auth is idempotent; storage clear may invalidate auth, so storage runs first; URL navigation is last so the steps land on the right page.)
4. **Run the scenario steps** (Phase 5a step 2 in SKILL.md).
5. **Run the scenario's teardown** if specified (Phase 5a step 3).
6. **Run fixture teardown** — reverse every setup write, in reverse order. Validate each revert.
7. **Record fixtures** in the verdict block's `Fixtures:` line.

If setup fails: scenario is `BLOCKED · setup: <one-line reason>`. Do NOT run the steps. Run fixture teardown for any setup that DID succeed.

If teardown fails: scenario verdict stands (PASS/FAIL/BLOCKED from the run), but `Fixtures:` line records the failure and the report's Notes section calls it out loudly. See [Teardown failure handling](#teardown-failure-handling).

---

## Categories

| Category | Examples | Setup capability |
|---|---|---|
| **Auth** | "Logged in as `admin@example.com`" | Existing — Phase 4 in SKILL.md |
| **URL** | "On `/reports/2026-Q1`" | `navigate_page` |
| **Storage** | "Cleared localStorage", "Fresh session", "No cached user state" | `run_playwright_code` |
| **Environment** | "Mobile viewport 375x812", "Network throttling off" | Mostly browser-only (viewport via playwright); some BLOCKED |

A precondition that names a database entity ("0 users for account X with status Y", "at least one open record exists") or a backend host is **out of scope** — see the scope note at the top. Mark it `BLOCKED · setup: requires non-browser state (out of engine scope)`.

---

## Auth preconditions

Already handled by SKILL.md Phase 4 (idempotent login + optional entity selection at run start).

If a scenario asserts a *different* user than the run's creds (e.g., "Logged in as `viewer@example.com`" when creds are admin), the engine cannot satisfy it without re-auth — and re-auth means losing the original session. Mark `BLOCKED · scenario requires user "<other>" but run is authenticated as "<creds-user>"`. Don't try to swap users mid-run; spec a separate run with the other user's creds.

---

## URL preconditions

`navigate_page(<url>)`. If the URL is relative (e.g., `/reports/2026-Q1`), prepend the base URL from the creds file.

Capture-prior-state is implicit: the browser remembers the previous URL. Teardown is a no-op — the next scenario's URL precondition (or auth flow) handles transition.

---

## Storage preconditions

### Detection patterns

Precondition prose containing any of: `fresh session`, `cleared localStorage`, `cleared sessionStorage`, `no cached state`, `clean browser`, `cookies cleared`, `clear cache`.

### Setup

Run via `run_playwright_code`:

```js
// Capture prior state for the audit BEFORE clearing (post-clear lengths are always 0)
const hadLocalStorage = localStorage.length > 0;
const hadSession = sessionStorage.length > 0;
const hadCookies = document.cookie.length > 0;
// Clear browser storage
localStorage.clear();
sessionStorage.clear();
// Clear all cookies for current origin
document.cookie.split(';').forEach(c => {
  const eq = c.indexOf('=');
  const name = (eq > -1 ? c.substr(0, eq) : c).trim();
  document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
});
// Report what existed before clearing for audit
({
  cleared: true,
  hadLocalStorage,  // captured pre-clear; true means storage held something
  hadSession,
  hadCookies,
});
```

After clearing, re-run the auth flow from SKILL.md Phase 4 (the user is now logged out, since storage held the auth token / session cookie). Note in fixtures: `cleared browser storage; re-authenticated`.

### Teardown

No revert. Storage is now in a "fresh" state, which is a valid baseline for the next scenario. The next scenario's auth flow will repopulate as needed.

### Selective clearing

If the precondition specifies "cleared `<specific-key>`" rather than full clear, scope the call:

```js
localStorage.removeItem('<specific-key>');
```

…and capture the prior value for revert:

```js
const prior = localStorage.getItem('<specific-key>');
localStorage.removeItem('<specific-key>');
({ priorValue: prior });
```

Teardown: `localStorage.setItem('<specific-key>', priorValue)` — only if the value was non-null.

### Seeding a specific storage value

If a scenario asserts a specific stored value ("`onboarding-complete` flag set", "feature flag X enabled in localStorage"), set it via `run_playwright_code`, capturing the prior value first:

```js
const prior = localStorage.getItem('<key>');
localStorage.setItem('<key>', '<value>');
({ priorValue: prior });
```

Teardown: restore the prior value if it was non-null, else `removeItem('<key>')`.

---

## Environment preconditions

### Detection patterns

Precondition prose mentioning: `viewport`, `mobile`, `tablet`, `network throttling`, `slow 3G`, `offline`, `API is down`.

### What's automatable

- **Viewport size** — `run_playwright_code`:

  ```js
  // Resize viewport (when supported by the runtime)
  await page.setViewportSize({ width: 375, height: 812 });
  ```

  May not work in all browser-automation configurations. If the call errors, mark `BLOCKED · viewport change unsupported`. Teardown: restore the prior viewport size (capture it before resizing).

### What's not

- **Network throttling** — the browser-automation tools do not expose throttling controls. Mark `BLOCKED · network throttling not supported in this runtime`.
- **API down / offline** — same. Mark `BLOCKED`.

If the test is genuinely about offline behavior, that's a category the browser-automation tools can't reach. Don't fake it.

---

## Cross-cutting safety rules

Apply to every browser-storage setup and teardown:

1. **Production guard.** Before any storage write, parse the `App base URL` from `_local/qa-creds.md`. If it looks production-shaped (no `localhost`, no `dev`, no `staging`, no `qa`, no `test` in the host), refuse: `BLOCKED · refused to seed: app URL "<url>" looks like production`. The user can override with explicit creds pointing at a known dev/staging environment.

2. **Capture before modify.** Every storage write captures the prior value *before* writing, so teardown can restore it (or remove a key that didn't exist before).

3. **Scope to the test origin.** Storage and cookie writes target the test app's origin only — never another domain.

4. **One concern per scenario.** A scenario's setup touches only the storage keys the precondition names. If a precondition is "cleared `cart`", the setup touches `cart` — not unrelated keys.

5. **Validate every revert.** Re-read storage after each teardown statement to confirm the original state is restored. If validation fails, surface loudly (see next section).

---

## Teardown failure handling

If a teardown step fails:

1. **Try once more** — re-issue. Transient timing issues are common.
2. If it fails again, **note the failure** in the report's Notes section:

   ```
   ⚠ TEARDOWN FAILED for TC-NNN — browser storage not restored to baseline.
   ```

3. **Continue with remaining teardowns** — one failure shouldn't block the rest.
4. The scenario's verdict (PASS/FAIL/BLOCKED) stands — teardown failure doesn't change what the test observed. But the run's overall `Status` flips to `INCOMPLETE` (the browser state isn't in a known baseline).

---

## Recording fixtures in the report

Every scenario's verdict block in `07_qa-report.md` gets a `Fixtures:` line. Examples:

- `Fixtures: none` — no setup needed.
- `Fixtures: precondition already met` — checked, no writes required.
- `Fixtures: cleared browser storage; re-authenticated` — storage clear.
- `Fixtures: 1 localStorage key set then reverted` — selective storage seed.
- `Fixtures: ⚠ teardown failed — browser storage not restored` — failure to surface.

When ANY fixture line is `⚠ teardown failed`, the report's top-of-file `Status:` is forced to `INCOMPLETE` regardless of scenario verdicts — the browser state isn't in a known baseline.
