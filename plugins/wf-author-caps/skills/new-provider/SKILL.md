---
name: new-provider
description: Scaffolds a provider capability bound to one contract surface by interviewing the author for the target plugin, the capability name, and the surface (tracker, delivery, engine, or host), warning at interview time when a capability already owns that surface, then emitting a schema-v2 manifest whose provider row carries the surface scope plus a fragment speaking only the abstract contract operations, self-linting the set and fixing its own findings before handing anything back. Use when the user wants to create, scaffold, or generate a provider capability, a tracker or delivery binding, or a QA engine or host binding, rather than an explanation of the provider surfaces.
allowed-tools: [Read, Write, Edit, Glob, Grep, Bash, AskUserQuestion]
---

# /wf-author-caps:new-provider — interview in, surface-bound provider out

Turns a surface answer into a real `capabilities/<name>/` folder whose manifest declares a `provider`
contribution scoped to that surface, and whose fragment speaks **only the abstract contract
operations** — every endpoint, credential, and command string kept in a profile or config slot, so
binding a new tracker or delivery tool requires **no core change**. It emits **finished files, never
a template** — no `TODO` survives to the author, and no artifact is handed back with a validator
finding still open.

For a capability that binds no surface use `/wf-author-caps:new-capability`; for a whole pack around
this capability use `/wf-author-caps:new-pack`. For *why* the surfaces partition, use
`/wf-author-caps:authoring-taxonomy`.

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
self-lints with, the rule-set body it emits from, the active registry it checks the surface against,
and the plugin roots it resolves paths from. If it is unavailable, stop and report that the resolver
runtime is not loaded (restart Claude Code); do not hand-roll the checks.

## Command Syntax

```
/wf-author-caps:new-provider [<name>] [--plugin <plugin-name>] [--surface tracker|delivery|engine|host]
```

| Argument | Required | Description |
|---|---|---|
| `<name>` | NO | The capability's bare name. Validated on arrival like any interview answer; an invalid one is explained and re-asked, not repaired. |
| `--plugin <plugin-name>` | NO | The plugin the capability is emitted into. Defaults to the sole plugin under `plugins/` when exactly one exists; otherwise asked. |
| `--surface <surface>` | NO | Pre-answers the surface question. Validated against the four-surface set — and checked for a collision — identically to a typed answer. |

### Zero-argument default

A bare invocation runs the full interview from question 1 — the intended path. Every argument above
is a shortcut that pre-answers one question; a pre-answered question is validated identically and
re-asked when it fails.

## Safety Rules (NON-NEGOTIABLE)

**Allowed:**

- Read any file in the workspace, and glob it to detect the target plugin and collisions.
- Read the active registry through the resolver's `resolve_registry` to detect a surface collision.
- Write and edit files **only** under the resolved `plugins/<plugin-name>/capabilities/<name>/` folder.
- Run the resolver's `validate_manifest`, `validate_registry`, and `preview_composition` tools and the
  repository's `glossary-lint.sh`.

**Forbidden:**

- Write or edit anything outside the target capability folder — no registry row, no version manifest,
  no skill body, no other capability's manifest. This skill emits one capability folder and nothing
  else.
- Register the emitted capability. Registration stays the standard flow: the author runs the owning
  pack's init skill, which self-registers through the resolver's `inspect_pack` / `register_pack`
  tools. Point at it; never edit the registry directly.
- Emit a `provider` row with a blank surface scope, or silently emit one whose surface an active
  capability already owns — the collision is stated at interview time, never discovered later.
- Write a concrete endpoint, host name, credential, organization, project, work-item id, or command
  string into fragment prose. Every such value is a profile or config slot.
- Emit a file containing `TODO`, `FIXME`, `XXX`, or any fill-me-in marker.
- Hand back an artifact carrying an open finding, or report a check as clean without running it.
- Write the current model id as an AI-attribution trailer, a "generated with" footer, an emoji, or a
  promotional tagline into any emitted file.
- Overwrite an existing `manifest.md` or fragment file without asking first.

---

## The procedure

This skill follows the plugin's shared scaffolder loop — interview → emit → self-lint →
fix-and-re-run → hand back only clean. **That loop is the single rule source and is not restated
here.** Obtain it through the resolver's `resolve_content` (`class: references-template`,
`plugin: wf-author-caps`, `skill: new-skill`, `ref: scaffolder-loop.md`) and follow it, supplying the
three provider-specific inputs below. Never reach it by a raw `Read` of the plugin-cache path.

### Input 1 — the interview questions and the rule each answer is bound to

Ask in order, validating each answer on arrival (loop Stage 1). The rule column is what a rejected
answer is explained against.

| # | Question | The answer must satisfy |
|---|---|---|
| 1 | **Name** — the capability's bare name | A filesystem-safe token: lowercase letters, digits, and hyphens only. It names the folder it will live in and the `Capability` column of the registry row that will later point at it, so it must not collide with a capability already present in the target plugin. |
| 2 | **Purpose** — what tool or environment this binds, and what it deliberately does not own | Must yield a prose paragraph naming the integration the capability carries. A provider capability that would name nothing specific belongs in core instead — say so and re-ask. |
| 3 | **Surface** — the contract surface this capability owns | Exactly one of `tracker`, `delivery`, `engine`, or `host`. No fifth value exists: a surface core does not define cannot produce a valid manifest, and inventing one is explained and re-asked. The surface fixes the registration anchor — `tracker` anchors at `spec`, `delivery` at `implement`, and `engine` and `host` at `qa-execution` — and becomes the row's `scope` token verbatim. |
| 4 | **Collision confirmation** — asked only when an active capability already owns the answered surface | A surface partitions: one owner per token, checked across the whole registry independent of the claiming row's phase. When `resolve_registry` shows an incumbent, **state the collision, name the incumbent capability, and require an explicit confirmation** before emitting. Replacing an incumbent is a legitimate intent the author may hold, but it is never assumed — and an unconfirmed collision emits nothing. |
| 5 | **Binding slots** — the project values the fragment must not name | Every concrete endpoint, organization, project, credential reference, path, and command string the binding needs, listed by slot name. Each becomes a `profile.template.json` key, never fragment prose. An answer that would put such a value in the fragment is explained against that rule and re-asked. |
| 6 | **Dispatch** — how the contribution is reached | `inline: fragments/<surface>.ops.md` is the default, and the file this skill then emits. `subagent: <plugin>:<agent>` is valid only when the author names an agent the pack already ships; a bare agent name is not plugin-qualified and resolves only by accident of install order — explain and re-ask. |

Answers 1 and 3 fix the emission path and the row's scope:
`plugins/<plugin-name>/capabilities/<name>/`, with `scope` = the answered surface. Resolve
`<plugin-name>` from `--plugin`, else from a sole `plugins/*` folder, else ask. Emission targets this
downstream plugin shape — never core's own tree.

**The collision path in full.** After answer 3, call `resolve_registry` and look for an active
capability whose manifest declares a `provider` row scoped to the same surface token. When one
exists, say so before anything is written: name the surface, name the incumbent, and state that
partition permits exactly one owner, so registering both will fail validation naming both offenders.
Then ask question 4. On a decline, no file is written and the run stops cleanly with the collision as
its stated reason. On a confirmation, emission proceeds — and the loop's Stage 3 `validate_registry`
will return `fail` on the overlap, naming both capabilities. That finding cannot be fixed without
guessing which capability the author means to own the surface, so the loop's Stage 5 applies: stop
honestly, leave the artifacts on disk, and report plainly that the set is not clean.

### Input 2 — the emission template

The manifest shape, the Fragments-row rules, and the fragment-file rules are **one rule set**,
obtained through the resolver's `resolve_content` (`class: references-template`,
`plugin: wf-author-caps`, `skill: new-capability`, `ref: capability-emission.md`) and followed
against the validated answers. Follow it and restate none of it; emitting a second manifest or
fragment implementation here is a defect, not a convenience. Supply it: the capability name (answer
1), the kind (`adapter` when the pack ships no skill for this binding, `feature` or `both` when it
does), and exactly one Fragments row — contribution kind `provider`, the phase its surface anchors
at, the dispatch from answer 6, and the surface from answer 3 as its scope.

Two additions this skill contributes on top of that rule set:

**1. The fragment's content rule.** The fragment names **only abstract contract operations** — the
names core already speaks — one section each, giving that operation's inputs, its guards, and how its
outcomes map. No product string appears anywhere in it.

- A `tracker` fragment covers the tracker operations: `get`, `create_umbrella`, `create_child`,
  `update`, `list_children`, `post_comment`, `set_status`, `attach_link`, and the read-only queries
  `list_by_status`, `list_milestones`, `list_cycles`, and `list_blockers`.
- A `delivery` fragment covers the delivery write operations — `branch-create`, `branch-switch`,
  `commit`, `push-upstream`, `pr-create`, `pr-detect`, `pr-comment-post`, `review-thread-resolve`,
  `review-thread-reply`, and `pr-merge` — and the read operations `workspace-root-resolve`,
  `current-branch-query`, `default-base-query`, `last-commit-timestamp-query`, `branch-changes-read`,
  `pr-comments-read`, `review-threads-read`, `checks-read`, and `activity-read`.
- An `engine` or `host` fragment declares the **dispatch contract** instead, because core freezes no
  operation list for those surfaces: what the orchestrator hands the surface, and the verdict shape
  that comes back. Invent no operation vocabulary for them.

Cover every operation the surface defines; a binding that genuinely cannot implement one says so in
that operation's section, with the outcome a caller gets instead. Silence about an operation is not
the same as declaring it unsupported.

**2. The profile template.** When answer 5 named any slot, emit `profile.template.json` in the
capability folder — the authoritative default shape a project overrides — and declare it with the
`profile-template:` manifest key. Its keys are the slot names; its values are the baseline defaults,
which may be angle-bracketed placeholder slots in the template itself. That template is the one place
an angle-bracketed slot is legitimate: it is the declared shape a project fills, never a fill-me-in
marker left in prose. When answer 5 named no slot, emit no template and declare no key.

Each emitted fragment is runtime-read, so it carries the ops budget the rule set states. Use forward
slashes in every path, and address any companion reference through the `resolve_content` form above —
a plain relative markdown link to one is classified as a raw-read instruction and fails the
repository's content-read guard.

### Input 3 — the check set the loop runs (Stage 3)

Run all of these, over the emitted set, on every pass. Map `pass` / `fail` / `error` exactly as the
loop's table says; `error` is never a pass.

- **The manifest validator** — the resolver's `validate_manifest`, targeted at the emitted
  `manifest.md`. It checks the schema-v2 shape, and that the `provider` row carries its scope.
- **The registry validator** — the resolver's `validate_registry`, which takes no arguments and
  checks the emitted manifest against the whole active registry. **This is the check that proves the
  partition holds**: an overlapping surface returns `fail` naming both offenders. On a confirmed
  collision that finding is expected, unfixable without guessing intent, and routes to Stage 5.
- **The vocabulary lint** — `glossary-lint.sh`, invoked with the emitted files as explicit arguments,
  since it has no whole-tree default:

  ```bash
  bash <wf-plugin-root>/skills/_contracts/glossary-lint.sh <emitted-files>
  ```

  Resolve `<wf-plugin-root>` through the resolver's `resolve_plugin_root` for the `wf` plugin.

- **The composition preview** — the resolver's `preview_composition` for the phase the surface
  anchors at. This is **not** a `ValidationVerdict`: it returns
  `{ tool, phase, entries, capabilitiesConsidered, phasesCovered, renderedFrom, summary }` and has no
  `status` field to map. It is **informational** — a freshly emitted, not-yet-registered capability
  legitimately yields zero entries, which is a first-class inert outcome and never a finding. Report
  what it rendered; never claim the fragment composed until the capability is registered.

`validate_skill_interface` and `validate_references` are **not** in this set: this skill emits no
skill body and no agent, so neither has a target here. Report them as not applicable rather than as
clean. The lint scopes each rule by path shape, and a manifest or fragment under
`plugins/*/capabilities/**` is in its `capability` scope; an emitted path outside a check's scope
invokes the loop's scope-honesty rule — report it as *not applicable*, never as a clean verdict it
did not reach.

## Edge Cases

- **The resolver is unavailable:** stop before the interview — the check set cannot be run, the
  collision check cannot be made, and an unlinted artifact is never emitted.
- **A surface answer outside the four-token set:** explained against the fixed set and re-asked; no
  file is written.
- **A surface an active capability already owns, and the author declines:** nothing is written; the
  run stops cleanly with the collision and the incumbent named.
- **A surface an active capability already owns, and the author confirms:** emission proceeds, and
  `validate_registry` returns `fail` naming both offenders. Stage 5 applies — artifacts stay on disk,
  reported plainly as not clean, with the author left to retire one of the two.
- **The target capability folder already exists:** stop and ask before overwriting; authored work is
  never silently clobbered.
- **The target plugin cannot be resolved:** ask for it rather than guessing a path.
- **The author names no binding slot:** valid — emit no `profile.template.json` and declare no
  `profile-template:` key. A binding whose values are all environment-supplied is legitimate.
- **`preview_composition` returns zero entries:** expected before registration — report it as inert,
  never as a finding, and never enter the fix loop over it.
- **A finding survives the loop's fix cap, or a check returns `error`:** stop and surface it per the
  loop's Stage 5 — the files stay on disk, reported plainly as not clean.
- **The author abandons the interview:** nothing was written; report that no file was emitted.

---

```
NEW-PROVIDER — <Delivered | Stopped>

Capability: <name>  (surface: <tracker | delivery | engine | host>, anchored at <phase>)
Emitted:    plugins/<plugin-name>/capabilities/<name>/manifest.md + fragments/<surface>.ops.md<, + profile.template.json>
Collision:  <none — surface unowned | <incumbent> already owns <surface> — confirmed by author>
Checks:     manifest <pass | fail | not applicable> · registry <pass | fail | not applicable> · vocabulary lint <pass | not applicable> · interface-marker not applicable · reference-existence not applicable
Preview:    <n> entry(ies) at <phase> — informational
Fixes:      <n> finding(s) fixed across <n> pass(es)
Next:       register the capability by running the owning pack's init skill, then fill its profile slots in the project's own profile override
```

`Delivered` — every file is emitted and every applicable check returned a clean verdict on it.
`Stopped` — the interview yielded no valid answer, the author declined a collision, or a finding
survived the fix cap; the reason and any open finding are named above the block.

**The final-output block must always be the very last thing output to chat.**
