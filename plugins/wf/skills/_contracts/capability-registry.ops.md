# Capability registry — runtime ops

**Version:** 1.2.0 (WF-200; WF-157 — delivery surface gains six operations: `pr-comments-read`, `pr-comment-post`, `checks-read`, `review-thread-resolve`, `pr-merge`, `activity-read`)
**Role:** the runtime-read half of the v2 core↔capability port — every schema, guard, error path, outcome mapping, and degradation rule a running skill follows. Self-sufficient at one level: no step below requires opening any further file.
**Pair (flat sibling, read directly when needed):** `invocation-runtime.ops.md` — the phase-firing / provider-resolution procedure.
**Reference (rationale, history, authoring guidance, validation detail — never read at boot):** `capability-registry.contract.md`.
**Model:** claude-fable-5

**Contents:** the `## Capabilities` registry · the `## Plugin Roots` mapping · recorded-root-first self-heal + residual diagnosis · the SDD phases · the contribution taxonomy · the delivery provider surface · the tracker provider surface · the constitution composition rule · manifest schema v2 · the profile-seeding convention.

## The `## Capabilities` registry (the selector)

Location: resolved from the repo-root `wf.config.js` `registryPath` key (a forward-slash, repo-relative file path; no absolute path, no drive prefix, no `..` — validator-enforced); **default `_local/config.md`** when the key is absent.

| Column | Meaning |
|--------|---------|
| `Capability` | The capability's name — identity only. Locates its config/profile; **never** keys a core code path. Filesystem-safe token: lowercase letters, digits, hyphens. |
| `Path` | Where its `manifest.md` lives. Two shapes, both runtime-resolved: **(a)** a repo-relative folder (resolved against the repo root); **(b)** a plugin-anchored token `plugin:<plugin-name>/<rel-path>`, resolved via the `## Plugin Roots` mapping below. |

Rules a boot follows:

1. **Empty/absent table = fully generic core.** Every phase runs exactly as if inert; no stack/domain/project term surfaces; core stays fully usable.
2. **Iterate; never name or count.** Walk rows top to bottom; never test for a specific capability, never key behaviour on how many rows are active.
3. **Table order = injection order**, general → specific — the most-specific capability is injected last and wins on additive `guidance`.

## The `## Plugin Roots` mapping

A second table (`| Plugin | Root |`) co-located with the registry. `Plugin` = the `plugin:` token's `<plugin-name>`, verbatim. `Root` = that plugin's install root — absolute or repo-relative, forward slashes only; a backslash or a `..` segment is invalid (validator-enforced). Per-machine, gitignored, written by the pack's own init skill — **core only reads it, never writes another plugin's root**. An absent/empty table only means no plugin-anchored row can resolve; repo-relative rows are unaffected.

## Recorded-root-first resolution with install-manifest self-heal

This section is the **single runtime-loaded home** of the recovery algorithm (WF-200): surface-agnostic — one reference serves the `delivery` and `tracker` provider surfaces alike — and the only authoritative copy. A consumer needing plugin-root recovery reads and follows this section; no skill restates the install-manifest logic. The registry validator (`validate-registry.sh`) resolves recoverable rows through this same fallback against an injectable install-manifest path, erroring only on rows neither route recovers.

Resolve a `plugin:<plugin-name>/<rel-path>` `Path` in this order — **in-memory only**:

1. **Recorded root first.** Look `<plugin-name>` up in `## Plugin Roots`; join `<root>/<rel-path>/manifest.md` (repo-relative `Root` against the repo root; absolute as-is). If that manifest exists on disk, use it — done.
2. **Dangling → install-manifest fallback.** If a recorded `Root` exists but its `<root>/<rel-path>/manifest.md` is absent (the root dangles), read Claude Code's install manifest at `~/.claude/plugins/installed_plugins.json` and recover the current root:
   1. **Marketplace-exact key first** — derive core's own marketplace by matching core's `${CLAUDE_PLUGIN_ROOT}` against the manifest, then look up the exact key `<plugin-name>@wf-marketplace`; only when that key is absent, fall back to matching the bare `<plugin-name>` (left-of-`@`) alone.
   2. **Normalize** every path read from the manifest backslash→forward-slash before use.
   3. **Prefer an existing `installPath`** when more than one record matches, so a stale record never shadows the live one.
   Resolve `<recovered-root>/<rel-path>/manifest.md` and use it.
3. **Still unrecoverable** (no readable manifest either way): the row **no-ops** (fail-safe, exactly like a missing manifest); the validator is what errors on it. An **unmapped** `<plugin-name>` — no `## Plugin Roots` row at all — **skips the self-heal entirely** and no-ops the same way. A write that needs this capability's surface surfaces the residual diagnosis below — never a silent misreport.

**Residual diagnosis** — a **write** on provider surface `<S>` that finds **zero readable** providers splits two ways, never conflated:

- **(a) Genuine no-provider** — every registered manifest is readable and none is scoped to `<S>`: emit the unchanged "no `<S>` provider registered" message and name the remedy (register a capability that owns `<S>` in the `## Capabilities` registry).
- **(b) Registered-but-unrecoverable** — one or more registered capabilities have an unreadable manifest: name those pack(s) as **candidates** (from the `## Capabilities` row) and **hedge** the surface attribution — "registered pack(s) [X, …] have an unrecoverable manifest at that path; if one is your `<S>` provider, fix its stale root / re-run its init." List all such packs. **Never** assert a candidate owns `<S>`.

**Surfacing by site:** a **delivery write** surfaces (b) **loudly** (it blocks); a **tracker write** emits it as the **warn-once**, then continues local-only; a **read** on either surface stays **silent local-only**.

## The SDD phases (the injection points)

Fixed spine — a manifest may attach fragments only to these; the constitution is **not** a phase:
`spec` (authoring hub; tracker `provider` anchor) · `plan` (`artifact`) · `tasks` (`task-list`) · `implement` (authoring hub; delivery `provider` anchor) · `verify` (`finding`) · `qa-generation` (`scenario`) · `qa-execution` (`provider`).

## The contribution taxonomy (the fragment kinds)

| Kind | Phase(s) | Aggregation policy |
|------|----------|--------------------|
| `guidance` | `spec`, `implement` | aggregate — follow every contributor in registry order; most-specific (last) wins on conflict |
| `task-list` | `tasks` | aggregate — append every contributor's tasks |
| `artifact` | `plan` | partition — one owner per `source→target` pair |
| `finding` | `verify` | aggregate, provenance-tagged (order cosmetic) |
| `scenario` | `qa-generation` | aggregate, provenance-tagged |
| `provider` | `qa-execution`; `implement` (delivery); `spec` (tracker) | partition — one owner per `surface` token; different surfaces compose |
| `article` | constitution | aggregate with provenance; precedence per the constitution rule below |

Partition overlap — the same `surface` token or `source→target` pair claimed by two active capabilities — is a **validator error naming both offenders**; the runtime never merges, it applies the single owner. Surface-ownership uniqueness is checked by token alone, across the whole registry, independent of the claiming row's phase. The `delivery`/`tracker` phase attachments are **registration anchors only** — they never gate when a core skill may invoke an operation (see `invocation-runtime.ops.md`, direct provider resolution).

## The delivery provider surface

The capability owning `surface = delivery` implements — abstract names; zero git/gh command strings anywhere in core or in these names:

- **Write side:** `branch-create`, `branch-switch`, `commit`, `push-upstream`, `pr-create`, `pr-detect`, `pr-comment-post`, `review-thread-resolve`, `pr-merge`.
- **Read side:** `workspace-root-resolve`, `current-branch-query`, `last-commit-timestamp-query`, `pr-comments-read`, `checks-read`, `activity-read`.

**Unconfigured (no `delivery` owner registered):**

- **Reads fall back silently** — no error, no warning; a read always resolves to something usable. `workspace-root-resolve` → the workspace root as a **plain directory**, no VCS invocation (this is how core locates `wf.config.js` and `_local/` in bare-core mode — defined behaviour, not degradation). `last-commit-timestamp-query` → a plain-directory-safe filesystem read (no specific algorithm mandated). `pr-comments-read`, `checks-read`, and `activity-read` → an **empty result** (no review-comment, check, or recent-activity context exists outside a delivery provider) — no error, no warning.
- **Writes state plainly** that no delivery provider is registered and **name the remedy** (register a capability owning the `delivery` surface) — never silent, never a guessed fallback. This governs every write above, the new `pr-comment-post` / `review-thread-resolve` / `pr-merge` included. When zero readable providers is instead case (b) above, surface the registered-but-unrecoverable diagnosis **loudly**.

**Single-shot-publish idempotency:** an operation returning an id/URL (`pr-create` canonical; `pr-comment-post` likewise) records it as a `**<label>:** <value>` metadata line in the local artifact that triggered it; before re-invoking for the same artifact, the caller **reads that line back first** — a present value means already-published, never re-invoke. `pr-merge` guards instead by detect-first: a PR already merged is a no-op, never re-merged.

## The tracker provider surface

The capability owning `surface = tracker` implements — abstract names; zero tracker-product strings:
`resolve_config`, `create_umbrella`, `create_child`, `update`, `get`, `list_children`, `post_comment`, `set_status`, `attach_link`, `list_by_status`, `list_milestones`, `list_cycles`.

**Query operations** (`list_by_status`, `list_milestones`, `list_cycles`) are read-only enumerations of the active tracker's own records — work items in a named workflow status, the milestones of a scope, the cycles (time-boxed iterations) of a scope. Each **consumes** an already-resolved status name / scope, never derives one, and performs no write. They inherit the degradation rules below unchanged: an **unconfigured** tracker yields an **empty result** — silent local-only, no prompt, no error (a read never warns); a **mid-run** failure after a tracker was configured **warns once** (naming the failing operation and the error) and continues local-only. They add nothing to the id-shape rule.

**Id shape:** the active tracker supplies the task-id shape. With **no** tracker owner, core uses its local scheme `T<NNN>`: scan `{task-root}` for existing `T<NNN>`-prefixed task folders anywhere under it, take the highest number, increment by one, zero-pad to 3 digits — no tracker call at all.

**Degradation rules:**

- **Unconfigured tracker** → silent local-only fallback: no prompt, no error; every read and write proceeds against local artifacts alone.
- **Mid-run provider failure** (after a tracker was configured) → **warn once**, naming the failing operation and the error, then **continue local-only** for the rest of the run; a tracker failure never blocks a local artifact write.
- **Registered-but-unrecoverable provider** → a tracker **write** emits the residual diagnosis above as the warn-once, then continues local-only; a tracker **read** stays silent local-only.

**Single-shot-publish idempotency:** same metadata-line guard as delivery (`create_umbrella` / `create_child` canonical) — before re-invoking for the **same artifact/slot**, read that slot's line back first; a present value for that slot = already published, never re-invoke.

## The constitution composition rule

1. **Composed from `article` fragments with provenance** — core's domain-free process articles plus each active capability's own; never a baked file.
2. **Project clauses override capability clauses**, regardless of registry order.
3. **A capability-vs-capability contradiction is a validation error** — fail-fast, both offenders named; only the project may resolve one.
4. **Established at setup** (the constitution skill, auto-invoked by `init`), **consulted as `guidance` at `spec`, enforced as `finding`s at `verify`** — not a per-ticket phase.

## Manifest schema v2 (the capability side, at the contract level)

Exactly one `manifest.md` at `<path>/manifest.md`:

- **`kind:`** `adapter` | `feature` | `both`.
- **Fragments table** `| phase | contribution-kind | dispatch | scope |` — `phase` and `contribution-kind` only from the fixed sets above (a manifest may not invent one); `dispatch` = `inline: <rel-path>` (forward-slash, relative to the capability's path) or `subagent: <agent>`; `scope` required only for partitioned kinds (a `surface` token for `provider`, a `source→target` pair for `artifact`), `—` otherwise.
- **`skills:`** (feature/both — documentation only; native plugin composition loads them) · **`profile-template:`** (optional; one forward-slash path relative to the capability folder) · **`requires:`** / **`conflicts:`** (optional; enforced at registry validation).

## The profile-seeding convention (capability-agnostic)

1. **Destination:** `_local/profiles/<capability-name>.profile.json` — `<capability-name>` is the registry's `Capability` column, verbatim. The override is seeded **only where the project's values diverge** from the capability's shipped default template; precedence: override > default.
2. **Placeholders:** every unfilled value is angle-bracketed — `<UPPER_SNAKE>`, `<UPPER_SNAKE: inline guidance>`, or `<FILL: guidance>`; a value is filled once it contains no `<…>`; fill guidance never lives in out-of-band comments — including guidance in a schema-permitted note field, which must itself be an angle-bracketed `<…>` token.
3. **Idempotency:** a re-run **never overwrites** an existing destination; it only creates a missing override, and only on divergence.
4. **No-op when absent:** a capability declaring no `profile-template:` seeds nothing — its silence is not an error.
