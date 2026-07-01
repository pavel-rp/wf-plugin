# `task-list` fragment — migration capability (inline reference doc)

**Version:** 1.0.0 (WF-23 — the migration `tasks`-phase decomposition fragment)
**Wired by:** `plugins/wf-caps/capabilities/migration/manifest.md` (`task-list → inline: fragments/task-list.md`)
**Backed by:** the `type-map` and `invariants` slots of `plugins/wf-caps/capabilities/migration/migration.contract.md`
**Model:** claude-opus-4-8

---

## What this doc is

This is the **inline reference doc** the core reads and follows in-context when it fires the
`tasks` phase with the migration capability active. The invocation runtime
(`plugins/wf/skills/_contracts/invocation-runtime.contract.md`) resolves
`tasks | task-list | inline: fragments/task-list.md` from the manifest and reads this file; the
core then performs the procedure below and returns tasks in the phase's generic `task-list`
shape, appended after the generic decomposition in registry order.

It introduces **no new slots or fragments.** The decomposition shape below re-expresses the
migration capability's standing `type-map` and `invariants` (a faithful 1:1 port preserves
names, integer values, DOM ids/classes, and signatures) as an ordered list of small,
independently testable porting increments. Concrete per-project values (the actual legacy
source constructs, the paired migrated targets, the type correspondences) come from the work
under review and a downstream `_local/` migration profile / map — this doc is the kept
reference shape, not the populated instance.

The point: a migration decomposes naturally **one ported construct at a time**, and each
construct is most safely ported **scaffold-then-component** — stand up the typed shell, then
fill and wire its behavior — so every increment is independently checkable against its legacy
oracle. These tasks are **additive** to the core's plan-derived decomposition, never a
replacement.

---

## Inputs the core supplies

- **The work under review** — the approved plan and the constructs it settles for porting.
  Core performs no migration detection or pairing of its own; **this fragment resolves the
  legacy↔migrated pairing in-context** — from a migration map artifact when present, otherwise
  from the plan / spec naming a legacy source construct to port. When no such pairing can be
  resolved, the work is not a migration and the fragment returns the empty task list (see
  below).
- **The generic `task-list` shape** — the phase's `task-list` contract that every task
  follows: a stable `T-NNN` id (numbered in the global sequence after the generic tasks), a
  title, a `Derives from:` trace, a `Proves done:` line naming the observable check, the single
  change, and the file(s) it touches. Migration tasks fill this shape; they do not invent a
  parallel one.

## What the core does (follow in-context)

For each migrated construct in the work under review, emit an ordered pair (or short run) of
tasks in the generic `task-list` shape, under the continuing global `T-NNN` sequence.

### 1. One construct at a time, in dependency order

Order constructs so each builds only on the ones before it — port the types/enums a component
consumes before the component, the data slice a form reads before the form. Where the
migration map enumerates constructs, follow its order; otherwise derive the order from the
plan's strategy.

### 2. Scaffold then component — two increments per construct

For each non-trivial construct, emit two tasks so each is independently testable:

- **Scaffold task** — stand up the typed shell of the migrated target: the type/interface,
  the empty component class with its preserved selector, or the slice with its default-valued
  properties. `Proves done:` the shell compiles and the preserved names / default values match
  the legacy surface (the `type-map` correspondence and the `invariants` name/value
  preservation).
- **Component task** — fill and wire the behavior: the method bodies, the template that
  reproduces the legacy DOM ids/classes/labels verbatim, the round-trip that rehydrates an
  enum to the same integer. `Proves done:` the behavior matches the legacy oracle (a round-trip
  value survives, a preserved DOM id is present, a signature is unchanged).

A trivial construct (a pure enum, a single POCO) collapses to one task: port it and prove the
integer values / property typing round-trip unchanged.

### 3. Trace and check every task

- **`Derives from:`** names the plan element (or migration-map row) the task ports, so the
  decomposition stays a derivation of the approved plan, never new scope.
- **`Proves done:`** names the migration invariant the increment must satisfy — a 1:1 name
  match, an integer round-trip, a verbatim DOM id/class, a preserved signature — stated as
  something observable, so the task is independently testable the way the generic shape
  requires.

### 4. Derive from the migration map when present

The migration-map artifact is usually produced later (at `verify` time), so at the `tasks`
phase the normal input is the plan/spec pairing of §"Inputs the core supplies". But when a
map artifact *does* already exist, it is the primary input — it already did the 1:1
enumeration with `file:line` evidence. Translate it directly: each mapped construct → its
scaffold-then-component task pair; each enum row → one integer-round-trip task; each
`[MISSING]` / `[⚠ UNMAPPED TYPE]` flag → a task that ports the missing construct, ordered first
so the gap closes before dependents. Don't re-derive the mapping from source — trust the
grep-verified map.

## Output the core returns

A list of tasks in the phase's generic `task-list` shape, appended **after** the core's
plan-derived decomposition, numbered in the continuing global `T-NNN` sequence. Each task
carries the same shape as every generic task plus the migration-distinguishing `Proves done:`
oracle:

```markdown
### T-NNN: Scaffold <migrated construct> — typed shell with preserved names

**Derives from:** <plan STEP-NNN, or migration-map row for the construct>
**Proves done:** the shell compiles; the preserved selector/type names and default values match the legacy surface (oracle: type-map + invariants).

**Change:**

- Stand up the typed shell of `<migrated construct>` — the interface / empty component class / default-valued slice — with the legacy names preserved verbatim.

**Files:**
| File | Action |
|------|--------|
| `path/to/migrated/construct` | create |
```

When **no** construct in the work under review is a migration (no map, no plan/spec pairing to
a legacy source), this fragment contributes an **empty task list** — the same empty shape the
no-op produces. The core proceeds with its generic decomposition either way; this fragment
contributes tasks, it does not halt the skeleton or force a section.
