# Capability registry + SDD phases + contribution taxonomy (the v2 port)

**Version:** 2.17.0 (WF-445 — lifecycle workspace selection and admission: one resolver-owned API selects the lifecycle workspace root under the fixed precedence explicit > `WF_WORKSPACE_ROOT` > cwd, distinguishes an **absent** source (falls through, not a failure) from a **present-but-blank declaration** (terminal, never replaced by a lower-precedence source), canonicalizes the winner, admits it against the launch worktree family, and returns a typed admitted-root result carrying the attempted tier on success and failure alike — so every later lifecycle surface consumes one canonical value instead of re-deriving one; selection performs no write on any path, every failure resolves to a closed reason token, and project workspace admission stays strictly distinct from plugin installation-root validation, which continues to govern inventory-supplied plugin roots; WF-443 — the committed `.wf/` project-override slot tier: `resolve_content`'s `slot` class gains a third served tier at rank 20, strictly between the pack contribution (10) and the personal `_local/` override (30), realizing the interval the WF-327 chain reserved — project content wins over pack content for both `replace` and `append` with its own `project-override` provenance, personal content remains highest precedence, and a project shipping no `.wf/slots/` override resolves byte-identically to before; `.wf/slots/<skill>.<point>.md` bodies join the fingerprinted `sources` as a `slot-project-override` kind and gain a symmetric `slot/orphaned-project-override` refresh validation; `SlotProvenanceRecord` widens its `tier` union and adds `projectOverridePresent`; added as ONE new ranked `Tier` with no contract change and no change to any existing tier, contribution, or override file, leaving the interval open on both sides for a further tier; WF-442 — ordered payload declarations and deterministic portable/machine-local/artifact lifecycle evidence policy; WF-21; WF-99 — the plugin-anchored `Path` shape is now runtime-resolved via the `## Plugin Roots` mapping; WF-120 — the delivery provider surface; WF-121 — the tracker provider surface; WF-179 — the last-commit-timestamp-query read operation; WF-199 — recorded-root-first plugin-root resolution with install-manifest self-heal fallback and the hedged registered-but-unrecoverable residual diagnosis; WF-208 — ops/reference split: the runtime-followed text is extracted to `capability-registry.ops.md` (v1.0.0), leaving this contract as the reference half; WF-157 — the delivery provider surface gains six operations: `pr-comments-read`, `pr-comment-post`, `checks-read`, `review-thread-resolve`, `pr-merge`, `activity-read`; WF-158 — the tracker provider surface gains three read-only query operations: `list_by_status`, `list_milestones`, `list_cycles`; WF-176 — the delivery provider surface gains one read operation: `branch-changes-read` (branch-changes enumeration); WF-154 — the `pre-commit` self-review seam: a new operation-time injection point fired by the commit path immediately before a commit is recorded, reusing the `finding` contribution kind; WF-239 — `article` removed from the contribution taxonomy (a constitution clause is the `article:` manifest KEY, not a fragments-table row): the taxonomy is now six kinds and the manifest schema documents the `article:` key; WF-315 — the tracker provider surface gains one read-only query operation: `list_blockers` (the set of task ids that block a given task, read from the tracker's own dependency relations); WF-323 — `slot` added as the **seventh** contribution kind: a per-skill composition-surface contribution scoped by a `skill.point` token with a declared per-slot merge policy (`replace` default = single-owner/partition-like, `append` = list-like/aggregate); a slot targets a skill point, not an SDD phase, so its Fragments row carries `—` in the phase column; WF-324 — the delivery provider surface gains two review-thread operations: `review-threads-read` (a HEAD_SHA-scoped read of review threads — thread node id, file/line anchor, resolved/unresolved state, body — degrading to a **typed degraded-empty** that can never be presented as a performed HEAD_SHA read-back) and `review-thread-reply` (a per-thread reply write keyed by the thread node id), complementing the existing `pr-comments-read` / `review-thread-resolve` / `pr-comment-post` ops; WF-326 — the **skill interface declaration** (`skills/<name>/interface.md`) formalizes a skill's externally-bindable surface (invocation shape, terminal block, declared slots + merge policies, declared settings keys, safety rules) as a machine-readable sidecar a resolver reads without touching the SKILL.md body, and defines the grep-validatable `<!-- wf:slot … -->` body-marker syntax — inline-default region + no-improvisation rule — CI-enforced by `skill-slot-marker-lint.sh`; WF-327 — filled-slot composition: `resolve_content` gains a `slot` content class that linearizes every contribution to a `<skill>.<point>` under an **ordered tier chain** (personal `_local/slots/<skill>.<point>.md` override > pack contribution > inline default), serving **exactly one** composed body — `replace` = the single highest-precedence body (inline default superseded), `append` = registry-ordered concatenation with the override last (inline default kept as the first, body-supplied part); a typed `unfilled` outcome directs the caller to the inline default; the chain admits a future C020 tier between local override and pack contribution with no contract change; composition is code in the bundled resolver runtime, so the model never arbitrates between fragments; WF-328 — **per-skill settings resolution**: a slotted skill's declared `## Settings` keys resolve through the SAME seeded-override pattern as capability profiles (hybrid precedence override > declared default, seeded only on divergence), re-keyed per skill on the existing `_local/profiles/` store as `_local/profiles/<skill>.settings.json`; a `resolve_settings` query serves the override-merged VALUES (a skill with no override resolves to its declared defaults, a divergent override value wins per key), and refresh-time validation rejects an override carrying a key the skill's `interface.md` does not declare LOUDLY — a `registry-invalid` error naming the key and the skill — homed at snapshot refresh, not `validate-registry.sh`, because it depends on the WF-326 interface declarations the registry validator runs without; settings files are not yet fingerprinted into the snapshot (deferred to WF-329); WF-329 — **fingerprint contributions and overrides, fail orphans loudly, expose per-slot provenance**: slot-contribution bodies, personal `_local/slots/<skill>.<point>.md` overrides, and `_local/profiles/<skill>.settings.json` settings overrides join the snapshot's fingerprinted `sources` (hashed not stored), so editing any invalidates the snapshot on the next query; refresh-time orphan validation fails LOUDLY in **both** directions — an override targeting a `skill.point` no active `## Slots` interface declares (`slot/orphaned-override`, naming the override file + missing slot id) and a registered `slot` manifest row targeting an undeclared `skill.point` (`slot/orphaned-contribution`, naming the capability + missing slot id), each a `registry-invalid` error stating a `/wf:resolve` recovery path, homed at refresh because it depends on the WF-326 interface declarations `validate-registry.sh` runs without; `resolve_inspect` gains per-slot provenance rows (slot id → winning source → tier + override presence) and the per-skill settings-override presence index; the fix reuses the existing `inspect_pack`/snapshot lifecycle exactly (no parallel freshness mechanism), covers id-level orphans only (semantic drift stays watch-list territory), and bumps the snapshot schema to 2 + the resolver generator to 0.3.0)
**Status:** reference half of the port — rationale, history, authoring guidance, validation detail; **never read at boot**. The runtime-read half — every runtime-followed schema, guard, error path, outcome mapping, and degradation rule — is `capability-registry.ops.md` (v1.0.0), the normative home a boot follows
**Supersedes:** `core-extension.contract.md` (v1.0.0, WF-1) — the single-selector, three-named-seam port, kept as the frozen N=1 base
**Runtime half:** generalised separately by WF-22 in `invocation-runtime.contract.md` (v2.5.0) — which supersedes `invocation-mechanism.contract.md` (v1.0.0/WF-10, kept as the N=1 substrate)
**Model:** claude-opus-4-8
**Owned by:** the `wf` core plugin (capability-agnostic; ships inside the plugin)

> **Ops/reference split (WF-208).** This contract is the **reference half** — read at authoring and validation time, never at boot. The **runtime-read half** is [`capability-registry.ops.md`](capability-registry.ops.md): bounded (≤150 lines), self-sufficient one level deep, the normative home for every runtime-followed clause. Sections below carrying a "Normative runtime text" pointer keep their narrative as background; a boot follows the ops doc, never this file.

## Resolver call root

Before calling a resolver MCP tool, run `pwd -P` in the current Agent/session and explicitly pass its absolute current workspace directory as `workspaceRoot`. Each Agent derives its own value; an Agent in a linked worktree never reuses its parent's root. Omission is a hard schema error — resolver MCP calls have no default or fallback root.

---

## Purpose

This document is the **port** between the domain-free `wf` core and an arbitrary
number of pluggable **capabilities**. It declares the stable abstraction core
skills depend on so that no core skill body ever names a concrete stack, domain,
or project concern. A capability fills this port from outside the core (see its
own contract + manifest); the core depends only on the names defined here, never
on a capability's implementation, shape, or count.

`wf` is a **Spec-Driven Development** harness. The port has three parts, all
defined below as semantics only:

1. a **capability registry** — the selector that lists which capabilities are
   active (replacing the single selector of the superseded v1 port);
2. a fixed set of named **SDD phases** — the injection points a capability
   attaches prose fragments to;
3. a generic **contribution taxonomy** — the small set of fragment kinds, each
   with its phase(s), aggregation policy, and (where partitioned) ownership
   scope, so core renders any capability's output uniformly.

This document defines **semantics only**. It wires no runtime, builds no
validator, authors no capability fragment, and rewires no skill — each of those
is owned by a separate downstream task named below. Nothing here is an
instruction to execute behaviour; it is a contract.

---

## Relationship to v1 (the N=1 base this supersedes)

The committed boundary is **v1**, frozen across two contracts:

- `core-extension.contract.md` (v1.0.0, WF-1) — the **port**: a single selector
  with a Null-Object absent-state, and three named seams (`rule-audit`,
  `parity-suite`, `mapping` — **all three superseded here**). This v2 contract
  replaces it: it generalises the single selector to the registry, drops the
  three named seams in favour of SDD phases + the contribution taxonomy, and adds
  the constitution composition rule and the manifest schema-v2 shape.
- `invocation-mechanism.contract.md` (v1.0.0, WF-10) — the **runtime**: config
  read → manifest read → per-seam `inline:` / `subagent:` dispatch → no-op path.
  Its v2 generalisation (iterate the registry, inject fragments per phase,
  aggregate per policy) is owned by **WF-22** (`invocation-runtime.contract.md`,
  v2.0.0); this contract does not reopen it.

**v1 is the N=1 case, not throwaway.** A registry with exactly one row reduces to
v1's single active capability; the empty registry generalises v1's absent-state
Null Object. The v1 reference capability (`migration`) — historically kept in-repo under
`plugins/wf-caps/capabilities/migration/`, now hosted in the private `wf-caps` marketplace
(moved out of this repo per WF-261; the paths below are illustrative of that external
reference capability, not in-repo) — survives here only as the worked single-row
**example this contract resolves *to*** (see "Worked
single-row example") — never a core dependency. Everything below is the v2
generalisation of a shape v1 already proved at N=1.

---

## The `## Capabilities` registry (the selector)

> **Normative runtime text:** [the `## Capabilities` registry](capability-registry.ops.md#the--capabilities-registry-the-selector).

Core reads a **registry** of active capabilities — a `## Capabilities` table at a
**configurable location**, resolved from the repo-root `wf.config.js` `registryPath`
key and **defaulting to the downstream `_local/config.md`** when that key is absent —
in place of the single selector v1 read. The default-absent location is exactly
`_local/config.md`, so the indirection is additive and backward-compatible: an existing
repo with no `registryPath` resolves to the same file as before. (Executing this
resolution is owned by `init`, WF-9; this contract fixes the indirection and its
default.)

**Valid `registryPath` values.** When set, `registryPath` is a **repo-relative file
path** written with **forward slashes**, resolved against the repo root —
the same shape as the `Path` column's **repo-relative folder** form (shape (a) in "The
two `Path` shapes"), except it names a **file** rather than a folder, **resolves
against the repo root rather than the marketplace repo root**, and **never**
accepts the plugin-anchored `plugin:<plugin-name>/<rel-path>` token (shape (b)). It
**must not** be an absolute path (no leading `/`, no drive prefix such as `C:`) and
**must not** contain a `..` segment, so the resolved location can never escape the repo
root.
A value violating this shape is a **registry-validation error** (WF-2's registry pass /
WF-28), rejected before `init` resolves a location from it.

One row per active capability:

```markdown
## Capabilities

| Capability | Path                    |
|------------|-------------------------|
| <name>     | <repo-relative folder>  |
```

| Column | Meaning |
|--------|---------|
| `Capability` | The capability's **name** — its identity, decoupled from where it lives so the binding survives the capability moving into a standalone add-on plugin. Used to locate config, never to key a core code path. |
| `Path` | The location of the capability's `manifest.md` and reference docs, in **one of two accepted shapes** (forward slashes in both): (a) a **repo-relative folder** — the path relative to the marketplace repo root (e.g. `plugins/wf-audit/capabilities/audit`); or (b) a **plugin-anchored token** of the shape `plugin:<plugin-name>/<rel-path>`, naming a capability that lives *inside* an installed plugin (`<plugin-name>` is the plugin's manifest name; `<rel-path>` is forward-slash, relative to that plugin's install root). Core reads the manifest at `<path>/manifest.md`; it never hardcodes a folder. **Both shapes resolve at runtime** — the plugin-anchored token via the `## Plugin Roots` mapping (see "The two `Path` shapes" and "The `## Plugin Roots` mapping" below). |

Registry semantics:

1. **Empty table = fully generic core.** An empty (or absent) `## Capabilities`
   table means no capability is active — the v2 generalisation of v1's
   absent-state Null Object. Every phase below runs **exactly as if inert**: a
   phase with zero attached fragments produces its declared empty result and the
   surrounding SDD skeleton proceeds unchanged. **No stack/domain/project term
   ever surfaces.** Core is fully usable with the registry empty.

2. **Core iterates; it never names or counts.** Core walks the registry rows in
   order; it never lists a specific capability name, never tests `if active ==
   <some concrete name>`, and never carries a code path keyed to one capability
   or to "how many" are active. Adding or removing a capability requires **zero**
   edits to any core skill body — the registry (downstream, outside
   `plugins/wf/`) carries every binding.

3. **Table order = deterministic injection order.** Rows are listed **general →
   specific**. Order is the single composition knob: for additive `guidance`
   (below) the most-specific capability is injected **last and wins**; for
   provenance-tagged and partitioned kinds, order is cosmetic. (See "Aggregation
   policy".)

4. **N=1 reduces to v1.** A single-row registry is exactly v1's single active
   capability; the empty registry is exactly v1's absent state. Backward
   compatibility is structural, not bolted on.

### The two `Path` shapes (both runtime-resolved)

The `Path` column accepts two token shapes; **both resolve at runtime** (WF-99):

1. **Repo-relative folder.** A path relative to the marketplace repo root (forward
   slashes). It resolves in the marketplace checkout exactly as v1's selector did.
   This is the form for a capability vendored in the repo. An existing repo-relative
   registry resolves with **no change** — the second shape is **purely additive and
   backward-compatible.**

2. **Plugin-anchored token — `plugin:<plugin-name>/<rel-path>`.** This shape names a
   capability living *inside* an installed plugin, whose on-disk install root varies
   per machine. Core resolves it by looking `<plugin-name>` up in the **`## Plugin
   Roots` mapping** (below), resolving `<root>/<rel-path>` and reading its
   `manifest.md`. This is the form to use on a **plugin-only install**, where the
   consuming repo does not vendor the plugin's `capabilities/` folder.

   **Why a mapping is needed (the datum core was missing).** `${CLAUDE_PLUGIN_ROOT}`
   resolves only to the **executing** plugin's own install root, so a capability path
   inside a *sibling* plugin (core reaching a capability that ships in a separate pack
   plugin) cannot be resolved from it — core has no `<plugin-name>` → install-root
   map of its own. The `## Plugin Roots` mapping supplies exactly that datum: it is
   written by a **pack-owned init skill**, which runs with *its* `${CLAUDE_PLUGIN_ROOT}`
   equal to the pack's install root and records it. Core then reads a generic
   `<plugin-name>` → root table and resolves any plugin-anchored `Path` from it,
   naming no concrete plugin.

---

### The `## Plugin Roots` mapping

> **Normative runtime text:** [the `## Plugin Roots` mapping](capability-registry.ops.md#the--plugin-roots-mapping).

The datum that resolves a plugin-anchored `Path` is a second table, **co-located with
the `## Capabilities` registry** at the `registryPath`-resolved location (default
`_local/config.md`, gitignored):

```markdown
## Plugin Roots

| Plugin     | Root                              |
|------------|-----------------------------------|
| <name>     | <absolute or repo-relative root>  |
```

| Column | Meaning |
|--------|---------|
| `Plugin` | The `<plugin-name>` used in a `plugin:<plugin-name>/<rel-path>` `Path` token — the plugin's manifest name. Matches the token's `<plugin-name>` segment verbatim. |
| `Root` | That plugin's **install root** — the folder its `capabilities/` live under. **Per-machine.** |

Mapping semantics:

1. **Resolution.** For a registry row whose `Path` is `plugin:<name>/<rel-path>`, core
   looks `<name>` up in this table and resolves `<root>/<rel-path>/manifest.md`. A
   **repo-relative** `Root` is joined to the repo root; an **absolute** `Root` is used
   as-is. This **recorded** root is tried **first**; when it dangles (a pack upgrade or
   machine move left it pointing at a directory that no longer exists), resolution
   **self-heals** via Claude Code's install manifest — see "Recorded-root-first
   resolution with install-manifest self-heal" below. A `plugin:` `Path` whose `<name>`
   has **no** row here is **unmapped** — the validator errors on it (naming the plugin);
   the runtime **no-ops** that row (fail-safe), exactly like a missing manifest.

2. **`Root` shape — deliberately distinct from `Path`/`registryPath`.** `Root`
   **may be absolute or drive-prefixed** (a plugin install root is absolute *by
   nature*), unlike the `Path` column and `registryPath`, which forbid absolute paths
   precisely so a *committed, repo-relative* location can never escape the repo. That
   escape concern does not apply here: the mapping lives in gitignored, per-machine
   `_local/`, and its whole purpose is to record a machine-specific install root. `Root`
   is still rejected if it contains a `..` segment or a backslash (a residual traversal
   guard; forward slashes only). Registry validation (WF-2's registry pass / WF-28)
   enforces this `Root` shape.

3. **Per-machine, gitignored, pack-written.** Because a `Root` is an absolute
   machine-specific path, the mapping belongs under `_local/` (already gitignored) and
   is **never** committed to `wf.config.js` or the registry `Path` column. A
   **pack-owned init skill** writes and refreshes each row (its own install root can
   move between machines / upgrades); **core never writes another plugin's root** — it
   only reads the table. When the registry is relocated to a **committed** file via
   `registryPath`, the machine-specific `## Plugin Roots` table must stay gitignored
   (keep it in `_local/`); the default location already is.

4. **No-op when absent.** A registry with only repo-relative `Path` rows needs no
   `## Plugin Roots` table at all — an absent or empty table simply means no
   plugin-anchored row can resolve, and repo-relative resolution is unchanged. This
   mirrors the empty-registry / inert-phase no-op: the mapping matters only when a
   `plugin:` `Path` is present.

#### Recorded-root-first resolution with install-manifest self-heal

> **Normative runtime text:** [recorded-root-first resolution with install-manifest self-heal](capability-registry.ops.md#recorded-root-first-resolution-with-install-manifest-self-heal).

A recorded `Root` can **dangle**: a pack upgrade — or a machine move — can relocate a
plugin's install root, leaving its `## Plugin Roots` row pointing at a directory that
no longer exists even though the pack is still installed. Resolution therefore tries
the recorded root **first** and, only when it dangles, **self-heals** from Claude
Code's install manifest. This recovers the current root without a re-init, and is
**in-memory only** — core reads the manifest to resolve a root for the current run; it
**never** writes another plugin's root back (writing the `## Plugin Roots` table stays
the pack init skill's job, per rule 3 above).

**Resolution algorithm (runtime-followed).** For a registry row whose `Path` is
`plugin:<plugin-name>/<rel-path>`, core resolves the plugin root in this order:

1. **Recorded root first.** Take the `Root` recorded for `<plugin-name>` in
   `## Plugin Roots` (repo-relative joined to the repo root; absolute as-is) and
   resolve `<root>/<rel-path>/manifest.md`. If that manifest file **exists on disk**
   (the recorded root is live), use it — done.
2. **Dangling → install-manifest fallback.** If the recorded root is **dangling** — its
   `<root>/<rel-path>/manifest.md` is not present on disk — read Claude Code's install
   manifest — the non-versioned file at `~/.claude/plugins/installed_plugins.json` —
   and recover the plugin's current install root from it:
   1. **Marketplace-exact key.** Derive core's own marketplace by matching core's
      `${CLAUDE_PLUGIN_ROOT}` against the manifest, and form the exact sibling key
      `<plugin-name>@wf-marketplace` (the marketplace that ships core). Look that exact
      key up **first**; only when it is **absent** from the manifest, fall back to
      matching on the bare `<plugin-name>` (the left-of-`@` segment) alone.
   2. **Path normalization.** Normalize every path read from the manifest
      backslash→forward-slash before use, so a manifest written on one OS resolves on
      another.
   3. **Prefer an existing `installPath`.** When more than one record matches for a
      scope, select the record whose `installPath` **exists on disk**, so a stale
      record never shadows the live one.
   Resolve `<recovered-root>/<rel-path>/manifest.md` from the recovered root and use it.
3. **Still unrecoverable.** If neither the recorded root nor the install-manifest
   fallback yields a readable `manifest.md` (manifest absent or unparseable, no matching
   record, or the recovered directory also missing), the row resolves to **no readable
   manifest** — the validator errors on it (naming the plugin), and the runtime
   **no-ops** that row (fail-safe, exactly like an unmapped row or a missing manifest).
   A write that needs this capability's provider surface then surfaces the residual
   diagnosis below instead of silently misreporting "no provider."

**Residual "registered-but-unrecoverable" diagnosis (runtime-followed).** When a
**write** for a provider surface `<S>` — a `delivery` or `tracker` surface (see the
surface sections below) — finds **zero readable** providers for `<S>`, the outcome
splits two ways, and the two are **never** conflated:

- **(a) Genuine "no provider."** Every registered capability's manifest is **readable**
  and none is scoped to `<S>`. Emit the pre-existing "no `<S>` provider registered"
  message, unchanged and correct, and name the remedy (register a capability that owns
  `<S>` in the `## Capabilities` registry).
- **(b) Registered-but-unrecoverable.** One or more registered capabilities have an
  **unreadable** manifest (step 3 above). Name those pack(s) as **candidates** — taken
  from the `## Capabilities` row, which carries only `Capability` + `Path`, never a
  `scope` — and **hedge** the surface attribution: *"registered pack(s) [X, …] have an
  unrecoverable manifest at that path; if one is your `<S>` provider, fix its stale root
  / re-run its init."* List **all** unreadable-manifest packs when more than one.
  **Never** assert that a named pack owns surface `<S>`: a capability's `scope` lives
  only in its (now unreadable) manifest, so surface ownership is unknowable precisely
  when the manifest cannot be read — asserting it would reintroduce the very
  misdiagnosis this resolution kills.

**Surfacing by site (runtime-followed).** The same split surfaces differently by where
the operation runs: a **delivery write** surfaces case (b) **loudly** (it blocks, like
the genuine-no-provider delivery write); a **tracker write** emits it as the
**warn-once**, then continues local-only (per the tracker degradation rules); a
**read** on either surface stays **silent local-only** and emits nothing (a read always
resolves to something usable via its plain-directory fallback).

**Rationale and dependency bound (reference).** Recorded-root-first keeps the common
path a single table read with **zero** manifest dependency; the install manifest is
consulted **only** to recover from a dangling root, and that dependency is **bounded to
recovering the plugin root** — on an absent or unparseable manifest, resolution
degrades to the truthful "re-run init" remedy (step 3 / the residual diagnosis),
**never** to total breakage of unrelated resolution. The hedged, candidate-naming form
exists because the failure that triggers it (an unreadable manifest) is exactly the
failure that makes surface ownership unknowable — so the diagnosis names *candidates*
and prescribes the fix (re-run the pack's init to rewrite its `## Plugin Roots` root)
without ever asserting an ownership it cannot verify. Resolution stays in-memory
throughout: core still only ever **reads** the `## Plugin Roots` table and never writes
another plugin's root.

The mapping names **no** concrete plugin or capability; it is the generic
`<plugin-name>` → root shape every pack's install root plugs into. Its location and
shape are fixed here (a downstream-visible contract, like a phase name); executing the
resolution is owned by the runtime (`invocation-runtime.ops.md`), writing it by a
pack-owned init skill, and checking it by the validator.

---

## The SDD phases (the injection points)

> **Normative runtime text:** [the SDD phases](capability-registry.ops.md#the-sdd-phases-the-injection-points).

Core ships a fixed **SDD lifecycle spine** — the canonical Spec-Driven Development
phases (Specify → Plan → Tasks → Implement) plus `wf`'s `verify` / `qa` extension.
Each phase is a gated, human-approved markdown artifact that feeds the next. A
capability attaches prose fragments **only to the phases it has something to say
about**; a phase it does not touch runs as if inert for that capability.

Two phases — `spec` (WHAT) and `implement` (HOW) — are **authoring hubs**, where
capability knowledge primarily enters; the rest largely *derive from* or *check*
the authored artifacts.

| Phase | SDD role | What a capability contributes here | Contribution kind |
|-------|----------|------------------------------------|-------------------|
| `spec` | Specify — **authoring hub** (WHAT) | conventions, constraints, acceptance criteria, invariants; *also* the ownership anchor for the tracker `provider` (registration only — see "The tracker provider surface") | authoring `guidance`; `provider` (tracker surface) |
| `plan` | Plan — derivation | correspondence / decomposition that can't live as spec prose | `artifact` |
| `tasks` | Tasks — derivation | opinionated decomposition into small, independently testable units | `task-list` |
| `implement` | Implement — **authoring hub** (HOW) | stack idioms / scaffolds; apply the plan's correspondence; *also* the ownership anchor for the delivery `provider` (registration only — see "The delivery provider surface") | authoring `guidance`; `provider` (delivery surface) |
| `verify` | wf extension — checking | assert conformance to the spec + spec-derived invariants | `finding` |
| `qa-generation` | wf extension — checking | scenarios derived from acceptance criteria | `scenario` |
| `qa-execution` | wf extension — provider | the execution engine + environment | `provider` |
| `pre-commit` | wf extension — delivery-path seam (operation-time; **not** a gated artifact) | a self-review of the staged change set that gates or annotates the commit about to be recorded | `finding` |

The phase names are **fixed by this contract**. A capability's manifest may attach
a fragment only to a phase named here; it may not invent a phase. The one exception
is a **`slot`** contribution (see "The contribution taxonomy"), which targets a
per-skill composition *point* rather than an SDD phase — its Fragments row carries
`—` in the phase column and names the point in its `skill.point` scope. The constitution
(below) is **not** a phase in this spine — it is a cross-cutting constraint
established at setup and enforced at `verify`.

`pre-commit` is likewise **not** part of the linear artifact spine — it authors no
gated markdown artifact and feeds no next phase. It is an **operation-time injection
point** fired by the commit path immediately before a commit is recorded — the
delivery-side analogue of the way the `verify` phase fires `finding`s — so a
capability may inspect the staged change set and gate or annotate the commit without
core naming it. Its firing semantics, empty-result no-op, and gate/annotate shape are
fixed in "The pre-commit self-review seam" below.

---

## The contribution taxonomy (the fragment kinds)

> **Normative runtime text:** [the contribution taxonomy](capability-registry.ops.md#the-contribution-taxonomy-the-fragment-kinds).

A capability attaches each fragment under exactly one **contribution kind**. Core
defines a fixed, small taxonomy so it can render any capability's output uniformly
without naming the capability. Each kind below states its phase(s) and its
**aggregation policy** — how core combines multiple contributors at the same phase.

| Kind | Phase(s) | What it carries | Aggregation policy |
|------|----------|-----------------|--------------------|
| authoring `guidance` | `spec`, `implement` | prose authoring direction (conventions, constraints, stack idioms) the core skill follows while authoring the artifact | **aggregate** — follow every contributor in registry order; most-specific (last) wins on conflict |
| `task-list` | `tasks` | an opinionated decomposition into small, independently testable units | **aggregate** — append every contributor's tasks |
| `artifact` | `plan` | a structured correspondence table / document derived in the plan phase | **partition by ownership** — only the owning capability applies (scope below) |
| `finding` | `verify`, `pre-commit` | a conformance issue asserted against the work under review (at `verify`) or against the staged change set about to be committed (at `pre-commit`) | **aggregate** — every contributor's findings, **provenance-tagged** |
| `scenario` | `qa-generation` | an executable check derived from an acceptance criterion | **aggregate** — every contributor's scenarios, provenance-tagged |
| `provider` | `qa-execution`, `implement`, `spec` | a capability that supplies *execution* (an engine or environment) or an *operation* (a delivery or tracker action), not a result | **partition by ownership** — one owner per surface (scope below); subagent dispatch (`qa-execution`) or direct resolve (`implement`, delivery surface; `spec`, tracker surface — see below) |
| `slot` | *n/a — targets a `skill.point`, not an SDD phase* | content contributed to a named per-skill composition **point** inside another skill's body (identified by its `skill.point` scope) | **per-slot merge policy** — `replace` (single owner, partition-like) or `append` (list-like, aggregate); declared in the scope (below) |

The taxonomy has **seven** kinds. A **constitution `article` is not among them** — it
is deliberately excluded, because an article is not a phase fragment: it attaches to
the **constitution**, which "is *not* a phase in this spine" (see "The SDD phases"),
so it can never legally sit in a manifest's fragments table (whose `phase` column
accepts only an SDD phase). A capability declares its non-negotiable clauses instead
with the dedicated **`article:` manifest key** (`article: <key> = <value>` — see
"Manifest schema v2" and "The constitution composition rule"), a manifest key of the
same family as `requires:` / `conflicts:`. Registry validation rejects a fragments-table
row that names `article` as its contribution kind (WF-239).

Authoring `guidance` and `task-list` are **authoring-side** kinds the hubs and the
`tasks` derivation consume. `finding` / `scenario` are
**provenance-carrying** kinds — each fragment's output is tagged with its
contributing capability, so registry order is cosmetic for them (attribution is
explicit); the constitution's `article:` declarations carry provenance the same way.
`artifact` and `provider` are **partitioned** — overlap is an error,
not a merge. `slot` is **conditionally partitioned** — a `replace` slot behaves
like a partitioned kind (single owner per `skill.point`), an `append` slot like an
aggregate one (contributions to one `skill.point` compose).

### Aggregation policy — `aggregate` vs `partition`

- **`aggregate`** — core follows **every** contributor at the phase, in **registry
  order** (general → specific). For additive authoring `guidance`, the most
  specific capability is injected last and therefore wins on any conflict. For
  the provenance-carrying kinds (`finding`, `scenario`), order is
  cosmetic — each contribution is tagged with its source capability (the
  constitution's `article:` declarations aggregate with provenance the same way).
- **`partition`** — only the **owning** capability applies at the phase; no merge
  occurs. Overlapping ownership across active capabilities is a
  **registry-validation error** (WF-2's registry pass / WF-28), with both
  offenders named. Two partitioned kinds carry an ownership **scope** token:

  - **`provider`** carries a **`surface`** token drawn from a small controlled
    enum (`engine`, `host`, `delivery`, `tracker`, …). Two capabilities claiming the
    **same** surface = validation error; **different** surfaces compose (e.g. one
    capability owns `engine`, another owns `host`, a third owns `delivery`, a
    fourth owns `tracker`) — ownership uniqueness is checked **by surface token,
    independent of which phase(s) the claiming fragment is attached to** (see "The
    delivery provider surface" and "The tracker provider surface" below).
  - **`artifact`** carries a **`source→target`** token pair drawn from a
    controlled vocabulary (e.g. `csharp→ts`). Ownership is whole-unit — a pair is
    owned entirely by one capability, never split. Overlap = an identical pair
    claimed by two capabilities = validation error.
  - **`slot`** carries a **`<skill>.<point> <merge-policy>`** compound scope: the
    **`skill.point`** (e.g. `ship.review`) identifies the composition point, and
    the **merge policy** (`replace` | `append`) declares how multiple contributions
    to that point combine. The policy is what makes `slot`'s partitioning
    *conditional*: a `replace` claim is single-owner (partition-like), so **two
    active capabilities each `replace`-claiming the same `skill.point` is a
    validation error**, both named; an `append` claim is list-like (aggregate-like),
    so two `append` claims on one `skill.point` **compose** and never conflict.
    Each segment of the `skill.point` is lowercase letters / digits / hyphens
    joined by a single dot; a blank scope, a malformed `skill.point`, or an
    absent / unknown merge policy is a validation error.

Start with the minimal scope vocabulary above; upgrade to a richer scope schema
only when a real second owner of the same surface or pair appears.

---

### The delivery provider surface

> **Normative runtime text:** [the delivery provider surface](capability-registry.ops.md#the-delivery-provider-surface).

Core has no vocabulary of its own for version-control / delivery operations —
creating a branch, committing, pushing, opening or detecting a pull request — so
a capability that wants to bind that behaviour to core has nothing to attach to.
The **delivery provider surface** is a `provider` fragment, scoped by the
**`delivery`** `surface` token, that fills this gap using the same
partitioned-ownership mechanism `qa-execution`'s `engine` / `host` surfaces
already use — not a parallel mechanism.

**Operation set — named abstractly, zero git/gh strings, no plumbing
exemption.** A capability owning the `delivery` surface implements:

- **Write side:** `branch-create`, `branch-switch`, `commit`, `push-upstream`,
  `pr-create`, `pr-detect`, `pr-comment-post`, `review-thread-resolve`,
  `review-thread-reply`, `pr-merge`.
- **Read side**, consumed by core (e.g. for id inference and standup):
  `workspace-root-resolve`, `current-branch-query`,
  `last-commit-timestamp-query`, `branch-changes-read`, `pr-comments-read`,
  `review-threads-read`, `checks-read`, `activity-read`.

The six operations added for the coupled PR-review, merge, and standup features
(the Wave-4 opener) extend — never reshape — the same partitioned surface, each
named abstractly: `pr-comment-post` posts a review comment on a pull request;
`pr-comments-read` reads the review comments on one; `review-thread-resolve`
marks a review thread resolved; `checks-read` reads a pull request's check
results; `pr-merge` merges a pull request; and `activity-read` reads recent
delivery activity (commits and pull requests) for a standup summary.

`branch-changes-read` (added later, again extending — never reshaping — the same
partitioned surface) is the read operation that **enumerates what changed on the
branch**: it returns the branch's changed-file set (the paths added, modified, or
removed on the current branch relative to its base), so a core skill can learn
which files a branch touched without any version-control vocabulary of its own.
Like every read operation, it **consumes** an already-resolved branch context and
takes no write; deriving that context (or a base ref) is the caller's job, not
the operation's.

`review-threads-read` and `review-thread-reply` (added later still, again
extending — never reshaping — the same partitioned surface) are the two
**review-thread** operations a review gate needs, and they **complement, never
duplicate**, the three review operations already on this surface:

- `review-threads-read` (read) answers *"what review threads exist at exactly
  `HEAD_SHA`?"* — it returns the pull request's review threads **scoped to the
  current head commit**, each carrying its **thread node id**, its **file/line
  anchor**, its **resolved/unresolved** state, and its **body**. This is
  strictly more than `pr-comments-read`, which reads the whole review
  conversation as a flat comment list with no per-thread resolved state and **no
  head-commit scoping**: a thread anchored to a stale (superseded) commit is
  **dropped**, never presented as current. The thread node id it returns is the
  same identity `review-thread-resolve` already consumes.
- `review-thread-reply` (write) posts a reply on **one specific thread**, keyed
  by that same **thread node id**. This complements `pr-comment-post`'s optional
  `<reply-to>` (which threads a reply keyed by a REST review-**comment** id, in
  the general PR-comment flow): a consumer that read threads via
  `review-threads-read` holds thread node ids and replies on that same identity
  with no id-space translation, while `pr-comment-post` remains the path for a
  PR-level comment or a REST-comment-id reply.

**Degradation shape — a typed degraded-empty for `review-threads-read`.** The
other read-side empties on this surface (`pr-comments-read`, `checks-read`,
`activity-read`) follow the **silent-empty** precedent: an empty result is
indistinguishable from "nothing there", which is harmless because none of them
backs a merge-blocking claim. `review-threads-read` is deliberately **different**:
its result is **typed** with a `<read-performed>` flag that is true **only** when
the pull request's threads were actually read at `HEAD_SHA` (even a genuinely
empty thread set at `HEAD_SHA` returns `<read-performed>` = true). A bare-core /
no-provider (or no-branch / no-PR-context) empty returns `<read-performed>` =
false. This typing exists so that a bare-core degraded empty **can never be
presented as a performed `HEAD_SHA` read-back**: a consumer honouring the
review-gate rule (no *"no review landed"* claim without an API read-back at
`HEAD_SHA`) treats **only** `<read-performed>` = true as a valid read-back, so
the silent absence of a delivery provider can never masquerade as a confirmed
"no unresolved threads" result.

No operation name, and no prose describing it, may contain a git/gh command
string or a plumbing invocation. "Branch", "commit", "deliver", "workspace
root", "changes" / "changed files", "review comment", "review thread",
"resolved", "reply", "check", "merge", and
"activity" are abstract vocabulary, not hits — a capability's own manifest and
fragment prose is where any concrete tool binds to these names.

**Phase anchor — registration only, not a firing gate.** A `delivery`-surface
`provider` fragment is attached at the `implement` phase (the SDD phase where a
delivery operation is actually exercised in practice — the tail of an
implementation). Unlike `qa-execution`'s `provider`, which is fired as part of
that phase's fragment collection, the `implement` phase attachment here is an
**ownership anchor for registry validation only** — it does not restrict *when*
a core skill may invoke a delivery operation. Any core skill, at any point in its
own procedure, resolves the `delivery` surface directly. The runtime mechanics of
that direct resolution are defined in `invocation-runtime.ops.md`'s "Direct
provider resolution" section — this contract states the surface's existence and
semantics; that document states how core reaches it.

**Workspace-root plain-directory fallback.** When no active capability owns the
`delivery` surface, `workspace-root-resolve` resolves the workspace root as a
**plain directory** — no VCS invocation of any kind. This fallback is how core
locates `wf.config.js` and `_local/` when running in bare-core mode (no delivery
provider registered): the plain-directory resolution is not a degraded mode, it
is the contract's defined behaviour for the unconfigured case.

**Last-commit-timestamp plain-directory-safe fallback.** When no active
capability owns the `delivery` surface, `last-commit-timestamp-query` resolves
to a **plain-directory-safe filesystem read** — no VCS invocation of any kind —
consistent with the "a read operation always resolves to something usable"
guarantee. As with `workspace-root-resolve`'s own fallback, this contract does
not prescribe a specific algorithm (e.g. a directory's own modification time is
illustrative only, not the mandated mechanism); the exact algorithm is left to
whichever provider or bare-core path resolves it.

**Branch-changes plain-directory-safe fallback.** When no active capability owns
the `delivery` surface, `branch-changes-read` likewise resolves to a
**plain-directory-safe filesystem read** — no VCS invocation of any kind — and
falls back **silently** (no error, no warning), the same defined bare-core
behaviour as `workspace-root-resolve` and `last-commit-timestamp-query`, not a
degraded mode. As with those two, this contract does not prescribe a specific
algorithm; the exact plain-directory enumeration is left to whichever bare-core
path resolves it. This silent low-level fallback is deliberately **distinct**
from a caller detecting that no delivery provider is registered: a core skill
that must branch on provider presence (e.g. to decide whether a branch-scoped
operation is meaningful) tests **surface ownership** in the `## Capabilities`
registry separately — the two paths never conflate, so a silent read fallback
never masks a caller's own provider-absence decision.

**Unconfigured-provider behaviour.**

- **Reads** (`workspace-root-resolve`, `current-branch-query`,
  `last-commit-timestamp-query`, `branch-changes-read`, `pr-comments-read`,
  `checks-read`, `activity-read`) fall back **silently** — no error, no warning.
  A read operation always resolves to *something* usable: the first four via the
  plain-directory path (below) — `branch-changes-read`'s own plain-directory-safe
  read joins `workspace-root-resolve` and `last-commit-timestamp-query` here;
  `pr-comments-read`, `checks-read`, and `activity-read` to an **empty result**
  (no review-comment, check, or recent-activity context exists outside a delivery
  provider).
- `review-threads-read` also resolves to an empty result, but a **typed** one:
  its `<read-performed>` flag is **false** (never true) in bare-core, so the
  empty is explicitly *not* a performed `HEAD_SHA` read-back — the one read on
  this surface that does **not** follow the plain silent-empty precedent, exactly
  because it feeds a merge-blocking "no unresolved threads" claim that a silent
  empty must never be allowed to satisfy.
- A **write** operation (`branch-create`, `commit`, `push-upstream`, `pr-create`,
  `pr-comment-post`, `review-thread-resolve`, `review-thread-reply`, `pr-merge`,
  …) invoked by a
  user-initiated skill with **no** `delivery`-surface owner active
  states **plainly** that no delivery provider is registered and **names the
  remedy** (register a capability that owns the `delivery` surface in the
  `## Capabilities` registry) — it does not fail silently or guess a fallback. That
  plain "no delivery provider" statement is the **genuine-no-provider** case (a) of the
  residual diagnosis; when the zero-provider result instead arises because a
  **registered** capability's manifest is **unrecoverable** (its recorded root dangles
  and the install-manifest self-heal fails), the delivery write surfaces the
  **registered-but-unrecoverable** diagnosis **loudly** instead — naming the candidate
  pack(s) and hedging surface attribution per "Recorded-root-first resolution with
  install-manifest self-heal" (`## Plugin Roots`).

**Single-shot-publish idempotency.** A delivery operation whose result is an
id or URL (`pr-create` is the canonical case; `pr-comment-post` is the second —
its returned comment URL) has that returned id/URL **recorded as a metadata line
in the local artifact that triggered it** — the same `**<label>:** <value>`
metadata-line shape used elsewhere for per-artifact attribution (e.g. a
model-attribution line). Before invoking that operation again for the same
artifact, the caller **reads the metadata line back first**; a present value
means the operation already ran and is treated as already-published — it is
never re-invoked. This is the caller-side idempotency guard for an operation
whose provider has no idempotency of its own. `pr-merge` needs no such recorded
line: it guards by **detect-first** — a pull request already merged is a
detectable no-op, so re-invoking it never double-merges.

---

### The tracker provider surface

> **Normative runtime text:** [the tracker provider surface](capability-registry.ops.md#the-tracker-provider-surface).

Core has no vocabulary of its own for issue-tracker operations — creating a
top-level work item, nesting a child work item beneath it, commenting, moving a
status, attaching a link, enumerating work items by workflow status, milestones,
or cycles, reading the task ids that block a given task — so a capability that
wants to bind that behaviour to core has nothing to attach to. The **tracker provider surface** is a `provider`
fragment, scoped by the **`tracker`** `surface` token, that fills this gap using
the same partitioned-ownership mechanism the `delivery` surface already uses —
not a parallel mechanism.

**Operation set — named abstractly, zero tracker-product strings, no plumbing
exemption.** A capability owning the `tracker` surface implements:

- `resolve_config` — read tracker configuration; report configured or
  unconfigured (local-only).
- `create_umbrella` — create the top-level work item for a task.
- `create_child` — create a work item nested under a parent (used both for a
  task's own child work items and for further nesting beneath those).
- `update` — update fields on an existing work item.
- `get` — fetch a work item's current state.
- `list_children` — enumerate the existing child work items of a parent.
- `post_comment` — post a comment on a work item.
- `set_status` — move a work item to a named workflow status.
- `attach_link` — attach an external URL to a work item.
- `list_by_status` — enumerate the work items currently in a named workflow
  status.
- `list_milestones` — enumerate the milestones defined for a scope.
- `list_cycles` — enumerate the cycles (time-boxed work periods) defined for a
  scope.
- `list_blockers` — for a given task id, return the set of task ids that
  **block** it (its blocking predecessors), read from the tracker's own
  dependency relations; an **empty set**, not an error, when the task has none.

The last four are **read-only query operations**: they enumerate the active
tracker's own records, consume an already-resolved status name / scope / task id
(never derive one), and take no write. They inherit the degradation rules below —
an unconfigured tracker returns an **empty result** (silent local-only, a read
never warns); a mid-run failure warns once and continues local-only — and add
nothing to the id-shape rule. They exist because a prioritized cross-tracker
briefing (and, downstream, a dependency-ordered fan-out runner) needs them
without baking any tracker-product string.

No operation name, and no prose describing it, may contain a concrete
tracker-product name, API shape, or vocabulary term. "Work item", "umbrella",
"child", "status", "milestone", "cycle", and "blocker"/"block" are abstract
vocabulary, not hits —
a capability's own manifest and fragment prose is where any concrete tracker
binds to these names.

**Phase anchor — registration only, not a firing gate.** A `tracker`-surface
`provider` fragment is attached at the `spec` phase (the SDD phase where a
tracker operation is first exercised in practice — a task's umbrella/child work
items are created at authoring time). Exactly like the `delivery` surface's
`implement` anchor, this attachment is an **ownership anchor for registry
validation only** — it does not restrict *when* a core skill may invoke a
tracker operation. Any core skill, at any point in its own procedure, resolves
the `tracker` surface directly, via the same "Direct provider resolution"
procedure in `invocation-runtime.ops.md` the `delivery` surface already
uses — this contract states the surface's existence and semantics; that
document states how core reaches it.

**The id-shape rule.** The active tracker capability supplies the shape of a
task id (e.g. a tracker-native identifier format). When the registry has **no**
active `tracker`-surface owner, core falls back to its own **local id scheme**:
`T<NNN>` — scan the **task root** (`{task-root}`, the folder where per-task
artifacts are written; core resolves it the same way every other core skill
does, via its own config) for existing `T<NNN>`-prefixed task folders anywhere
under it, take the highest existing number, increment by one, and zero-pad to
3 digits. This is the same
"empty table = fully generic core" guarantee the registry already states in
general, applied concretely to task-id generation: an empty registry yields a
deterministic local id with **no** tracker call at all.

**Degradation rules.**

- **Unconfigured tracker** — a silent local-only fallback. No prompt, no error;
  every read and write proceeds against local artifacts alone.
- **Mid-run provider failure** — an operation call that errors after a tracker
  was configured **warns once**, naming the failing operation and the error,
  then **continues local-only** for the remainder of the run. A tracker failure
  never blocks a local artifact write.
- **Registered-but-unrecoverable provider** — when the `tracker` surface has **zero
  readable** providers because a **registered** capability's manifest is unrecoverable
  (recorded root dangling and the install-manifest self-heal failed), a tracker
  **write** emits the residual **registered-but-unrecoverable** diagnosis as the
  **warn-once** (candidate pack(s) named, surface attribution hedged, per
  "Recorded-root-first resolution with install-manifest self-heal" in
  `## Plugin Roots`), then continues local-only; a tracker **read** stays **silent
  local-only**. This is distinct from the unconfigured case above (no registered
  tracker at all), which stays silent.

**Single-shot-publish idempotency.** A tracker write whose result is an id
(`create_umbrella` and `create_child` are the canonical cases) has that returned
id **recorded as a metadata line in the local artifact that triggered it** —
the same `**<label>:** <value>` metadata-line shape the `delivery` surface's
`pr-create` operation already uses. Before invoking that operation again for the
same artifact/slot, the caller **reads the metadata line back first**; a present
value means the operation already ran and is treated as already-published — it
is never re-invoked.

---

### The pre-commit self-review seam

> **Normative runtime text:** [the pre-commit self-review seam](capability-registry.ops.md#the-pre-commit-self-review-seam).

Core has no place, of its own, where a capability may inspect a change **before it is
recorded** — the phase spine ends its authoring at `implement` and its checking at
`verify` (post-implementation) / `qa` (post-implementation), none of which sits on the
commit path. The **pre-commit self-review seam** fills that gap. It is the `pre-commit`
phase (the SDD-phases table above): an **operation-time injection point** fired by the
commit path immediately **before** a commit is recorded, reusing the existing `finding`
contribution kind — **no new kind** is introduced.

- **Reuses `finding`, provenance-tagged (aggregate).** A pre-commit self-review is a
  set of findings about the staged change set, exactly the shape `finding` already
  carries at `verify`; the seam adds a second phase to `finding`, not a new taxonomy
  kind. Multiple capabilities compose: every contributor's findings are aggregated in
  registry order, each tagged with its source capability (order is cosmetic, as for
  every `finding`).
- **When it fires.** The core commit path fires it on **every** route to a commit — a
  direct commit invocation and every programmatic commit (the PR and full-cycle paths
  that reach the same commit operation) — immediately before the commit operation, and
  **only when a real change is pending** (never on the nothing-to-commit path, where no
  commit is recorded and there is nothing to review).
- **Empty-result no-op — inert when unregistered.** With an **empty registry**, or a
  registry in which **no** capability attaches a fragment at `pre-commit`, the phase
  produces its declared empty result: **no finding surfaces, no term of any capability
  appears, and the commit proceeds byte-identically to a core with no seam at all.**
  This is the same "empty table = fully generic core / inert phase" guarantee the
  registry already states, applied to the commit path.
- **Gate or annotate — the contributor decides; core only fires and honors.** A
  contributed finding may **gate** (block the commit) or merely **annotate** (record an
  observation and let the commit proceed); which one is the **contributing
  capability's** determination, carried in its finding, not core's. Core's role is
  fixed and capability-agnostic: fire the phase, aggregate the findings, and — if any
  aggregated finding signals a block — **not record the commit**; otherwise proceed.
  Core names, requires, and assumes **no** capability at this seam, exactly as it names
  none at `verify`.
- **A phase firing, not a provider resolution.** The seam is fired the way any core
  phase-firing skill fires a phase (walk the registry, collect the phase's fragments,
  dispatch, aggregate) — **distinct from** the direct resolution of the `delivery`
  `provider` surface the commit path also uses for the commit operation itself. The two
  never conflate: a run's forwarded `delivery` resolution record serves the delivery
  operations only; the `pre-commit` firing reads the registry for `finding` fragments
  independently and alters neither the forwarded record nor the delivery surface.

---

## The constitution composition rule

> **Normative runtime text:** [the constitution composition rule](capability-registry.ops.md#the-constitution-composition-rule).

The constitution is a set of **non-negotiable principles** — **composed, not
authored** as a single baked file (no compile step; see "What this contract is
NOT"). At the contract level it is governed by these rules:

1. **Composed from each capability's `article:` manifest-key declarations, with
   provenance.** Core contributes domain-free **process** articles; each active
   capability contributes its own non-negotiables via the `article:` manifest key
   (an article is a manifest-key declaration, **not** a phase fragment — the
   constitution is not a phase). Articles aggregate through the registry, each
   tagged with its source.
2. **Project clauses override capability clauses.** A clause recorded by the
   project (via the setup skill, WF-24) takes precedence over any capability's
   article, regardless of registry order. This precedence is distinct from
   registry order, which only sequences additive `guidance`.
3. **A capability-vs-capability contradiction is a validation error.** Two active
   capabilities whose articles contradict each other fail the registry validation
   (WF-2's registry pass / WF-28) — fail-fast, both offenders named. Only the
   project may resolve a contradiction (rule 2).
4. **Established at setup, enforced at `verify`.** Articles are recorded once at
   project setup (the `wf:constitution` skill, **auto-invoked by `init`**, WF-24 —
   not implemented here) and **consulted as `guidance` at `spec`** and **enforced
   as `finding`s at `verify`**. The constitution is not a per-ticket phase.

This contract states the constitution *rule*; the setup skill, the runtime
composition, and the enforcement wiring are owned downstream (WF-24, WF-22,
WF-7).

---

## Manifest schema v2 (the capability side, at the contract level)

> **Normative runtime text:** [manifest schema v2](capability-registry.ops.md#manifest-schema-v2-the-capability-side-at-the-contract-level).

Every capability folder named in the registry carries one `manifest.md` at
`<path>/manifest.md`. This contract declares its **v2 shape** (the capability
contract and the runtime own the rest):

- **`kind:`** — `adapter` (phase fragments only; ships no skills) | `feature`
  (ships its own skills/commands/agents; may also attach fragments) | `both`.
- **Fragments table** — one row per attached fragment:

  ```markdown
  | phase | contribution-kind | dispatch | scope |
  ```

  - `phase` — one of the SDD phases named above (a manifest may not invent one).
  - `contribution-kind` — one of the taxonomy kinds named above.
  - `dispatch` — how core reaches the fragment: `inline: <rel-path>` (a reference
    doc core **reads and follows in-context**, forward-slash, relative to the
    capability's path) **or** `subagent: <agent>` (a generically-named subagent
    core invokes via the Task tool for heavy work).
  - `scope` — **required only for partitioned kinds**: a `surface` enum token for
    `provider`; a `source→target` token pair for `artifact`; a
    `<skill>.<point> <merge-policy>` compound for `slot`. Empty (`—`) for
    aggregate kinds. A `slot` row is the one kind whose **`phase` cell is `—`** — a
    slot targets a skill point (its scope), not an SDD phase.

- **`skills:`** — for `feature` / `both` kinds, where the capability's skills live
  (documentation only; native plugin composition handles loading).
- **`profile-template:`** — **optional.** A capability that fills contract slots
  with concrete project values may ship a human-fillable **profile seed template**
  and name it here: a single path, forward-slash, **relative to the capability's
  folder** (e.g. `profile.template.json`). The template is the DATA leg of the
  port — the concrete values the phase fragments later consume — distinct from any
  test fixture the capability also ships. A manifest **without** this field is
  still valid: the capability simply seeds no profile (see the seeding convention
  below). This field is additive and backward-compatible — every pre-existing
  manifest stays conformant.

  A declared JSON profile template may reserve a top-level **`ask` array** for
  project-configuration questions. Entries are ordered and have this shape:

  ```json
  {
    "ask": [
      {
        "id": "project-name",
        "destination": "project.name",
        "prompt": "Project name?",
        "schema": { "type": "string", "minLength": 1, "maxLength": 80 },
        "suggestedDefault": "example"
      }
    ]
  }
  ```

  `id` is a lowercase hyphenated identifier. `destination` must match
  `^[A-Za-z][A-Za-z0-9_.-]*$`: it starts with an ASCII letter and every later
  character is an ASCII letter, digit, `_`, `.`, or `-`. The exact reserved
  destination `ask` is forbidden. IDs and destinations are unique within the
  template. `prompt` is non-empty metadata (never executable prose).
  `suggestedDefault` is optional. `schema.type` is exactly one of:

  - `string` — either unbounded with no length/pattern fields, or jointly bounded by
    non-negative `minLength` and `maxLength`; `pattern` is allowed only on a bounded
    string. The safe-regex subset accepts at most 256 source characters and values
    whose `maxLength` is at most 1,024; outside character classes it permits no
    grouping or alternation, it permits no numeric or named backreferences, and it
    permits at most one variable quantifier (`*`, `+`, `?`, `{n,}`, or `{n,m}` where
    `n != m`). Every braced quantifier bound is at most 1,024. Fixed `{n}` and
    `{n,n}` quantifiers are allowed and do not consume the variable-quantifier
    allowance;
  - `boolean` — no additional fields;
  - `integer` — inclusive safe-integer `minimum` and `maximum`, both required;
  - `enum` — a non-empty array of unique non-empty string `values`.

  Resource limits are part of the declaration contract: a template is at most
  262,144 UTF-8 bytes; `ask` carries at most 64 entries; a prompt at most 2,048
  characters; an enum at most 128 values; a pattern at most 256 characters and
  matches at most 1,024 input characters; normalized question metadata is at most
  131,072 UTF-8 bytes. Invalid declaration diagnostics retain at most 256 ordered
  entries within the same 131,072-byte aggregate and end with a fixed truncation
  diagnostic when more were omitted. The resolver rejects unknown/type-inappropriate fields,
  incomplete or reversed bounds, unsafe patterns, invalid defaults, and every
  over-limit declaration with pack/question/field attribution. One defect rejects
  the complete declaration set — no partial questions are exposed.

  Suggested defaults and ordinary template values at a declared destination remain
  attributed suggestions. Personal values are suggestions too. Only a valid,
  explicitly persisted project value resolves a question; proposed values use the
  same deterministic validator but are not persisted here. Metadata responses carry
  the validated declaration (including its prompt), never the raw template body.
- **Payloads table — optional, ordered.** A capability may declare files managed by
  the pack beneath an exact `## Payloads` heading. The table has exactly these five
  columns, in this order:

  ```markdown
  | Source | Destination | Production | Refresh | Removal |
  ```

  Each row is normalized with its pack `pluginId` and capability name as provenance,
  while row order remains declaration order. `Source` names the declared file beneath
  the capability root. `Destination` names the future workspace-relative target.
  `Production` is exactly `copy`; `Refresh` is exactly
  `replace-if-unmodified` or `retain`; `Removal` is exactly
  `delete-if-unmodified` or `retain`. These are closed tokens: no undeclared field or
  semantic value is inferred.

  Both declarations must be non-empty, forward-slash relative lexical paths (source
  relative to the capability root; destination relative to the workspace). They
  reject an absolute or drive prefix, a backslash, NUL or colon, and every empty, `.`,
  or `..` segment. Inspection additionally requires `Source` to resolve as a regular,
  non-symlink file beneath the canonical capability root and fingerprints its raw bytes
  with SHA-256. `Destination` receives **lexical validation only** at this boundary:
  inspection neither resolves it against a workspace nor follows a target symlink.

  An absent table or a valid header-only table is inert. Duplicate sections or columns,
  missing/unknown columns, malformed rows, invalid tokens, unsafe paths, or unreadable
  sources produce bounded diagnostics attributed to pack, capability, row, and field.
  One defect rejects the complete inspected pack payload set: no partial declaration
  set or source-hash set is exposed, and registration performs no write. Inspection
  returns normalized metadata and hashes only — never source bodies.
- **`requires:` / `conflicts:`** — optional; resolved at registry validation
  (`requires:` satisfied; `conflicts:` not both active).
- **`article:`** — **optional, repeatable.** A capability with non-negotiable
  principles declares each one with an `article:` manifest key, of the shape
  `article: <key> = <value>` — `<key>` names the clause (its identity), `<value>`
  its stance. This is a **manifest key** of the same family as `requires:` /
  `conflicts:`, **not** a fragments-table row: an article attaches to the
  **constitution**, which is not an SDD phase, so it has no legal home in the
  fragments table (whose `phase` column accepts only an SDD phase). The
  `wf:constitution` skill composes these declarations provenance-tagged (see "The
  constitution composition rule"); registry validation rejects two active
  capabilities declaring the **same** `<key>` with **different** `<value>` as a
  capability-vs-capability contradiction. A manifest with no `article:` key simply
  contributes no constitution clause (the no-op path).

A capability attaches only the fragments it provides; an unattached phase no-ops
for that capability. Two composition mechanisms stay separate: **features compose
natively** (install N plugins → their skills are all discoverable, no custom
machinery), while **phase fragments compose via the registry** at runtime.

---

## Payload declarations and lifecycle evidence

> **Normative runtime text:** [payload declarations and lifecycle evidence](capability-registry.ops.md#payload-declarations-and-lifecycle-evidence).

The resolver exposes pure, body-free proof records so later discovery and application
work can distinguish portable pack identity from machine-local installation facts.
All path/hash arrays and artifact owners are deterministically ordered by stable
identity; every fingerprint is a lowercase SHA-256 digest. Duplicate identities,
malformed hashes, or incomplete required values fail closed instead of yielding a
partial record.

**Ledger home.** The only accepted portable-ledger selector values are `committed` and
`local`; an absent value defaults to `committed`. `committed` selects
`.wf/install-state.json`, while `local` selects `_local/install-state.json`.
Machine-binding evidence always belongs at `_local/install-state.json`, regardless of
the portable selection. This contract resolves paths only; persistence is downstream.

**Portable pack evidence has exactly five fields:**

- `pluginId`
- `version`
- ordered `capabilities`
- ordered `manifestHashes` (`path`, `sha256`)
- ordered `declaredSourceHashes` (`path`, `sha256`)

It contains no canonical install root, local path, CLI fact, timestamp, or other
machine datum. Manifest and source paths are portable pack-relative identities.

**Machine-binding evidence has exactly six fields:**

- `pluginId`
- `canonicalRoot`
- `cliScope`
- `enablement`
- `observedVersion`
- ordered `localFingerprints` (`path`, `sha256`)

The local record carries the current installation observation and never substitutes
for portable identity.

**Comparison precedence.** Comparison first requires complete expected portable,
observed portable, and observed binding evidence. Missing proof yields
`evidence-missing`. A portable difference then yields `portable-mismatch` **before**
any root-movement fact is considered. Only portable equality admits local comparison:
an absent prior binding yields `binding-seed` with the observed binding as a
**nonpersisted proposal**; a changed canonical root yields `root-moved`; another local
change yields `local-mismatch`; exact equality yields `equal`. A seed proposal is not
stale evidence and this pure comparison never writes it.

**Artifact evidence and authority.** One produced artifact record contains exactly its
lexical `destination`, the complete deterministically ordered owners (each
`pluginId`, `capability`, and declared `source`), the
`declaredSourceFingerprint`, the `producedContentHash`, and the full semantic tuple
`production`, `refresh`, `removal`. Mutation authority exists only when this complete
proof is present and the observed destination bytes still hash to the recorded
produced-content hash. Then persistence is permitted, replacement is permitted only
for `replace-if-unmodified`, and removal only for `delete-if-unmodified`. Missing,
incomplete, malformed, or modified proof grants **no** persistence, replacement, or
deletion authority.

**Hard scope boundary (WF-442).** This declaration/evidence boundary does not discover
or select payloads into snapshot state; map lifecycle or stale-overlay states; render a
plan; canonicalize or contain workspace targets; inspect target symlinks; arbitrate
collisions or owners; produce destination bytes; compose or write `.wf/`; persist a
ledger or binding; open a transaction or journal; apply, refresh, delete, recover,
repair, bootstrap, upgrade, or migrate a runner. Those behaviours remain downstream
consumers of this pure inspection contract.

---

## Lifecycle workspace selection and admission

One resolver-owned API selects the lifecycle workspace root and admits it, so every
later lifecycle surface consumes a single canonical admitted-root value instead of
re-deriving one. Selection is deterministic, happens exactly once, performs **no write
of any kind** on any success or failure path, and returns a typed result rather than
throwing.

**Fixed precedence.** An explicitly supplied root wins over the `WF_WORKSPACE_ROOT`
environment declaration, which wins over the current working directory. The working
directory is used **only** when neither higher tier is declared. The result names the
tier that supplied the attempted root, on success and on failure alike, so a caller can
always report which declaration it acted on.

**Absent is not invalid.** A source that is not declared at all is **absent**: it falls
through to the next tier and is not a failure. A source that is present but blank is a
**declaration**, and an invalid declaration is **terminal** — it is never replaced by a
lower-precedence source, produces no partial result, and writes nothing. Collapsing
these two states is the defect this boundary exists to prevent: a blank declaration
that silently degrades to the working directory resolves against a workspace the
operator did not target.

**Admission.** The selected candidate is canonicalized — it must be an absolute path
that exists and is a directory — and then admitted against the launch workspace family:
a Git launch admits any main or linked worktree sharing its common directory; a
plain-directory launch admits only that one canonical directory. Where there is no
prior launch to constrain the candidate, the candidate *is* the launch: it is
canonicalized and identified with no family constraint. Every failure resolves to one
closed reason token distinguishing a blank declaration, a non-absolute path, a missing
path, a non-directory path, and an out-of-family root; an unrecognized canonicalization
error still resolves to a closed token rather than escaping.

**Hard scope boundary (WF-445).** Project workspace admission and **plugin
installation-root validation are distinct** and share no code path: inventory-supplied plugin roots
remain governed by the recorded-root-first plugin-root resolution described above, and
nothing in this boundary consults or reuses it. This boundary also does not integrate
the admitted root into any downstream lifecycle surface, admit unrelated roots, define
scratch behaviour, or probe a cache. Those remain downstream consumers of this one
admitted-root value.

---

## The skill interface declaration and slot markers

> **Normative runtime text:** [the skill interface declaration and slot markers](capability-registry.ops.md#the-skill-interface-declaration-and-slot-markers).

Manifest schema v2 (above) is the **capability** side of composition — what a
capability *contributes*. This section is the **skill** side — what a skill
*exposes* to be bound. A `slot` contribution (WF-323) names a target `skill.point`;
this is where that point is declared and placed. WF-326 formalizes it.

**The interface / implementation split.** A skill's file (`skills/<name>/SKILL.md`)
mixes two things a reader cannot currently tell apart: a **stable, externally
bindable surface** and **freely rewordable implementation prose**. WF-326 draws
the line explicitly. The **interface** — the contracted surface downstream binders
and the resolver may depend on — is exactly five things:

1. the **invocation shape** (the slash command and its arguments);
2. the **terminal-block** contract (the `NAME — <state>` final-output block others grep);
3. the declared **slots**, each with its **merge policy** (`replace` | `append`, the WF-323 vocabulary);
4. the declared **settings keys** (the project-tunable inputs — declared in a grep-parsable `## Settings` table; WF-328 resolves them through the seeded-override machinery, see [The per-skill settings resolution](#the-per-skill-settings-resolution-capability-agnostic));
5. the **safety rules** (the Allowed / Forbidden envelope).

Everything else in the body is implementation: it may be reworded, reordered, or
rewritten freely without a contract bump, as long as the five above and the slot
markers below stay intact.

**The machine-readable home (the bounded spec-phase decision, charter Assumption
#4).** The declaration lives in a sidecar, **`skills/<name>/interface.md`** —
**not** inside `SKILL.md`. The binding constraint is that the resolver must learn a
skill's declared slots and settings keys **without reading the SKILL.md body**
(`resolve_content` refuses skill-body reads by class). A sidecar file, distinct
from the body, satisfies this: it is read as its own document, so the body stays a
non-machine-read implementation artifact. `interface.md` uses fixed, grep-parsable
sections — at minimum a `## Slots` table (column 1 the `skill.point` id, column 2
the merge policy) and a `## Settings` section; the other three interface elements
(`## Invocation`, `## Terminal block`, `## Safety rules`) are declared there too so
the whole surface has one home. A skill that exposes nothing bindable ships no
`interface.md` at all — the default, and the state of every skill today.

**The slot marker syntax (grep-validatable).** A declared slot is *placed* in the
body by an HTML-comment **marker pair**, each marker **alone on its line**
(surrounding whitespace tolerated), both naming the same id:

```markdown
<!-- wf:slot <skill>.<point> -->
…the inline-default region…
<!-- wf:slot-end <skill>.<point> -->
```

- The **id** is a `skill.point` token: two segments joined by a single dot, each
  segment lowercase letters / digits / hyphens; the first segment (`<skill>`)
  **must equal the skill folder name**, so a marker can never misname its own skill.
- The **inline-default region** is the content between the two markers. It is what
  the skill runs when the slot is **unfilled** — a real, executable default (or
  empty, meaning "do nothing here").
- **No-improvisation rule.** An unfilled slot executes **exactly** its
  inline-default region — never an ad-libbed substitute invented at the marker. A
  capability that `replace`-fills the point substitutes the region wholesale; an
  `append`-fill runs its content **after** the default. This is what makes an
  unfilled composition surface deterministic: absent a binding, the body reads and
  runs precisely as written, with no model discretion at the seam. (Resolver-side
  consumption of a *filled* slot — how a binding is fetched and injected — is
  WF-327, out of scope here; WF-326 fixes only the shape and the unfilled
  behaviour.)

**Mechanical enforcement.** `skill-slot-marker-lint.sh` — since WF-369 carried by
the `wf-core-authoring` pack at
`plugins/wf-core-authoring/capabilities/core-authoring/fixtures/`, registered in
that folder's own `run.sh` and discovered by CI by convention — keeps body and
declaration honest, each failure naming file + line:

- a **well-formed** marker matching a `## Slots` declaration passes;
- a **malformed** marker (bad id grammar, wrong folder segment, not alone on its
  line) or a malformed `## Slots` declaration (bad id / absent-or-unknown policy) fails;
- a marker whose id is **not declared** in the skill's `interface.md` fails;
- a **declared** slot with **no** marker pair (or an unbalanced / duplicate pair) fails;
- a skill with no `## Slots` and no markers is **inert** — the whole existing
  skill tree (which declares no slots yet) passes unchanged.

The lint and this contract change **together** (CLAUDE.md §10): the marker grammar
and declaration shape here are exactly what the lint enforces, and its
`slot-marker-fixtures/` (alongside the lint in the pack fixture folder named
above) are the reviewable proof it discriminates. **No composed
`SKILL.md` is ever materialized** — a slot is a marker in the one authored body,
not a code-generated file.

**Filled-slot composition (WF-327).** WF-326 fixes the *unfilled* behaviour; WF-327
defines how a *filled* slot is resolved and served. Execution reaching a marker
obtains the winning body with **one** `resolve_content` call — explicitly passing
`workspaceRoot: <current Agent/session absolute workspace directory>`, using the `slot` content
class, and keyed by the `<skill>.<point>` id (`skill` + `point` args) — following the
same metadata → body-fetch → follow dispatch pattern as every other served class.
The composition is **code in the bundled resolver runtime, not prose the model
arbitrates**: for any input set the per-slot winner is a pure function of the
registry + the override files, and the caller is handed **exactly one** body,
never a set of competing fragments (locked decision 2 — the model never chooses
between fragments).

- **The precedence is an ordered tier chain, not hardcoded pairwise rules.** The
  tiers, highest precedence first, are: the **personal `_local/` override** > the
  **committed `.wf/` project override** (WF-443) > the **pack contribution(s)** >
  the **inline default** (which lives in the body and is never read by the
  resolver — `resolve_content` refuses skill-body reads). The chain is authored as
  a list of ranked tiers (pack 10, project 20, personal 30), which is exactly how
  WF-443's project tier was added: **one new `Tier` at a free rank, with no
  contract change and no change to any existing tier, contribution, or override
  file**. The tier-insertion test proves every pre-existing slot resolves to the
  same winner after a further intermediate tier is registered, and the interval
  remains open on both sides for any tier after it.
- **The personal override** is a gitignored, per-machine file, **one per point at
  `_local/slots/<skill>.<point>.md`** (`_local/` stays gitignored wholesale, per
  charter Assumption #1 — nothing *personal* is ever committed downstream). Its
  presence fills the slot at the highest precedence; its absence is simply "no
  override".
- **The project override** (WF-443) is a **committed** file, one per point at
  **`.wf/slots/<skill>.<point>.md`** — the same checked-in `.wf/` home the
  install-state ledger already uses, reused rather than a second convention. It is
  how a maintainer commits shared workflow customization the whole team receives on
  checkout, while every teammate keeps personal override authority above it. It is
  a **read** home for the resolver: the tier grants no skill a write scope outside
  `_local/`. Its absence is simply "no project override", which is why a project
  that ships none resolves exactly as it did before the tier existed.
- **Linearization by merge policy.** A **`replace`** slot serves the **single
  highest-precedence present** contribution — the personal override when present,
  else the project override, else the lone pack contribution. An **`append`** slot
  serves **one** composed body: every present contribution concatenated in
  ascending tier rank — pack contributions in **registry order** first, then the
  project override, the personal override **last** — joined by exactly one blank
  line. Either way, exactly one body is served.
- **The inline default's fate in a filled composition (the bounded spec-phase
  decision).** For **`replace`**, the inline default is **superseded wholesale** —
  the served body replaces the marker region. For **`append`**, the inline default
  is the **first part**: it stays in the authored body and runs **before** the
  served composition, matching the WF-326 marker rule that "an `append` fill runs
  after the default". The resolver therefore never needs — and never has — the
  inline-default text: it serves only the pack/override contributions, and the body
  supplies the default. This keeps all three invariants: determinism (a pure
  function of registry + overrides), exactly one served body, and an **unfilled**
  slot still executing *exactly* the inline default.
- **Typed outcomes preserve the content surface's degradation discipline.** A
  filled slot returns `{status: composed, content, policy, parts}`, each part
  carrying the `tier` it came from (`pack-contribution` / `project-override` /
  `local-override`) and its `source`; a slot with no
  contribution **and** no override at either override tier returns the typed
  `{status: unfilled}` (no body,
  no wrong-path fall-through) directing the caller to run the inline-default region
  unchanged; a dangling contributor or a declared pack body missing on disk returns
  `{status: unresolved}` (registry-invalid / ref-not-found) with a `/wf:resolve`
  recovery; a malformed ref or a non-inline (subagent) slot dispatch returns
  `{status: unresolved}` / `{status: refused}`. Never a wrong-path body, never a
  raw-read fall-through.

**Fingerprinting, orphan validation, and provenance (WF-329).** WF-327 composes a
filled slot and WF-328 resolves settings, but the files both read — slot-contribution
bodies and personal overrides — were not part of the snapshot's fingerprinted input
set, so an edit could leave a stale composition serving old bodies, and an override
orphaned by a pack upgrade (its target slot renamed/removed) would silently lose to
the default. WF-329 closes both gaps on the **existing** fingerprint/snapshot
lifecycle (no parallel freshness mechanism):

- **Fingerprinted inputs.** Every pack slot-contribution body (a `slot-contribution`
  source), every personal `_local/slots/<skill>.<point>.md` override (a
  `slot-override` source), and every committed `.wf/slots/<skill>.<point>.md`
  project override (a `slot-project-override` source, WF-443) join the snapshot's
  `sources`, hashed not stored (the
  body-free invariant holds). Editing any invalidates the snapshot on the next
  query, exactly as editing a manifest or profile does.
- **Orphan validation at refresh, both directions.** A slot is *declared* only by a
  skill's `## Slots` interface table (WF-326). The refresh fails **loudly** — a
  `registry-invalid` error stating a `/wf:resolve` recovery path — when either side
  targets a `skill.point` no active skill interface declares: **(a)** a personal
  override file whose slot no interface declares (`slot/orphaned-override`, naming the
  override file + the missing slot id — it would silently lose to the default);
  **(a2)** a committed project override whose slot no interface declares
  (`slot/orphaned-project-override`, symmetric with (a) — WF-443);
  **(b)** a registered `slot` manifest row whose slot no interface declares
  (`slot/orphaned-contribution`, naming the contributing capability + the missing
  slot id — it would silently never fire). Both checks home at **refresh**, not
  `validate-registry.sh`, because they depend on the WF-326 interface declarations
  the registry validator runs without (the same rationale as the settings
  undeclared-key check). Loud failure covers **id-level** orphans only; an override
  whose slot id survived but whose *meaning* drifted is watch-list territory, not
  solved here.
- **Per-slot provenance.** `resolve_inspect`, called with
  `workspaceRoot: <current Agent/session absolute workspace directory>`, lists each composed slot with its
  **winning source** and the **tier** it won from (`local-override` /
  `project-override` / `pack-contribution`
  / `unfilled`), a presence flag for **each** override tier (`overridePresent` and
  `projectOverridePresent`, so a reader can see when a project override was masked
  by a personal one), and the ordered contributors — full
  composition provenance for anyone debugging what a slot resolved to — plus the
  per-skill settings-override presence index.

---

## The profile-seeding convention (capability-agnostic)

> **Normative runtime text:** [the profile-seeding convention](capability-registry.ops.md#the-profile-seeding-convention-capability-agnostic).

A capability's contract slots are filled by a downstream **profile** — the
concrete project values, distinct from the capability's behaviour. So that any
capability can ship a starter for that profile without core naming it, this
contract defines a single capability-agnostic seeding convention. The convention
declares **where** a profile is stamped and **how** the stamp behaves;
**executing** it is owned by `init` (WF-9) — this contract only defines the
interface.

1. **Stamp destination — deterministic, keyed by capability name.** A capability
   declaring a `profile-template:` ships that template as its **authoritative default
   template** — the baseline shape (which may carry angle-bracketed placeholder slots,
   per the placeholder syntax below) that a project overrides; `init` seeds a downstream
   **override** at a deterministic path under the downstream `_local/`:

   ```
   _local/profiles/<capability-name>.profile.json
   ```

   **Hybrid precedence — downstream override > capability default.** The override is
   seeded **only when the project's values diverge** from the capability's shipped
   default; where the project does not diverge, no override is written and the
   capability default applies. (So a fully-default project keeps an empty
   `_local/profiles/` and the capability default stands.) `<capability-name>` is the
   registry's `Capability` column — the capability's
   stable identity, **not** its `Path` — so the profile location survives the
   capability moving folders or into a standalone add-on plugin. The path is
   derived the same way for every capability; core names no concrete capability.
   Because the name is used **verbatim as the filename stem**, it must be a
   **filesystem-safe token** — lowercase letters, digits, and hyphens (the same
   shape as a skill slug), with no path separator, `..` segment, or whitespace —
   so the derived path is unambiguous and cannot traverse outside
   `_local/profiles/`. Registry validation (WF-2's registry pass / WF-28) rejects
   any name that is not a safe token, before `init` ever derives a path from it.

2. **Placeholder syntax — every unfilled value is angle-bracketed.** A seeded-but-
   unfilled value is an **angle-bracketed token**, in one of three forms:
   `<UPPER_SNAKE>` for a bare value to replace (e.g. `<SOURCE_ROOT>`);
   `<UPPER_SNAKE: inline guidance>` to name the value and carry its fill direction in
   one token (e.g. `<SOURCE_ROOT: repo-relative source root, forward slashes>`); or
   `<FILL: guidance>` where no value-name is needed. A value is **filled** once it
   contains no `<…>` placeholder. Templates whose data format forbids comments carry
   their fill guidance **inside** these angle-bracketed tokens — **including any
   guidance placed in a schema-permitted note field, which must itself be an
   angle-bracketed `<…>` token** — never as out-of-band comments. This keeps the
   seeded file parseable, keeps the "no `<…>` ⇒ filled" rule total (no guidance
   escapes detection), and keeps a filled copy schema-conformant.

3. **Idempotency — a re-run never overwrites.** Seeding is safe to re-run: if the
   destination already exists, the convention **leaves it untouched** (it never
   overwrites a partially- or fully-filled override). Re-seeding only ever creates a
   **missing** override, and only on divergence — mirroring `init`'s existing
   skip-if-present behaviour for `_local/config.md`. A non-divergent re-run writes
   nothing.

4. **No-op when absent.** A capability that declares **no** `profile-template:`
   seeds nothing — no destination is created, no placeholder is written. This
   mirrors the empty-registry / inert-phase no-op: a capability contributes a
   profile seed exactly when it opts in, and its silence is not an error.

The convention names **no** concrete capability, stack, or project value; it is the
generic shape every capability's seed template plugs into. The destination-path
convention is fixed here; any later change to it is a separate decision (it is a
downstream-visible contract, like a phase name).

---

## The per-skill settings resolution (capability-agnostic)

Where the profile-seeding convention above tunes a **capability's** contract slots,
this section tunes a **skill's** own scalar behaviour. WF-326 lets a skill declare
**settings keys** in its `interface.md` `## Settings` section; WF-328 resolves them
through the **same seeded-override pattern**, re-keyed per skill — **no new storage
mechanism** (locked decision 10).

- **Declaration — a grep-parsable `## Settings` table.** A settings-declaring skill's
  `interface.md` carries a `## Settings` table whose first column is the settings key
  (one or more dot-joined lowercase/digit/hyphen segments, e.g. `review.depth`) and
  whose second column is the **declared default**. A `## Settings` section carrying
  only `_(none)_` declares no keys — the default, and the state of every skill today.
- **Storage — re-keyed per skill on the existing `_local/profiles/` store.** The
  personal override lives at **`_local/profiles/<skill>.settings.json`** — the same
  gitignored folder capability profiles use, with a `<skill>.settings.json` stem that
  never collides with a capability's `<capability>.profile.json`. `<skill>` is the
  skill folder name; the value is a flat JSON object of key → value.
- **Hybrid precedence — override > declared default, per key.** For each declared
  key, the override's value (when the key is present in the override object) wins;
  otherwise the declared default applies. A skill with **no** override resolves to
  its declared defaults, and — mirroring the profile convention — an override is
  seeded only when the project **diverges** (a fully-default project keeps no
  settings override). An **undeclared** key is never silently merged in.
- **Resolution — the `resolve_settings` query.** A consumer obtains the
  override-merged VALUES with one `resolve_settings` call, explicitly passing
  `workspaceRoot: <current Agent/session absolute workspace directory>` and the skill slug.
  The resolver locates the skill's `interface.md` (the core plugin root first, then
  every resolved pack root), reads the optional override via its own fs, and merges.
  Values only — never a skill body or interface prose (the body-free invariant holds:
  `interface.md` is a machine-read sidecar, not the SKILL.md body).
- **Loud rejection of an undeclared key — homed at snapshot refresh.** An override
  carrying a key the skill's `interface.md` does not declare is a **`registry-invalid`**
  failure: the refresh emits an error diagnostic **naming the offending key AND the
  skill**, never silently ignoring or accepting it. The check homes at **snapshot
  refresh** (the resolver runtime), **not** `validate-registry.sh`, because it depends
  on the WF-326 interface declarations the registry validator runs without — the same
  rationale that homes orphan detection at refresh. An override for a skill with no
  locatable declaring interface (an uninstalled pack, a renamed skill) is a
  **warning** (the resolver cannot validate it), never a hard failure of an unrelated
  override.
- **Fingerprinted into the snapshot (WF-329).** Each `_local/profiles/<skill>.settings.json`
  override is fingerprinted into the snapshot's `sources` (a `settings-override` kind,
  hashed not stored), so editing an override invalidates the snapshot and the next query
  recomposes. `resolve_inspect` reports the per-skill **settings-override presence** index.

The convention names **no** concrete skill, stack, or project value; it is the generic
shape every settings-declaring skill plugs into.

---

## Worked single-row example (what core resolves *to* at N=1)

This traces the v1 reference capability (`migration`) — historically under
`plugins/wf-caps/capabilities/migration/`, now hosted in the private `wf-caps` marketplace
(moved out of this repo per WF-261; the paths here are illustrative of that external
capability, not in-repo) — as the
worked **N=1** registry — an **example a core skill resolves to**, never a
dependency. With a single registry row, the v2 port reduces to v1:

- Its existing single v1 seam (`rule-audit`, **superseded here**) maps onto the v2
  shape as a `finding` contribution at the `verify` phase (the **example** the
  taxonomy resolves *to*). Core fires the `verify` phase, walks the one-row
  registry, reads the example manifest at `plugins/wf-caps/capabilities/migration/manifest.md`, and
  renders that capability's `finding` output — provenance-tagged to it.
- The other two superseded v1 seams (`parity-suite`, `mapping`) map onto a
  `scenario` at `qa-generation` and an `artifact` at `plan` respectively — the
  **examples** those taxonomy kinds resolve *to* once authored. They are **not
  authored here** (WF-3 / WF-6 / WF-7 / WF-8 own that); this contract only shows
  the schema correspondence so its taxonomy claim has a reference.

The single-row case is exactly v1; the registry generalises it to N rows with no
new vocabulary.

---

## What this contract is NOT

- It is **not** a runtime. No registry iteration, fragment injection, per-policy
  aggregation, or subagent dispatch is defined or implied here — that runtime
  generalisation is owned by **WF-22** (generalising the v1 substrate).
- It is **not** a validator. The registry-level checks (unique names, names are
  filesystem-safe tokens, `registryPath` is a forward-slash repo-relative path with no
  `..`/absolute prefix, paths exist and carry a manifest — a plugin-anchored `Path`
  resolved via the `## Plugin Roots` mapping, with a valid `Root` shape and no unmapped
  plugin, no overlapping ownership scopes — including two `replace` `slot` claims on
  one `skill.point` — well-formed `slot` scopes/merge-policies, no contradictory
  articles, valid phase/kind references) are owned by **WF-2's registry pass / WF-28**. The
  per-capability profile check (a profile vs its contract) is unchanged.
- It is **not** a capability. It names zero stack/domain/project concerns. Every
  concrete vocabulary, value, or example belongs in a capability's own contract,
  outside the core. The two partitioned-scope vocabularies (`surface` enum,
  `source→target` pairs) are *controlled token shapes*, not concrete capability
  values.
- It does **not** wire any skill to a phase or contribution kind (`verify`
  rendering `finding`s, `plan` rendering an `artifact`, `qa-generation` rendering
  `scenario`s, the `tasks` skill, the `wf:constitution` skill) — owned by
  WF-7 / WF-6 / WF-8, WF-23, and WF-24 respectively.
- It introduces **no codegen, composer, or compile step.** Composition is runtime
  inline-prose injection: edit a fragment once and every project picks it up on
  the next run, with nothing to rebuild or keep in sync.
