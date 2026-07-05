# Capability registry + SDD phases + contribution taxonomy (the v2 port)

**Version:** 2.4.0 (WF-21; WF-99 — the plugin-anchored `Path` shape is now runtime-resolved via the `## Plugin Roots` mapping; WF-120 — the delivery provider surface; WF-121 — the tracker provider surface; WF-179 — the last-commit-timestamp-query read operation)
**Status:** authoritative source of truth for the core↔capability boundary semantics
**Supersedes:** `core-extension.contract.md` (v1.0.0, WF-1) — the single-selector, three-named-seam port, kept as the frozen N=1 base
**Runtime half:** generalised separately by WF-22 in `invocation-runtime.contract.md` (v2.3.0) — which supersedes `invocation-mechanism.contract.md` (v1.0.0/WF-10, kept as the N=1 substrate)
**Model:** claude-opus-4-8
**Owned by:** the `wf` core plugin (capability-agnostic; ships inside the plugin)

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
Null Object. The kept v1 reference capability under `plugins/wf-caps/capabilities/migration/` survives
only as the worked single-row **example this contract resolves *to*** (see "Worked
single-row example") — never a core dependency. Everything below is the v2
generalisation of a shape v1 already proved at N=1.

---

## The `## Capabilities` registry (the selector)

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
| `Path` | The location of the capability's `manifest.md` and reference docs, in **one of two accepted shapes** (forward slashes in both): (a) a **repo-relative folder** — the path relative to the marketplace repo root (e.g. `plugins/wf-caps/capabilities/migration`); or (b) a **plugin-anchored token** of the shape `plugin:<plugin-name>/<rel-path>`, naming a capability that lives *inside* an installed plugin (`<plugin-name>` is the plugin's manifest name; `<rel-path>` is forward-slash, relative to that plugin's install root). Core reads the manifest at `<path>/manifest.md`; it never hardcodes a folder. **Both shapes resolve at runtime** — the plugin-anchored token via the `## Plugin Roots` mapping (see "The two `Path` shapes" and "The `## Plugin Roots` mapping" below). |

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
   as-is. A `plugin:` `Path` whose `<name>` has **no** row here is **unmapped** — the
   validator errors on it (naming the plugin); the runtime **no-ops** that row
   (fail-safe), exactly like a missing manifest.

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

The mapping names **no** concrete plugin or capability; it is the generic
`<plugin-name>` → root shape every pack's install root plugs into. Its location and
shape are fixed here (a downstream-visible contract, like a phase name); executing the
resolution is owned by the runtime (`invocation-runtime.contract.md`), writing it by a
pack-owned init skill, and checking it by the validator.

---

## The SDD phases (the injection points)

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

The phase names are **fixed by this contract**. A capability's manifest may attach
a fragment only to a phase named here; it may not invent a phase. The constitution
(below) is **not** a phase in this spine — it is a cross-cutting constraint
established at setup and enforced at `verify`.

---

## The contribution taxonomy (the fragment kinds)

A capability attaches each fragment under exactly one **contribution kind**. Core
defines a fixed, small taxonomy so it can render any capability's output uniformly
without naming the capability. Each kind below states its phase(s) and its
**aggregation policy** — how core combines multiple contributors at the same phase.

| Kind | Phase(s) | What it carries | Aggregation policy |
|------|----------|-----------------|--------------------|
| authoring `guidance` | `spec`, `implement` | prose authoring direction (conventions, constraints, stack idioms) the core skill follows while authoring the artifact | **aggregate** — follow every contributor in registry order; most-specific (last) wins on conflict |
| `task-list` | `tasks` | an opinionated decomposition into small, independently testable units | **aggregate** — append every contributor's tasks |
| `artifact` | `plan` | a structured correspondence table / document derived in the plan phase | **partition by ownership** — only the owning capability applies (scope below) |
| `finding` | `verify` | a conformance issue asserted against the work under review | **aggregate** — every contributor's findings, **provenance-tagged** |
| `scenario` | `qa-generation` | an executable check derived from an acceptance criterion | **aggregate** — every contributor's scenarios, provenance-tagged |
| `provider` | `qa-execution`, `implement`, `spec` | a capability that supplies *execution* (an engine or environment) or an *operation* (a delivery or tracker action), not a result | **partition by ownership** — one owner per surface (scope below); subagent dispatch (`qa-execution`) or direct resolve (`implement`, delivery surface; `spec`, tracker surface — see below) |
| `article` | constitution (set up at `init`; enforced at `verify`) | a non-negotiable principle | **aggregate** with provenance; precedence rules below |

Authoring `guidance` and `task-list` are **authoring-side** kinds the hubs and the
`tasks` derivation consume. `finding` / `scenario` / `article` are
**provenance-carrying** kinds — each fragment's output is tagged with its
contributing capability, so registry order is cosmetic for them (attribution is
explicit). `artifact` and `provider` are **partitioned** — overlap is an error,
not a merge.

### Aggregation policy — `aggregate` vs `partition`

- **`aggregate`** — core follows **every** contributor at the phase, in **registry
  order** (general → specific). For additive authoring `guidance`, the most
  specific capability is injected last and therefore wins on any conflict. For
  the provenance-carrying kinds (`finding`, `scenario`, `article`), order is
  cosmetic — each contribution is tagged with its source capability.
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

Start with the minimal scope vocabulary above; upgrade to a richer scope schema
only when a real second owner of the same surface or pair appears.

---

### The delivery provider surface

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
  `pr-create`, `pr-detect`.
- **Read side**, consumed by core (e.g. for id inference): `workspace-root-resolve`,
  `current-branch-query`, `last-commit-timestamp-query`.

No operation name, and no prose describing it, may contain a git/gh command
string or a plumbing invocation. "Branch", "commit", "deliver", and "workspace
root" are abstract vocabulary, not hits — a capability's own manifest and
fragment prose is where any concrete tool binds to these names.

**Phase anchor — registration only, not a firing gate.** A `delivery`-surface
`provider` fragment is attached at the `implement` phase (the SDD phase where a
delivery operation is actually exercised in practice — the tail of an
implementation). Unlike `qa-execution`'s `provider`, which is fired as part of
that phase's fragment collection, the `implement` phase attachment here is an
**ownership anchor for registry validation only** — it does not restrict *when*
a core skill may invoke a delivery operation. Any core skill, at any point in its
own procedure, resolves the `delivery` surface directly. The runtime mechanics of
that direct resolution are defined in `invocation-runtime.contract.md`'s "Direct
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

**Unconfigured-provider behaviour.**

- **Reads** (`workspace-root-resolve`, `current-branch-query`,
  `last-commit-timestamp-query`) fall back **silently** to the plain-directory
  path — no error, no warning. A read operation always resolves to *something*
  usable.
- A **write** operation (`branch-create`, `commit`, `push-upstream`, `pr-create`,
  …) invoked by a user-initiated skill with **no** `delivery`-surface owner active
  states **plainly** that no delivery provider is registered and **names the
  remedy** (register a capability that owns the `delivery` surface in the
  `## Capabilities` registry) — it does not fail silently or guess a fallback.

**Single-shot-publish idempotency.** A delivery operation whose result is an
id or URL (`pr-create` is the canonical case) has that returned id/URL
**recorded as a metadata line in the local artifact that triggered it** — the
same `**<label>:** <value>` metadata-line shape used elsewhere for per-artifact
attribution (e.g. a model-attribution line). Before invoking that operation
again for the same artifact, the caller **reads the metadata line back first**;
a present value means the operation already ran and is treated as
already-published — it is never re-invoked. This is the caller-side idempotency
guard for an operation whose provider has no idempotency of its own.

---

### The tracker provider surface

Core has no vocabulary of its own for issue-tracker operations — creating a
top-level work item, nesting a child work item beneath it, commenting, moving a
status, attaching a link — so a capability that wants to bind that behaviour to
core has nothing to attach to. The **tracker provider surface** is a `provider`
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

No operation name, and no prose describing it, may contain a concrete
tracker-product name, API shape, or vocabulary term. "Work item", "umbrella",
"child", and "status" are abstract vocabulary, not hits — a capability's own
manifest and fragment prose is where any concrete tracker binds to these names.

**Phase anchor — registration only, not a firing gate.** A `tracker`-surface
`provider` fragment is attached at the `spec` phase (the SDD phase where a
tracker operation is first exercised in practice — a task's umbrella/child work
items are created at authoring time). Exactly like the `delivery` surface's
`implement` anchor, this attachment is an **ownership anchor for registry
validation only** — it does not restrict *when* a core skill may invoke a
tracker operation. Any core skill, at any point in its own procedure, resolves
the `tracker` surface directly, via the same "Direct provider resolution"
procedure in `invocation-runtime.contract.md` the `delivery` surface already
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

**Single-shot-publish idempotency.** A tracker write whose result is an id
(`create_umbrella` and `create_child` are the canonical cases) has that returned
id **recorded as a metadata line in the local artifact that triggered it** —
the same `**<label>:** <value>` metadata-line shape the `delivery` surface's
`pr-create` operation already uses. Before invoking that operation again for the
same artifact/slot, the caller **reads the metadata line back first**; a present
value means the operation already ran and is treated as already-published — it
is never re-invoked.

---

## The constitution composition rule

The constitution is a set of **non-negotiable principles** — **composed, not
authored** as a single baked file (no compile step; see "What this contract is
NOT"). At the contract level it is governed by these rules:

1. **Composed from `article` fragments with provenance.** Core contributes
   domain-free **process** articles; each active capability contributes its own
   non-negotiables. Articles aggregate through the registry, each tagged with its
   source.
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
    `provider`; a `source→target` token pair for `artifact`. Empty (`—`) for
    aggregate kinds.

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
- **`requires:` / `conflicts:`** — optional; resolved at registry validation
  (`requires:` satisfied; `conflicts:` not both active).

A capability attaches only the fragments it provides; an unattached phase no-ops
for that capability. Two composition mechanisms stay separate: **features compose
natively** (install N plugins → their skills are all discoverable, no custom
machinery), while **phase fragments compose via the registry** at runtime.

---

## The profile-seeding convention (capability-agnostic)

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

## Worked single-row example (what core resolves *to* at N=1)

This traces the kept v1 reference capability under `plugins/wf-caps/capabilities/migration/` as the
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
  plugin, no overlapping ownership scopes, no contradictory articles, valid phase/kind
  references) are owned by **WF-2's registry pass / WF-28**. The
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
