# Capability registry + SDD phases + contribution taxonomy (the v2 port)

**Version:** 2.0.0 (WF-21)
**Status:** authoritative source of truth for the core↔capability boundary semantics
**Supersedes:** `core-extension.contract.md` (v1.0.0, WF-1) — the single-selector, three-named-seam port, kept as the frozen N=1 base
**Runtime half:** generalised separately by WF-22 in `invocation-runtime.contract.md` (v2.0.0) — which supersedes `invocation-mechanism.contract.md` (v1.0.0/WF-10, kept as the N=1 substrate)
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
| `Path` | The location of the capability's `manifest.md` and reference docs, in **one of two accepted shapes** (forward slashes in both): (a) a **repo-relative folder** — the path relative to the marketplace repo root (e.g. `plugins/wf-caps/capabilities/migration`); or (b) a **plugin-anchored token** of the shape `plugin:<plugin-name>/<rel-path>`, naming a capability that lives *inside* an installed plugin (`<plugin-name>` is the plugin's manifest name; `<rel-path>` is forward-slash, relative to that plugin's install root). Core reads the manifest at `<path>/manifest.md`; it never hardcodes a folder. See "The two `Path` shapes" below for which shape is runtime-resolved today. |

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

### The two `Path` shapes (one runtime-resolved today, one forward-looking)

The `Path` column accepts two token shapes, but only one is resolved at runtime today:

1. **Repo-relative folder — the only form resolved at runtime today.** A path
   relative to the marketplace repo root (forward slashes). This is the form to use
   for any capability registered today; it resolves in the marketplace checkout
   exactly as v1's selector did. An existing repo-relative registry resolves with no
   change — the second shape is **purely additive and backward-compatible.**

2. **Plugin-anchored token — `plugin:<plugin-name>/<rel-path>` — forward-looking,
   runtime resolution deferred.** This shape names a capability living *inside* an
   installed plugin, whose on-disk install root varies per machine. It is **recognized
   registry vocabulary** so a registry can be authored against the multi-plugin future,
   but its **runtime resolution is deferred to a follow-up issue** — core does not
   resolve a plugin-anchored `Path` today.

   The reason resolution is deferred: `${CLAUDE_PLUGIN_ROOT}` resolves only to the
   **executing** plugin's own install root, so a capability path inside a *sibling*
   plugin (e.g. `wf` core reaching a capability that ships in `wf-caps`) cannot be
   resolved from it. Cross-plugin resolution needs a `<plugin-name>` → install-root
   mapping that does not yet exist; until that mapping lands, only the repo-relative
   form is runtime-resolved.

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
| `spec` | Specify — **authoring hub** (WHAT) | conventions, constraints, acceptance criteria, invariants | authoring `guidance` |
| `plan` | Plan — derivation | correspondence / decomposition that can't live as spec prose | `artifact` |
| `tasks` | Tasks — derivation | opinionated decomposition into small, independently testable units | `task-list` |
| `implement` | Implement — **authoring hub** (HOW) | stack idioms / scaffolds; apply the plan's correspondence | authoring `guidance` |
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
| `provider` | `qa-execution` | a capability that supplies *execution* (an engine or environment), not a result | **partition by ownership** — one owner per surface (scope below); subagent dispatch |
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
    enum (`engine`, `host`, …). Two capabilities claiming the **same** surface =
    validation error; **different** surfaces compose at `qa-execution` (e.g. one
    capability owns `engine`, another owns `host`).
  - **`artifact`** carries a **`source→target`** token pair drawn from a
    controlled vocabulary (e.g. `csharp→ts`). Ownership is whole-unit — a pair is
    owned entirely by one capability, never split. Overlap = an identical pair
    claimed by two capabilities = validation error.

Start with the minimal scope vocabulary above; upgrade to a richer scope schema
only when a real second owner of the same surface or pair appears.

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
  `..`/absolute prefix, paths exist and carry a manifest, no overlapping ownership
  scopes, no contradictory articles, valid phase/kind references) are owned by
  **WF-2's registry pass / WF-28**. The
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
