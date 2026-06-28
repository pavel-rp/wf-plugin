---
name: init
description: Initializes the current repository for the wf:* skill suite by creating the _local/ task folder, writing a default _local/config.md, gitignoring _local/, scaffolding the _testkit test runner, and optionally adding project-specific git excludes. Use once per new repository before running /wf:spec — idempotent on subsequent runs.
allowed-tools: [Read, Write, Edit, Glob, Bash]
---

# /wf:init — Bootstrap a repo for the wf:* skill suite

Bootstrap the current git repository for the wf:* skill suite. Creates and/or updates:

- `_local/` — task root (per-ticket artifacts)
- `_local/config.md` — project-specific values consumed by every wf:* skill
- `_local/README.md` — short note explaining the folder's purpose
- `_local/_testkit/run.mjs` — Node test runner used by `/wf:test-node`
- `.gitignore` — ensures `_local/` is never committed
- `.git/info/exclude` — adds the Compliance-Risk `_page-tests/` path if that path exists in the checkout

> Plugin agents (the `*.md` companions in the plugin's `agents/` folder) are auto-discovered by Claude Code once the `wf` plugin is installed — no per-machine setup is needed, and nested subagent delegation (e.g. `wf:branch`→`wf:index`) works out of the box.

Idempotent. Re-running against an already-initialized repo produces no diff unless `--force` is passed.

---

## Command Syntax

```
/wf:init [--force]
```

### Arguments

| Argument  | Required | Description                                                        |
| --------- | -------- | ------------------------------------------------------------------ |
| `--force` | NO       | Overwrite `_local/config.md` and `_local/README.md` if they exist. |

---

## Safety Rules (NON-NEGOTIABLE)

**Allowed:**

- Read/write files under `_local/`
- Append (not rewrite) `.gitignore`
- Append (not rewrite) `.git/info/exclude`
- Read-only git commands (`git rev-parse`, `git remote get-url`)

**Forbidden:**

- Modify any source file outside `_local/` and the two exclude files above
- Run builds, tests, linters, installs
- Any destructive git operation
- Initialize a git repo — if none exists, stop and ask the user

---

## Phase 0: Preconditions

1. Confirm the current directory is a git working tree: `git rev-parse --git-dir`.
   - If not, stop: "wf:init must run inside a git repository. Run `git init` first, then rerun."
2. Record the repo root: `git rev-parse --show-toplevel`. All paths below are relative to it.

---

## Phase 1: Create `_local/`

- If the directory is missing, create it.
- If it already exists as a directory, continue — do not clobber.
- If `_local` exists as a regular file (not a directory), stop and report the conflict.

---

## Phase 2: Write `_local/config.md`

- If `_local/config.md` exists and `--force` is not set, skip. Report "config.md already present — left untouched."
- Otherwise:
  1. **Ask for the Azure DevOps Organization.** Prompt the user for their ADO org slug — the `<org>` segment in `dev.azure.com/<org>`. There is no sensible default, so don't invent one. If the user can't supply it yet, write `<your-ado-org>` into the **ADO Organization** row and flag it in the chat summary so they fix it before `/wf:spec`.
  2. **Infer the Verify Command** from the project's actual config (see "Detecting Verify Command" below). Do not write a hardcoded default — every repo's command differs, and a wrong default (e.g., `tsc --noEmit` on an Angular project) misses the very errors the skills exist to catch.
  3. Write the template below, substituting the org into the `ADO Organization` row and the detected command into the `Verify Command` row. If either falls back to a placeholder, flag it prominently in the chat summary so the user fixes it before running any other skill.

### Default content

```markdown
# Skills Configuration

Project-specific values used by all `wf:*` skills. Skills MUST read this file at startup and substitute these values — never hardcode them.

## Azure DevOps

| Key | Value |
|-----|-------|
| **ADO Project** | `Compliance Risk` |
| **ADO Organization** | `<asked by wf:init — see Phase 2>` |
| **Work Item ID Prefix** | `ADO` |

## Task Folders

| Key | Value |
|-----|-------|
| **Task Root** | `_local` |
| **Folder Pattern** | `{task-root}/{prefix}-{id}/` (e.g. `_local/ADO-6396/`) |

## Build / Verify

| Key | Value |
|-----|-------|
| **Verify Command** | `<detected by wf:init — see note below>` |

Must exit 0 when the project typechecks (including framework-level checks: Angular templates, metadata, decorators) and non-zero on any error. `wf:init` infers this from your project's `package.json` scripts and framework signals — review the value after running and adjust if the detection picked the wrong script or directory. Used by `wf:plan`, `wf:lite`, `wf:implement`, and `wf:test-page` before they hand off a diff.

## QA

| Key | Value |
|-----|-------|
| **QA Baseline Ignore** | `<none>` |
| **API Base Path** | `/api` |
| **API Controllers Root** | `<auto-detect>` |
| **API Auth Token Source** | `<auto-discover>` |

**QA Baseline Ignore** — optional allowlist for the **Baseline health** suite `/wf:qa-gen` adds to every plan (no console errors, no failed network requests, view renders). One pattern per line or comma-separated; each is a plain substring or `/regex/`. Console messages and request URLs/statuses matching any pattern are treated as known-benign and won't fail a baseline check — e.g. a noisy third-party widget warning, or an analytics beacon that 404s in dev. Leave as `<none>` to tolerate nothing. Consumed by `/wf:qa-gen`, `/wf:qa-auto`, and `/wf:qa-run`.

The three **API** keys are used only by the backend-exercise path (`Type: API` scenarios) — leave the defaults unless your project differs:

- **API Base Path** — prefix the dev proxy forwards to the API, joined to the app base URL when a scenario route omits it. Default `/api`.
- **API Controllers Root** — directory (relative to repo root) where ASP.NET `*Controller.cs` files live, used by `/wf:qa-host api-probe` to find a host controller. `<auto-detect>` globs `**/*Controller.cs` (skipping `bin/`/`obj/`).
- **API Auth Token Source** — where the app keeps the bearer the runner reuses. `<auto-discover>` scans `localStorage`/`sessionStorage` for a JWT-shaped value; override with an exact storage key (e.g. `localStorage:access_token`) if discovery picks wrong, or `cookie` for httpOnly-cookie auth.

## Database

| Key | Value |
|-----|-------|
| **Database Name** | `ComplianceRisk` |
| **Migration Path** | `ComplianceRisk.Sql/Sequence/` |
| **Migration Pattern** | `ComplianceRisk####-##.sql` |
| **History Table** | `dbo.scripthistory` |

## Capabilities

| Capability | Path                   |
|------------|------------------------|

The capability registry (see `plugins/wf/skills/_contracts/capability-registry.contract.md`). Each row activates one capability: `Capability` is its name (its identity, decoupled from where it lives) and `Path` is where its `manifest.md` lives, in one of two accepted shapes (forward slashes in both): (a) a **repo-relative folder** (the form to use **today** — the only one resolved at runtime), or (b) a **plugin-anchored token** `plugin:<plugin-name>/<rel-path>` naming a capability inside an installed plugin — **forward-looking, with runtime resolution deferred to a follow-up** (recognized vocabulary, not yet resolved; see the contract's "The two `Path` shapes"). **An empty (header-only) table = fully generic core** — no capability fires and every capability-aware phase runs inert. **One row per active capability.** **Table order = injection order** (general → specific): for additive guidance the most-specific capability is injected last and wins; for provenance-tagged contributions order is cosmetic. Add a row to register a capability (e.g. `migration | plugins/wf-caps/capabilities/migration`).
```

After writing, tell the user to review `_local/config.md` — especially the detected `Verify Command` — and edit values for the current project if they differ from the defaults. The keys must not change — only the values.

### Detecting Verify Command

The goal is a single shell command that exits 0 when the whole project typechecks. Detect in this order — stop at the first rule that produces a concrete command:

1. **Find project roots.** `Glob` for `**/package.json` and `**/angular.json` (skip `node_modules/`, `.git/`, `dist/`, `bin/`, `obj/`). Record each containing directory, relative to repo root.

2. **Prefer explicit scripts.** For each `package.json`, parse `scripts` and look for a verification-ish script in this priority: `typecheck` > `check` > `verify` > `build:check` > `lint:types`. First hit wins:
   ```
   (cd <dir> && npm run <script>)       # drop the cd wrapper if <dir> is the repo root
   ```

3. **Angular project.** If no script matched but the candidate dir has `angular.json`, OR its `package.json` lists `@angular/cli` under `devDependencies`, use the AoT dev build — it's the canonical way to catch template, metadata, and TS errors together:
   ```
   (cd <dir> && npx ng build --configuration=development --output-hashing=none)
   ```

4. **Generic `build` script.** If a `build` script exists in `package.json`, use it as a last resort — it almost always includes typechecking as a side effect:
   ```
   (cd <dir> && npm run build)
   ```

5. **Plain TypeScript.** If the dir has `tsconfig.json` but nothing better matched:
   ```
   (cd <dir> && npx tsc --noEmit)
   ```
   Warn in the chat summary that this catches only plain-TS errors; it's fine for pure-TS libraries, not for framework projects.

6. **Multi-candidate tie-break.** If multiple dirs produce different commands, pick in this order: any Angular one > any with an explicit typecheck/check script > the shallowest dir. List the others in the chat summary so the user can override.

7. **Nothing found.** Write:
   ```
   TODO: replace with the command that typechecks this project (must exit non-zero on any type or template error)
   ```
   and flag it loudly in the chat summary. Do not silently substitute a generic guess — a skill running a bogus verify is worse than one that stops with a clear error.

Record the chosen rule (and the rejected candidates, if any) in the chat summary so the user can see the reasoning without reading config.md.

---

## Phase 3: Ensure `_local/` is gitignored

1. If `.gitignore` doesn't exist at the repo root, create it with a single line: `_local/`.
2. If it exists, check for a line matching either `_local` or `_local/` (with or without trailing slash, exact match on its own line).
3. If absent, append `_local/` on a new line. Leave existing entries alone.
4. Never rewrite, reorder, or deduplicate existing `.gitignore` entries.

---

## Phase 4: Scaffold `_local/_testkit/run.mjs`

If the file already exists, skip (regardless of `--force` — the runner is stable and tests may depend on its behavior). Otherwise:

Create `_local/_testkit/` and write `run.mjs` — a dependency-free Node script that:

- Recursively discovers `*.test.ts` under `_local/` (skip `node_modules`, `.git`).
- Accepts an optional path argument (file or directory; resolve relative to repo root).
- Spawns `node --test --test-reporter=spec --no-warnings=MODULE_TYPELESS_PACKAGE_JSON <files...>` with `cwd: repoRoot`, stdio inherited.
- Exits with the child's exit code.

Constraints:

- Only `node:*` imports — no npm packages.
- Do NOT create a `package.json` under `_local/` — it forces a module-type decision Node doesn't need for type-stripped TS under `node --test`.
- Require Node 23.6+ (type stripping is stable from that version). If `node --version` reports an older runtime, warn the user but still write the file.

---

## Phase 5: Write `_local/README.md`

If the file already exists and `--force` is not set, skip. Otherwise write:

```markdown
# _local/

Per-task artifacts managed by the wf:* skill suite. Everything here is gitignored.

- `ADO-<id>/` — task folders (requirements, spec, plan, research, artifacts)
- `_testkit/` — Node test runner for `/wf:test-node`
- `config.md` — project-specific values consumed by every wf:* skill

Safe to nuke if you want a clean slate. Nothing here is version-controlled.
```

---

## Phase 6: Append the page-test exclude (conditional)

The `/wf:test-page` skill writes into `AuditTrakker.Web/src/app/code-trakker/code-trakker-module-test/_page-tests/`. That path is Compliance-Risk-specific.

1. Check whether `AuditTrakker.Web/src/app/code-trakker/code-trakker-module-test/` exists in the repo.
2. If yes, ensure `.git/info/exclude` contains a line matching `AuditTrakker.Web/src/app/code-trakker/code-trakker-module-test/_page-tests/`. Append only if missing.
3. If no, skip silently — this isn't a Compliance Risk checkout. The `/wf:test-page` skill bootstraps the same entry on its own first run anyway.

---

## Phase 7: Establish the constitution

After `_local/config.md` exists (Phase 2) and the registry table is in place,
**unconditionally** invoke `/wf:constitution` with no arguments so a fresh repo gets a
constitution record — the same slash-invocation `plan`/`spec`/`lite` use for `/wf:classify`.
`init` carries **no existence check of its own**: the skill's **establish-or-update default**
handles both cases — it establishes when `_local/constitution.md` is absent (writing a
core-only constitution when the `## Capabilities` registry is empty, the inert path) and
updates idempotently when the file already exists (an unchanged project produces no diff, so
re-running `init` is safe). If invocation is unavailable, skip with a one-line note in the
chat summary telling the user to run `/wf:constitution` manually — never STOP `init` on it.

---

## Edge Cases

- **Not a git repository:** Stop in Phase 0 with the init instruction. Never run `git init` automatically.
- **`_local/` is a regular file, not a directory:** Stop and report the conflict. Do not delete.
- **`.gitignore` or `.git/info/exclude` is read-only:** Stop and report. Don't attempt to chmod.
- **`--force` passed but nothing needs rewriting:** Continue; produce no diff on clean runs.
- **Repo appears already initialized by an older version of this skill:** Fill in any missing pieces idempotently; leave existing files alone unless `--force`.
- **Config values don't match the current repo:** Don't guess. Write defaults and tell the user to edit.

---

## Final Output

```
INIT — <initialized | already-initialized | partial>

Repo: <repo root path>
Actions:
- _local/ — <created | kept>
- _local/config.md — <created | kept | overwritten>
- _local/README.md — <created | kept | overwritten>
- _local/_testkit/run.mjs — <created | kept>
- _local/constitution.md — <established | updated | unchanged | skipped — run /wf:constitution>
- .gitignore entry for _local/ — <appended | already present>
- .git/info/exclude entry for _page-tests/ — <appended | already present | skipped>

Verify Command: <detected command>
  Rule: <which detection rule matched — e.g. "rule 2: typecheck script in AuditTrakker.Web/package.json">
  Rejected candidates: <list any other project roots that could have been picked, or "none">

Next: review `_local/config.md` — confirm the Verify Command matches what you actually run to typecheck the project. Then `/wf:spec <ado-id>`.
```

If detection fell back to rule 7 (TODO placeholder), replace the `Verify Command` line with:
```
Verify Command: ⚠ NOT DETECTED — edit _local/config.md before running any other wf:* skill
  Scanned: <list of package.json / angular.json paths found, or "none">
```

**The final output block must always be the very last thing output to chat.**
