---
name: constitution
description: Establishes and updates a project's composed constitution — core process articles plus each registered capability's non-negotiables, aggregated through the Capabilities registry with provenance and a precedence rule (project clauses override capability clauses). Also takes the project's own clauses as bare free text after the command, normalizing each into a clause, echoing it with its minted proj id for approval, and writing nothing until approved; drop and amend forms edit an existing project clause behind the same gate. Writes _local/constitution.md and maintains the Capabilities table in _local/config.md. Auto-invoked by /wf:init and re-runnable any time to refresh principles. Use after init, after registering or removing a capability, or whenever the project's own non-negotiable clauses change.
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
- The project's own non-negotiable clauses change — pass the clause as free text after the
  command (`/wf:constitution never expose internal ids in a response`) and it is normalized,
  echoed with its minted id, and recorded on approval.

**Don't use it when:**

- You want to *check* code against the constitution — that belongs to the `verify` phase
  (`/wf:verify-spec`), not this skill (that consumption wiring is future work, see the intro).
- You're working a single ticket — the constitution is established once, not per-task.

---

## Prerequisites

Before the first bundled resolver MCP call in this skill/agent, run `pwd -P` and use the returned absolute current Agent/session workspace directory as `workspaceRoot` in every call. In a linked-worktree Agent, that cwd is the Agent's own worktree; never inherit a parent Agent's root. Pass `workspaceRoot` explicitly on every resolver call; omission is a hard schema error, and the resolver has no default or fallback root.

**Before any other phase**, obtain project config and the active registry from the bundled
`wf-resolver` MCP service: `resolve_config({ workspaceRoot, ... })` for project values (`coreConfig`,
`workspaceRoot`, `registryPath`) and `resolve_registry({ workspaceRoot, ... })` for the ordered active
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
/wf:constitution [establish | update | <clause text>]
```

**Zero-argument invocation is the default and does establish-or-update**: if
`_local/constitution.md` is absent it establishes it; if it already exists it updates it.

**Anything else after the command is clause text, not a mode.** `establish` and `update` are
reserved only as the **exact sole argument** — the whole argument string, trimmed, equal to
that one word. Longer text that merely *starts* with one of them is clause intake:
`update the write-scope rule to name every generated directory` records a clause, it does not
force update mode.

### Arguments

| Argument         | Required | Description |
| ---------------- | -------- | ----------- |
| *(none)*         | —        | **Default.** Establish if absent, update if present — the establish-or-update path. |
| `establish`      | NO       | Exact sole argument. Force first-time establishment. Errors if `_local/constitution.md` already exists (re-run with no argument to update instead). |
| `update`         | NO       | Exact sole argument. Force an update of an existing constitution. Errors if `_local/constitution.md` is absent (run with no argument to establish instead). |
| `<clause text>`  | NO       | Free text — a non-negotiable this project holds itself to. Normalized, echoed with its minted `proj.N` id, and recorded only on approval. See "Clause intake". |
| `drop <id>`      | NO       | Remove the project clause with that id, behind the same echo gate. |
| `amend <id>: <text>` | NO   | Replace that project clause's rule with the normalized `<text>`, behind the same echo gate; the id is kept. |

**Routing is decided once, before anything else runs:** trim the argument string; empty →
establish-or-update; exactly `establish` or exactly `update` → that mode; anything else →
clause intake. There is no ambiguity to resolve later and no third mode — intake is a
**path through this skill**, not a mode of it, and it ends in the same composed record.

---

## Safety Rules

**Allowed:**

- Read any file in the project (`Read`, `Glob`).
- Obtain each registered capability's composed `article`s from the `wf-resolver` `resolve_registry({ workspaceRoot, ... })` query (the `articles[]` metadata per capability) — no direct `manifest.md` read for composition.
- Read-only workspace resolution via the `wf-resolver` `resolve_config({ workspaceRoot, ... })` (`workspaceRoot`) query; plain-directory fallback when no delivery provider is registered.
- Write **only** these two `_local/`-scoped targets:
  - `_local/constitution.md` (the composed constitution record).
  - the `## Capabilities` table inside `_local/config.md` (maintained, not the rest of the file).
- On the clause-intake path, edit **only** the record's `## Project clauses (provenance: project)`
  section, and only after the echo has been approved.

**Forbidden:**

- Write anywhere outside `_local/`.
- **Write any user-intent text before the echo is approved.** Intake shows the normalized clause
  and its minted id first, every time; there is no path that records a clause the user has not
  seen in the form it will be recorded.
- Amend or remove a `core.*` or `<capability>.*` article. They are re-rendered from their source
  on every re-composition; overriding one is done by adding a project clause that names it.
- Reuse a `proj.N` id, or renumber existing clauses.
- Touch any section other than `## Project clauses` on the intake path — intake records a clause,
  it does not re-compose the record.
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
constitution regardless of the registry. Each is one rule on one unwrapped line, carrying its
own `core.<n>` id — the form [`references/clause-style.md`](references/clause-style.md)
defines and every article of every provenance shares:

- **core.1 — Spec is the source of truth.** A derived artifact (plan, task list) never overrides the spec; conformance is judged against the spec.
- **core.2 — No phase skips its gate.** Each phase's artifact feeds the next; nothing advances past an unapproved gate. A human approves; or, where unattended mode is established independently of the agent, a resolver-issued run-evidence record does: naming the gate, binding the approved artifact by digest, filed before the next phase, valid only in its requesting run, requested by but never written by the agent it authorises. Absent, unmatched, unverifiable, foreign-run, or digest-stale, the gate is unapproved: the run halts there, reported unproven.
- **core.3 — Write scope.** Nothing writes outside `_local/` except the designated source-mutating skills and the resolver-owned declared lifecycle artifacts under `.wf/`, admitted only when both resolver-managed and of a declared class; every other component reads `.wf/` through the resolver and writes only inside `_local/`.
- **core.4 — Model attribution.** Every artifact carries a `**Model:** <id>` line, or a verb-shaped variant, naming the model that produced it.
- **core.5 — No AI attribution in commits.** Commit messages and PR descriptions carry no `Co-Authored-By` trailer, "generated with" footer, emoji, or promotional tagline.
- **core.6 — Never commit to `main`.** All work happens on a feature branch (`feat/…`, `fix/…`, `chore/…`); pushing to `main` is forbidden whatever is registered, and in bare-core mode a branch gate skips with a stated reason rather than permit a `main` commit.
- **core.7 — Config over hardcode.** Project-specific values are read from `_local/config.md`, never hardcoded into a skill.
- **core.8 — Core never requires a capability.** Every core extension point ships a lean default and runs inert when no capability is registered; core never names or hard-depends on a specific capability.
- **core.9 — Scratch discipline.** Scratch and temporary files live only under `_local/scratch/` — never the repo root, system temp, or beside tracked files. (a) A scratch file's consumer deletes it as its own last act in that same run, never deferring to a sweep. (b) The run-ending skill deletes that run's coordination files — state, handoff, ledger, lock, marker — as part of ending it, on success or failure. The finalize sweep is a backstop that excuses neither.

**This wording is authoritative, and it is mirrored.** The resolver carries the same nine
lines so a re-composition can refresh an already-composed record; the two copies are held
equal by a contract test, so an edit here that is not mirrored there fails the suite rather
than shipping a second, silently divergent constitution. Never shorten an article by dropping
an obligation: the 1:1 map every rewrite is judged against is
[`references/obligation-inventory.md`](references/obligation-inventory.md).

### 2. Capability articles — composed from the registry (provenance-tagged)

Compose each registered capability's non-negotiables from the `wf-resolver` `resolve_registry({ workspaceRoot, ... })`
query — do **not** read `## Capabilities` or any `manifest.md` yourself — referencing the
taxonomy by **contribution-kind name** (`article`), never by heading:

1. **Call `resolve_registry({ workspaceRoot, ... })`.** It returns the ordered active `capabilities[]` (**in registry
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
`resolve_registry({ workspaceRoot, ... })` returns an empty `capabilities[]`, or a capability declares no `article`, that
contributor — or the whole group — produces **nothing**. The constitution is then
**core-only**. **The `## Capability articles (provenance: each capability)` heading is still
written** — always, in every record, core-only included — carrying the single line
`No registered capability declares a constitution article.` in place of a body. It is a
**section that is empty, never a section that is absent**: the heading is a structural
landmark every later re-composition locates the record by, so omitting it would make a
core-only project's own record unrecognizable to the very re-composition that must later
carry an amended core article into it. No capability/stack/domain term surfaces either way,
and there is no STOP. Never hardcode or
special-case a concrete capability, count the registry, or carry a per-capability code path
(a capability's name still appears as a provenance tag when it contributes articles — that is
the registry-driven composition, not a hardcoded branch).

### 3. Project clauses — user-owned (distinct section)

The project's own non-negotiable clauses, provenance `project`, in their own distinct section,
each rendered `- **proj.<n> — <key>:** <rule>` like every other article.
**Establish** seeds this section with a short commented starter inviting the project to add its
clauses (it does not invent clauses). **Update** **preserves** whatever the project has here
verbatim — see the update-merge rule below.

Clauses are recorded through **clause intake** (below), not by hand: intake is what mints the
id, applies the clause-style contract, and checks the clause against every existing article.
The section stays **user-owned** either way — nothing rewrites a clause without asking, and a
re-composition carries the whole section across untouched.

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
2. **Re-compose** the **core articles** and the **capability articles** (re-query
   `resolve_registry({ workspaceRoot, ... })`; refresh to match the current registered
   capabilities). **Core article text does change between releases** — an amended article
   reaches an already-composed record only here, so replace the whole
   `## Core articles (provenance: core)` section with the articles above **as this release
   states them**, rather than assuming what is already in the file is current. A record
   composed against an earlier release is the ordinary case, not an error.
3. **Preserve the project clauses** exactly as authored. Never silently overwrite a
   user-authored clause — if a re-compose would change or drop anything inside the project
   section, **ask before overwriting**; default to keeping the existing text. Replacing the
   core section never touches it: everything from the `## Project clauses (provenance:
   project)` heading to end of file is carried across verbatim.
   **Refuse rather than reset.** If the existing record does not carry the three sections in
   the template's order — core articles, then capability articles, then project clauses,
   with nothing unrecognized between them — do not rewrite it. Report the structure you did
   not recognize, leave the file exactly as it is, and let the user reconcile it; a record
   this skill cannot place is never regenerated, because regenerating it is what would
   destroy the project's own writing.
4. **Idempotent:** on an unchanged registry, unchanged core articles and unchanged project
   clauses, the re-composed file is byte-identical to the existing one — **produce no diff**.
   Emit each core article as **one unwrapped line**, exactly as the section above states it,
   so that a re-run over an already-current record reproduces the same bytes rather than
   merely equivalent ones. Refresh the `**Model:**` line and the `**Composed:**` timestamp
   whenever anything else actually changed — **a refreshed core-articles section counts**,
   because a record must not attribute article text to a model and a date that did not
   produce it (core Article 4).
5. **Confirm the project's writing survived.** Before reporting success, re-read the file you
   just wrote and confirm it still carries its `## Project clauses (provenance: project)`
   heading and the clause text that was there before. If it does not, say so plainly rather
   than reporting a clean update — that section is the one part of the record no other copy
   exists of.
6. Maintain the `## Capabilities` table in `_local/config.md` (below).
7. Emit the final-output block (`CONSTITUTION — updated` or `CONSTITUTION — unchanged`).

## Clause intake

Reached when the trimmed argument is neither empty nor exactly `establish`/`update`. It records
**one** project clause per run, and it **never writes user-intent text before echoing it**.

If `_local/constitution.md` is absent, stop: "No constitution to add a clause to. Run
`/wf:constitution` first." Intake amends a record; it does not establish one.

Read [`references/clause-style.md`](references/clause-style.md) first — it is the contract every
step below applies, and it is read only on this path.

1. **Classify.** `drop <id>` → remove. `amend <id>: <text>` → amend. Anything else → add.
   For remove/amend, the id must be a `proj.N` **present in the record**; an absent one stops
   with the ids that are present.
   **`core.*` and `<capability>.*` are never remove or amend targets.** They are re-rendered
   from their source on every re-composition, so an edit here would be silently reverted. Stop
   and say so, naming the one supported route: add a project clause that overrides that id.

2. **Normalize.** Apply the clause-style contract's normalization rules — one rule, imperative
   present tense, rationale stripped, a kebab-case key derived from the subject. Text carrying
   two independent obligations is split into two clauses, each minted its own id, and both are
   echoed together. Normalization fixes **form**, never **meaning**: a clause whose meaning
   cannot survive the contract is reported back rather than reshaped.

3. **Mint the id.** For an add, the next `proj.N` is **one past the highest `proj.N` the record
   has ever carried**, not one past the highest currently present — ids are monotonic and never
   reused, so dropping `proj.2` does not free `proj.2`. An amend keeps its clause's id.

4. **Check against every article — core, capability, and project alike.**
   - **Duplicate** — the rule is already an obligation of an existing article. Report the
     covering id, **write nothing**, and stop. Emit `CONSTITUTION — clause covered`.
   - **Contradiction** — the rule cannot hold at the same time as an existing article. Do not
     stop and do not silently proceed: carry the conflict into the echo, naming the conflicting
     id and stating the conflict, and proceed **only on explicit confirmation**. On confirmation
     it is recorded as a project clause that **overrides** the named id — precedence resolves
     the conflict; the core or capability article is never edited.

5. **Echo, and gate.** Show the normalized clause exactly as it will be written, with its minted
   id, the action (add / amend / remove), and — when step 4 found one — the overridden or
   conflicting id. For an amend, show the current text alongside the replacement; for a remove,
   show the clause being removed. Then ask for approval.
   **Nothing is written before approval is given.** The echo is the only place the user sees
   what will be recorded in their name; declining leaves the record byte-for-byte unchanged and
   emits `CONSTITUTION — clause declined`.

6. **Write, and report the sync impact.** On approval, edit **only** the
   `## Project clauses (provenance: project)` section — every other section is left exactly as
   it is, and this path performs no re-composition. Then re-read the file and confirm the
   section carries what was just approved **and** every clause that was there before; if it does
   not, say so plainly rather than reporting a clean write. Emit `CONSTITUTION — clause added`
   / `amended` / `removed` with a `Sync impact:` line naming each id that moved
   (`+proj.1 "…"`, `~proj.1 "…"`, `-proj.2 "…"`).

## Maintain the `## Capabilities` table (second write target)

The skill keeps the `## Capabilities` registry table in `_local/config.md` consistent — it is
the source the `wf-resolver` snapshot (and thus this skill's own `resolve_registry({ workspaceRoot, ... })` query and
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

The verbatim `_local/constitution.md` template — the metadata block, `## Precedence`, `## Core articles`, `## Capability articles`, and `## Project clauses` — lives at `constitution-template.md`, obtained via the resolver's `resolve_content({ workspaceRoot, ... })` (`class: references-template`, `skill: constitution`, `ref: constitution-template.md`), never a raw `Read` of the plugin-cache path. It is read only on this write path (establish/update), so it stays out of the boot body. Follow it, then emit it with placeholders substituted.

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
- **A capability resolves as invalid** (its `manifest.md` unreadable — `resolve_registry({ workspaceRoot, ... })` marks
  it with an invalid `validity` and empty `articles[]`). Compose the rest; record that
  capability with no articles and note it in the chat summary. The registry validator
  (WF-2 / WF-28) is the gate for malformed registries — this skill does not STOP on it.
- **`establish` passed but the constitution already exists.** Stop and tell the user to re-run
  with no argument (which updates). Don't clobber.
- **`update` passed but no constitution exists.** Stop and tell the user to run with no
  argument (which establishes). Don't fabricate an empty update.
- **The existing record carries superseded core article text.** The ordinary case for a
  project composed against an earlier release — not an error and not a conflict. Replace the
  core-articles section with this release's articles, leave the project clauses untouched,
  and report the refresh in the chat summary. Nothing detects this state on its own: it
  surfaces only when this skill re-runs.
- **The existing record's structure is not the template's.** A missing, duplicated, or
  out-of-order section heading, or an unrecognized section between two this skill composes
  → **refuse**: leave the file byte-for-byte as it is, name the structure that was not
  recognized, and stop. Never regenerate a record you cannot place — that is the one path
  that would destroy the project's own clauses.
- **Project clauses would change on re-compose.** Never silently overwrite — ask first;
  default to preserving the existing text. The project section is user-owned.
- **Unchanged project on re-run.** Produce **no diff** — same registry + same project clauses
  ⇒ byte-identical file. Idempotency is a contract, not a nicety.
- **A capability declares no articles.** It simply contributes nothing to the capability
  group — not an error, the same no-op as an absent capability.
- **Free text starting with a reserved word** (e.g. `update the scratch rule…`). Clause intake,
  not update mode — the reservation is on the **exact sole argument** only. A user who wanted the
  mode passes the bare word.
- **Clause intake with no constitution present.** Stop: "No constitution to add a clause to. Run
  `/wf:constitution` first." Never establish a record as a side effect of recording a clause.
- **The clause is already covered by an existing article.** Report the covering id and write
  nothing (`CONSTITUTION — clause covered`). A second copy of a rule is a second thing to keep in
  sync, and the covering id is the useful answer.
- **The clause contradicts a core or capability article.** Not a stop and not a silent write: the
  echo names the conflicting id and states the conflict, and only an explicit confirmation
  proceeds — recording it as a project clause that overrides that id. Precedence resolves it;
  the article is never edited.
- **`drop`/`amend` naming a `core.*` or `<capability>.*` id.** Stop and name the supported route
  (add an overriding project clause). Those ids are re-rendered from source, so an edit would be
  reverted on the next re-composition — accepting it would be a silent no-op.
- **`drop`/`amend` naming a `proj.N` that is not in the record.** Stop and list the ids that are.
  A dropped id is never re-minted, so a stale reference is a mistake, not a gap to fill.
- **The echo is declined.** The record is left byte-for-byte unchanged
  (`CONSTITUTION — clause declined`). Declining is a supported outcome, not a failure.
- **Free text carrying two independent obligations.** Split into two clauses, each with its own
  minted id, echoed together under one approval — one rule per article is the contract.

---

## Final Output

End the chat reply with this fenced block, as the very last thing emitted:

On the establish / update path:

```
CONSTITUTION — <established | updated | unchanged>

Articles: <9 core> + <capability articles present | none (core-only)> + <project section: seeded | preserved>
Registry: <comma-separated capability names | none (core-only)>
File:     _local/constitution.md
Next:     review _local/constitution.md and add any project clauses with /wf:constitution <clause text>; then /wf:spec <id> to start a task (the constitution is intended for consultation at spec and enforcement at verify once that wiring lands).
```

On the clause-intake path:

```
CONSTITUTION — <clause added | clause amended | clause removed | clause covered | clause declined>

Clause:      <the normalized clause as recorded, or the one that was not>
Sync impact: <+proj.N "…" | ~proj.N "…" | -proj.N "…" | none — covered by <id> | none — declined>
Articles:    <9 core> + <capability articles present | none (core-only)> + <project clauses: N>
File:        _local/constitution.md
Next:        review _local/constitution.md, or record another clause with /wf:constitution <clause text>.
```

`clause covered` and `clause declined` both wrote **nothing** — their `Sync impact:` says so
explicitly rather than leaving a silent no-op to be inferred.

**The final output block must always be the very last thing output to chat.**
