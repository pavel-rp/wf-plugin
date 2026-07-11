---
name: init
description: Initializes the current repository for the wf:* skill suite by creating the _local/ task folder, writing a default _local/config.md, gitignoring _local/, scaffolding the _testkit test runner, and optionally adding project-specific git excludes. Use once per new repository before running /wf:spec — idempotent on subsequent runs.
allowed-tools: [Read, Write, Edit, Glob, Bash]
---

# /wf:init — Bootstrap a repo for the wf:* skill suite

Bootstrap the current repository for the wf:* skill suite. Creates and/or updates:

- `_local/` — task root (per-ticket artifacts)
- `_local/config.md` — project-specific values consumed by every wf:* skill
- `_local/README.md` — short note explaining the folder's purpose
- `_local/_testkit/run.mjs` — Node test runner used by `/wf-node-ts:test-node`
- `.gitignore` — ensures `_local/` is never committed
- `.git/info/exclude` — adds a `_page-tests/` path when a registered capability's test-host root exists in the checkout

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
- Write the `## Capabilities` registry table to a **configured `registryPath`** location when `wf.config.js` sets one (a repo-relative file path that passes the Phase 0 defensive check) — this is the one sanctioned write outside `_local/`, since relocating the registry is the feature's whole purpose
- Read-only resolution via `workspace-root-resolve` (direct provider resolution)

**Forbidden:**

- Modify any source file **except** the writes named in the Allowed list above — i.e. anything other than files under `_local/`, the two exclude files (`.gitignore`, `.git/info/exclude`), and a configured `registryPath` registry location, all of which are explicitly permitted
- Run builds, tests, linters, installs
- Invoke a delivery write operation (`branch-create`, `commit`, `push-upstream`, `pr-create`) — init only ever reads `workspace-root-resolve`, it never writes through the delivery provider

---

## Phase 0: Preconditions

1. **Resolve the workspace root via `workspace-root-resolve`**, reached by the canonical resolve-once procedure — `invocation-runtime.ops.md` §"Direct provider resolution" (one `## Capabilities` read plus one manifest+fragment read for the `delivery` surface; a plugin-anchored `Path` resolves through the self-heal home, `capability-registry.ops.md` §"Recorded-root-first resolution with install-manifest self-heal"). This is the same plain bootstrap read that precedes any provider resolution — the known limitation `agents/branch.md`'s resolution section documents: it can't itself honor a project-configured non-default `registryPath`, and assumes the current directory is the workspace root. init's two outcomes differ from a generic read's silent fallback:
   - **A `delivery` provider resolves** — dispatch its fragment to resolve the workspace root. A **registered** provider that then fails to resolve (no working tree to resolve) is a genuine environment error, distinct from the unconfigured case below — stop: "Could not resolve a workspace root: <provider's error>." Never fall through to the plain-directory fallback in this case.
   - **Zero readable `delivery` rows** — including a registry that doesn't exist yet (the fresh-repo case) — resolves `workspace-root-resolve` as a **plain directory**: the current working directory, with no VCS invocation of any kind, no error, no stop condition.

   All paths below are relative to this resolved workspace root.
2. **Resolve the registry location.** Read `wf.config.js` at the resolved workspace root (if present) and resolve the registry's `## Capabilities` table location from its optional `registryPath` key, **defaulting to `_local/config.md` when the key (or the file) is absent**. Use this resolved location everywhere this skill writes or reads the registry — the Phase 2 table write and the Phase 2.5 seeding iteration below. When `registryPath` is absent the resolved location is `_local/config.md`, so default behaviour is byte-identical to before this key existed. Record the registry-location state for the Final Output — `default` (no key), `configured` (a key that passed the defensive check below), or `rejected → fell back to default` (a key that failed it).

   **Defensive `registryPath` check (fallback).** When `registryPath` is set, before resolving a write location from it confirm it is a **repo-relative, forward-slash file path** with **no** `..` segment and **no** absolute/drive prefix (no leading `/`, no `C:`-style prefix) — the shape the contract requires. If it violates that shape, do **not** resolve or write to it: fall back to the default `_local/config.md`, record the `rejected → fell back to default` state, and flag the rejected value loudly in the chat summary. Registry validation (WF-2's registry pass / WF-28) should reject such a value upstream; this is a defensive fallback so a configured `registryPath` can never make `init` write outside the resolved workspace root that repo-relative path is resolved against, even if that validation has not run — mirroring the Phase 2.5 defensive token check. (A passing `registryPath` may resolve outside `_local/` — that relocated registry write is the sanctioned exception in the Safety Rules above.)

---

## Phase 1: Create `_local/`

- If the directory is missing, create it.
- If it already exists as a directory, continue — do not clobber.
- If `_local` exists as a regular file (not a directory), stop and report the conflict.

---

## Phase 2: Write `_local/config.md`

> The config template below carries the `## Capabilities` registry table. Its destination is the **Phase 0 resolved registry location**, not whether `registryPath` is set. When the resolved location **is** `_local/config.md` (the `default`, the `rejected → fell back to default`, **and** a `configured` value that points back at `_local/config.md`), the table rides inside the config template. When the resolved location is a **different** file, write the `## Capabilities` table at that resolved location instead — the rest of the config template still goes to `_local/config.md`. **Resolved location == `_local/config.md` ⇒ the registry stays there, byte-identical to before.**

> **The two writes skip independently.** The config-template write and the registry-table write are guarded by **separate** skip-if-present checks, each keyed on **its own** resolved destination — so re-running after the registry was pointed elsewhere still creates the registry where it now belongs:
> - **Resolved location == `_local/config.md`** (`default`, `rejected → fell back to default`, or a `configured` value pointing back at it): the table rides inside the config template, so the single `_local/config.md` skip below covers it — byte-identical to before.
> - **Resolved location is a different file** (a `configured` `registryPath` that resolves elsewhere): the registry table is written to that resolved location guarded by its **own** skip-if-present check on **that file** — independent of whether `_local/config.md` exists. If the resolved location is absent (or `--force` is set), write/refresh the `## Capabilities` table there even when `_local/config.md` already exists; if it is already present and `--force` is not set, skip it and report "registry already present at `<resolved location>` — left untouched."

- If `_local/config.md` exists and `--force` is not set, skip the config-template write (this also covers the registry table **only** when the resolved registry location is `_local/config.md`, where it lives inside this file). Report "config.md already present — left untouched." A registry write whose resolved location is a different file is guarded separately, per the note above.
- **One registry, never two.** The `## Capabilities` section in the "Default content" template below belongs to **exactly one** destination — the **Phase 0 resolved registry location**, not whether `registryPath` is set. When the resolved location **is** `_local/config.md` (the `default`, `rejected → fell back to default`, **and** a `configured` value pointing back at `_local/config.md` cases), keep `## Capabilities` inside `_local/config.md`. When the resolved location is a **different** file, **omit the `## Capabilities` section from the `_local/config.md` write entirely** and write that section **only** to the resolved registry file — never emit it in both places, so a user can't edit the wrong copy (runtime reads only the resolved location).
- **Strip the authoring aid.** The `<!-- … -->` HTML comment above the `## Capabilities` table in the template is a build-time directive **for `init` only** — it must **never** reach a written file. Drop it in both branches: write only the `## Capabilities` heading, table, and explanatory prose to the Phase 0 resolved registry location (which is `_local/config.md` itself when the resolved location equals it). Every "write the template" instruction below means the template **minus** this comment.
- Otherwise:
  1. **Infer the Verify Command** from the project's actual config (see "Detecting Verify Command" below). Do not write a hardcoded default — every repo's command differs, and a wrong default (e.g., `tsc --noEmit` on a framework project needing template/metadata checks) misses the very errors the skills exist to catch.
  2. Write the template below, substituting the detected command into the `Verify Command` row. If it falls back to a placeholder, flag it prominently in the chat summary so the user fixes it before running any other skill.

### Default content

```markdown
# Skills Configuration

Project-specific values used by all `wf:*` skills. Skills MUST read this file at startup and substitute these values — never hardcode them.

## Task Folders

| Key | Value |
|-----|-------|
| **Task Root** | `_local` |
| **Folder Pattern** | `{task-root}/T<NNN>/` (e.g. `_local/T001/`) — the tracker contract's empty-registry default (`capability-registry.contract.md` §"The tracker provider surface", "The id-shape rule"). An active tracker capability supplies its own id shape once registered. |

## Build / Verify

| Key | Value |
|-----|-------|
| **Verify Command** | `<detected by wf:init — see note below>` |

Must exit 0 when the project typechecks (including framework-level checks: templates, metadata, decorators) and non-zero on any error. `wf:init` infers this from your project's `package.json` scripts and framework signals — review the value after running and adjust if the detection picked the wrong script or directory. Used by `wf:plan`, `wf:lite`, and `wf:implement` before they hand off a diff.

## QA

| Key | Value |
|-----|-------|
| **QA Baseline Ignore** | `<none>` |
| **QA Rules** | `<none>` |
| **API Base Path** | `/api` |
| **API Controllers Root** | `<auto-detect>` |
| **API Auth Token Source** | `<auto-discover>` |

**QA Baseline Ignore** — optional allowlist for the **Baseline health** suite `/wf:qa-gen` adds to every plan (no console errors, no failed network requests, view renders). One pattern per line or comma-separated; each is a plain substring or `/regex/`. Console messages and request URLs/statuses matching any pattern are treated as known-benign and won't fail a baseline check — e.g. a noisy third-party widget warning, or an analytics beacon that 404s in dev. Leave as `<none>` to tolerate nothing. Consumed by `/wf:qa-gen`, `/wf:qa-auto`, and `/wf:qa-run`.

**QA Rules** — optional path to the project QA-rules artifact written by `/wf:qa-init` (default `_local/wf-qa.md`). When set, the QA report's severity rubric — defined in `qa-gen`'s report-format reference and applied when `07_qa-report.md` is written — resolves from that artifact instead of the built-in default; the artifact also holds the project's risk-area and environment rules. Leave as `<none>` until `/wf:qa-init` has run — an absent or `<none>` value is treated as not set (built-in default). Referenced everywhere as `{qa-rules}`; `/wf:qa-init` sets it and `/wf:qa-gen` reads it.

The three **API** keys are used only by the backend-exercise path (`Type: API` scenarios) — leave the defaults unless your project differs:

- **API Base Path** — prefix the dev proxy forwards to the API, joined to the app base URL when a scenario route omits it. Default `/api`.
- **API Controllers Root** — directory (relative to repo root) that contains the project's API controller source, used by `/wf-angular:qa-host api-probe` to find a host controller. `<auto-detect>` globs the project's controller-source pattern (skipping compiled-output directories).
- **API Auth Token Source** — where the app keeps the bearer the runner reuses. `<auto-discover>` scans `localStorage`/`sessionStorage` for a JWT-shaped value; override with an exact storage key (e.g. `localStorage:access_token`) if discovery picks wrong, or `cookie` for httpOnly-cookie auth.

## Database

| Key | Value |
|-----|-------|
| **Database Name** | `<DATABASE_NAME: the project's database name>` |
| **Migration Path** | `<MIGRATION_PATH: repo-relative folder holding SQL migration scripts, forward slashes>` |
| **Migration Pattern** | `<MIGRATION_PATTERN: filename glob for migration scripts>` |
| **History Table** | `<HISTORY_TABLE: schema-qualified migration history table>` |

## Seed

| Key | Value |
|-----|-------|
| **Architecture Doc** | `<ARCHITECTURE_DOC: repo-relative path (forward slashes) to the default architecture/design doc /wf:seed parses when called with no argument>` |
| **Backlog Path** | `{task-root}/BACKLOG.md` |

The two keys `/wf:seed` reads. **Architecture Doc** is the doc parsed on a zero-argument `/wf:seed` — leave the placeholder until you have an architecture/design doc to seed action items from (or always pass the doc explicitly: `/wf:seed <doc>`). **Backlog Path** is where the append-only backlog is written; the `{task-root}/BACKLOG.md` default suits most projects. A repo initialized before this section existed simply has no `## Seed` keys — `/wf:seed` degrades gracefully (the explicit-doc form still works, and Backlog Path falls back to the same default).

## Standup

| Key | Value |
|-----|-------|
| **Standup Statuses** | `<none>` |

The default tracker workflow statuses `/wf:standup` enumerates open work items for, comma-separated in significance order (most active first — e.g. the in-progress status before the not-started one). Status names are tracker-specific, so this ships as `<none>`: leave it until you know your tracker's status names, then set them (or always pass `--status` explicitly). When `<none>` or absent, `/wf:standup` skips only the by-status work-item section and still renders milestones, cycles, recent activity, and local in-flight tasks. A repo initialized before this section existed simply has no `## Standup` key — `/wf:standup` degrades gracefully the same way.

## Capabilities

<!-- init directive (strip before writing — never emit this comment to any file):
     This `## Capabilities` section goes to the Phase 0 RESOLVED registry location only.
     Resolved location == `_local/config.md` → keep this section here. Resolved location is a
     different file → write this section only to that file, NOT here. See Phase 2 "One registry, never two". -->

| Capability | Path                   |
|------------|------------------------|

The capability registry (see `plugins/wf/skills/_contracts/capability-registry.contract.md`). Each row activates one capability: `Capability` is its name (its identity, decoupled from where it lives) and `Path` is where its `manifest.md` lives, in one of two accepted shapes (forward slashes in both): (a) a **repo-relative folder** (e.g. `plugins/wf-audit/capabilities/audit`), or (b) a **plugin-anchored token** `plugin:<plugin-name>/<rel-path>` naming a capability inside an installed plugin — resolved via the **`## Plugin Roots`** mapping co-located with this table (see the contract's "The two `Path` shapes" and "The `## Plugin Roots` mapping"; run the pack's own self-registering `/init`, e.g. `/wf-git:init`, to populate both). **An empty (header-only) table = fully generic core** — no capability fires and every capability-aware phase runs inert. **One row per active capability.** **Table order = injection order** (general → specific): for additive guidance the most-specific capability is injected last and wins; for provenance-tagged contributions order is cosmetic. Add a row to register a capability (e.g. `audit | plugins/wf-audit/capabilities/audit`).
```

After writing, tell the user to review `_local/config.md` — especially the detected `Verify Command` — and edit values for the current project if they differ from the defaults. The keys must not change — only the values.

### Detecting Verify Command

The goal is a single shell command that exits 0 when the whole project typechecks. Detect in this order — stop at the first rule that produces a concrete command:

1. **Find project roots.** `Glob` for `**/package.json` plus any framework project manifests (skip `node_modules/`, `.git/`, `dist/`, `bin/`, `obj/`). Record each containing directory, relative to repo root.

2. **Prefer explicit scripts.** For each `package.json`, parse `scripts` and look for a verification-ish script in this priority: `typecheck` > `check` > `verify` > `build:check` > `lint:types`. First hit wins:
   ```
   (cd <dir> && npm run <script>)       # drop the cd wrapper if <dir> is the repo root
   ```

3. **Framework AoT build.** If no script matched but the candidate dir's `package.json` lists a framework CLI under `devDependencies` whose canonical verification is an ahead-of-time / production build, use that CLI's AoT/production build — it's the canonical way to catch template, metadata, and TS errors together. Derive the exact command from the detected CLI at runtime (its AoT/production build invocation, e.g. a development-configuration build with output hashing disabled):
   ```
   (cd <dir> && <framework CLI's AoT/production build command>)
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

6. **Multi-candidate tie-break.** If multiple dirs produce different commands, pick in this order: any framework-build one > any with an explicit typecheck/check script > the shallowest dir. List the others in the chat summary so the user can override.

7. **Nothing found.** Write:
   ```
   TODO: replace with the command that typechecks this project (must exit non-zero on any type or template error)
   ```
   and flag it loudly in the chat summary. Do not silently substitute a generic guess — a skill running a bogus verify is worse than one that stops with a clear error.

Record the chosen rule (and the rejected candidates, if any) in the chat summary so the user can see the reasoning without reading config.md.

> **Registry location is configurable.** The `## Capabilities` table location is resolved in Phase 0 from `wf.config.js`'s optional `registryPath` key, defaulting to `_local/config.md`. To point the registry elsewhere, set `registryPath` (forward-slash, repo-relative) in `wf.config.js` — leaving it unset keeps the registry in `_local/config.md` exactly as before.

---

## Phase 2.5: Seed capability profiles

After the `## Capabilities` registry table exists (Phase 2) and before the constitution is established (Phase 7), execute the **profile-seeding convention** defined in `plugins/wf/skills/_contracts/capability-registry.contract.md` (§"The profile-seeding convention"). Do **not** re-derive its rules here — follow the convention **by name**; this phase only invokes it for every registered capability.

> **Resolving a registry row's manifest path (used by this phase and Phase 6).** A row's `Path` is one of two shapes (`plugins/wf/skills/_contracts/capability-registry.contract.md` §"The two `Path` shapes"), **both resolved**: a **repo-relative** `Path` → `<repo-root>/<Path>/manifest.md`; a **plugin-anchored** `plugin:<name>/<rel-path>` → look `<name>` up in the **`## Plugin Roots`** mapping (co-located with the `## Capabilities` registry at the Phase 0 resolved location), then read `<root>/<rel-path>/manifest.md` (an absolute `Root` as-is; a repo-relative `Root` joined to the repo root). If a `plugin:` row's `<name>` has **no `## Plugin Roots` entry**, it is **unmapped** — **no-op that row** (skip; record `skipped — unmapped plugin root`), mirroring the runtime's fail-safe. This resolution names **no** concrete plugin or capability — it reads the generic `<plugin-name>→root` table.

Iterate the registry rows at the Phase 0 resolved location and, for each row, apply the convention:

1. **Read the registry rows.** Open the `## Capabilities` table at the resolved registry location and read its rows in order. Each row carries a `Capability` name and a `Path`.
   - **Empty (header-only) or absent table ⇒ seed nothing** — no destination is created. This is the inert no-op; report "none" in the Final Output. (Matches the contract's no-op-when-absent rule.)

2. **Per row, read the manifest.** Read the row's manifest resolved per "Resolving a registry row's manifest path" above (repo-relative or plugin-anchored via `## Plugin Roots`; an **unmapped** `plugin:` row no-ops → record `skipped — unmapped plugin root`). If the manifest does **not** declare a `profile-template:` field, **no-op** for this capability (skip — no destination, no placeholder) and record `skipped — no template`.

3. **Per declaring capability, derive the deterministic destination.** When the manifest declares `profile-template:`, derive the destination **keyed on the registry `Capability` column** (its stable identity — never the `Path`):

   ```
   _local/profiles/<Capability>.profile.json
   ```

   The `<Capability>` value is used verbatim as the filename stem; the convention requires it to be a filesystem-safe token (lowercase letters, digits, hyphens — no separators or `..`), which registry validation enforces before this phase runs.

   **Defensive token check (fallback).** Before deriving the destination, confirm `<Capability>` is a filesystem-safe token — lowercase letters, digits, and hyphens only, with **no** path separator (`/` or `\`), **no** `..` segment, and **no** whitespace. If it is not, **skip this row** (write nothing, derive no path) and record `skipped — unsafe capability name`. Registry validation (WF-2's registry pass / WF-28) should reject such a name upstream; this check is a defensive fallback so the path can never traverse outside `_local/profiles/` even if that validation has not run. Create `_local/profiles/` on demand.

4. **Seed an override only on divergence; never overwrite.** The capability ships its `profile-template:` as the **authoritative default template** — the baseline shape (which may carry angle-bracketed placeholder slots) a project overrides; seed a downstream **override** at the destination **only when the project's values diverge** from that template. Precedence is **downstream override > capability default**. State that hybrid precedence in the seeded file, and use the convention's angle-bracketed placeholder syntax for every divergent (unfilled) slot. **Idempotent — if the destination already exists, leave it untouched** (skip-if-present; never clobber a partially- or fully-filled override). Record `seeded override` when written, or `default in use` when no override was needed.

5. **Model attribution.** Every seeded file carries the model-attribution convention **where its data format provides a place for it** — include a `**Model:** <current model id>` line for a prose/markdown profile, or, for a comment-forbidding format like JSON, an angle-bracketed model token in a **schema-permitted** note slot, per the convention's placeholder rule. **A JSON schema that forbids extra fields (`additionalProperties: false`) and defines no dedicated metadata/note slot for attribution has no place to carry it** — do **not** add a non-schema field (that would make the seeded file fail its own validator). In that case **omit** the in-file attribution and instead record the seeding model on the Phase 2.5 outcome line (the Final Output "Capability profiles" row), so attribution is preserved without breaking schema conformance. (`init` is project-level and has no task context, so there is no per-task `index.md` to record it in.) (The migration profile's schema is `additionalProperties: false` with no metadata slot, so its seed omits the in-file token.)

**Domain-free guard:** this phase names **no** concrete capability — capability names appear only as the path-deriving `Capability` value read from the registry. Core iterates and derives; it never tests for or hardcodes a specific capability.

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

- `T<NNN>/` — task folders (requirements, spec, plan, research, artifacts)
- `_testkit/` — Node test runner for `/wf-node-ts:test-node`
- `config.md` — project-specific values consumed by every wf:* skill

Safe to nuke if you want a clean slate. Nothing here is version-controlled.
```

---

## Phase 6: Append the page-test exclude (conditional)

A capability may ship a page-test harness that writes its `_page-tests/` files under a
project-specific **test-host root**. That root comes from the capability's profile
(`test-host-root`), not from core. This phase derives the exclude **generically from the
`## Capabilities` registry + capability profiles** — it **keys on the presence of the
`test-host-root` profile field, never on any capability name.** Model the loop shape and
the no-name discipline on Phase 2.5 above and `verify-spec`'s registry iteration.

1. **Read the `## Capabilities` registry** at the Phase 0 resolved location and iterate its
   rows **in order**. **Empty (header-only) or absent table ⇒ skip silently** (the inert
   no-op — nothing is appended).
2. **Per row, read the manifest** resolved per Phase 2.5's "Resolving a registry row's
   manifest path" note (repo-relative or plugin-anchored via `## Plugin Roots`; an
   **unmapped** `plugin:` row is skipped) and **resolve that capability's profile** via the
   profile-seeding convention defined in
   `plugins/wf/skills/_contracts/capability-registry.contract.md` — override
   `_local/profiles/<Capability>.profile.json` > the capability's default template — keyed
   on the registry `Capability` column. Do **not** re-derive the convention here; follow it
   by name.
3. **For any capability whose resolved profile declares a `test-host-root`**, resolve
   `{test-host-root}` and check whether the conventional sandbox module-test folder under it
   exists in the checkout. (A capability whose profile declares no `test-host-root`
   contributes nothing here — skip it.)
4. **If the folder exists**, ensure `.git/info/exclude` contains a line matching that
   capability's `_page-tests/` path under `{test-host-root}` (the capability's page-test
   skill defines the exact sandbox folder). Append only if missing — idempotent,
   skip-if-present, append-only, so a clean re-run produces no diff.
5. **If no registered capability declares a `test-host-root`, or the folder is absent, skip
   silently** — this isn't a checkout of that project. The capability's page-test skill
   bootstraps the same entry on its own first run anyway.

**Domain-free guard:** this phase names **no** concrete capability. It iterates the registry
and keys the exclude on the *presence of the `test-host-root` profile field*, so onboarding a
different stack's test-host needs no core edit.

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

- **Registered delivery provider fails to resolve a workspace root:** Stop in Phase 0 with the provider's error. Never fall back to the plain-directory resolution in this case — that fallback is only for the unconfigured (no delivery provider registered) case.
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

Registry: <resolved registry location> (<default | configured | rejected → fell back to default>)
Capability profiles:
- <capability-name> — <seeded override [seeded by <model id>] | default in use | skipped — no template | skipped — unsafe capability name | skipped — unmapped plugin root>
  (repeat one line per registered capability; "none" when the registry is empty. Append `seeded by <model id>` **only** to a `seeded override` row whose profile format has no schema-permitted attribution slot — see Phase 2.5 step 5; every other outcome carries no separate seeding-model stamp (a seeded markdown/prose profile records its model in its own in-file `**Model:**` line).)

Verify Command: <detected command>
  Rule: <which detection rule matched — e.g. "rule 2: typecheck script in web/package.json">
  Rejected candidates: <list any other project roots that could have been picked, or "none">

Next: review `_local/config.md` — confirm the Verify Command matches what you actually run to typecheck the project. Then `/wf:spec <task-id>`.
  Need a tracker? Install and run the active tracker capability's own init for tracker-specific config (see the capability pack's own docs for the exact command).
```

If detection fell back to rule 7 (TODO placeholder), replace the `Verify Command` line with:
```
Verify Command: ⚠ NOT DETECTED — edit _local/config.md before running any other wf:* skill
  Scanned: <list of package.json / framework-manifest paths found, or "none">
```

**The final output block must always be the very last thing output to chat.**
