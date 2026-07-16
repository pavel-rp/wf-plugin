---
name: constitution
description: Establishes and updates a project's composed constitution — core process articles plus each registered capability's non-negotiables, aggregated through the Capabilities registry with provenance and a precedence rule (project clauses override capability clauses). Writes _local/constitution.md and maintains the Capabilities table in _local/config.md. Auto-invoked by /wf:init and re-runnable any time to refresh principles. Use after init, after registering or removing a capability, or whenever the project's own non-negotiable clauses change.
allowed-tools: [Read, Write, Edit, Glob, Bash]
---

# /wf:constitution — Establish and update the project's composed constitution

Establish (or refresh) the project's **constitution**: the set of **non-negotiable
principles** the workflow holds itself to. The constitution is **composed, not authored
as a single baked file** — core contributes domain-free **process** articles, each
registered capability contributes its own non-negotiables, and the project contributes its
own clauses. They are recorded together with **provenance** (which source each article came
from) and a fixed **precedence rule**: project clauses override capability clauses.

This skill **establishes the record**; it does not consume or enforce it. The constitution is
**intended to be consulted as guidance at `spec`** and **enforced as `finding`s at `verify`**
— but that consumption wiring is owned by **other tasks** (spec-consultation by the runtime /
`spec` phase, WF-22; verify enforcement via the `verify` finding-aggregation, WF-7) and is
**not yet active**. This skill only writes the record. It is **not a per-ticket phase**: you
run it once at setup (auto-invoked by `/wf:init`) and re-run it only when the registry or the
project's own clauses change.

This skill is **capability-agnostic**. With no capability registered, it writes a
**core-only** constitution — the inert path, no stack/domain/project term surfaced. When
capabilities are registered, it composes their articles on top of the core articles, in
registry order, each provenance-tagged. It never **hardcodes**, requires, counts, or
special-cases any concrete capability; capability names appear only as provenance tags read
from the registry.

---

## When to use / when not

**Use it when:**

- `/wf:init` runs (it invokes this skill automatically so a fresh repo has a constitution).
- A capability is added to or removed from the `## Capabilities` registry — re-run to
  refresh the composed capability articles.
- The project's own non-negotiable clauses change — re-run to record them.

**Don't use it when:**

- You want to *check* code against the constitution — that belongs to the `verify` phase
  (`/wf:verify-spec`), not this skill (that consumption wiring is future work, see the intro).
- You're working a single ticket — the constitution is established once, not per-task.

---

## Prerequisites

**Before any other phase**, obtain project config and the active registry from the bundled
`wf-resolver` MCP service: `resolve_config` for project values (`coreConfig`,
`workspaceRoot`, `registryPath`) and `resolve_registry` for the ordered active
`capabilities[]` (`name`, `kind`, `manifestPath`, `fragments[]`, `articles[]`,
`provenance`) — both already resolved from `_local/config.md` and every `manifest.md`, so
composition performs no direct registry/manifest parse of its own. If the resolver reports
the project is uninitialized (absent `_local/config.md`), stop with: "Run `/wf:init`
first." (In the normal flow `/wf:init` invokes this skill *after* writing `config.md`, so
it is present.) If the `wf-resolver` service is unavailable, stop and report that the
resolver runtime is not loaded (restart Claude Code). Never hardcode project values. The
one exception to reading through the resolver is this skill's own **write** to the
`## Capabilities` table in `_local/config.md` — see "Maintain the `## Capabilities` table"
below.

---

## Command Syntax

```
/wf:constitution [establish | update]
```

A single optional positional argument selects the mode. **Zero-argument invocation is the
default and does establish-or-update**: if `_local/constitution.md` is absent it establishes
it; if it already exists it updates it. You rarely need to pass the mode explicitly — the
default detects the right one.

### Arguments

| Argument      | Required | Description |
| ------------- | -------- | ----------- |
| `establish`   | NO       | Force first-time establishment. Errors if `_local/constitution.md` already exists (re-run with no argument to update instead). |
| `update`      | NO       | Force an update of an existing constitution. Errors if `_local/constitution.md` is absent (run with no argument to establish instead). |
| *(none)*      | —        | **Default.** Establish if absent, update if present — the establish-or-update path. |

---

## Safety Rules

**Allowed:**

- Read any file in the project (`Read`, `Glob`).
- Obtain each registered capability's composed `article`s from the `wf-resolver` `resolve_registry` query (the `articles[]` metadata per capability) — no direct `manifest.md` read for composition.
- Read-only workspace resolution via the `wf-resolver` `resolve_config` (`workspaceRoot`) query; plain-directory fallback when no delivery provider is registered.
- Write **only** these two `_local/`-scoped targets:
  - `_local/constitution.md` (the composed constitution record).
  - the `## Capabilities` table inside `_local/config.md` (maintained, not the rest of the file).

**Forbidden:**

- Write anywhere outside `_local/`.
- Rewrite the rest of `_local/config.md` — touch only its `## Capabilities` table.
- **Bake a flattened composed file** outside the constitution record, or generate any
  compiled artifact — composition is the runtime record itself, there is no compile step.
- Author a capability's articles. This skill *composes* (reads and aggregates) what each
  capability's `manifest.md` declares; it never writes a capability's non-negotiables for it.
- Hardcode, require, count, or special-case any concrete stack, domain, or capability in its
  own behaviour (capability names may still be recorded as provenance tags read from the
  registry — that is composition, not hardcoding).
- Run builds, tests, installs, or any destructive version-control operation.

---

## Compose the articles (shared by both modes)

The constitution is composed from three article groups, each carrying **provenance** (the
source it came from). Both modes build the same three groups; they differ only in how they
treat the project group (establish writes a starter, update preserves the existing one).

### 1. Core articles — domain-free process (verbatim, always present)

Core contributes these non-negotiable **process** articles, recorded **verbatim**,
provenance `core`. They name no stack, domain, or capability and are present in **every**
constitution regardless of the registry:

1. **The spec is the single source of truth.** A derived artifact (plan, task list) never
   overrides the spec; conformance is judged against the spec.
2. **No phase skips its gate.** Every phase is a human-approved artifact that feeds the
   next; nothing advances past an unapproved gate.
3. **Nothing writes outside `_local/`** except the designated source-mutating skills.
4. **Every artifact carries model attribution.** A `**Model:** <id>` line (or a verb-shaped
   variant) records which model produced each artifact.
5. **No AI attribution in commits.** Commit messages and PR descriptions carry no
   `Co-Authored-By` trailer, "generated with" footer, emoji, or promotional tagline.
6. **Never commit to `main`.** All work happens on a feature branch (`feat/…`, `fix/…`,
   `chore/…`); pushing to `main` is forbidden regardless of registered capabilities. This
   holds even in bare-core mode, where every branch gate skips with a stated reason rather
   than silently permitting a `main` commit.
7. **Project configuration lives in `_local/config.md`.** Project-specific values are read
   from config, never hardcoded into a skill.

Plus this additional core article (provenance `core`), recorded **verbatim**:

8. **Core never requires a capability.** Every core extension point ships a lean default and
   runs inert when no capability is registered; core never names or hard-depends on a
   specific capability.

### 2. Capability articles — composed from the registry (provenance-tagged)

Compose each registered capability's non-negotiables from the `wf-resolver` `resolve_registry`
query — do **not** read `## Capabilities` or any `manifest.md` yourself — referencing the
taxonomy by **contribution-kind name** (`article`), never by heading:

1. **Call `resolve_registry`.** It returns the ordered active `capabilities[]` (**in registry
   order**, general → specific), each already resolved from the registry and its `manifest.md`,
   carrying its composed **`articles[]`** metadata (the declared non-negotiable principles).
   The resolver has done the registry iteration and per-capability manifest read; core reads
   only this metadata. If the `wf-resolver` service is unavailable, stop and report that the
   resolver runtime is not loaded (WF-272 diagnostics/recovery).
2. **Collect** each capability's `articles[]` entries.
3. **Aggregate provenance-tagged.** Record each capability's articles under that capability's
   `name`. Because every article is tagged with its source, registry order is **cosmetic** for
   the recorded articles — attribution is explicit.

**No-op (the only permitted branch is "zero capability articles" vs "one or more"):** if
`resolve_registry` returns an empty `capabilities[]`, or a capability declares no `article`, that
contributor — or the whole group — produces **nothing**. The constitution is then **core-only**:
no capability section, no capability/stack/domain term surfaced, no STOP. Never hardcode or
special-case a concrete capability, count the registry, or carry a per-capability code path
(a capability's name still appears as a provenance tag when it contributes articles — that is
the registry-driven composition, not a hardcoded branch).

### 3. Project clauses — user-authored (distinct section)

The project's own non-negotiable clauses, provenance `project`, in their own distinct section.
**Establish** seeds this section with a short commented starter inviting the project to add its
clauses (it does not invent clauses). **Update** **preserves** whatever the project has authored
here verbatim — see the update-merge rule below.

### Precedence (stated in the record)

State the precedence rule in the constitution record itself:

- **Project clauses override capability clauses.** A clause recorded by the project takes
  precedence over any capability's article, regardless of registry order. (This is distinct
  from registry order, which only sequences additive guidance elsewhere.)
- **A capability-vs-capability contradiction is a registry-validation error**, not resolved
  here — it fails the registry validation (owned by WF-2 / WF-28), both offenders named. Only
  the project may resolve a contradiction, via rule above. This skill **references** that rule;
  it does not implement the validator.

---

## Establish mode

Run when `_local/constitution.md` is **absent** (or `establish` is passed). If the file
already exists and `establish` was passed explicitly, stop and tell the user to re-run with
no argument to update instead.

1. Compose the three article groups per "Compose the articles" above.
2. Seed the **project clauses** section with the commented starter (no invented clauses).
3. Write `_local/constitution.md` using the template below, with a `**Model:** <id>`
   attribution line.
4. Ensure `_local/config.md` carries a `## Capabilities` table (maintain mode below) — if
   `init` already wrote one, leave it; if it's absent, append an empty one with the documented
   header so the registry exists for future runs.
5. Emit the final-output block (`CONSTITUTION — established`).

## Update mode

Run when `_local/constitution.md` **exists** (or `update` is passed). If the file is absent
and `update` was passed explicitly, stop and tell the user to run with no argument to establish
instead. Mirror the update-merge / skip-if-present idempotency of `qa-gen` and `init`:

1. Read the existing `_local/constitution.md`.
2. **Re-compose** the core articles (verbatim — they don't drift) and the **capability
   articles** (re-query `resolve_registry`; refresh to match the current registered
   capabilities).
3. **Preserve the project clauses** exactly as authored. Never silently overwrite a
   user-authored clause — if a re-compose would change or drop anything inside the project
   section, **ask before overwriting**; default to keeping the existing text.
4. **Idempotent:** on an unchanged registry and unchanged project clauses, the re-composed
   file is byte-identical to the existing one — **produce no diff**. Refresh the `**Model:**`
   line and any timestamp only when something else actually changed.
5. Maintain the `## Capabilities` table in `_local/config.md` (below).
6. Emit the final-output block (`CONSTITUTION — updated` or `CONSTITUTION — unchanged`).

## Maintain the `## Capabilities` table (second write target)

The skill keeps the `## Capabilities` registry table in `_local/config.md` consistent — it is
the source the `wf-resolver` snapshot (and thus this skill's own `resolve_registry` query and
every capability-firing phase) resolves from. This is the **one** direct `_local/config.md`
write this skill performs; the composition reads all go through the resolver. Maintain **only**
this table; never rewrite the rest of `config.md`. After maintaining it, the resolver
re-validates its input fingerprints on the next query and rebuilds the snapshot automatically —
no manual step is required (use `/wf:resolve refresh` only to force the rebuild point).

```markdown
## Capabilities

| Capability | Path                   |
|------------|------------------------|
```

- **Empty table = fully generic core.** An empty (header-only) table means no capability is
  active; the constitution is core-only and every capability-firing phase no-ops.
- **One row per active capability**, `Capability` = its name (its identity, decoupled from
  location), `Path` = the repo-relative folder (forward slashes) holding its `manifest.md`.
- **Table order = injection order** (general → specific). For the constitution this is
  cosmetic (articles are provenance-tagged); it is load-bearing for additive guidance phases.
- If a row's `Path` has no `manifest.md`, leave the row but note it in the chat summary — the
  registry validator (WF-2 / WF-28) is the gate, not this skill.

If `init` already populated this table, leave the rows intact and only normalise the header
shape if needed. Never invent capability rows.

---

## Template: `_local/constitution.md`

The verbatim `_local/constitution.md` template — the metadata block, `## Precedence`, `## Core articles`, `## Capability articles`, and `## Project clauses` — lives at [`references/constitution-template.md`](references/constitution-template.md). It is read only on this write path (establish/update), so it stays out of the boot body. Read it, then emit it with placeholders substituted.

Do **not** bake a flattened single-source file anywhere else — this record *is* the
composition. Do **not** name any concrete stack, domain, or capability in the core articles
or anywhere this skill authors; capability names appear only as provenance tags read from
the registry.

---

## Edge Cases

- **`_local/config.md` is absent.** Stop: "Run `/wf:init` first." (Normal flow has `init`
  write config before invoking this skill.)
- **`## Capabilities` registry is empty or absent.** Not an error — write a **core-only**
  constitution (the inert path) and, if the table is absent, append an empty one. No
  capability term surfaces.
- **A capability resolves as invalid** (its `manifest.md` unreadable — `resolve_registry` marks
  it with an invalid `validity` and empty `articles[]`). Compose the rest; record that
  capability with no articles and note it in the chat summary. The registry validator
  (WF-2 / WF-28) is the gate for malformed registries — this skill does not STOP on it.
- **`establish` passed but the constitution already exists.** Stop and tell the user to re-run
  with no argument (which updates). Don't clobber.
- **`update` passed but no constitution exists.** Stop and tell the user to run with no
  argument (which establishes). Don't fabricate an empty update.
- **Project clauses would change on re-compose.** Never silently overwrite — ask first;
  default to preserving the existing text. The project section is user-owned.
- **Unchanged project on re-run.** Produce **no diff** — same registry + same project clauses
  ⇒ byte-identical file. Idempotency is a contract, not a nicety.
- **A capability declares no articles.** It simply contributes nothing to the capability
  group — not an error, the same no-op as an absent capability.

---

## Final Output

End the chat reply with this fenced block, as the very last thing emitted:

```
CONSTITUTION — <established | updated | unchanged>

Articles: <8 core> + <capability articles present | none (core-only)> + <project section: seeded | preserved>
Registry: <comma-separated capability names | none (core-only)>
File:     _local/constitution.md
Next:     review _local/constitution.md and add any project clauses; then /wf:spec <id> to start a task (the constitution is intended for consultation at spec and enforcement at verify once that wiring lands).
```

**The final output block must always be the very last thing output to chat.**
