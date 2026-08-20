# Capability registry — runtime ops

**Version:** 1.10.0 (WF-200; WF-157 — delivery surface gains six operations: `pr-comments-read`, `pr-comment-post`, `checks-read`, `review-thread-resolve`, `pr-merge`, `activity-read`; WF-158 — the tracker provider surface gains three read-only query operations: `list_by_status`, `list_milestones`, `list_cycles`; WF-176 — the delivery surface gains one read operation: `branch-changes-read` (branch-changes enumeration); WF-154 — the `pre-commit` self-review seam fired by the commit path before recording a commit, reusing the `finding` kind; WF-239 — `article` removed from the contribution taxonomy: a constitution clause is the `article:` manifest KEY, not a fragments-table row — the taxonomy is now six kinds and the manifest schema documents the `article:` key; WF-272 — resolver-failure semantics bind to the same three-surface degradation policy via the resolver's `resolve_gate` typed query; WF-315 — the tracker provider surface gains one read-only query operation: `list_blockers` (the set of task ids that block a given task); WF-323 — `slot` added as the seventh contribution kind: a per-skill composition-surface contribution scoped by a `skill.point` token with a declared `replace`/`append` merge policy — a slot targets a skill point, not an SDD phase, so its Fragments row carries `—` in the phase column; WF-324 — the delivery surface gains two review-thread operations: `review-threads-read` (HEAD_SHA-scoped review-thread read, degrading to a typed degraded-empty never presentable as a HEAD_SHA read-back) and `review-thread-reply` (per-thread reply write keyed by thread node id), complementing the existing `pr-comments-read` / `review-thread-resolve` / `pr-comment-post`; WF-326 — the **skill interface declaration** (`skills/<name>/interface.md`): a machine-readable sidecar declaring a skill's externally-bindable surface (invocation shape, terminal block, declared slots + merge policies, declared settings keys, safety rules) that a resolver reads without touching the SKILL.md body, plus the `<!-- wf:slot … -->` body-marker syntax with its inline-default region and no-improvisation rule, CI-enforced by `skill-slot-marker-lint.sh`; WF-327 — filled-slot resolution: `resolve_content` gains the `slot` content class, composing every contribution to a `<skill>.<point>` under the ordered precedence **personal `_local/slots/<skill>.<point>.md` override > pack contribution** into exactly one served body (`replace` → single highest-precedence; `append` → registry-ordered concatenation, override last), a typed `unfilled` outcome directing the caller to the inline default, all in the resolver runtime — the model never arbitrates between fragments)
**Role:** the runtime-read half of the v2 core↔capability port — every schema, guard, error path, outcome mapping, and degradation rule a running skill follows. Self-sufficient at one level: no step below requires opening any further file.
**Pair (flat sibling, read directly when needed):** `invocation-runtime.ops.md` — the phase-firing / provider-resolution procedure.
**Reference (rationale, history, authoring guidance, validation detail — never read at boot):** `capability-registry.contract.md`.
**Model:** claude-fable-5

**Contents:** resolver call root · the `## Capabilities` registry · the `## Plugin Roots` mapping · recorded-root-first self-heal + residual diagnosis · the SDD phases · the contribution taxonomy · the skill interface declaration and slot markers · the delivery provider surface · the tracker provider surface · the pre-commit self-review seam · the constitution composition rule · manifest schema v2 · the profile-seeding convention.

## Resolver call root

Every bundled `wf-resolver` MCP call passes `workspaceRoot`: run `pwd -P` in the current Agent/session and use its absolute current workspace directory. A linked-worktree Agent passes its own root, never its parent's. Omission is a hard schema error; no MCP call has a default or fallback root.

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

**Resolver-failure semantics (the broken-resolver case).** A resolver that cannot produce a trustworthy resolution — a **snapshot-missing / snapshot-malformed / schema-incompatible / fingerprint-unresolvable / cli-unavailable / registry-invalid** state — binds to the **same three-surface policy**, so a broken resolver is never a silent no-op: a **local-only read continues** best-effort with the diagnostics + a recovery hint; a **tracker write warns and continues**; a **delivery write blocks before any mutation**. Each surfaced diagnostic carries the failed input/state and a recovery path naming `/wf:resolve refresh` (or `/wf:resolve invalidate`). Resolve this via the bundled resolver's `resolve_gate` typed query with `workspaceRoot: <current Agent/session absolute workspace directory>` and `surface: local-read | tracker-write | delivery-write` — it returns the reaction; it never re-walks capability folders or probes the environment as a fallback (a known-broken path surfaces diagnostics + recovery instead — C008).

## The SDD phases (the injection points)

Fixed spine — a manifest may attach fragments only to these; the constitution is **not** a phase (nor is a `slot`, which targets a skill point, not a phase — its Fragments-row phase cell is `—`; see the taxonomy):
`spec` (authoring hub; tracker `provider` anchor) · `plan` (`artifact`) · `tasks` (`task-list`) · `implement` (authoring hub; delivery `provider` anchor) · `verify` (`finding`) · `qa-generation` (`scenario`) · `qa-execution` (`provider`) · `pre-commit` (`finding`; the commit-path self-review seam — operation-time, **not** a gated artifact phase; see "The pre-commit self-review seam" below).

## The contribution taxonomy (the fragment kinds)

| Kind | Phase(s) | Aggregation policy |
|------|----------|--------------------|
| `guidance` | `spec`, `implement` | aggregate — follow every contributor in registry order; most-specific (last) wins on conflict |
| `task-list` | `tasks` | aggregate — append every contributor's tasks |
| `artifact` | `plan` | partition — one owner per `source→target` pair |
| `finding` | `verify`, `pre-commit` | aggregate, provenance-tagged (order cosmetic) |
| `scenario` | `qa-generation` | aggregate, provenance-tagged |
| `provider` | `qa-execution`; `implement` (delivery); `spec` (tracker) | partition — one owner per `surface` token; different surfaces compose |
| `slot` | — (targets a skill point, not an SDD phase) | per `skill.point`: `replace` partitions (single owner), `append` aggregates (composes) |

There are **seven** contribution kinds; `article` is **not** one of them (a constitution clause is not a fragment — it attaches to the constitution, which is not an SDD phase). A capability declares its non-negotiable clauses with the `article:` manifest **key** (see "Manifest schema v2" and "The constitution composition rule" below), never as a fragments-table row; a fragment naming `article` as its contribution kind is a validator error. A **`slot`** (WF-323) is the seventh kind: it targets a per-skill composition **point**, not an SDD phase, so its Fragments row carries `—` in the phase column and a scope of `<skill>.<point> <merge-policy>` — the `skill.point` (e.g. `ship.review`) names the point, the merge policy is `replace` (single-owner) or `append` (list-like). Both are required; a blank scope, a malformed skill.point (each segment lowercase letters/digits/hyphens, one dot), or an absent/unknown policy is a validator error.

Partition overlap — the same `surface` token, `source→target` pair, or a `skill.point` claimed with `replace` by two active capabilities — is a **validator error naming both offenders**; the runtime never merges, it applies the single owner. Two `append` slot claims on one `skill.point` **compose** (never conflict). Surface-ownership uniqueness is checked by token alone, across the whole registry, independent of the claiming row's phase. The `delivery`/`tracker` phase attachments are **registration anchors only** — they never gate when a core skill may invoke an operation (see `invocation-runtime.ops.md`, direct provider resolution).

## The skill interface declaration and slot markers

A skill's **externally-bindable surface** — invocation shape, terminal block, declared **slots** (with merge policies), declared **settings** keys, and safety rules — is declared in a machine-readable sidecar, **`skills/<name>/interface.md`**, *not* in the SKILL.md body. A resolver learns a skill's slots and settings from this file alone and **never reads the SKILL.md body** (`resolve_content` refuses skill-body reads); the body prose stays freely rewordable implementation while the declaration is the stable, contracted surface.

- **Declared slots** sit in interface.md's `## Slots` table — column 1 the `skill.point` id (WF-323 vocabulary; the first segment **is** the skill folder name), column 2 the merge policy (`replace` | `append`).
- **A slot is placed in the body** by a marker pair, each alone on its line, naming the same id: `<!-- wf:slot <skill.point> -->` … inline-default region … `<!-- wf:slot-end <skill.point> -->`.
- **No-improvisation rule:** an **unfilled** slot executes **exactly** its inline-default region (or nothing, when the region is empty) — no ad-lib at the marker. A `replace` fill substitutes the region; an `append` fill runs after it.
- **Correspondence (CI-enforced by `skill-slot-marker-lint.sh`):** every body marker id is declared in `## Slots`, and every declared slot has exactly one marker pair; a malformed marker or declaration, an undeclared marker id, or a declared-but-unmarked slot fails naming file+line. A skill with no `## Slots` and no markers is inert — the whole current tree passes unchanged.
- **Filled-slot resolution at runtime (WF-327):** execution reaching a marker fetches the winning body with ONE call — `resolve_content` with `workspaceRoot: <current Agent/session absolute workspace directory>`, class `slot`, and args `skill` + `point` (the `<skill>.<point>` id). The resolver linearizes every contribution under the fixed precedence **personal `_local/` override > pack contribution** (`inline: <rel-path>` bodies, registry order) and serves **exactly one** composed body — the model never sees competing fragments. Outcomes: `{status: composed, content, policy, parts}` (`replace` → the single highest-precedence body; `append` → contributions concatenated in registry order, override **last**, one blank line between); `{status: unfilled}` when there is no contribution and no override — **execute the inline-default region exactly** (no-improvisation rule); `{status: unresolved}` (registry-invalid / ref-not-found) or `{status: refused}` follow the content surface's degradation discipline (never a wrong-path body, never a raw-read fall-through). The override is one gitignored file per point, **`_local/slots/<skill>.<point>.md`** (`_local/` is gitignored wholesale — nothing override-related is committed). For a **filled `append`**, the inline default stays the **first** part (it runs from the body, before the served composition); a **filled `replace`** supersedes the inline default wholesale.

## The delivery provider surface

The capability owning `surface = delivery` implements — abstract names; zero git/gh command strings anywhere in core or in these names:

- **Write side:** `branch-create`, `branch-switch`, `commit`, `push-upstream`, `pr-create`, `pr-detect`, `pr-comment-post`, `review-thread-resolve`, `review-thread-reply`, `pr-merge`.
- **Read side:** `workspace-root-resolve`, `current-branch-query`, `default-base-query`, `last-commit-timestamp-query`, `branch-changes-read`, `pr-comments-read`, `review-threads-read`, `checks-read`, `activity-read`.

**Unconfigured (no `delivery` owner registered):**

- **Reads fall back silently** — no error, no warning; a read always resolves to something usable. `workspace-root-resolve` → the workspace root as a **plain directory**, no VCS invocation (this is how core locates `wf.config.js` and `_local/` in bare-core mode — defined behaviour, not degradation). `default-base-query` → a plain default base name (`main`), so a caller that needs the base value never has to name a trunk itself. `last-commit-timestamp-query` and `branch-changes-read` → a plain-directory-safe filesystem read (no specific algorithm mandated) — `branch-changes-read` returns the changed-file set via a plain-directory enumeration, no VCS invocation. This silent low-level read fallback is **distinct** from a caller detecting provider absence: a skill that must branch on whether a delivery provider is registered tests **surface ownership** in `## Capabilities` separately — the two never conflate. `pr-comments-read`, `checks-read`, and `activity-read` → an **empty result** (no review-comment, check, or recent-activity context exists outside a delivery provider) — no error, no warning. `review-threads-read` also empties, but as a **typed degraded-empty**: `<read-performed>` = false (never true) in bare-core, so the empty is explicitly *not* a performed `HEAD_SHA` read-back — a merge-blocking "no unresolved threads" claim honours only `<read-performed>` = true, so a silent no-provider empty can never satisfy it.
- **Writes state plainly** that no delivery provider is registered and **name the remedy** (register a capability owning the `delivery` surface) — never silent, never a guessed fallback. This governs every write above, the new `pr-comment-post` / `review-thread-resolve` / `review-thread-reply` / `pr-merge` included. When zero readable providers is instead case (b) above, surface the registered-but-unrecoverable diagnosis **loudly**.

**Single-shot-publish idempotency:** an operation returning an id/URL (`pr-create` canonical; `pr-comment-post` likewise) records it as a `**<label>:** <value>` metadata line in the local artifact that triggered it; before re-invoking for the same artifact, the caller **reads that line back first** — a present value means already-published, never re-invoke. `pr-merge` guards instead by detect-first: a PR already merged is a no-op, never re-merged.

## The tracker provider surface

The capability owning `surface = tracker` implements — abstract names; zero tracker-product strings:
`resolve_config`, `create_umbrella`, `create_child`, `update`, `get`, `list_children`, `post_comment`, `set_status`, `attach_link`, `list_by_status`, `list_milestones`, `list_cycles`, `list_blockers`.

**Query operations** (`list_by_status`, `list_milestones`, `list_cycles`, `list_blockers`) are read-only enumerations of the active tracker's own records — work items in a named workflow status, the milestones of a scope, the cycles (time-boxed work periods) of a scope, and the set of task ids that **block** a given task (its blocking predecessors, read from the tracker's own dependency relations; an **empty set**, never an error, when the task has none). Each **consumes** an already-resolved status name / scope / task id, never derives one, and performs no write. They inherit the degradation rules below unchanged: an **unconfigured** tracker yields an **empty result** — silent local-only, no prompt, no error (a read never warns); a **mid-run** failure after a tracker was configured **warns once** (naming the failing operation and the error) and continues local-only. They add nothing to the id-shape rule.

**Id shape:** the active tracker supplies the task-id shape. With **no** tracker owner, core uses its local scheme `T<NNN>`: scan `{task-root}` for existing `T<NNN>`-prefixed task folders anywhere under it, take the highest number, increment by one, zero-pad to 3 digits — no tracker call at all.

**Degradation rules:**

- **Unconfigured tracker** → silent local-only fallback: no prompt, no error; every read and write proceeds against local artifacts alone.
- **Mid-run provider failure** (after a tracker was configured) → **warn once**, naming the failing operation and the error, then **continue local-only** for the rest of the run; a tracker failure never blocks a local artifact write.
- **Registered-but-unrecoverable provider** → a tracker **write** emits the residual diagnosis above as the warn-once, then continues local-only; a tracker **read** stays silent local-only.

**Single-shot-publish idempotency:** same metadata-line guard as delivery (`create_umbrella` / `create_child` canonical) — before re-invoking for the **same artifact/slot**, read that slot's line back first; a present value for that slot = already published, never re-invoke.

## The pre-commit self-review seam

The commit path fires the `pre-commit` phase **immediately before it records a commit** — on **every** route to a commit (a direct commit and every programmatic commit that reaches the same commit operation) and **only when a real change is pending** (never on the nothing-to-commit path, where nothing is recorded). Firing is the ordinary phase firing (`invocation-runtime.ops.md` §"The moving parts"): walk `## Capabilities`, collect every `finding` fragment attached at `pre-commit`, dispatch each, aggregate provenance-tagged in registry order. It reuses the `finding` kind — **no new kind**.

- **Empty result → no-op, byte-identical.** Empty/absent registry, or no capability attaching a `pre-commit` fragment → the phase produces its empty result: no finding surfaces, no capability term appears, and the commit proceeds **exactly as with no seam** (the inert-when-unregistered default).
- **Gate vs annotate — the contributor decides.** A contributed finding either **gates** (blocks the commit) or merely **annotates** (the commit proceeds); which one is the finding's own signal, not core's. Core fires, aggregates, and — if any aggregated finding signals a block — **does not record the commit**; otherwise it proceeds. Core names, requires, and assumes **no** capability here, exactly as at `verify`.
- **A phase firing, not a provider resolution.** Independent of the `delivery` surface's direct resolution used for the commit operation itself: a run's forwarded `delivery` record serves the delivery operations only; the `pre-commit` firing reads the registry for `finding` fragments and touches neither the record nor the surface.

## The constitution composition rule

1. **Composed from each capability's `article:` manifest-key declarations, with provenance** — core's domain-free process articles plus each active capability's own (an `article:` key is not a fragment and the constitution is not a phase); never a baked file.
2. **Project clauses override capability clauses**, regardless of registry order.
3. **A capability-vs-capability contradiction is a validation error** — fail-fast, both offenders named; only the project may resolve one.
4. **Established at setup** (the constitution skill, auto-invoked by `init`), **consulted as `guidance` at `spec`, enforced as `finding`s at `verify`** — not a per-ticket phase.

## Manifest schema v2 (the capability side, at the contract level)

Exactly one `manifest.md` at `<path>/manifest.md`:

- **`kind:`** `adapter` | `feature` | `both`.
- **Fragments table** `| phase | contribution-kind | dispatch | scope |` — `phase` and `contribution-kind` only from the fixed sets above (a manifest may not invent one); `dispatch` = `inline: <rel-path>` (forward-slash, relative to the capability's path) or `subagent: <agent>`; `scope` required only for partitioned kinds (a `surface` token for `provider`, a `source→target` pair for `artifact`, a `<skill>.<point> <merge-policy>` compound for `slot` — whose phase cell is `—`), `—` otherwise.
- **`skills:`** (feature/both — documentation only; native plugin composition loads them) · **`profile-template:`** (optional; one forward-slash path relative to the capability folder; its JSON may reserve an ordered top-level `ask` array whose resolver-validated entries carry `id`, `destination`, `prompt`, one of the bounded `string`/`boolean`/`integer`/`enum` schemas, and optional `suggestedDefault`; one invalid or over-limit entry rejects the complete set, and only a valid explicit persisted value resolves it) · **`requires:`** / **`conflicts:`** (optional; enforced at registry validation).
- **`article:`** — optional, **repeatable** manifest key `article: <key> = <value>` declaring a constitution clause (`<key>` = the clause identity, `<value>` = its stance). A manifest **key** like `requires:`/`conflicts:`, **not** a fragments-table row (`article` is not a contribution kind). The constitution skill composes it (below); registry validation rejects two active capabilities declaring the same `<key>` with different `<value>` (CHECK 9).

## The profile-seeding convention (capability-agnostic)

1. **Destination:** `_local/profiles/<capability-name>.profile.json` — `<capability-name>` is the registry's `Capability` column, verbatim. The override is seeded **only where the project's values diverge** from the capability's shipped default template; precedence: override > default.
2. **Placeholders:** every unfilled value is angle-bracketed — `<UPPER_SNAKE>`, `<UPPER_SNAKE: inline guidance>`, or `<FILL: guidance>`; a value is filled once it contains no `<…>`; fill guidance never lives in out-of-band comments — including guidance in a schema-permitted note field, which must itself be an angle-bracketed `<…>` token.
3. **Idempotency:** a re-run **never overwrites** an existing destination; it only creates a missing override, and only on divergence.
4. **No-op when absent:** a capability declaring no `profile-template:` seeds nothing — its silence is not an error.
