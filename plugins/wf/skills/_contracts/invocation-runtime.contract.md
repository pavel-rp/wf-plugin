# Capability invocation runtime (the registry-iterating, per-phase-injecting substrate)

**Version:** 2.5.0 (WF-22; WF-99 — plugin-anchored `Path` resolved via the `## Plugin Roots` mapping; WF-120 — direct provider resolution for the delivery surface; WF-121 — tracker named as direct provider resolution's second surface; WF-199 — recorded-root-first self-heal fallback (referencing the port) and the write-side registered-but-unrecoverable diagnosis split; WF-208 — ops/reference split: the runtime-followed text is extracted to `invocation-runtime.ops.md` (v1.0.0), leaving this contract as the reference half)
**Status:** reference half of the invocation runtime — rationale, v1 lineage, worked demonstrations; **never read at boot**. The runtime-read half — the exact firing/resolution procedure with every guard, no-op case, and fail-safe — is `invocation-runtime.ops.md` (v1.0.0), the normative home a boot follows
**Supersedes:** `invocation-mechanism.contract.md` (v1.0.0, WF-10) — the single-manifest, three-named-seam runtime, kept intact as the frozen N=1 substrate this generalises
**Executes the port:** `capability-registry.contract.md` (v2.6.0, WF-21; WF-99; WF-120; WF-121; WF-179; WF-199; WF-208) — phase names, contribution kinds, aggregation/partition policies, and the manifest fragments-table schema all come from there; this document executes them, never redefines them
**Model:** claude-opus-4-8
**Owned by:** the `wf` core plugin (capability-agnostic; ships inside the plugin)

> **Ops/reference split (WF-208).** This contract is the **reference half** — read at authoring and validation time, never at boot. The **runtime-read half** is [`invocation-runtime.ops.md`](invocation-runtime.ops.md): bounded (≤150 lines), self-sufficient one level deep, the normative home for the whole runtime-followed procedure. Sections below carrying a "Normative runtime text" pointer keep their narrative as background; a boot follows the ops doc, never this file.

---

## Purpose

`capability-registry.contract.md` (v2.0.0, WF-21) froze the **semantics** of the
v2 core↔capability boundary: the `## Capabilities` registry, the named **SDD
phases** as injection points, the generic **contribution taxonomy** with its
per-kind aggregation policy, and the **manifest schema v2** (the fragments table).
It deliberately left the **runtime** — how a core skill, at execution time, turns
"fire the `verify` phase" into the actual aggregated output of whatever capabilities
are registered — unspecified, naming WF-22 as its owner.

This document settles that runtime. It is the procedure a **core skill author**
follows to iterate the registry, inject each active capability's phase fragments in
registry order, and aggregate them per the firing kind's policy — in the Claude
Code skill substrate, where there is **no DI container** to inject implementations.

It introduces **no new runtime.** The procedure is built entirely from the three
primitives every `wf:*` skill already uses — the exact three the superseded v1
substrate used, generalised from one manifest to N:

1. read the registry at its `registryPath`-resolved location (default `_local/config.md` — the same file every skill reads as its first step; see § "1. Registry iteration");
2. read a file at a contracted, forward-slash path;
3. invoke a subagent by `subagent_type` via the Task tool (the established Pattern C delegation).

**Decision B — runtime inline-prose injection, no codegen and no compile step.**
Composition is reading the registry and following fragments in-context; there is no
generated dispatcher, no composed file, nothing to rebuild. **Edit a fragment once
and every project picks it up on the next run, with nothing to rebuild or keep in
sync.** Core re-reads the registry and the manifests every run.

This document defines **semantics and procedure**, not the behaviour of any one
capability. It names zero stack/domain/project concerns. The worked demonstration
references one kept reference capability **by path only**, on lines explicitly
labelled — as something a core skill resolves *to*, never as something core depends
on.

---

## How v2 generalises v1 (the N=1 substrate this keeps)

*(All v1 vocabulary in this section — the `{domain}` selector, "hook", the `<none>`
Null Object — is **superseded-v1**: it describes the kept N=1 substrate
`invocation-mechanism.contract.md` (WF-10), not v2 core vocabulary.)*

The committed runtime is **v1** *(superseded-v1: `invocation-mechanism.contract.md`,
WF-10)*: four moving parts over **one** active capability — folder resolution from a
single selector, one manifest read, per-**hook** dispatch (`inline:` / `subagent:`),
and the `<none>` no-op path. That substrate is **kept, not replaced.**

This v2 runtime generalises it along exactly one axis: **from one manifest to an
iterated registry of N.**

| v1 *(superseded-v1, kept N=1 base)* | v2 (this document, N capabilities) |
|---------------------|-------------------------------------|
| one `{domain}` / `{domain-path}` selector | iterate the `## Capabilities` registry, in registry order |
| one manifest read at `{domain-path}/manifest.md` | one manifest read per registry row, at `<path>/manifest.md` |
| per-**hook** dispatch (3 frozen hook names) | per-**phase** fragment collection, then per-fragment dispatch |
| `inline:` / `subagent:` dispatch kinds | **unchanged** — the same two dispatch kinds |
| single result per hook | **aggregate** across contributors per the firing kind's policy |
| `<none>` Null-Object no-op | empty / fragment-less registry no-op (the same Null Object, generalised) |

A **single-row** registry reduces to **exactly v1**: one capability, one manifest,
one contributor — no aggregation step has anything to combine. An **empty** registry
is **exactly v1's `<none>`** absent state. Backward compatibility is structural.

---

## The moving parts (the generalised procedure)

> **Normative runtime text:** [the moving parts](invocation-runtime.ops.md#the-moving-parts-the-generalised-procedure).

A core skill firing a phase performs these steps, in order. Each is a distinct,
greppable section below.

1. **Registry iteration** — walk the `## Capabilities` rows at the `registryPath`-resolved location (default `_local/config.md`), in registry order (general → specific).
2. **Per-capability manifest read** — for each row, read the contracted manifest at `<path>/manifest.md`.
3. **Per-phase fragment collection** — select the manifest's fragment rows whose `phase` equals the firing phase.
4. **Per-fragment dispatch** — for each collected fragment, dispatch on its `dispatch` kind: `inline: <rel-path>` (read-and-follow) or `subagent: <agent>` (Task tool).
5. **Aggregation** — combine the contributors per the firing contribution kind's policy.

---

## 1. Registry iteration

> **Normative runtime text:** [1. Registry iteration](invocation-runtime.ops.md#1-registry-iteration).

Core reads the **`## Capabilities` registry** from its **configurable location** —
resolved from the repo-root `wf.config.js` `registryPath` key, **defaulting to
`_local/config.md`** (the same file every `wf:*` skill reads first) when the key is
absent. The default-absent location is exactly `_local/config.md`, so existing
repo-relative behaviour is **unchanged** — this is an additive indirection note, not a
change to how the registry is read. The registry shape and column meaning are fixed by
`capability-registry.contract.md`; this runtime **executes** them:

- Each row carries a `Capability` **name** and a `Path`. Core uses the
  path to locate the manifest; it **never** hardcodes a folder, and it **never** uses
  the name to key a code path (see "Generic-only branch rule").
- **`Path` resolution — both shapes (WF-99), recorded-root-first with self-heal (WF-199).** The port
  (`capability-registry.contract.md`) defines `Path` as accepting two shapes: a
  repo-relative folder and a plugin-anchored token `plugin:<plugin-name>/<rel-path>`.
  This runtime resolves **both**. A **repo-relative** `Path` resolves against the repo
  root, unchanged. A **plugin-anchored** `Path` resolves via the port's **`## Plugin
  Roots` mapping** (co-located with the registry at the `registryPath`-resolved
  location): core looks `<plugin-name>` up in that table, joins `<root>/<rel-path>`
  (an absolute `Root` as-is; a repo-relative `Root` against the repo root), and reads
  its `manifest.md`. That recorded root is the **first** attempt; when it **dangles**
  (a pack upgrade or machine move relocated the install root), core **self-heals** by
  recovering the plugin's current install root from Claude Code's install manifest —
  exactly per the port's **"Recorded-root-first resolution with install-manifest
  self-heal"** (`## Plugin Roots`): recorded-root-first, then the install-manifest
  fallback (marketplace-exact `<plugin-name>@wf-marketplace` key with left-of-`@`
  fallback, backslash→forward-slash normalization, prefer-existing-`installPath`
  selection), **in-memory only**. This runtime **executes** that algorithm; it does not
  redefine it. The mapping supplies the `<plugin-name>` → install-root datum
  `${CLAUDE_PLUGIN_ROOT}` alone could not (it resolves only to the *executing* plugin's
  root); the mapping is written by a pack-owned init skill, core only reads it. A
  plugin-anchored `Path` whose `<plugin-name>` has **no** `## Plugin Roots` row is
  **unmapped**, and a mapped row where **neither** the recorded root **nor** the
  self-heal yields a readable manifest is **unrecoverable** → in both cases the row
  **no-ops** (fail-safe, same as a missing manifest; the validator is what errors on
  it). Existing repo-relative resolution behaviour is
  **unchanged** — this is an additive resolution rule, not a change to how a
  repo-relative `Path` resolves.
- **Registry order is the injection order** — general → specific. Core walks the rows
  top to bottom and preserves that order through aggregation.

Iteration outcome:

- If the `## Capabilities` table is **empty or absent**, there are zero rows to walk →
  go straight to the **no-op path** (§ below); no manifest is read.
- Otherwise, for each row in order, proceed to the per-capability manifest read.

Core **iterates** the registry — it does not look up a particular capability, count
the rows, or test whether a specific one is present.

---

## 2. Per-capability manifest read

> **Normative runtime text:** [2. Per-capability manifest read](invocation-runtime.ops.md#2-per-capability-manifest-read).

For each registry row, core reads exactly one **manifest** at a contracted, fixed
path under that row's path:

```
<path>/manifest.md
```

Core reads `<path>/manifest.md` to learn which fragments this capability attaches to
which phases. It does **not** scan, glob, or guess — the path is fixed by the port
contract, so each read is a single deterministic read. Here `<path>` is the registry
row's `Path`, resolved per §1 — a **repo-relative** `Path` against the repo root, or a
**plugin-anchored** `plugin:<plugin-name>/<rel-path>` token via the `## Plugin Roots`
mapping (`<root>/<rel-path>`). An **unmapped** plugin-anchored `Path` resolves to no
readable manifest → this capability contributes **nothing** for the invocation (the
no-op path below applies to it).

The manifest's **fragments table** has the v2 schema fixed by
`capability-registry.contract.md`:

```markdown
| phase | contribution-kind | dispatch | scope |
```

- `phase` — one of the fixed SDD phases named by the port (a manifest may not invent one).
- `contribution-kind` — one of the taxonomy kinds named by the port.
- `dispatch` — `inline: <rel-path>` or `subagent: <agent>` (see § per-fragment dispatch).
- `scope` — a `surface` token (for `provider`) or a `source→target` token pair (for `artifact`); empty (`—`) for aggregate kinds.

Per-capability outcome:

- If the manifest file does not exist at `<path>/manifest.md` → treat this capability
  as contributing **nothing** for this invocation (the no-op path applies to it); move
  to the next row.
- Otherwise parse its fragments table and proceed to per-phase fragment collection.

Core references the fragments table by the **column names the port fixes**
(`phase` / `contribution-kind` / `dispatch` / `scope`) — never by reading a heading.

---

## 3. Per-phase fragment collection

> **Normative runtime text:** [3. Per-phase fragment collection](invocation-runtime.ops.md#3-per-phase-fragment-collection).

To fire a given phase, core selects from the parsed manifest **only** the fragment
rows whose `phase` column equals the firing phase. All other rows are ignored for
this firing — a capability contributes to a phase only if it has a row for that phase.

Collection outcome, per capability:

- **Zero matching rows** → this capability attaches nothing to the firing phase; it
  contributes the no-op (its part of the phase runs as if inert). Move on.
- **One or more matching rows** → each becomes a contributor; dispatch each (§ below)
  and carry the results into aggregation, **retaining the contributing capability's
  name** as the source row (surfaced as provenance only for the provenance-carrying
  kinds — `finding` / `scenario` / `article` — and used solely for ordering on the
  additive kinds; see § aggregation).

Across the whole registry, the firing phase's contributor set is the union of every
active capability's matching rows, ordered by registry order.

---

## 4. Per-fragment dispatch

> **Normative runtime text:** [4. Per-fragment dispatch](invocation-runtime.ops.md#4-per-fragment-dispatch).

For each collected fragment, core dispatches on its `dispatch` kind — the **same two
kinds** the v1 substrate used, unchanged:

| Fragment `dispatch` | Core action |
|---------------------|-------------|
| `inline: <rel-path>` | Read `<path>/<rel-path>` — forward-slash, **relative to the capability's registry path** (not repo-relative) — and **follow it in-context**. The reference doc instructs core what to assert/produce; core returns the result in the contribution kind's generic shape. No subagent is spawned. |
| `subagent: <agent>` | Invoke the Task tool with `subagent_type: <agent>`, passing the artifact under review and the kind's generic shape. The heavy work runs in isolated context; only the agent's final block returns to the caller. |
| *(no matching row for the phase)* | No-op — this capability contributes the phase's declared empty result (§ no-op path). |
| *(row present, `dispatch` neither `inline:` nor `subagent:`)* | No-op (fail-safe) — core does not guess a malformed kind (§ fail-safe). |

In every case **core supplies the generic shape** the contribution kind returns and
the **capability supplies the content**; core reaches capability behaviour only
through the fragment row, never by naming the capability.

---

## 5. Aggregation

> **Normative runtime text:** [5. Aggregation](invocation-runtime.ops.md#5-aggregation).

Once the firing phase's contributors are dispatched, core combines their results per
the **firing contribution kind's aggregation policy**. The policies are fixed by
`capability-registry.contract.md`; this runtime executes them:

### `aggregate`

Core follows **every** contributor at the phase, in **registry order** (general →
specific):

- For additive authoring **`guidance`** (at `spec` / `implement`) and **`task-list`**
  (at `tasks`), core applies/appends every contributor's fragment in registry order;
  on a conflict in `guidance`, the **most-specific capability — injected last — wins.**
- For the **provenance-carrying** kinds — **`finding`** (at `verify`), **`scenario`**
  (at `qa-generation`), and **`article`** (constitution) — each contribution is
  **provenance-tagged** with its source capability, so registry **order is cosmetic**;
  attribution is explicit rather than positional.

### `partition` (by ownership)

Only the **owning** capability applies at the phase; there is no merge. Overlapping
ownership across active capabilities is **not** something this runtime resolves — it
is a **registry-validation error**, owned by the validator (WF-2's registry pass /
WF-28), which names both offenders. The runtime assumes a validated registry and
applies the single owner. Two partitioned kinds carry an ownership **scope** token:

- **`provider`** (at `qa-execution`, `implement` for the delivery surface, and
  `spec` for the tracker surface — see below) carries a **`surface`** enum
  token. Different surfaces compose — distinct owners coexist; the same
  surface claimed twice is the validator's error, not a runtime merge.
  Ownership uniqueness is checked **by surface token alone, across the whole
  registry, independent of which phase(s) the claiming row is attached to** —
  a `qa-execution` row, an `implement` row, and a `spec` row never collide
  merely for sharing a phase; they collide only if they share a `surface`
  value. `qa-execution`'s `provider` dispatches by subagent when its phase
  fires; the `delivery` surface (`implement`) and the `tracker` surface
  (`spec`) are instead reached via **direct provider resolution** (see below) —
  a phase-independent invocation mode, not a runtime merge or a second
  aggregation policy.
- **`artifact`** (at `plan`) carries a **`source→target`** token pair. A pair is owned
  whole by one capability; an identical pair claimed twice is the validator's error.

---

## Direct provider resolution (the delivery and tracker invocation modes)

> **Normative runtime text:** [direct provider resolution](invocation-runtime.ops.md#direct-provider-resolution-the-delivery-and-tracker-invocation-modes).

The five moving parts above assume a phase *fires* and its contributors
*aggregate*. That model fits `qa-execution`'s `provider` (invoked when the
`qa-execution` phase fires) but not the **delivery** or **tracker** `provider`
surfaces defined in `capability-registry.contract.md` ("The delivery provider
surface", "The tracker provider surface"): a delivery operation (branch/commit/
push/PR, or a read like workspace-root resolution) or a tracker operation
(create/update/comment/status/link on a work item) is needed whenever a core
skill needs it — id inference can happen at any phase, `branch` / `commit` /
`pr`-style skill bodies invoke a delivery operation directly, and `spec` /
`plan` / `implement`-style skill bodies invoke a tracker operation directly —
none of these are a side effect of a phase firing.

**Direct provider resolution** is the alternate entry point a core skill uses to
reach the `delivery` or `tracker` surface — the same mechanism serves both; a
surface is not a reason for a second procedure. It reuses three of the five
primitives verbatim and skips the other two:

1. **Registry iteration** — unchanged (primitive 1).
2. **Per-capability manifest read** — unchanged (primitive 2).
3. ~~Per-phase fragment collection~~ — **replaced** by a **scope-equality
   filter**: instead of selecting rows whose `phase` equals a firing phase, the
   skill selects the row(s) where `contribution-kind = provider` **and**
   `scope = delivery` (or `scope = tracker`, for a skill that needs the tracker
   surface), across the whole registry, regardless of that row's `phase` value.
   (The `implement` phase value on a delivery row, and the `spec` phase value on
   a tracker row, are registration anchors for the validator, not filter
   conditions here.)
4. **Per-fragment dispatch** — unchanged (primitive 4): `inline:` read-and-follow,
   or `subagent:` via the Task tool, exactly as any other fragment dispatches.
5. ~~Aggregation~~ — **skipped**. Partitioned ownership (enforced by the
   validator, WF-2's registry pass / WF-28) guarantees **at most one** row can
   match the scope-equality filter registry-wide, so there is nothing to
   combine — the resolved fragment (or the unconfigured no-op below) *is* the
   result.

**Unconfigured case.** When the scope-equality filter matches **zero** rows (no
active capability owns the `delivery` surface, or none owns the `tracker`
surface), the outcome is structurally the same "zero matching contributors"
shape the § no-op path already defines for phase-firing (its case 3 is the
phase-filtered instance; this is the scope-filtered instance of the same
"nothing matched" shape) — no new no-op *case* is introduced, only a second
filter that can produce it. `capability-registry.contract.md`'s "The delivery
provider surface" and "The tracker provider surface" state what that no-op
resolves to operationally for each surface (the workspace-root plain-directory
fallback and a plain "no delivery provider registered" statement for delivery;
the silent local-only `T<NNN>` id fallback and degradation rules for tracker).

**Write-side diagnosis split (WF-199).** A scope-equality filter can match zero
*readable* rows for two distinct reasons, and a **write** must not conflate them.
Either **(a)** no registered capability owns `<S>` at all (every manifest is readable),
or **(b)** a registered capability that *might* own `<S>` has an **unrecoverable**
manifest (its recorded root dangled and the install-manifest self-heal in §1 — which
executes the port's `## Plugin Roots` algorithm — recovered nothing), so its row never
becomes a readable provider row. Core resolves this exactly per the
port's **"Residual 'registered-but-unrecoverable' diagnosis"** and **"Surfacing by
site"** (`capability-registry.contract.md`, `## Plugin Roots`): case (a) emits the
unchanged "no `<S>` provider registered" message; case (b) names the
unreadable-manifest pack(s) as **candidates** from the `## Capabilities` row and
**hedges** surface attribution (never asserting a candidate owns `<S>`). Surfacing
follows the port: a **delivery** write surfaces (b) **loudly**, a **tracker** write
emits it as the **warn-once** (then continues local-only), and a **read** on either
surface stays **silent local-only**. This runtime executes that diagnosis; the port
defines it.

Direct provider resolution introduces no new primitive and no new aggregation
policy — it is the existing registry-iteration / manifest-read / dispatch
substrate, entered through a scope filter instead of a phase filter, for the
partitioned kind where "at most one match, invoked on demand" is the operative
shape rather than "every contributor at a firing phase." A second surface
(`tracker`) plugging into the same filter, unchanged, is exactly what proves the
mechanism generalises — not a reason to add a third procedure.

---

## No-op path (the generalised `<none>` Null Object)

> **Normative runtime text:** [no-op path](invocation-runtime.ops.md#no-op-path-the-generalised-none-null-object).

A phase — or an individual capability's part of it — **no-ops** (produces the empty
result of the firing kind's declared shape and lets the surrounding SDD skeleton
proceed exactly as if nothing were attached) in any of these cases:

1. the `## Capabilities` registry is **empty or absent** (zero rows to iterate), **or**
2. a registry row's manifest at `<path>/manifest.md` does **not exist** — including a plugin-anchored `Path` whose `<plugin-name>` is **unmapped** in `## Plugin Roots`, **or** whose recorded root **dangles** and the install-manifest self-heal (§1, which executes the port's `## Plugin Roots` algorithm) still recovers no readable manifest; either resolves to no readable manifest (fail-safe; the validator errors on it), **or**
3. a manifest exists but has **no fragment row** for the firing phase, **or**
4. a fragment row exists but its `dispatch` is neither `inline:` nor `subagent:` (a malformed or unrecognized kind — see fail-safe).

When **no** active capability contributes to the firing phase, the **phase as a whole
no-ops**: core emits the phase's declared empty result — no findings, no scenarios, no
correspondence rows, no guidance applied — and the surrounding SDD skeleton runs
unchanged. **No stack/domain/project term surfaces.** This is the runtime realization
of the registry's empty-table guarantee and the direct generalisation of v1's `<none>`
Null Object: the contracts carry the seam, the skill bodies stay capability-free.

### Generic-only branch rule

> **Normative runtime text:** [generic-only branch rule](invocation-runtime.ops.md#generic-only-branch-rule).

The **only** branch a core skill may evaluate around a phase firing is the generic
one: **the registry has zero contributing fragments for this phase** vs. **one or
more**. A core skill body must **never**:

- test `if capability == <some concrete name>`,
- count the registry (no `if active.length == 1`, no keying on "how many" are active),
- carry a code path, conditional, or message keyed to one specific capability,
- name a concrete capability anywhere in its body.

Adding or removing a capability requires **zero** edits to any core skill body — the
registry and the manifests (downstream, outside `plugins/wf/`) carry every binding.
Core iterates rows and dispatches on each fragment's declared kind; it never special-
cases a row.

### Fail-safe

> **Normative runtime text:** [fail-safe](invocation-runtime.ops.md#fail-safe).

A collected fragment row whose `dispatch` kind is neither `inline:` nor `subagent:`
(a malformed or unrecognized dispatch) is treated as a **no-op**, exactly as the v1
substrate does (its no-op case 4 above) — the runtime never guesses a malformed
dispatch. (A row whose `phase` does not equal the firing phase never reaches dispatch:
§3 collection only selects matching-phase rows, so a bogus-`phase` row is inert by
construction.) Rejecting bad rows up front — unique names, valid `phase` /
`contribution-kind` references, non-overlapping ownership — is the **validator's**
concern (WF-2's registry pass / WF-28), not the runtime's; until validation runs, this
dispatch fail-safe keeps a core skill from being stranded by a bad manifest.

---

## Worked demonstration: firing the `verify` phase across three registries

This traces the `verify` phase — a `finding` kind, which **aggregates with
provenance** — across three registries, to show the empty / single-row / two-row
cases. One kept reference capability appears, **by path only**, on lines explicitly
labelled "example-the-runtime-resolves-to". Core depends on **none** of these paths;
it depends only on the registry rows and the fixed manifest path.

### (a) Empty registry → phase no-ops

1. **Registry iteration.** Core reads `_local/config.md`; the `## Capabilities` table
   is empty (or absent). Zero rows to walk.
2. **No-op path.** No capability contributes to `verify`. Core emits `verify`'s
   declared empty result — **no findings.**
3. **Result.** The surrounding SDD skeleton proceeds exactly as if `verify` had no
   capability attached. No stack/domain/project term surfaced; no capability-name
   branch was evaluated. This is exactly the superseded-v1 `<none>` outcome.

### (b) Single-row registry → exactly v1 (the N=1 reduction)

1. **Registry iteration.** The `## Capabilities` table has **one** row, whose `Path`
   is `plugins/wf-caps/capabilities/migration/` *(example-the-runtime-resolves-to — by path only)*. Core
   walks the single row.
2. **Manifest read.** Core reads the manifest at that path and parses its fragments
   table. One row matches the firing phase *(example-the-runtime-resolves-to / superseded-v1: `verify | finding | inline: hooks/rule-audit.md | —` — the v1 `rule-audit` seam re-expressed in the v2 fragments-table shape; `scope` is empty because `finding` aggregates with provenance)*.
3. **Dispatch.** *(example-the-runtime-resolves-to: `dispatch` is `inline:`, so core reads `hooks/rule-audit.md` relative to that capability's path)* and follows it
   in-context, producing `finding`s in core's generic finding shape.
4. **Aggregation.** One contributor → nothing to combine; core renders its findings,
   **provenance-tagged** to that single capability.
5. **Result.** Identical to the superseded-v1 single-active-capability outcome — the
   N=1 reduction, with no new vocabulary.

### (c) Two-row registry → two contributors aggregated with provenance

1. **Registry iteration.** The `## Capabilities` table has **two** rows, in registry
   order (general → specific). Core walks both.
2. **Manifest read + collection.** Each capability's manifest has a fragment row for
   `verify` under the `finding` kind. Each becomes a contributor.
3. **Dispatch.** Core dispatches each fragment per its `dispatch` kind (`inline:`
   read-and-follow, or `subagent:` via the Task tool).
4. **Aggregation.** `finding` aggregates with **provenance**: core renders **both**
   capabilities' findings, each **tagged with its source capability**. Because the
   tags carry attribution, registry order here is cosmetic. Core never names either
   capability in a branch — it walks the rows and tags each result with the row's name.
5. **Result.** Two provenance-tagged finding sets compose into the `verify` output
   with no special-casing — N rows handled by the same iterate-and-tag procedure as
   N=1.

---

## Composition with the WF-21 port

- **Phase names and contribution kinds** come **only** from
  `capability-registry.contract.md`; the runtime fires a phase named there and reads
  the manifest's fragments table by its fixed columns (`phase | contribution-kind |
  dispatch | scope`). The runtime references them by **phase name / contribution-kind
  name**, never by heading.
- **Aggregation/partition policies** are the port's; this runtime **executes** them
  (aggregate in registry order with provenance for provenance-carrying kinds;
  partition by the single owner for `provider` / `artifact`).
- **The manifest schema** (the fragments table, the two dispatch kinds, the two scope
  vocabularies) is the port's v2 schema; the runtime consumes it, never redefines it.

The two v2 halves stay mutually consistent: the port declares **what** a capability
may attach and how core combines it; this runtime is **how** core reaches and combines
it at execution time — registry iteration, manifest read, fragment collection,
dispatch, aggregation, no-op — with no new vocabulary.

---

## Supersede and downstream references

- This document **supersedes** `invocation-mechanism.contract.md` (v1.0.0, WF-10),
  which is kept intact as the frozen **N=1 substrate** this generalises. It ships at
  v2.0.0; the change to the invocation contract carries a **MINOR** version bump
  (0.6.0 → 0.7.0, per CLAUDE.md §11, pre-1.0).
- **Registry validation** — unique capability names, paths exist and carry a manifest,
  no overlapping ownership scopes, no contradictory `article` clauses, valid phase/kind
  references — is owned by the validator (**WF-2**'s registry pass / **WF-28**), **not
  implemented here**. This runtime assumes a validated registry and fail-safes a bad row.
- **Per-phase wiring of consumer skills** — making a skill fire `verify` and render
  `finding`s, fire `plan` and render an `artifact`, fire `qa-generation` and render
  `scenario`s, run the `tasks` decomposition, or compose the constitution — is owned by
  **WF-6 / WF-7 / WF-8**, **WF-23** (the `tasks` skill), and **WF-24** (the
  `wf:constitution` skill, auto-invoked by `init`). Each is referenced **by issue,
  without being implemented here.**

---

## What this document is NOT

- It is **not** a dispatcher, registry service, aggregator service, composer, or build
  step. The "runtime" is the three existing substrate primitives: config read, file
  read, Task-tool subagent invocation. There is **no codegen and no compile step** —
  composition is runtime inline-prose injection, picked up on the next run.
- It is **not** a validator. Checking that a registry is well-formed (unique names,
  existing paths, non-overlapping ownership, non-contradictory articles, valid
  phase/kind references) is owned by WF-2's registry pass / WF-28.
- It is **not** a capability. It names zero stack/domain/project concerns; the one
  reference path in the worked demonstration is an example the runtime resolves *to*,
  on explicitly labelled lines — never a dependency.
- It does **not** rewire any consumer skill, author any capability fragment, define any
  phase or contribution kind, or establish the constitution. Those are owned by the
  WF-21 port and the downstream wiring issues named above.
