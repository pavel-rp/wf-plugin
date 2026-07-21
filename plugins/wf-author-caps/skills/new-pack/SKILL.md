---
name: new-pack
description: Scaffolds a complete registerable plugin pack by interviewing the author for the pack's name, purpose, and its one capability, emitting the plugin manifest, the capability folder, and an init skill on the pack-onboarding spine, then self-linting the whole set and fixing its own findings before handing anything back. Use when the user wants to create, scaffold, or generate a new wf plugin pack, a pack skeleton, or a pack that registers itself, rather than an explanation of the pack anatomy.
allowed-tools: [Read, Write, Edit, Glob, Grep, Bash, AskUserQuestion]
---

# /wf-author-caps:new-pack — interview in, registerable pack out

Before any resolver MCP call, run `pwd -P` and use the returned absolute current Agent/session workspace directory as `workspaceRoot`. In a linked-worktree Agent, that cwd is the Agent's own worktree; never inherit a parent root. Pass it explicitly on every call. Omitting `workspaceRoot` is a hard schema error; resolver MCP calls have no default or fallback root.

Turns a set of validated answers into a real `plugins/<pack>/` tree that installs, registers itself,
and passes the same gates the repository's own pull-request checks apply. It emits **finished files,
never a template** — no `TODO` survives to the author, and no artifact is handed back with a
validator finding still open.

This is the pack-level scaffolder. For one capability alone use `/wf-author-caps:new-capability`; for
one skill alone use `/wf-author-caps:new-skill`; for a capability that binds a provider surface use
`/wf-author-caps:new-provider`. For *why* the anatomy is what it is, use
`/wf-author-caps:authoring-guide`.

**Model:** claude-opus-4-8

---

## Contents

- [Prerequisites](#prerequisites)
- [Command Syntax](#command-syntax)
- [Safety Rules](#safety-rules-non-negotiable)
- [The procedure](#the-procedure)
- [Edge Cases](#edge-cases)

---

## Prerequisites

The bundled `wf-resolver` MCP service must be loaded — it supplies the typed validators this skill
self-lints with, the rule-set bodies it emits from, and the plugin roots it resolves paths from. If
it is unavailable, stop and report that the resolver runtime is not loaded (restart Claude Code); do
not hand-roll the checks.

## Command Syntax

```
/wf-author-caps:new-pack [<pack-name>] [--capability <capability-name>] [--kind adapter|feature|both]
```

| Argument | Required | Description |
|---|---|---|
| `<pack-name>` | NO | The plugin's name. Validated on arrival like any interview answer; an invalid one is explained and re-asked, not repaired. |
| `--capability <capability-name>` | NO | Pre-answers the capability's bare name. Validated identically to a typed answer. |
| `--kind <kind>` | NO | Pre-answers the capability's kind. Validated against the three-kind set identically to a typed answer. |

### Zero-argument default

A bare invocation runs the full interview from question 1 — the intended path. Every argument above
is a shortcut that pre-answers one question; a pre-answered question is validated identically and
re-asked when it fails.

## Safety Rules (NON-NEGOTIABLE)

**Allowed:**

- Read any file in the workspace, and glob it to detect existing plugins, capability names, and
  collisions.
- Write and edit files under the resolved `plugins/<pack-name>/` folder — the plugin manifest, the
  capability folder, and the init skill.
- Add the pack's `plugins[]` entry and bump the top-level `version` in a `.claude-plugin/marketplace.json`
  that already exists at the workspace root — **only** after the author explicitly confirms it, and
  **only** those two edits.
- Run the resolver's `validate_manifest`, `validate_registry`, `validate_skill_interface`,
  `validate_references`, and `preview_composition` tools, the repository's `glossary-lint.sh`, and
  `claude plugin validate` over the emitted plugin manifest.

**Forbidden:**

- Write or edit anything outside `plugins/<pack-name>/`, with the single confirmed marketplace
  exception above. No registry row, no other pack's files, no core skill body.
- Create the marketplace file when it does not exist — a repository that is not marketplace-shaped
  gets the exact entry printed for the author instead, and nothing is written outside the pack.
- Register the emitted capability. Registration stays the standard flow: the author runs the emitted
  pack's own init skill, which self-registers through the resolver's `inspect_pack` /
  `register_pack` tools. Point at it; never edit the registry directly.
- Emit an init skill that probes `${CLAUDE_PLUGIN_ROOT}`, derives an install root by hand, or edits a
  `## Capabilities` or `## Plugin Roots` row itself — those writes belong to `register_pack`.
- Emit a file containing `TODO`, `FIXME`, `XXX`, or any fill-me-in marker.
- Emit a partitioned contribution kind without a declared, non-overlapping scope.
- Hand back an artifact carrying an open finding, or report a check as clean without running it.
- Write the current model id as an AI-attribution trailer, a "generated with" footer, an emoji, or a
  promotional tagline into any emitted file.
- Overwrite an existing plugin folder, manifest, or skill body without asking first.

---

## The procedure

This skill follows the plugin's shared scaffolder loop — interview → emit → self-lint →
fix-and-re-run → hand back only clean. **That loop is the single rule source and is not restated
here.** Obtain it through the resolver's `resolve_content` (`workspaceRoot`, `class: references-template`,
`plugin: wf-author-caps`, `skill: new-skill`, `ref: scaffolder-loop.md`) and follow it, supplying the
three pack-specific inputs below. Never reach it by a raw `Read` of the plugin-cache path.

### Input 1 — the interview questions and the rule each answer is bound to

Ask in order, validating each answer on arrival (loop Stage 1). The rule column is what a rejected
answer is explained against. Questions 4–6 are the capability's own answers; they are validated here
and then supplied to the emission rule set, which asks nothing itself.

| # | Question | The answer must satisfy |
|---|---|---|
| 1 | **Pack name** — the plugin's name | Lowercase letters, digits, and hyphens only. It is the folder under `plugins/`, the stable plugin id the emitted init registers under, and the namespace every emitted command is invoked through. It must not collide with a plugin already present under `plugins/`. |
| 2 | **Purpose** — what the pack supplies | Must yield a one-sentence plugin description naming the stack, domain, or integration knowledge the pack carries. A pack that would name nothing specific belongs in core instead — say so and re-ask. |
| 3 | **Manifest metadata** — author and repository | Each is a concrete value the author gives. Never invent an author name, an email, or a repository URL: when one is absent, ask, and when the author declines a field entirely, omit the key rather than emitting a placeholder for it. |
| 4 | **Capability name** — the one capability the pack ships | A filesystem-safe token: lowercase letters, digits, and hyphens only. It names the folder under the pack's `capabilities/` and the `Capability` column of the registry row the emitted init will write, so it must not collide with a capability already active in the workspace. |
| 5 | **Capability kind** — what the capability provides | Exactly one of `adapter` (fragments only, ships no skill), `feature` (ships its own skills, may also attach fragments), or `both`. A pack always ships its init skill, so a kind of `adapter` is explained against that fact and re-asked. |
| 6 | **Contributions** — the capability's phase, contribution kind, scope, and dispatch | Exactly the vocabularies and the partitioned-kind rule the emission rule set freezes. Validate every answer against that file's fixed sets before emission; a partitioned kind with a blank scope, or one an already-active capability claims, is explained and re-asked. A pack that declares no contribution yet is valid and emits a deliberately empty table. |
| 7 | **Marketplace registration** — whether to write the `plugins[]` entry | Asked only when `.claude-plugin/marketplace.json` exists at the workspace root. A `yes` permits exactly two edits to that file: the pack's entry and the top-level `version` bump. A `no`, or an absent file, means the entry is printed for the author and nothing outside the pack is written. |

Answer 1 fixes the emission root: `plugins/<pack-name>/`. Answers 4–6 fix the capability portion.

### Input 2 — the emission set

Emit four artifact groups, in this order.

**1. The plugin manifest** — `plugins/<pack-name>/.claude-plugin/plugin.json`, carrying `name` (answer
1), `version` (`0.1.0` — a first release, stated as the rule-derived default), `description` (answer
2), and the `author`, `repository`, `license`, and `keywords` keys the author supplied in answer 3.
The component folders `skills/` and `capabilities/` live at the plugin root, never inside
`.claude-plugin/`.

**2. The capability folder** — `plugins/<pack-name>/capabilities/<capability-name>/`, emitted by
**following the capability-emission rule set**, obtained through the resolver's `resolve_content`
(`class: references-template`, `plugin: wf-author-caps`, `skill: new-capability`, `ref:
capability-emission.md`), with answers 4–6 supplied as its already-validated inputs. That file is the
single rule source for the manifest shape, the Fragments-row rules, and the fragment-file rules —
follow it and restate none of it. Emitting a second manifest or fragment implementation here is a
defect, not a convenience.

**3. The init skill** — `plugins/<pack-name>/skills/init/SKILL.md`, following the core contract
`pack-onboarding.ops.md` spine: preconditions, discover self, register the capability, the
pack-specific step, the self-check, and a fenced final block as the very last thing emitted. Its
mechanics are the typed resolver tools, exactly as the toolkit's own init demonstrates:

- Confirm a git repository and the resolved registry location via `resolve_config({ workspaceRoot })`; when the registry
  file is absent, stop and direct the author to run core's own init first.
- Call `resolve_registry({ workspaceRoot })` for prior state — reporting only, never a skipped step.
- Call `inspect_pack({ pluginId: "<pack-name>", workspaceRoot })` with the **stable plugin id**. On `valid: false`,
  take the failure path and **do not** call `register_pack`, so nothing is written.
- Call `register_pack({ pluginId: "<pack-name>", expectedFingerprint: <the fingerprint inspect_pack
  returned>, workspaceRoot })`. It owns the `## Plugin Roots` row, the `## Capabilities` row, the snapshot refresh,
  and the self-check in one write.
- On any failure, call `resolve_gate({ surface: "delivery-write", workspaceRoot })` and report its categories,
  diagnostics, and recovery alongside the typed reason — never a bare error, and never a claim of
  success.

The emitted init never probes `${CLAUDE_PLUGIN_ROOT}`, never derives an install root, and never
hand-edits a registry row. Its frontmatter `allowed-tools` covers only what it uses, and its final
block is a fenced `<PACK-NAME-UPPERCASED>-INIT — <onboarded | already-registered | partial>` whose
last line is `Next:`.

**4. The marketplace registration** — per answer 7. On a confirmed `yes`, add the pack's `plugins[]`
entry (`name`, `source: ./plugins/<pack-name>`, `version`, `description`) and bump the file's
top-level `version` by one minor step, changing nothing else in it. Otherwise print the exact entry
the author must add, and state plainly that nothing outside the pack was written.

Use forward slashes in every path. Address any companion reference through the `resolve_content` form
above — a plain relative markdown link to one is classified as a raw-read instruction and fails the
repository's content-read guard.

### Input 3 — the check set the loop runs (Stage 3)

Run all of these, over the emitted set, on every pass. Map `pass` / `fail` / `error` exactly as the
loop's table says; `error` is never a pass.

- **The manifest validator** — the resolver's `validate_manifest({ path: <emitted manifest>, workspaceRoot })`, targeted at the emitted
  `manifest.md`. It checks the schema-v2 shape: the declared kind, that every row names a phase and
  contribution kind core actually defines, and that a partitioned row carries its scope.
- **The registry validator** — the resolver's `validate_registry({ workspaceRoot })` and
  checks the emitted manifest against the whole active registry: name uniqueness, declared paths
  resolving, `requires:` satisfied and `conflicts:` not both active, no contradictory `article:`
  clause, and no ownership scope overlapping an already-active capability's.
- **The interface-marker validator** — the resolver's `validate_skill_interface` with
  `{ plugin: <pack-name>, skill: "init", workspaceRoot }`. An init emitted with no declared slots and no markers is
  inert by construction and passes clean — the expected verdict, which must still be obtained by
  running the tool rather than assumed.
- **The reference-existence validator** — the resolver's `validate_references({ path: <emitted skill>, workspaceRoot })`, targeted at the
  emitted init skill. Rule id `REF-1`. This is the check that proves the emitted init's resolver-tool
  references resolve, so it is never skipped on a pack emission. Its classifier flags **narrated**
  invocations as well as directive ones, so an emitted body must never embed a live-looking
  invocation of a command that does not exist.
- **The vocabulary lint** — `glossary-lint.sh`, invoked with the emitted files as explicit arguments,
  since it has no whole-tree default:

  ```bash
  bash <wf-plugin-root>/skills/_contracts/glossary-lint.sh <emitted-files>
  ```

  Resolve `<wf-plugin-root>` through the resolver's `resolve_plugin_root({ plugin: "wf", workspaceRoot })`.

- **The plugin-manifest check** — `claude plugin validate` over the emitted pack. A type mismatch
  fails; an unrecognised key warns.
- **The composition preview** — the resolver's `preview_composition({ phase: <declared phase>, workspaceRoot })`, for each phase the emitted
  capability declares a row at. This is **not** a `ValidationVerdict`: it returns
  `{ tool, phase, entries, capabilitiesConsidered, phasesCovered, renderedFrom, summary }` and has no
  `status` field to map. It is **informational** — a freshly emitted, not-yet-registered capability
  legitimately yields zero entries, which is a first-class inert outcome and never a finding. Report
  what it rendered; never claim the emitted fragments composed until the pack is registered, and
  never treat a zero-entry preview as a failure to fix.

The lint scopes each rule by path shape, and an emitted path outside a check's scope invokes the
loop's scope-honesty rule — report it as *not applicable*, never as a clean verdict it did not reach.

## Edge Cases

- **The resolver is unavailable:** stop before the interview — the check set cannot be run, and an
  unlinted artifact is never emitted.
- **The pack folder already exists:** stop and ask before overwriting; authored work is never
  silently clobbered.
- **`.claude-plugin/marketplace.json` is absent:** the repository is not marketplace-shaped — print
  the exact entry for the author and write nothing outside the pack. This is a clean outcome, not a
  finding.
- **The author declines the marketplace edit:** identical to the absent case — print the entry, write
  nothing outside the pack, and say so in the final block.
- **A partitioned kind answered with no scope, or with one another capability owns:** the emission
  rule set's rule is explained and the contribution question re-asked; no file is written.
- **The author declares no contribution at all:** valid — the capability is emitted with a zero-row
  Fragments table and a sentence stating the emptiness is deliberate. Registry validation tolerates
  it, and the pack still registers.
- **`preview_composition` returns zero entries:** expected before registration — report it as inert,
  never as a finding, and never enter the fix loop over it.
- **A finding survives the loop's fix cap, or a check returns `error`:** stop and surface it per the
  loop's Stage 5 — the files stay on disk, reported plainly as not clean.
- **The author abandons the interview:** nothing was written; report that no file was emitted.

---

```
NEW-PACK — <Delivered | Stopped>

Pack:        plugins/<pack-name>  (capability: <capability-name>, kind: <adapter | feature | both>)
Emitted:     .claude-plugin/plugin.json · capabilities/<capability-name>/manifest.md + <n> fragment file(s) · skills/init/SKILL.md
Marketplace: <entry added + top-level version bumped | entry printed — not written>
Checks:      manifest <pass | not applicable> · registry <pass | not applicable> · interface-marker <pass | not applicable> · reference-existence <pass | not applicable> · vocabulary lint <pass | not applicable> · plugin validate <pass | not applicable>
Preview:     <n> entry(ies) across <n> phase(s) — informational
Fixes:       <n> finding(s) fixed across <n> pass(es)
Next:        run the emitted pack's own init skill to register the capability, then /wf-author-caps:new-provider if it should bind a provider surface
```

`Delivered` — every file is emitted and every applicable check returned a clean verdict on it.
`Stopped` — the interview yielded no valid answer, or a finding survived the fix cap; the reason and
any open finding are named above the block.

**The final-output block must always be the very last thing output to chat.**
