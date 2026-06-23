# wf:qa-gen — Migration parity scenarios

How `/wf:qa-gen` covers a **migration task** — one that ports a legacy C#/MVC unit (POCO, ViewModel, MVC partial view, controller/service method, cookie slice) to an Angular/TypeScript counterpart. Loaded from `SKILL.md` Phase 3.6 when the task is classified as a migration.

The point: every CRA → Angular migration in this repo is a strict **1:1 copy** (property names preserved, enum integer values round-trip, DOM ids/classes preserved verbatim, method signatures preserved). A migrated unit that compiles is not a migrated unit that *behaves and looks like the original*. Parity scenarios exist so the migrated part is exercised against the legacy part as the oracle — not stamped PASS because it typechecks or because its criteria happen to be all Build/static.

These scenarios are **in addition to** the normal spec-traced suites, not a replacement. A migration task still gets browser/API scenarios for any net-new behavior its criteria describe; parity is the extra layer that pins "matches the thing it replaced."

## Contents

- [When to emit parity scenarios](#when-to-emit-parity-scenarios)
- [The legacy oracle — side-by-side vs captured](#the-legacy-oracle--side-by-side-vs-captured)
- [Functional parity scenarios](#functional-parity-scenarios)
- [Visual parity scenarios](#visual-parity-scenarios)
- [Deriving parity from the migration map](#deriving-parity-from-the-migration-map)
- [Parity scenario template](#parity-scenario-template)
- [Scope behavior](#scope-behavior)

---

## When to emit parity scenarios

A task is a **migration** when any of these hold (checked in Phase 2):

1. **Type metadata says so.** `01_spec.md` / `02_plan.md` carries `**Type:** migration` (persisted by `/wf:classify`).
2. **A migration map exists.** `03_migration-map.md` is present in the task folder (output of `/wf:migration-map`). This is the strongest signal *and* the richest input — it already enumerates every 1:1 unit with `file:line` evidence.
3. **The diff is shaped like a migration.** `git diff --name-only main...HEAD` has Angular target files (`.ts` / `.html` / `.scss` under `AuditTrakker.Web/`) **and** the target files carry `//MIGRATION NOTE` / `//MIGRATION TODO` comments naming a legacy `.cs` / `.cshtml` source, **or** `00_reqs.md` cites a legacy source file (`ReportCookie.cs`, `ReviewController.cs`, `_ProviderFilter.cshtml`, …).

When none hold, the task is not a migration — skip Phase 3.6 entirely and emit no parity suite.

For each migrated unit, decide which parity dimensions apply:

- **Functional parity** — the unit has observable runtime behavior (an endpoint that returns/filters/persists, a component that filters a list, a state slice that round-trips through localStorage). Emit functional parity scenarios.
- **Visual parity** — the unit has a rendered surface (a migrated `partial` → component template, a ViewModel-driven form). Emit visual parity scenarios.

A `poco` or `enum` migration with no rendered surface and no standalone behavior gets **functional** parity only (e.g. enum integer values round-trip); a pure presentational `partial` with no logic gets **visual** parity only. Most real units get both.

---

## The legacy oracle — side-by-side vs captured

Parity needs a reference for "what the legacy did/looked like." Two oracle modes, chosen per scenario:

1. **Side-by-side (preferred when the legacy app is reachable).** The legacy MVC view/endpoint is still runnable in the dev environment. The scenario drives **both** the legacy surface and the migrated surface with the same inputs and compares outputs directly. Emit the precondition:

   ```
   Legacy reference: <legacy route or view — e.g. ComplianceRisk.WebUI `/Review/ProviderFilter`>
   ```

   This is the parity analog of `Host required:` / `Backend host required:`. **The scenario author chooses the oracle mode up front** (see the default rule below) and encodes it here — the runners execute the Steps table as written and do **not** auto-detect legacy reachability or switch modes (they only special-case `Type: API`; everything else runs the steps verbatim). If a side-by-side step's legacy surface turns out to be unreachable at run time, the runner marks that step BLOCKED; the scenario should then be re-generated in captured mode.

2. **Captured (when the legacy app is not runnable side-by-side).** The legacy behavior/appearance is captured *ahead of time* as the expected oracle — from the spec, from the `03_migration-map.md` evidence, or from a one-time read of the legacy source's *public surface* (the same signature-only, black-box allowance the rest of the skill uses — DOM ids/classes in `.cshtml`, property names in the POCO, the enum's integer values; never the method bodies). Emit the precondition:

   ```
   Legacy oracle: captured (<source — 03_migration-map.md | 00_reqs.md | legacy signature read>)
   ```

   The expected values are baked into the scenario's **Expected Result** column as concrete strings/ids/numbers, so the runner asserts the migrated side against a fixed oracle with no live legacy needed.

Default to **captured** unless `00_reqs.md` / `01_spec.md` (or `_local/config.md`) states the legacy app is runnable in the dev environment — most migration verification happens with only the new app live. State the chosen mode in the precondition either way.

---

## Functional parity scenarios

Assert that the migrated unit produces the **same observable output as the legacy unit for the same input**. What "same output" means by kind:

| Migrated kind | Functional parity assertion |
|---|---|
| `service` / endpoint | Same HTTP verb + route shape; same inputs → same response **contract** (status, shape, spec-named fields) and same documented edge behavior (empty-result handling, sort order, filter exclusions). Assert the contract, **never exact row counts or DB-specific values** — same caution as API scenarios. |
| `slice` (cookie → store) | Same property defaults after load; setting a value persists and rehydrates to the same value; enum-valued slots round-trip to the same integer. Drive it through the UI that reads/writes the slice, or via the store's public API in a page-test host. |
| `viewmodel` (→ form) | Same validation behavior — a field `[Required]` in the legacy ViewModel blocks submit when empty in the migrated form; `[StringLength(N)]` enforces the same max length. Same default values on load. |
| `poco` / `enum` | Same enum integer values round-trip (pick a value, confirm it survives a save/reload as the same integer); same property presence/typing surfaces correctly where the value is shown or sent. |
| `partial` (interactive) | Same interaction outcome — a dropdown that filtered the list in the legacy view filters it the same way in the migrated component; a button that opened a modal does the same. |

When in side-by-side mode, each row above becomes "do X on legacy, do X on migrated, outputs match." When in captured mode, the legacy output is the fixed expected value and only the migrated side is driven.

---

## Visual parity scenarios

Assert that the migrated rendered surface **matches the legacy view**. Two granularities — emit the DOM-structure check always (it's deterministic and grep-friendly), add the layout check at `full` scope:

1. **DOM-structure parity (always, for any migrated `partial`/view).** Per the repo's Migration Guidelines, ids / names / classes are preserved **verbatim** (even when the legacy capitalization is "wrong" — `id="riskCatId"` stays `riskCatId`). The scenario asserts every legacy `id="…"` and meaningful `class="…"` token appears in the migrated DOM with the same value, every legacy form control has a matching migrated control, and every visible label/heading text matches. This is largely derivable statically from the `03_migration-map.md` `partial` rows — turn each mapped id/class/label into an assertion row.

2. **Layout / visual parity (add at `full` scope).** The migrated view's visible layout matches the legacy view — same field order, same grouping/sections, same column set in tables, same control types (a legacy dropdown is a dropdown, not a free-text box). In **side-by-side** mode this is a screenshot-comparison step: capture the legacy route and the migrated route at the **same viewport** and compare for structural/visual equivalence (exact-pixel parity is *not* required — fonts/spacing may differ between MVC and Angular; assert layout equivalence, not pixel-identity). In **captured** mode it's a checklist of layout elements the runner confirms present and in the same order.

Visual parity findings that are intentional deviations (a deliberate redesign noted in the spec) are not failures — note them as `<!-- INTENTIONAL DEVIATION: <element> · <spec reference> -->` so the runner doesn't flag them.

---

## Deriving parity from the migration map

When `03_migration-map.md` exists, it is the primary input — it already did the 1:1 enumeration with evidence. Translate it directly:

- Each **`poco` / `slice` property row** → one functional parity assertion (the value/default/round-trip survives).
- Each **`enum` value row** → one assertion that the integer value round-trips unchanged.
- Each **`partial` id/class/label row** → one DOM-structure visual parity assertion.
- Each **`service` method row** → one functional parity scenario (verb/route/contract match).
- Each **`[MISSING]` / `[⚠ UNMAPPED TYPE]` / `[FORMAT]` flag** in the map → a parity scenario marked `[BLOCKED BY MAP FLAG: <flag>]`; the migration map must be reconciled before parity can pass. Surface these under the coverage matrix's **Parity blockers** sub-list — a category **distinct from** the SC-N "no coverage" Gaps (a parity blocker is a scenario that exists but cannot pass until the map is fixed, not a criterion with no scenario). Don't mix the two.

Don't re-derive the mapping from source — trust the map (it's grep-verified). If no `03_migration-map.md` exists, suggest running `/wf:migration-map {id}` first in the final-output `Next:` line, and derive parity from the spec + a signature-only legacy read instead.

---

## Parity scenario template

Same outer shape as every other scenario (`Validates` / `Priority` / `Preconditions` / `Teardown`) so the report and traceability roll up identically. The distinguishing marks: a `**Type:** parity` line, a `**Parity:** functional | visual` line, and a `Legacy reference:` / `Legacy oracle:` precondition. The **Steps** table's Expected Result column carries the legacy oracle values.

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
- Legacy oracle: captured (<03_migration-map.md | 00_reqs.md | legacy signature read>)   <!-- captured mode -->
- Host required: <component-path>                   <!-- only if the migrated component is un-routed, per Phase 2 -->

**Steps:**

| # | Action | Expected Result |
|---|---|---|
| 1 | Navigate to the migrated view `<route>`. | Primary content renders. |
| 2 | Confirm the migrated DOM has `id="riskCatId"`, class `provider-filter`, label `Provider`. | All present with the legacy values (oracle: migration-map partial rows). |
| 3 | Select `Acme Corp` in the **Provider** dropdown. | The list filters to Acme rows — same filtering the legacy `_ProviderFilter` applied. |

**Teardown:**

- <none | revert any data fixture>
```

When **Parity is functional** the Steps table compares behavior (legacy output vs migrated output, or migrated vs captured oracle). When **Parity is visual** the table walks DOM-structure assertions (and, at `full` scope, a final screenshot/layout-comparison step). One assertion per row, as everywhere else.

A migration unit with no own success criterion (the spec covers the feature, not the migration mechanics) uses `**Validates:** — (migration parity, not spec-traced)` — parity is the standing bar for a migration the same way Baseline health is for any change. These are the second sanctioned exception to "untraceable scenarios don't ship."

---

## Scope behavior

Parity scenarios respect the same scope filter as spec scenarios:

- **`smoke`** — one parity scenario per migrated *surface* (one functional + one visual for an interactive migrated view; one functional for a pure data unit), golden path only. DOM-structure visual parity counts as the one visual scenario.
- **`happy`** — add key variations: the main alternate inputs/flows the legacy supported (a second filter value, an alternate valid form input).
- **`full`** — add the layout/screenshot visual-parity step, legacy edge behaviors (empty states, boundary values the legacy handled), and negative parity (an input the legacy rejected is rejected the same way).

The parity suite is its own `## Suite: Migration parity` section, numbered in the global `TC-NNN` sequence, placed **after** the spec suites and **before** Baseline health. It is omitted entirely for non-migration tasks.
