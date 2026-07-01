# `parity-suite` fragment — migration capability (inline reference doc)

**Version:** 1.1.0 (WF-82 — absorbed the C#/.NET backend-surface file-pattern examples re-sourced from core's `qa-gen/references/api-scenarios.md`)
**Wired by:** `plugins/wf-caps/capabilities/migration/manifest.md` (`parity-suite → inline: fragments/parity-suite.md`)
**Backed by:** the `invariants` slot (the parity-relevant subset) of `plugins/wf-caps/capabilities/migration/migration.contract.md`
**Model:** claude-opus-4-8

---

## What this doc is

This is the **inline reference doc** the core reads and follows in-context when it fires the
`qa-generation` phase with the migration capability active. The invocation runtime
(`plugins/wf/skills/_contracts/invocation-runtime.contract.md`) resolves
`qa-generation | scenario | inline: fragments/parity-suite.md` from the manifest and reads this
file; the core then performs the procedure below and returns scenarios in the phase's generic
`scenario` shape, provenance-tagged to this capability.

It introduces **no new slots or fragments.** The parity bar below is the migration capability's
standing `invariants` (a faithful 1:1 port preserves names, integer values, DOM ids/classes,
and signatures) re-expressed as runnable QA scenarios. Concrete per-project values (the actual
legacy source units, the paired migrated targets) come from the work under review and a
downstream `_local/` migration profile / map — this doc is the kept reference shape, not the
populated instance.

The point: a migrated unit that compiles is not a migrated unit that *behaves and looks like
the original*. Parity scenarios exist so the migrated part is exercised against the legacy part
as the oracle — not stamped PASS because it typechecks or because its criteria happen to be all
build/static. They are **additive** to the core's spec-traced and baseline-health suites, never
a replacement.

---

## Inputs the core supplies

- **The work under review** — the changed code/diff and the ported unit(s). Core performs no
  migration detection or pairing of its own; **this fragment resolves the legacy↔migrated
  pairing in-context** — from a migration map artifact when present, otherwise from
  migration-note comments naming a legacy source, or from the spec citing one. When no such
  pairing can be resolved, the work is not a migration and the fragment returns the empty
  scenario list (see below).
- **The generic `scenario` shape** — the phase's `scenario` contract that every QA scenario
  follows: a stable `TC-NNN` id, a `Validates: SC-N` (or the sanctioned not-spec-traced
  marker) line, a priority, preconditions, an observable Steps table, and teardown. Parity
  scenarios fill this shape; they do not invent a parallel one.

## What the core does (follow in-context)

For each migrated unit in the work under review, decide which parity **dimensions** apply,
pick the **legacy oracle** mode, then emit scenarios in the generic `scenario` shape under a
dedicated parity suite.

### 1. Decide the dimensions per unit

- **Functional parity** — the unit has observable runtime behavior (an endpoint that
  returns/filters/persists, a component that filters a list, a state slice that round-trips
  through storage). Emit functional parity scenarios.
- **Visual parity** — the unit has a rendered surface (a migrated partial-view → component
  template, a view-model-driven form). Emit visual parity scenarios.

A pure data/enum unit with no rendered surface gets **functional** parity only (e.g. enum
integer values round-trip); a pure presentational view with no logic gets **visual** parity
only. Most real units get both.

### 2. Pick the legacy oracle mode

Parity needs a reference for "what the legacy did / looked like." Choose per scenario:

- **Side-by-side** (preferred when the legacy app is reachable). The legacy view/endpoint is
  still runnable; the scenario drives **both** the legacy and migrated surfaces with the same
  inputs and compares outputs directly. Emit the precondition `Legacy reference: <legacy
  route/view>`. The author fixes the mode up front; runners execute the steps verbatim and do
  not auto-detect reachability — if a side-by-side legacy surface is unreachable at run time,
  that step is marked BLOCKED and the scenario should be re-generated captured.
- **Captured** (when the legacy app is not runnable side-by-side — the default). The legacy
  behavior/appearance is captured ahead of time as the expected oracle, from the spec, the
  migration-map evidence, or a one-time **signature-only** read of the legacy source's public
  surface (DOM ids/classes, property names, enum integer values — never method bodies). Bake
  the expected values into the Steps table's Expected Result column. Emit the precondition
  `Legacy oracle: captured (<source>)`.

Default to **captured** unless the spec / config states the legacy app is runnable in the dev
environment. State the chosen mode in the precondition either way.

### 3. Functional parity — same input → same observable output

| Migrated kind | Functional parity assertion |
|---|---|
| `service` / endpoint | Same verb + route shape; same inputs → same response **contract** (status, shape, named fields) and same documented edge behavior (empty-result handling, sort order, filter exclusions). Assert the contract, **never** exact row counts or store-specific values. |
| `slice` (persisted state) | Same property defaults after load; setting a value persists and rehydrates to the same value; enum-valued slots round-trip to the same integer. Drive through the UI that reads/writes the slice, or via the store's public API in a test host. |
| `viewmodel` (→ form) | Same validation behavior — a field required in the legacy view-model blocks submit when empty in the migrated form; a max-length constraint enforces the same limit. Same default values on load. |
| `poco` / `enum` | Same enum integer values round-trip (pick a value, confirm it survives save/reload as the same integer); same property presence/typing where the value is shown or sent. |
| interactive view fragment | Same interaction outcome — a dropdown that filtered the list in the legacy view filters it the same way in the migrated component; a button that opened a modal does the same. |

Side-by-side: each row becomes "do X on legacy, do X on migrated, outputs match." Captured:
the legacy output is the fixed expected value and only the migrated side is driven.

#### Backend-surface file patterns (this capability's stack specifics)

Core's generic API-scenario reference (`plugins/wf/skills/qa-gen/references/api-scenarios.md`)
names backend surfaces by **role** — *endpoint / route-handler*, *service / data-layer*, and
*response-shape type* — and defers the concrete file-name patterns and route-declaration syntax
to the active backend capability. For this C#→TS migration capability, those stack specifics are:

| Role (core's generic term) | Concrete pattern this capability recognizes |
|----------------------------|---------------------------------------------|
| endpoint / route-handler | `*Controller.cs` — read each action's `[HttpGet/Post/Put/Delete]` verb, `[Route]`/route template, parameters, and return type (signature-only). New/changed actions are **endpoint** surfaces. |
| service / data-layer | `*Service.cs` / `*Repository.cs` / `*Provider.cs` — read public method signatures. A new/changed public method with no controller action calling it is a **service-only** surface (→ `Backend host required:`). |
| response-shape type | `*Dto.cs` / model / record types referenced by the above — read property names + types to derive the expected response shape. Legacy ASP.NET framework nouns stay on the source side of the port. |

When deriving parity scenarios for a migrated backend unit (functional-parity `service`/endpoint
rows above, and the map-driven derivation in §5), use these patterns to locate the source and
migrated handlers. They are the migration-capability home for the backend-API examples core no
longer carries — core names the role, this fragment names the C#/.NET pattern.

### 4. Visual parity — migrated rendered surface matches the legacy view

1. **DOM-structure parity (always, for any migrated rendered view).** Ids / names / classes
   are preserved **verbatim** (even when the legacy capitalization looks "wrong" — it stays
   as-is). Assert every legacy `id="…"` and meaningful `class="…"` token appears in the
   migrated DOM with the same value, every legacy form control has a matching migrated control,
   and every visible label/heading text matches. Largely derivable statically from the
   migration map's view rows — turn each mapped id/class/label into an assertion row.
2. **Layout / visual parity (add at `full` scope).** The migrated view's visible layout
   matches the legacy — same field order, grouping/sections, table column set, and control
   types (a legacy dropdown is a dropdown, not a free-text box). Side-by-side: a
   screenshot-comparison step at the **same viewport** asserting layout equivalence (not
   pixel-identity — fonts/spacing may differ across frameworks). Captured: a checklist of
   layout elements confirmed present and in the same order.

Intentional deviations noted in the spec are **not** failures — mark them
`<!-- INTENTIONAL DEVIATION: <element> · <spec reference> -->` so the runner does not flag them.

### 5. Derive from the migration map when present

When a migration-map artifact exists it is the primary input — it already did the 1:1
enumeration with `file:line` evidence. Translate it directly: each property/slice row → one
round-trip functional assertion; each enum value row → one integer-round-trip assertion; each
view id/class/label row → one DOM-structure visual assertion; each service-method row → one
functional parity scenario; each `[MISSING]` / `[⚠ UNMAPPED TYPE]` / `[FORMAT]` flag → a
scenario marked `[BLOCKED BY MAP FLAG: <flag>]` that cannot pass until the map is reconciled.
Don't re-derive the mapping from source — trust the grep-verified map.

### 6. Scope filter

Parity scenarios respect the same scope filter the core applies to spec scenarios:

- **`smoke`** — one parity scenario per migrated *surface* (one functional + one visual for an
  interactive view; one functional for a pure data unit), golden path only. DOM-structure
  visual parity counts as the one visual scenario.
- **`happy`** — add key variations (a second filter value, an alternate valid form input).
- **`full`** — add the layout/screenshot visual step, legacy edge behaviors (empty states,
  boundary values), and negative parity (an input the legacy rejected is rejected the same way).

## Output the core returns

A list of QA scenarios in the phase's generic `scenario` shape, grouped into one parity suite
that the core places **after** its spec-traced suites and **before** the baseline-health suite,
numbered in the global `TC-NNN` sequence. Each scenario carries the same outer block as every
other scenario plus the parity-distinguishing marks:

```markdown
### TC-NNN: <title — name the migrated unit and the parity dimension>

**Validates:** SC-<N> — <criterion, abbreviated>   <!-- or: — (migration parity, not spec-traced) when the unit has no own SC -->
**Priority:** P0 | P1 | P2
**Type:** parity
**Parity:** functional | visual

**Preconditions:**

- Authenticated session; <entity / data state>.
- Legacy reference: <legacy route/view>            <!-- side-by-side mode -->
  — or —
- Legacy oracle: captured (<map | spec | legacy signature read>)   <!-- captured mode -->
- Host required: <component-path>                   <!-- only if the migrated component is un-routed -->

**Steps:**

| # | Action | Expected Result |
|---|---|---|
| 1 | Navigate to the migrated view `<route>`. | Primary content renders. |
| 2 | Confirm the migrated DOM has the legacy ids/classes/labels. | All present with the legacy values (oracle: map view rows). |
| 3 | Drive the migrated behavior with a known input. | Same observable output the legacy produced. |

**Teardown:**

- <none | revert any data fixture>
```

A migrated unit with no own success criterion uses
`**Validates:** — (migration parity, not spec-traced)` — parity is the standing bar for a
migration the same way baseline-health is for any change, the sanctioned exception to
"untraceable scenarios don't ship." One assertion per step, as everywhere.

When **no** unit in the work under review is a migration (no map, no migration-note pairing, no
legacy-source citation), this fragment contributes an **empty scenario list** — the same empty
shape the no-op produces. The core proceeds with its generic plan either way; this fragment
contributes scenarios, it does not halt the skeleton or force a suite.
