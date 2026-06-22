# wf:qa-auto — Precondition handling

How `/wf:qa-auto` reaches the data, storage, and environment state each scenario asserts in its `Preconditions:` block. Loaded from `SKILL.md` Phase 6a step 1.

The skill's default disposition is **"reach the precondition, run the test"** — not "BLOCKED if state isn't already there." Skip to BLOCKED only when the precondition genuinely can't be reached via the recipes here.

## Contents

- [Lifecycle](#lifecycle)
- [Categories](#categories)
- [Auth preconditions](#auth-preconditions)
- [URL preconditions](#url-preconditions)
- [Storage preconditions](#storage-preconditions)
- [Data preconditions](#data-preconditions)
- [Environment preconditions](#environment-preconditions)
- [Cross-cutting safety rules](#cross-cutting-safety-rules)
- [Teardown failure handling](#teardown-failure-handling)
- [Recording fixtures in the report](#recording-fixtures-in-the-report)

---

## Lifecycle

For every scenario, before driving its steps:

1. **Parse** preconditions one by one. Classify each into a category below.
2. **Plan** setup actions and capture-prior-state for each non-trivial precondition.
3. **Execute setup** in the order: storage → auth → data → URL. (Auth is idempotent; storage clear may invalidate auth, so storage runs first; data setup may rely on auth being in place; URL navigation is last so the steps land on the right page.)
4. **Run the scenario steps** (Phase 6a step 2 in SKILL.md).
5. **Run the scenario's teardown** if specified (Phase 6a step 3).
6. **Run fixture teardown** — reverse every setup write, in reverse order. Validate each revert.
7. **Record fixtures** in the verdict block's `Fixtures:` line.

If setup fails: scenario is `BLOCKED · setup: <one-line reason>`. Do NOT run the steps. Run fixture teardown for any setup that DID succeed.

If teardown fails: scenario verdict stands (PASS/FAIL/BLOCKED from the run), but `Fixtures:` line records the failure and the report's Notes section calls it out loudly. See [Teardown failure handling](#teardown-failure-handling).

---

## Categories

| Category | Examples | Setup capability |
|---|---|---|
| **Auth** | "Logged in as `admin@example.com`" | Existing — Phase 5 in SKILL.md |
| **URL** | "On `/audits/2026-Q1`" | `navigate_page` |
| **Storage** | "Cleared localStorage", "Fresh session", "No cached user state" | `run_playwright_code` |
| **Data** | "At least one open audit exists", "0 users for account X with status Y", "User `test@x` exists" | `mssql_*` MCP tools (preferred) or `sqlcmd` via Bash |
| **Host** | "Host required: `<path>`" — target component has no route yet | Follow `wf:qa-host/SKILL.md`: `route` → `new` if missing |
| **Environment** | "Mobile viewport 375x812", "Network throttling off", "API is down" | Mostly browser-only (viewport via playwright); some BLOCKED |

---

## Auth preconditions

Already handled by SKILL.md Phase 5 (idempotent login + entity selection at run start).

If a scenario asserts a *different* user than the run's creds (e.g., "Logged in as `viewer@example.com`" when creds are admin), the skill cannot satisfy it without re-auth — and re-auth means losing the original session. Mark `BLOCKED · scenario requires user "<other>" but run is authenticated as "<creds-user>"`. Don't try to swap users mid-run; spec a separate run with the other user's creds.

---

## URL preconditions

`navigate_page(<url>)`. If the URL is relative (e.g., `/audits/2026-Q1`), prepend the base URL from the creds file.

Capture-prior-state is implicit: the browser remembers the previous URL. Teardown is a no-op — the next scenario's URL precondition (or auth flow) handles transition.

---

## Storage preconditions

### Detection patterns

Precondition prose containing any of: `fresh session`, `cleared localStorage`, `cleared sessionStorage`, `no cached state`, `clean browser`, `cookies cleared`, `clear cache`.

### Setup

Run via `run_playwright_code`:

```js
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
  hadLocalStorage: localStorage.length === 0,  // post-clear; true means we did clear something
  hadSession: sessionStorage.length === 0,
});
```

After clearing, re-run the auth flow from SKILL.md Phase 5 (the user is now logged out, since storage held the auth token / session cookie). Note in fixtures: `cleared browser storage; re-authenticated`.

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

---

## Data preconditions

### Detection patterns

Precondition prose containing: `<N> <entity>`, `at least <N>`, `exactly <N>`, `0 <entity>`, `no <entity>`, `<entity> in state <X>`, `user <X> exists`, `<entity> with <field>=<value>`, etc.

### Schema discovery

Allowed without violating black-box discipline:

- `mssql_*` MCP tools to list tables, describe columns, list foreign keys.
- Reading migration files under the schema folder named in `_local/config.md` (e.g., `{schema-folder}` if the project tracks a SQL migration directory). Migration files are schema metadata, not behavior.

NOT allowed for precondition setup:

- Reading the application's data-access source (`*Repository.cs`, EF DbContext config, etc.). The schema is the contract; the repository's behavior is what you're testing. If the test reveals the repository disagrees with the schema, that's a bug — don't paper over it by mimicking the repository's logic.

### Setup recipe

For each data precondition:

1. **Query current state** — read what's already there with the query the precondition implies. Examples:

   - "At least one open audit exists" → `SELECT COUNT(*) FROM Audits WHERE Status = 'Open' AND TenantId = @currentTenant`.
   - "0 users for account X with status Y" → `SELECT COUNT(*) FROM Users WHERE AccountId = @x AND Status = 'Y'`.
   - "User `test@x` exists" → `SELECT TOP 1 Id FROM Users WHERE Email = 'test@x'`.

2. **Decide** based on the count:

   - State already matches → no setup; record `precondition already met` in fixtures.
   - State doesn't match → plan minimal writes to reach the asserted state.

3. **Capture prior state** for every row you intend to modify. Examples:

   - INSERT: capture nothing (the new row's PK is the "prior" reference for revert).
   - UPDATE: `SELECT <all columns we'll change> FROM <table> WHERE <pk>` first, save the rowset.
   - DELETE: `SELECT * FROM <table> WHERE <pk>` first; capture the entire row.

   Store captures in a per-scenario fixture log inside the run's working memory (not on disk — the agent holds it for the scenario's lifetime). On teardown, replay in reverse.

4. **Execute writes.** Constraints enforced:

   - Always `WHERE` with an unambiguous PK or a fixture-tag (see [Cross-cutting safety rules](#cross-cutting-safety-rules)).
   - Never `TRUNCATE`, never `DROP`, never `DELETE FROM <table>` without a `WHERE`.
   - Single statement per write, so the agent can correlate writes with reverts 1:1.
   - Tag inserted rows with a recognizable marker if the schema allows: a `Notes` column with `WF-QA-AUTO TC-NNN <UTC>`, or a known sentinel value in a free-text field. This helps if teardown is ever incomplete — orphans are findable.

5. **Validate setup** — re-run the same query from step 1; confirm the asserted state is now reached.

### Setup recipes by precondition shape

| Shape | Setup |
|---|---|
| `at least N <entity> exists [matching <filter>]` | Count current; if `< N`, INSERT `(N - current)` minimal-valid rows matching `<filter>`. Capture inserted IDs. |
| `exactly N <entity> exists [matching <filter>]` | Count current; if `> N`, soft-delete `(current - N)` matching rows (or hard-delete with capture if no soft-delete column); if `< N`, INSERT to reach N. |
| `0 <entity> [matching <filter>]` | Count current matching; if `> 0`, soft-delete or update to a non-matching state, capturing originals. Prefer `UPDATE` to a non-matching state over `DELETE` — easier to reverse. |
| `<entity> X in state <Y>` | Look up X. If state is already Y, no-op. Else `UPDATE` to Y, capture original state. |
| `<entity> X exists [with <fields>]` | If exists, no-op (verify field values match). If not, INSERT minimal-valid row. Capture for delete. |
| `<entity> X does NOT exist` | If exists, capture full row, then DELETE. Insert restore on teardown. |

### Teardown

Run captures in **reverse order** of setup:

- INSERT → DELETE by captured PK.
- UPDATE → UPDATE back to captured prior column values (set them all in one statement).
- DELETE → INSERT with captured row data.

After each revert, validate by re-querying — confirm the change is gone. Don't trust "no error returned" as success.

### Examples

**Example 1 — TC-016: 0 users for account/status combination**

Precondition: `0 users for account "Acme Corp" with status "Active"`.

Setup:

```sql
-- Discover the account ID
SELECT Id FROM Accounts WHERE Name = 'Acme Corp';
-- → 42

-- Count current matching users
SELECT COUNT(*) AS cnt FROM Users WHERE AccountId = 42 AND Status = 'Active';
-- → 3 (precondition not met)

-- Capture them (will revert later)
SELECT Id, Status FROM Users WHERE AccountId = 42 AND Status = 'Active';
-- → [(101, 'Active'), (102, 'Active'), (103, 'Active')]

-- Move them to a non-matching state
UPDATE Users SET Status = '__QA_PARKED' WHERE Id IN (101, 102, 103);

-- Validate setup
SELECT COUNT(*) FROM Users WHERE AccountId = 42 AND Status = 'Active';
-- → 0 ✓
```

Run scenario.

Teardown:

```sql
-- Reverse the UPDATE using captured originals
UPDATE Users SET Status = 'Active' WHERE Id = 101;
UPDATE Users SET Status = 'Active' WHERE Id = 102;
UPDATE Users SET Status = 'Active' WHERE Id = 103;

-- Validate
SELECT COUNT(*) FROM Users WHERE AccountId = 42 AND Status = '__QA_PARKED';
-- → 0 ✓
```

Fixtures line: `Fixtures: 3 Users.Status updated then reverted (TC-016 setup)`.

**Example 2 — User does not exist (precondition asserts absence)**

Precondition: `0 users with email "qa-test+ephemeral@example.com"`.

Already 0 → no setup. `Fixtures: precondition already met`.

---

## Host preconditions

### Detection patterns

Precondition prose containing `Host required:` followed by a component path (or selector / class name). Emitted by `/wf:qa-gen` at plan-time when a target `*.component.ts` was added on the branch but isn't routed in `code-trakker-routing.module.ts`.

### Setup

Follow the procedure in `wf:qa-host/SKILL.md`. The orchestrator reads that file once per run when the first `Host required:` precondition appears, then handles all subsequent host preconditions inline.

1. **Try `route <component>` first** — cheap, no writes. If it returns a route URL, substitute that URL into any subsequent URL precondition for this scenario and continue.
2. **If `route` says "not scaffolded"**, run `new <component>` — writes the host folder (TS + HTML), edits `code-trakker-routing.module.ts` three places, runs `{verify-command}`. On typecheck failure, mark scenario `BLOCKED · setup: host scaffold failed typecheck` and skip steps; the failed scaffold's files stay so the user can inspect.
3. **Validate** the route is reachable: `navigate_page(<app-base>/<route>)`, `read_page` once, confirm no 404. If the route 404s after scaffolding, the routing edit didn't land — `BLOCKED · setup: route 404 after scaffold` and surface the routing module diff.

### Teardown

No revert. Hosts are persistent test surfaces — git-tracked source, intended to outlive the run. Once scaffolded, they stay until manually cleaned via `/wf:qa-host clean <component>`.

The first scenario that triggered scaffolding pays the cost (writes + typecheck). Subsequent scenarios for the same component see the host already exists and just `route` to it. No teardown needed for any of them.

### Recording in fixtures

When `wf:qa-host` scaffolded a host during setup: `Fixtures: scaffolded host /<kebab>-test (persistent — see /wf:qa-host clean)`. When the host already existed: `Fixtures: routed to existing host /<kebab>-test`. The persistence note is important — readers shouldn't expect this fixture to revert.

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

  May not work in all browser-automation configurations. If the call errors, mark `BLOCKED · viewport change unsupported`.

### What's not

- **Network throttling** — the browser-automation tools do not expose throttling controls. Mark `BLOCKED · network throttling not supported in this runtime`.
- **API down / offline** — same. Mark `BLOCKED`.

If the test is genuinely about offline behavior, that's a category the browser-automation tools can't reach. Don't fake it.

---

## Cross-cutting safety rules

Apply to every setup and teardown:

1. **Production guard.** Before any DB write, parse the `App base URL` from `_local/qa-creds.md`. If it looks production-shaped (no `localhost`, no `dev`, no `staging`, no `qa`, no `test` in the host), refuse: `BLOCKED · refused to seed: app URL "<url>" looks like production`. The user can override with explicit creds pointing at a known dev/staging environment.

2. **Capture before modify.** Every UPDATE and DELETE captures the rows it will touch *before* writing. INSERTs capture the IDs they generate.

3. **Bounded writes.** Every write has a `WHERE` clause that targets specific PKs or a fixture-tag we wrote ourselves. Never:
   - `DELETE FROM <table>` without `WHERE`.
   - `UPDATE <table> SET <col> = <val>` without `WHERE`.
   - `WHERE 1=1` or anything equivalent.
   - `TRUNCATE`, `DROP`, schema DDL.

4. **One concern per scenario.** A scenario's setup touches only the entities the precondition names. If a precondition is "0 users for account X", the setup touches Users — not Accounts, Audits, AuditLogs, etc.

5. **No cascading writes.** If the schema has triggers or cascading deletes, prefer UPDATEs over DELETEs to avoid surprises. If a DELETE is unavoidable, list the foreign keys you'll cascade through first.

6. **Tag inserted rows.** When the schema has a `Notes`, `Description`, or similar free-text column, write `WF-QA-AUTO TC-NNN <UTC>` so orphans are findable.

7. **Validate every revert.** Re-query after each teardown statement to confirm the original state is restored. If validation fails, surface loudly (see next section).

---

## Teardown failure handling

If a teardown statement fails:

1. **Try once more** — re-issue. Transient lock contention is common.
2. If it fails again, **log the failure** to a per-scenario file: `_local/{wi-prefix}-{id}/qa-fixtures/teardown-TC-NNN-failed-<UTC>.sql`. Write the SQL needed to manually complete the revert, including comments describing the captured state.
3. **Continue with remaining teardowns** — one failure shouldn't block the rest.
4. **Mark the report's Notes section loudly:**

   ```
   ⚠ TEARDOWN FAILED for TC-NNN — manual cleanup required.
   See: _local/{wi-prefix}-{id}/qa-fixtures/teardown-TC-NNN-failed-<UTC>.sql
   ```

5. The scenario's verdict (PASS/FAIL/BLOCKED) stands — teardown failure doesn't change what the test observed.

---

## Recording fixtures in the report

Every scenario's verdict block in `07_qa-report.md` gets a `Fixtures:` line. Examples:

- `Fixtures: none` — no setup needed.
- `Fixtures: precondition already met` — checked, no writes required.
- `Fixtures: cleared browser storage; re-authenticated` — storage clear.
- `Fixtures: 3 Users.Status updated then reverted` — data setup with successful revert.
- `Fixtures: 1 User INSERTed (Id=9001), reverted; 1 Audits.Status UPDATEd then reverted` — multiple writes.
- `Fixtures: ⚠ teardown failed — see qa-fixtures/teardown-TC-NNN-failed-<UTC>.sql` — failure to surface.

When ANY fixture line is `⚠ teardown failed`, the report's top-of-file `Status:` is forced to `INCOMPLETE` regardless of scenario verdicts — the test environment isn't in a known state.
