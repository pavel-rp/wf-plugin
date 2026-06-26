---
name: migration-map
description: Produces a deterministic 1:1 migration mapping table between a C#/MVC source and its Angular/TypeScript target (POCO, enum, viewmodel, MVC partial, service, cookie-slice) with per-row file and line evidence and grep-verified counts. Use when the user wants to audit or document a CRA→Angular migration before finalizing.
allowed-tools: [Read, Write, Edit, Glob, Grep, Bash]
---

# /wf-caps:migration-map — Deterministic 1:1 migration mapping table

Produce a deterministic 1:1 migration mapping table between a C# / MVC source and its Angular / TypeScript target. Works for POCOs (C# class → TS interface), enums, ViewModels, MVC partial views (`.cshtml` → Angular component `.html` + `.ts`), controller/service methods, and cookie-slice state. Every row is backed by `file:line` evidence and counts are verified via `grep`/`awk`, not eyeballed. Use when the user asks to "map this 1:1", "produce a migration table", "diff the POCO against the TS interface", "map all migrated stuff in this branch", or wants a coverage report before finalizing a migration.

Every CRA → Angular migration in this repo is a strict 1:1 copy: property
names preserved (camelCased from PascalCase), enum integer values round-trip
to .NET, ids/classes preserved on DOM migrations, method signatures
preserved on service migrations. This skill turns that invariant into a
verifiable artifact — a table with one row per migratable unit and an
evidence column the reader can click through.

The output is **not a review**; it's a mapping. Deviations are flagged in a
separate section so the reader can decide whether each one is intentional.
Counts are verified via `grep` / `awk` over the actual files, so the reader
can reproduce the numbers rather than trust a count the LLM generated.

---

## Dispatch on arguments

Parse the argument to decide source and target files.

### empty → infer from current branch

1. `git status --porcelain` + `git diff --name-only main...HEAD` — union of
   staged/unstaged/untracked and committed changes.
2. Partition by extension:
   - New/changed `.ts` / `.html` / `.scss` in `AuditTrakker.Web/` → the
     **target** side.
   - Untouched `.cs` / `.cshtml` referenced by the ticket or by the
     `//MIGRATION NOTE` / `//MIGRATION TODO` comments in the target files
     → the **source** side.
3. If the branch also has an `_local/ADO-<id>/00_reqs.md`, read it for the
   source-file citation (ticket bodies almost always name `ReportCookie.cs`,
   `ReviewController.cs`, `_ProviderFilter.cshtml`, etc.). Prefer the
   ticket's citation over your inference when they disagree.
4. If no target files exist, stop and ask the user to point at the files
   explicitly.

### one arg — `<path-to-target>`

Use the given target (TS/HTML) file. Infer the source file from:
- The ticket (`00_reqs.md`) if present.
- `//MIGRATION NOTE (XX): migrated from <path>` comments inside the target.
- Filename heuristic (`foo.component.html` ↔ `_Foo.cshtml`, `cra-shared-state.models.ts`
  ↔ `ReportCookie.cs`).

If inference fails, ask the user for the source path.

### two args — `<source> <target>`

Explicit pairing. Skip inference. Useful for verifying a mapping the user
is about to commit, or a renamed migration that doesn't match heuristics.

### `--kind=<poco|enum|viewmodel|partial|service|slice>` (optional)

Override the auto-detected pairing kind. Useful when a file is ambiguous
(e.g. a `.cs` with both a POCO and a static helper class).

---

## Pairing kinds

Auto-detect by scanning the source file. If multiple fit (rare), emit one
section per kind.

### `poco` — POCO class → TS interface

**Source shape:** C# class with `public <Type> <Name> { get; set; }`
properties. No methods beyond `Load()` / `Save()` style persistence.

**Target shape:** TS `interface` declaration.

**Extraction:**
- Source: `^\s+public\s+\S+\s+\w+\s*\{\s*get;` → list of `(Type, Name)`.
- Target: `^\s+\w+\s*:\s*[^;]+;?` inside the interface body.

**Pairing rule:** PascalCase ↔ camelCase. Compare name with first letter
lowercased (and acronym preservation, e.g. `IsIncludeICD` stays
`isIncludeICD`, not `isIncludeIcd`).

**Type mapping reference:** per
`ComplianceRisk.TechDocs/MigrationDesigns/CRA_State_Services_Migration_Design.md:78-86`
— `int?→number|null`, `bool?→boolean|null`, `DateTime?→Date|null`,
`List<int>/List<int?>/List<short>→number[]`, `List<string>→string[]`,
`List<SortSetting>→SortSetting[]`, enums round-trip by integer value.
Plain `string` is **not** in the table — if the source has plain `string`
and the target has `string` or `string | null`, flag it as a
STOP-AND-ESCALATE gate trigger (do not silently approve either).

### `enum` — C# enum → TS enum

**Source shape:** `public enum <Name>[: Int16]? { A = 0, B = 1, ... }`.
**Target shape:** `export enum <Name> { A = 0, B = 1, ... }`.

**Pairing rule:** name-by-name. Integer value **must match** exactly (they
round-trip to .NET when APIs accept the enum later). Flag any missing or
renumbered member.

Common enums in this repo: `AuditCodeReviewedCodesFilter`,
`ProviderAuditResultSortBy`, `SortOrder` (`ComplianceRisk.WebUI.Classes`).

### `viewmodel` — MVC ViewModel → Angular component `@Input` surface

**Source shape:** C# class in `Models/` with `public <Type> <Name> { get; set; }`
used by a Razor view. May have `[Required]` / `[Display]` attributes.
**Target shape:** Angular component `.ts` file — `@Input()` properties,
form group controls, or a `readonly state = signal<...>()` object.

**Pairing rule:** camelCase name match. Attribute-driven validation
(`[Required]`, `[StringLength]`) should map to `Validators.required` /
`Validators.maxLength(N)` in the Angular form. Flag any missing validator.

### `partial` — MVC partial view → Angular component template

**Source shape:** `.cshtml` with `@Html.*`, `<input id="...">`,
`<div class="...">`, `@model <ViewModel>`.
**Target shape:** `.html` component template plus its `.ts` sibling for
`@Input` / event-handler wiring.

**Pairing rule:**
- Every `id="..."` in `.cshtml` must appear in `.html` with the same
  value (per Migration Guidelines: ids/names/classes preserved verbatim,
  even if wrong capitalization).
- Every `class="..."` token (ignoring framework noise like `form-control`
  when identical) must appear.
- Every `@Html.DropDownListFor` / `@Html.TextBoxFor` etc. becomes a
  `<kendo-*>` or `<select>` / `<input>` with a matching `formControlName`
  or `id`.
- Every `@Url.Action` / `@Html.ActionLink` maps to an `[href]` binding or
  a service call.

Run a `Grep` for `id="` and `class="` in both files and produce a diff.

### `service` — MVC controller/service → Angular service

**Source shape:** `public <ReturnType> <MethodName>(<params>)` inside a
controller action or service class. `[HttpGet]` / `[HttpPost]` attributes
if present.
**Target shape:** Angular service method returning `Observable<T>` or
`Promise<T>`, usually wrapping `HttpClient.get/post`.

**Pairing rule:** method-by-method. Verify:
- HTTP verb matches the C# attribute (or the controller default).
- Route matches `@RoutePrefix` + `[Route("...")]` on the C# side.
- Request body / query parameters have the same names and types after
  camelCasing.
- Return type: `ActionResult<T>` → `Observable<T>` with T mapped per the
  POCO rules above.

### `slice` — MVC cookie → Angular observable-store slice

**Source shape:** a `CookieBase` subclass (e.g. `ReportCookie.cs`) with
public properties and a `Load()` / `Save()` pair.
**Target shape:** a state-models file (e.g. `cra-shared-state.models.ts`)
that declares:
- `<Slice>State` interface — one property per cookie property (`poco` kind
  rules apply).
- `<Slice>StateKeys` enum — one entry per state property, camelCase name
  and camelCase string value.
- `<Slice>StoreActions` enum — `Rehydrate = '<Slice> Rehydrate'` plus
  `Set<PascalProp> = '[<Slice>] Set <camelProp>'` for each state property.
- `initial<Slice>State` const — defaults matching the cookie's
  post-`Load()` defaults (true/false/enum literal overrides, null for
  unset scalars, `[]` for collections).

**Pairing rule:** produce five tables:
1. C# property ↔ TS state property (poco rules).
2. C# property ↔ Keys enum entry (all camelCase, 1:1).
3. C# property ↔ `Set<Prop>` action (with exact action string).
4. C# cookie-key constant (`ReportCookieNames.Foo = "ab"`) — note these
   are **not migrated**; the Angular slice uses full camelCase keys in
   localStorage. Flag as out-of-scope but list for completeness.
5. `Load()`-time default → `initial<Slice>State` default.

Also count the `Rehydrate` action as one extra action (N+1).

---

## Extraction patterns

**Finding the source/target files first:** when the pairing isn't obvious from the arguments or ticket, use sourcebot MCP (`mcp__sourcebot__search_code`, `mcp__sourcebot__list_tree`) to locate the declarations. Fall back to `Glob`/`Grep` if sourcebot is unavailable.

**For the counts themselves:** use `awk` — `grep` count output has edge cases with newline handling at end-of-file. The shell commands below are deliberate and stay as-is; the reader should be able to reproduce the numbers. Representative commands:

```bash
# C# public properties
awk '/public .*\{ *get;/ {c++} END {print c}' <file>.cs

# TS interface properties (inside body, indented, no =)
awk 'NR>=<START> && NR<=<END> && /^  [a-z].*:/ {c++} END {print c}' <file>.ts

# TS enum entries with string values
awk 'NR>=<START> && NR<=<END> && /^  [A-Za-z].*=.*'"'"'/ {c++} END {print c}' <file>.ts
```

Always print the contents alongside the count, so the reader can see which
lines were counted and catch false positives.

---

## Output format

Produce one markdown section per pairing kind. Standard shape:

```markdown
# /wf-caps:migration-map — <source-basename> ↔ <target-basename>

**Source:** `<path>` (<LOC>)
**Target:** `<path>` (<LOC>)
**Kind(s):** <poco | enum | ...>
**Coverage:** <N mapped> / <M source units> (<extras on target side>)
**Generated by:** <model identifier>

## Properties (poco)

| # | C# property | C# type | TS property | TS type | Default |
|---|---|---|---|---|---|
| 1 | `SkipEmptyCategories` | `bool?` | `skipEmptyCategories` | `boolean \| null` | `true` |
| 2 | ... | | | | |

⚑ footnote for any row carrying a migration note (e.g. JSON-serialized
side) — explain below the table.
⚠ footnote for any row whose type mapping is not in the design doc's
Type Mapping table — flag for STOP-AND-ESCALATE.

## Enum values (enum)

| C# name | C# value | TS name | TS value |

## Deterministic counts

| Location | Count |
|---|---|
| `<source>` public properties | N |
| `<target>` `<Interface>` properties | N |
| `<target>` `<Keys>` enum entries | N |
| `<target>` `<Actions>` enum entries | N+1 |
| `<target>` `initial<Slice>State` entries | N |

All counts reproduced via `awk` — command shown in the `<details>` block
below.

<details>
<summary>Count commands</summary>

```
awk ...
```

</details>

## Missing / extra / flagged

- [MISSING] `<Name>` in source has no target counterpart.
- [EXTRA] `<Name>` in target has no source counterpart — justify (support
  type? helper DTO? pure Angular need?).
- [⚠ UNMAPPED TYPE] `<Name>` uses a source type not in the design's Type
  Mapping table. Stop and ask Zach.
- [FORMAT] `//MIGRATION NOTE` on `<Name>` is missing the `(<initials>):`
  marker required by the Migration Guidelines.

## Recommended next actions

- Specific, ordered follow-ups. `file:line` where applicable.
```

For non-POCO kinds, the table columns differ:
- `enum` → `C# name | C# value | TS name | TS value`
- `partial` → `id/class | cshtml:line | html:line | status`
- `service` → `C# method | verb+route | TS method | TS path | status`
- `slice` → five tables as described above

Keep quoted type snippets short. The reader should click `file:line` for
anything longer.

---

## Artifact — `_local/ADO-<id>/03_migration-map.md`

The mapping report is **always written to disk** alongside the inline
chat output, so the user ends up with a durable artifact they can diff,
attach to a PR, or hand to a reviewer. Path rules:

- If the branch resolves to an ADO id (same logic as `/wf:verify-spec` —
  extract the first 3+-digit run from `git branch --show-current`, confirm
  `_local/ADO-<id>/` exists), write to
  `_local/ADO-<id>/03_migration-map.md`. This slots into the existing
  ticket folder next to `00_reqs.md` / `01_spec.md` / `02_plan.md`.
- If no ADO folder exists (e.g. branch name has no id, or the folder
  hasn't been scaffolded yet), write to
  `_local/migration-map-<yyyymmdd>-<source-basename>.md`. Don't create
  an `_local/ADO-<id>/` folder — that's the spec-fetch skill's job, not
  this one.
- If two args were passed explicitly (`<source> <target>`) and the branch
  has no ADO id, use the second form too.
- If a file already exists at the target path, overwrite. The mapping is
  a derived artifact — regenerating it is the whole point, and the
  previous version is in `git reflog` / localhistory anyway.

Write the **same markdown** you show inline — don't split content across
the two. The inline rendering is for the reader's immediate eye; the
artifact is for later reference and for attaching to PR descriptions.

`_local/` is gitignored (see repo `.gitignore`), so the artifact never
enters commits. If the user wants it in the PR, they paste it manually.

After writing, report the path back to the user in the end-of-turn
summary so they know where it landed.

**Update the index** when the artifact landed under an ADO task folder
(`_local/ADO-<id>/03_migration-map.md`): invoke
`/wf:index <id> migration-map "<n> mappings · <m> partial · <k> missing"`
where `<n>` is the total mapped row count, `<m>` is the count of
[FORMAT] / [⚠ UNMAPPED TYPE] flagged rows, and `<k>` is the count of
[MISSING] rows. Skip the index call when the artifact was written to the
fallback `_local/migration-map-<yyyymmdd>-…md` path (no task folder
context exists).

---

## What this skill will NOT do

- Will NOT modify **source** code. The only file it writes is its own
  report artifact under `_local/`.
- Will NOT infer a mapping for a source type not in the design's Type
  Mapping table — flag as STOP-AND-ESCALATE, don't silently pick one.
- Will NOT "clean up" deviations by omitting them from the table. Every
  mismatch gets a row plus a flag.
- Will NOT pad counts. If `awk` says 55 and the interface has 56, show
  both numbers and find the discrepancy.
- Will NOT create the `_local/ADO-<id>/` folder if it's missing — that
  signals the ticket hasn't been fetched yet, and this skill isn't the
  right entry point for that.

---

## Edge Cases

- **Source has `string`, target has `string | null`** — plain `string`
  is not in the Type Mapping table. Reference:
  `CRA_State_Services_Migration_Design.md:78-86`. Always flag, even if
  the choice seems obvious.
- **Actions enum missing `Rehydrate`** — every slice must have a
  Rehydrate action, per `ObservableStoreSlice.rehydrateStateFromLocalstore`.
  Count of actions should be **N+1** where N is the property count.
- **MVC partial ids renamed to camelCase** — Migration Guidelines say
  ids/names/classes are preserved verbatim, even when the original is
  wrong (`id="riskCatId"` stays `riskCatId`, not `riskCategoryId`).
- **Auto-fetched `00_reqs.md` is older than the latest commit on the
  branch** — warn the user the ticket may have been updated mid-stream.
- **Two migrations in one branch** — `git log main..HEAD --oneline`
  reveals multi-ticket branches. Emit one mapping per ticket, clearly
  labeled.

---

## Final Output

End the turn with this block, after the inline mapping and the artifact-path report:

```
MIGRATION-MAP — <clean | flagged>

Pairing:  <source-basename> ↔ <target-basename> (<kind(s)>)
Coverage: <N> mapped · <m> flagged · <k> missing
Artifact: <path written>
Next:     <branched on the result — see below>
```

The `Next:` line branches on the result:

- **flagged or missing rows** → `address the rows in "Missing / extra / flagged", then re-run /wf-caps:migration-map`.
- **clean** → `/wf:verify-spec <id>` — its migration-rule audit re-checks conformance (omit when the map landed at the no-task fallback path).

**The final-output block must always be the very last thing output to chat.**
