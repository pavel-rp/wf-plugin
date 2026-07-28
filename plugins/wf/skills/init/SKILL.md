---
name: init
description: Initializes the current repository for the wf:* skill suite by creating the _local/ task folder, writing a default _local/config.md, gitignoring _local/, scaffolding the _testkit test runner, and optionally adding project-specific git excludes. Use once per new repository before running /wf:spec — idempotent on subsequent runs.
allowed-tools: [Read, Write, Edit, Glob, Bash, ToolSearch]
---

# /wf:init — Bootstrap a repo for the wf:* skill suite

Bootstrap the current repository for the wf:* skill suite. Creates and/or updates:

- `_local/` — task root (per-ticket artifacts)
- `_local/config.md` — project-specific values consumed by every wf:* skill
- `_local/README.md` — short note explaining the folder's purpose
- `_local/_testkit/run.mjs` — Node test runner used by a registered unit-test-authoring capability
- `.gitignore` — ensures `_local/` is never committed
- `.git/info/exclude` — adds a `_page-tests/` path when a registered capability's test-host root exists in the checkout

> Plugin agents (the `*.md` companions in the plugin's `agents/` folder) are auto-discovered by Claude Code once the `wf` plugin is installed — no per-machine setup is needed, and nested subagent delegation (e.g. `wf:run`→`wf:phase-runner`) works out of the box.

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
- Read-only resolution via the bundled `wf-resolver` MCP service (`resolve_config({ workspaceRoot: resolverWorkspaceRoot, ... })`, `resolve_registry({ workspaceRoot: resolverWorkspaceRoot, ... })`, `resolve_profile({ workspaceRoot: resolverWorkspaceRoot, ... })`), plus one explicit `resolve_refresh({ workspaceRoot: resolverWorkspaceRoot, ... })` call after Phase 2/2.5 write the config, registry, and profile seeds — never any other resolver write

**Forbidden:**

- Modify any source file **except** the writes named in the Allowed list above — i.e. anything other than files under `_local/`, the two exclude files (`.gitignore`, `.git/info/exclude`), and a configured `registryPath` registry location, all of which are explicitly permitted
- Run builds, tests, linters, installs
- Invoke a delivery write operation (`branch-create`, `commit`, `push-upstream`, `pr-create`) — init obtains the workspace root as a resolved fact from `resolve_config({ workspaceRoot: resolverWorkspaceRoot, ... })` (Phase 0), never by dispatching the delivery provider directly, and it never writes through the delivery provider
- Probe `${CLAUDE_PLUGIN_ROOT}` or otherwise derive a plugin's install root, a capability's manifest path, or a profile's override-merged values by hand — `resolve_config({ workspaceRoot: resolverWorkspaceRoot, ... })`/`resolve_registry({ workspaceRoot: resolverWorkspaceRoot, ... })`/`resolve_profile({ workspaceRoot: resolverWorkspaceRoot, ... })` already resolve them; if a fact is needed, call the tool with `workspaceRoot: resolverWorkspaceRoot` and its other required arguments
- Call `register_pack({ workspaceRoot: resolverWorkspaceRoot, ... })` — that call registers one pack's own capability under a stable plugin id; `init` establishes the substrate those calls attach to, not a capability of its own

---

## Phase 0: Preconditions

1. **Derive `resolverWorkspaceRoot`** by running `pwd -P` in this Agent/session; use its absolute current workspace directory for `workspaceRoot` in **every** bundled resolver MCP call in this run. If this Agent is in a linked worktree, derive that worktree's own root; never reuse a parent Agent's root. Omitting `workspaceRoot` is a hard schema error — resolver MCP calls have no default or fallback root.

2. **Call `resolve_config({ workspaceRoot: resolverWorkspaceRoot })`** on the bundled `wf-resolver` MCP service. It returns `{ workspaceRoot, registryPath, coreConfig{ taskRoot, … }, idShape }` in one typed query — the resolver's `R1` operation. It never depends on `_local/config.md` already existing: on a fresh repo `coreConfig`'s fields simply come back unset, which is exactly the state Phase 2 below fills in. `init` performs **no** direct `wf.config.js` parse, no `${CLAUDE_PLUGIN_ROOT}` probe, and no manual `## Capabilities`/manifest/fragment read to derive either fact — the resolver already did that work, the same way `plan`/`tasks`/`run` obtain it.

   - **`workspaceRoot`** is the resolver's already-normalized `workspace-root-resolve` fact — a plain-directory value when no delivery provider is registered, since the resolver never dispatches a provider to compute it (it is a fixed, environment-supplied input to every snapshot, not derived per query). All paths below are relative to it.
   - **If the `wf-resolver` service is unavailable** (the tool call errors, or the MCP server isn't loaded), **stop**: "The `wf-resolver` service is not available — restart Claude Code so the bundled resolver MCP server loads." Never fall back to hand-parsing `wf.config.js` or the registry as a substitute (WF-272 diagnostics/recovery) — a broken resolver is a stop condition here, not a silent fallback.

3. **Resolve the registry location from the returned `registryPath`.** Use this resolved location everywhere this skill writes or reads the registry — the Phase 2 table write and the Phase 2.5 seeding iteration below. When no `registryPath` override is configured, the resolver's own default is `_local/config.md`, so default behaviour is byte-identical to before this key existed. Record the registry-location state for the Final Output — `default` (no key), `configured` (a key that passed the defensive check below), or `rejected → fell back to default` (a key that failed it).

   **Defensive `registryPath` check (fallback).** The resolver extracts the raw `registryPath` string from `wf.config.js` but does not itself enforce its shape. Before resolving a write location from a non-default `registryPath`, confirm it is a **repo-relative, forward-slash file path** with **no** `..` segment and **no** absolute/drive prefix (no leading `/`, no `C:`-style prefix) — the shape the contract requires. Then canonicalize the target if it exists, or its nearest existing ancestor if it does not, and require that canonical path to remain under the canonical `resolverWorkspaceRoot`; this catches a repo-relative path that escapes through a symlink. If either check fails, do **not** resolve or write to it: fall back to the default `_local/config.md`, record the `rejected → fell back to default` state, and flag the rejected value loudly in the chat summary. Registry validation (WF-2's registry pass / WF-28) should reject a bad lexical shape upstream; these checks are the defensive fallback that prevents a configured `registryPath` from making `init` write outside the resolved workspace root even when validation has not run — mirroring the Phase 2.5 defensive token check. (A passing `registryPath` may resolve outside `_local/` but remains inside the workspace — that relocated registry write is the sanctioned exception in the Safety Rules above.)

---

## Phase 1: Create `_local/`

- If the directory is missing, create it.
- If it already exists as a directory, canonicalize it and require that it remains under canonical `resolverWorkspaceRoot`; if `_local` is a symlink to a directory outside the workspace, stop before any write and report the escape.
- If `_local` exists as a regular file (not a directory), stop and report the conflict.

---

## Phase 2: Write `_local/config.md`

> The config template below carries the `## Capabilities` registry table. Its destination is the **Phase 0 resolved registry location** (§Phase 0 step 3), not whether `registryPath` is set. Two named cases, reused below: the **same-file case** — resolved location **is** `_local/config.md` (the `default`, `rejected → fell back to default`, and a `configured` value that points back at `_local/config.md`) — where the table rides inside the config template; and the **relocated case** — resolved location is a **different** file — where the `## Capabilities` table is written there instead, and the rest of the config template still goes to `_local/config.md`. **Same-file case ⇒ the registry stays there, byte-identical to before.**

> **The two writes skip independently**, each guarded by its **own** skip-if-present check keyed on its own resolved destination — so re-running after the registry was pointed elsewhere still creates the registry where it now belongs:
> - **Same-file case:** the table rides inside the config template, so the single `_local/config.md` skip below covers it.
> - **Relocated case:** the registry table is written to the resolved location guarded by its own skip-if-present check on that file — independent of whether `_local/config.md` exists. Absent (or `--force` set) ⇒ write/refresh it there even when `_local/config.md` already exists; present and no `--force` ⇒ skip it and report "registry already present at `<resolved location>` — left untouched."

- If `_local/config.md` exists and `--force` is not set, skip the config-template write (this also covers the registry table in the **same-file case**). Report "config.md already present — left untouched." The **relocated case** is guarded separately, per the note above.
- **One registry, never two.** The `## Capabilities` section in the "Default content" template below belongs to **exactly one** destination. **Same-file case** ⇒ keep `## Capabilities` inside `_local/config.md`. **Relocated case** ⇒ **omit the `## Capabilities` section from the `_local/config.md` write entirely** and write that section **only** to the resolved registry file — never emit it in both places, so a user can't edit the wrong copy (runtime reads only the resolved location).
- **Strip the authoring aid.** The `<!-- … -->` HTML comment above the `## Capabilities` table in the template is a build-time directive **for `init` only** — it must **never** reach a written file. Drop it in both branches: write only the `## Capabilities` heading, table, and explanatory prose to the Phase 0 resolved registry location (`_local/config.md` itself in the same-file case). Every "write the template" instruction below means the template **minus** this comment.
- Otherwise:
  1. **Infer the Verify Command** from the project's actual config (see "Detecting Verify Command" below). Do not write a hardcoded default — every repo's command differs, and a wrong default (e.g., `tsc --noEmit` on a framework project needing template/metadata checks) misses the very errors the skills exist to catch.
  2. Write the template below, substituting the detected command into the `Verify Command` row and the current model id (§9 model attribution) into the `**Model:**` line. If Verify Command falls back to a placeholder, flag it prominently in the chat summary so the user fixes it before running any other skill.

### Default content

The verbatim `_local/config.md` default content — the `## Task Folders`, `## Build / Verify`, `## QA`, `## Seed`, `## Standup`, and `## Capabilities` sections — lives at `config-template.md`, obtained via `resolve_content({ workspaceRoot: resolverWorkspaceRoot, class: "references-template", skill: "init", ref: "config-template.md" })`, never a raw `Read` of the plugin-cache path. It is read only on this write path (Phase 2), so it stays out of the boot body. Follow it, then write it substituting the detected Verify Command and the current model id. **Strip the `<!-- init directive … -->` HTML comment before writing** (per "Strip the authoring aid" above), and apply the "One registry, never two" rule to where the `## Capabilities` section lands.

After writing, tell the user to review `_local/config.md` — especially the detected `Verify Command` — and edit values for the current project if they differ from the defaults. The keys must not change — only the values.

### Detecting Verify Command

The goal is a single shell command that exits 0 when the whole project typechecks. Detect in this order — stop at the first rule that produces a concrete command:

1. **Find project roots.** `Glob` for `**/package.json` plus any framework project manifests (skip `node_modules/`, `.git/`, `dist/`, `bin/`, `obj/`). Record each containing directory, relative to repo root.

2. **Prefer explicit scripts.** For each `package.json`, parse `scripts` and look for a verification-ish script in this priority: `typecheck` > `check` > `verify` > `build:check` > `lint:types`. First hit wins:
   ```
   npm --prefix <dir> run <script>
   ```

3. **Framework AoT build.** If no script matched but the candidate dir's `package.json` lists a framework CLI under `devDependencies` whose canonical verification is an ahead-of-time / production build, use that CLI's AoT/production build — it's the canonical way to catch template, metadata, and TS errors together. Derive the exact command from the detected CLI at runtime (its AoT/production build invocation, e.g. a development-configuration build with output hashing disabled):
   ```
   npm --prefix <dir> exec -- <framework CLI's AoT/production build command>
   ```

4. **Generic `build` script.** If a `build` script exists in `package.json`, use it as a last resort — it almost always includes typechecking as a side effect:
   ```
   npm --prefix <dir> run build
   ```

5. **Plain TypeScript.** If the dir has `tsconfig.json` but nothing better matched:
   ```
   npm --prefix <dir> exec -- tsc --noEmit
   ```
   Warn in the chat summary that this catches only plain-TS errors; it's fine for pure-TS libraries, not for framework projects.

6. **Multi-candidate tie-break.** If multiple dirs produce different commands, pick in this order: any framework-build one > any with an explicit typecheck/check script > the shallowest dir. List the others in the chat summary so the user can override.

7. **Nothing found.** Write:
   ```
   TODO: replace with the command that typechecks this project (must exit non-zero on any type or template error)
   ```
   and flag it loudly in the chat summary. Do not silently substitute a generic guess — a skill running a bogus verify is worse than one that stops with a clear error.

Record the chosen rule (and the rejected candidates, if any) in the chat summary so the user can see the reasoning without reading config.md.

> Registry location (`registryPath`) is resolved once in Phase 0 step 3 — see there for the rule.

---

## Phase 2.5: Seed capability profiles

After the `## Capabilities` registry table exists (Phase 2) and before the constitution is established (Phase 7), execute the **profile-seeding convention** defined in `plugins/wf/skills/_contracts/capability-registry.contract.md` (§"The profile-seeding convention"). Do **not** re-derive its rules here — follow the convention **by name**; this phase only invokes it for every registered capability, obtained from the `wf-resolver` MCP service rather than a hand-rolled registry/manifest/plugin-root read.

1. **Call `resolve_registry({ workspaceRoot: resolverWorkspaceRoot })`** on the `wf-resolver` service. It returns the ordered active `capabilities[]`, each already resolved from the registry and its `manifest.md` — **including plugin-anchored self-heal** — as `{ name, kind, resolvedPath, manifestPath, validity, profileTemplatePath, … }`. No manual `## Capabilities` read, no `## Plugin Roots` lookup, no manifest `Read`: the resolver already performed the registry iteration, the per-capability manifest read, and the plugin-root resolution.
   - **Empty `capabilities[]` ⇒ seed nothing** — no destination is created. This is the inert no-op; report "none" in the Final Output. (Matches the contract's no-op-when-absent rule.)

2. **Per capability, read `validity` and `profileTemplatePath`.**
   - `validity: "unrecoverable"` (no readable manifest — either an unmapped plugin root, or a missing/unreadable `manifest.md` at a repo-relative path) ⇒ **no-op** for this capability (skip — no destination, no placeholder) and record `skipped — unreadable manifest`.
   - `validity: "ok"` but `profileTemplatePath: null` (the manifest declares no `profile-template:`) ⇒ **no-op** and record `skipped — no template`.
   - Otherwise `profileTemplatePath` points to the capability's default template — read it directly, but **guard the join first**. `profileTemplatePath` is workspace-root-*relative* only when the template lives inside the workspace; for a plugin-anchored capability whose install root is outside the workspace (e.g. a plugin cache), the resolver returns an **absolute** path. So: if `profileTemplatePath` is absolute (a leading `/` or a `C:`-style drive prefix), `Read` it **verbatim**; otherwise `Read <workspaceRoot>/<profileTemplatePath>`. Never blindly join `workspaceRoot` — prefixing an already-absolute path yields an invalid location. (The resolver returns paths and metadata only, never the template body itself, so this one file read stays with the consuming skill.)

3. **Per declaring capability, derive the deterministic destination**, keyed on the registry `name` field (its stable identity — never `resolvedPath` or `manifestPath`):

   ```
   _local/profiles/<name>.profile.json
   ```

   The `name` value is used verbatim as the filename stem; the convention requires it to be a filesystem-safe token (lowercase letters, digits, hyphens — no separators or `..`), which registry validation enforces before this phase runs.

   **Defensive token check (fallback).** Before deriving the destination, confirm `name` is a filesystem-safe token — lowercase letters, digits, and hyphens only, with **no** path separator (`/` or `\`), **no** `..` segment, and **no** whitespace. If it is not, **skip this row** (write nothing, derive no path) and record `skipped — unsafe capability name`. Registry validation (WF-2's registry pass / WF-28) should reject such a name upstream; this check is a defensive fallback so the path can never traverse outside `_local/profiles/` even if that validation has not run. Create `_local/profiles/` on demand.

4. **Seed an override only on divergence; never overwrite.** The capability ships its `profile-template:` as the **authoritative default template** — the baseline shape (which may carry angle-bracketed placeholder slots) a project overrides; seed a downstream **override** at the destination **only when the project's values diverge** from that template. Precedence is **downstream override > capability default**. State that hybrid precedence in the seeded file, and use the convention's angle-bracketed placeholder syntax for every divergent (unfilled) slot. **Idempotent — if the destination already exists, leave it untouched** (skip-if-present; never clobber a partially- or fully-filled override). Record `seeded override` when written, or `default in use` when no override was needed.

5. **Model attribution.** Every seeded file carries the model-attribution convention **where its data format provides a place for it** — include a `**Model:** <current model id>` line for a prose/markdown profile, or, for a comment-forbidding format like JSON, an angle-bracketed model token in a **schema-permitted** note slot, per the convention's placeholder rule. **A JSON schema that forbids extra fields (`additionalProperties: false`) and defines no dedicated metadata/note slot for attribution has no place to carry it** — do **not** add a non-schema field (that would make the seeded file fail its own validator). In that case **omit** the in-file attribution and instead record the seeding model on the Phase 2.5 outcome line (the Final Output "Capability profiles" row), so attribution is preserved without breaking schema conformance. (`init` is project-level and has no task context, so there is no per-task `index.md` to record it in.) (The migration profile's schema is `additionalProperties: false` with no metadata slot, so its seed omits the in-file token.)

**Domain-free guard:** this phase names **no** concrete capability — capability names appear only as the path-deriving `name` value read from the resolved registry. Core iterates and derives; it never tests for or hardcodes a specific capability.

---

## Phase 2.6: Inform the resolver

Phase 2 and Phase 2.5 are the writes that mutate the resolution substrate the `wf-resolver` snapshot models — `_local/config.md`, the `## Capabilities` registry (in the same-file or relocated case), and any seeded `_local/profiles/*.profile.json` overrides. Every typed resolver query already re-validates its recorded input fingerprints and rebuilds on a mismatch, so the very next `resolve_*` call would pick these writes up regardless of this step — but `init` informs the resolver explicitly anyway, the same way a pack's own `register_pack({ workspaceRoot: resolverWorkspaceRoot, ... })` call folds a refresh into its own registration write, so Phase 6 and Phase 7 (and any skill run afterward) never rely on incidental fingerprint recomputation.

1. **Call `resolve_refresh({ workspaceRoot: resolverWorkspaceRoot, reasons: ["/wf:init wrote _local/config.md, the capability registry, and profile seeds"] })`.** It rebuilds the snapshot from the now-current files and returns the fresh lifecycle state — `{ valid, counts{ capabilities, packs, providers }, diagnostics[] }`.
2. **On success**, note the returned `counts.capabilities` for the chat summary.
3. **On a "no such tool", fetch and retry once before degrading.** `resolve_refresh` is **deferred**: its schema loads on demand, so that error on first reach means *not yet fetched*, not *not installed*. Fetch it through the host's tool-search surface and repeat step 1 once; only a second failure degrades to step 4.
4. **On failure, or when the service is unavailable, do not stop `init`** — the writes already landed on disk, and the resolver's own fingerprint-driven freshness rebuilds on the next natural query even without this call. Flag in the chat summary that the explicit refresh didn't confirm and suggest `/wf:resolve refresh` (WF-272 diagnostics/recovery) — never fall back to re-deriving the registry by hand to "confirm" it.

This is `init`'s only resolver **write-adjacent** call. It never calls `register_pack({ workspaceRoot: resolverWorkspaceRoot, ... })`: that call registers one pack's own capability under a stable plugin id, whereas `init` establishes the substrate those calls attach to — the empty (or project-clause-only) registry a pack's own init later registers into.

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

If the file already exists and `--force` is not set, skip. Otherwise write, substituting the current model id (§9) into the `**Model:**` line:

```markdown
# _local/

**Model:** <current model id>

Per-task artifacts managed by the wf:* skill suite. Everything here is gitignored.

- `T<NNN>/` — task folders (requirements, spec, plan, research, artifacts)
- `_testkit/` — Node test runner for a registered unit-test-authoring capability
- `config.md` — project-specific values consumed by every wf:* skill

Safe to nuke if you want a clean slate. Nothing here is version-controlled.
```

---

## Phase 6: Append the page-test exclude (conditional)

A capability may ship a page-test harness that writes its `_page-tests/` files under a
project-specific **test-host root**. That root comes from the capability's profile
(`test-host-root`), not from core. This phase derives the exclude **generically from the
resolved registry + capability profiles** — it **keys on the presence of the
`test-host-root` profile field, never on any capability name.** Model the loop shape and
the no-name discipline on Phase 2.5 above and `verify-spec`'s registry iteration.

1. **Call `resolve_registry({ workspaceRoot: resolverWorkspaceRoot })`** on the `wf-resolver` service and iterate the returned
   `capabilities[]` **in order**. **Empty `capabilities[]` ⇒ skip silently** (the inert
   no-op — nothing is appended). No manual `## Capabilities` read.
2. **Per capability, call `resolve_profile({ workspaceRoot: resolverWorkspaceRoot, capability: <name> })`.** It returns the override-merged
   profile **values** directly — override `_local/profiles/<name>.profile.json` > the
   capability's default template, the resolver already applying that precedence. No manual
   manifest read, no `## Plugin Roots` lookup, no hand-merge.
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

After `_local/config.md` exists (Phase 2) and the registry table is in place, route this fixed sibling-Skill edge immediately before work: call `resolve_routing` with `workspaceRoot: <absolute pwd -P workspace root>`, `role: "constitution"`, `unitIds: ["init:constitution"]`, `shapeEvidence: { workSurface: "caller-context", atomicity: "atomic", unitCount: 1, unitsIndependent: false, ambiguity: "none", risk: "low", toolWork: "none", validation: "mechanical", contextIsolation: "none", independentReview: false, returnContract: "mechanically-judgeable", requestedParallelism: 1 }`, `supportsModelSelector: false`, and `supportsEffortSelector: false`. Include `actualModel` only when the host exposes it; emit the compact operational record; and pass no selector. On `status: stop` or non-null `diagnostic`, preserve this phase's existing non-fatal behavior: skip the constitution refresh, record the resolver reason in the summary, and continue init. Otherwise obey the selected `inline` shape and **unconditionally** invoke `/wf:constitution` through the Skill tool with no arguments so a fresh repo gets a
constitution record — the same slash-invocation `plan`/`spec`/`lite` use for `/wf:classify`.
`init` carries **no existence check of its own**: the skill's **establish-or-update default**
handles both cases — it establishes when `_local/constitution.md` is absent (writing a
core-only constitution when the `## Capabilities` registry is empty, the inert path) and
updates idempotently when the file already exists (an unchanged project produces no diff, so
re-running `init` is safe). If invocation is unavailable, skip with a one-line note in the
chat summary telling the user to run `/wf:constitution` manually — never STOP `init` on it.

---

## Edge Cases

- **`wf-resolver` MCP service unavailable:** Stop in Phase 0 (or, for the informational Phase 2.6 refresh, degrade without stopping — see there). Never hand-parse `wf.config.js` or the registry as a substitute; direct the user to restart Claude Code so the bundled resolver MCP server loads (WF-272 diagnostics/recovery).
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
- <capability-name> — <seeded override [seeded by <model id>] | default in use | skipped — no template | skipped — unsafe capability name | skipped — unreadable manifest>
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
