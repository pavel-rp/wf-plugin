---
name: new-capability
description: Scaffolds a new, conforming capability by interviewing the author for its name, kind, and each phase contribution, emitting a schema-v2 manifest plus every declared fragment file at exactly the path its row names, then self-linting the set against registry validation and the vocabulary lint and fixing its own findings before handing anything back. Use when the user wants to create, scaffold, or generate a new capability, a capability manifest, or its phase fragments, rather than an explanation of the schema.
allowed-tools: [Read, Write, Edit, Glob, Grep, Bash, AskUserQuestion, ToolSearch]
---

# /wf-author-caps:new-capability — interview in, clean capability out

Before any resolver MCP call, run `pwd -P` and use the returned absolute current Agent/session workspace directory as `workspaceRoot`. In a linked-worktree Agent, that cwd is the Agent's own worktree; never inherit a parent root. Pass it explicitly on every call. Omitting `workspaceRoot` is a hard schema error; resolver MCP calls have no default or fallback root.

Turns a set of validated answers into a real `capabilities/<name>/manifest.md` and every fragment file
its Fragments table declares, already passing the same gates the repository's own pull-request checks
apply. It emits **finished files, never a template** — no `TODO` survives to the author, and no
artifact is handed back with a validator finding still open.

For *why* the schema is what it is, use `/wf-author-caps:authoring-taxonomy`. This skill is the build
half: it applies it. For a skill rather than a capability, use `/wf-author-caps:new-skill`.

**Model:** claude-opus-4-8

---

## Prerequisites

The bundled `wf-resolver` MCP service must be loaded — it supplies the typed validators this skill
self-lints with, the reference bodies it emits from, and the plugin roots it resolves paths from.
Apart from `resolve_content`, every tool this skill reaches (`validate_manifest`, `validate_registry`,
`validate_skill_interface`, `resolve_plugin_root`, `inspect_pack`, `register_pack`) is **deferred**:
their schemas load on demand, so a "no such tool" on first reach means *not yet fetched*, not *not
installed*. Fetch them through the host's tool-search surface and retry once. Only if the retry still
fails, stop and report that the resolver runtime is not loaded (restart Claude Code); do not
hand-roll the checks.

## Command Syntax

```
/wf-author-caps:new-capability [<name>] [--plugin <plugin-name>] [--kind adapter|feature|both]
```

| Argument | Required | Description |
|---|---|---|
| `<name>` | NO | The capability's bare name. Validated on arrival like any interview answer; an invalid one is explained and re-asked, not repaired. |
| `--plugin <plugin-name>` | NO | The plugin the capability is emitted into. Defaults to the sole plugin under `plugins/` when exactly one exists; otherwise asked. |
| `--kind <kind>` | NO | Pre-answers the kind question. Validated against the three-kind set identically to a typed answer. |

### Zero-argument default

A bare invocation runs the full interview from question 1 — the intended path. Every argument above
is a shortcut that pre-answers one question; a pre-answered question is validated identically and
re-asked when it fails.

## Safety Rules (NON-NEGOTIABLE)

**Allowed:**

- Read any file in the workspace, and glob it to detect the target plugin and collisions.
- Write and edit files **only** under the resolved `plugins/<plugin-name>/capabilities/<name>/` folder.
- Run the resolver's `validate_manifest({ path: <emitted manifest>, workspaceRoot })` and `validate_registry({ workspaceRoot })` tools and the repository's
  `glossary-lint.sh`.

**Forbidden:**

- Write or edit anything outside the target capability folder — no registry row, no version manifest,
  no skill body, no other capability's manifest. This skill emits one capability folder and nothing
  else.
- Register the emitted capability. Registration stays the standard flow: the author runs the owning
  pack's `init` skill, which self-registers through the resolver's `inspect_pack` / `register_pack`
  tools. Point at it; never edit the registry directly.
- Emit a file containing `TODO`, `FIXME`, `XXX`, or any fill-me-in marker.
- Emit a partitioned contribution kind without a declared, non-overlapping scope.
- Hand back an artifact carrying an open finding, or report a check as clean without running it.
- Write the current model id as an AI-attribution trailer, a "generated with" footer, an emoji, or a
  promotional tagline into any emitted file.
- Overwrite an existing `manifest.md` or fragment file without asking first.

---

## The procedure

This skill follows the plugin's shared scaffolder loop — interview → emit → self-lint →
fix-and-re-run → hand back only clean. **That loop is the single rule source and is not restated
here.** Obtain it through the resolver's `resolve_content` (`workspaceRoot`, `class: references-template`,
`plugin: wf-author-caps`, `skill: new-skill`, `ref: scaffolder-loop.md`) and follow it, supplying the
three capability-specific inputs below. Never reach it by a raw `Read` of the plugin-cache path.

### Input 1 — the interview questions and the rule each answer is bound to

Ask in order, validating each answer on arrival (loop Stage 1). The rule column is what a rejected
answer is explained against. Questions 4–6 repeat as a group, once per contribution the author
declares; an author declaring none skips them and emits a deliberately empty table.

| # | Question | The answer must satisfy |
|---|---|---|
| 1 | **Name** — the capability's bare name | A filesystem-safe token: lowercase letters, digits, and hyphens only. It names the folder it will live in and the `Capability` column of the registry row that will later point at it, so it must not collide with a capability already present in the target plugin. |
| 2 | **Kind** — what the capability provides | Exactly one of `adapter` (fragments only, ships no skill), `feature` (ships its own skills, may also attach fragments), or `both`. No fourth value exists; a kind that does not cover what the author described in question 3 is explained and re-asked. |
| 3 | **Purpose** — what knowledge it supplies, and what it deliberately does not own | Must yield a prose paragraph naming the stack, domain, or project knowledge the capability carries. A capability that would name nothing specific belongs in core instead, not in a capability — say so and re-ask. |
| 4 | **Phase** — which injection point this contribution attaches to | One of the fixed spine: `spec`, `plan`, `tasks`, `implement`, `verify`, `qa-generation`, `qa-execution`, `pre-commit` — or `—` for a `slot`, which targets a skill point rather than a phase. A manifest may not invent a phase. |
| 5 | **Contribution kind** — what shape the contribution takes | One of the seven kinds, and valid **for the phase named in question 4**: `guidance` at `spec`/`implement`, `task-list` at `tasks`, `artifact` at `plan`, `finding` at `verify`/`pre-commit`, `scenario` at `qa-generation`, `provider` at `qa-execution`/`implement`/`spec`, `slot` at no phase. `article` is **not** a contribution kind — a constitution clause is the `article:` manifest key, so an answer naming it is explained and re-asked as a key, not a row. |
| 6 | **Scope** — the ownership token, asked only when question 5 named a partitioned kind | Required and non-overlapping. `provider` takes a `surface` token, `artifact` a `source→target` pair, `slot` a `<skill>.<point> <merge-policy>` compound. A blank scope, or one an already-active capability claims, cannot produce a valid manifest — state the rule, state why this answer violates it, and **re-ask**. Emit nothing until it is answered. |
| 7 | **Dispatch** — how the contribution is reached | `inline: <rel-path>` (a forward-slash path relative to the capability folder, whose file this skill then emits) or `subagent: <plugin>:<agent>` naming an agent the pack already ships. A bare agent name is not plugin-qualified and resolves only by accident of install order — explain and re-ask. |

Answers 1 and 2 fix the emission path: `plugins/<plugin-name>/capabilities/<name>/`. Resolve
`<plugin-name>` from `--plugin`, else from a sole `plugins/*` folder, else ask. Emission targets this
downstream plugin shape — never core's own tree.

### Input 2 — the emission template

The manifest shape, the Fragments-row rules, and the fragment-file rules are **one rule set**,
obtained through the resolver's `resolve_content` (`workspaceRoot`, `class: references-template`,
`plugin: wf-author-caps`, `skill: new-capability`, `ref: capability-emission.md`) and followed
against the validated answers. It is deliberately factored out of this body so a scaffolder emitting
a capability as part of a larger artifact set composes the same rules rather than restating them.

Emit, in one pass: the `manifest.md`, then one fragment file for every row whose dispatch is
`inline:`, each at exactly the path its row declares and each within the runtime-read ops budget. Use
forward slashes in every path, and address any companion reference through the `resolve_content` form
above — a plain relative markdown link to one is classified as a raw-read instruction and fails the
repository's content-read guard.

### Input 3 — the check set the loop runs (Stage 3)

Run all three, over the emitted set, on every pass:

- **The manifest validator** — the resolver's `validate_manifest({ path: <emitted manifest>, workspaceRoot })` tool, targeted at the emitted
  `manifest.md`. It checks the schema-v2 shape: the declared kind, that every row names a phase and
  contribution kind core actually defines, and that a partitioned row carries its scope.
- **The registry validator** — the resolver's `validate_registry({ workspaceRoot })` tool, which takes no other arguments and
  checks the emitted manifest in the context of the whole active registry: name uniqueness, declared
  paths resolving, `requires:` satisfied and `conflicts:` not both active, no contradictory `article:`
  clause, and — the check this scaffolder exists to make unnecessary to run by hand — **no ownership
  scope overlapping an already-active capability's**.
- **The vocabulary lint** — `glossary-lint.sh`, invoked with the emitted files as explicit arguments,
  since it has no whole-tree default:

  ```bash
  bash <wf-plugin-root>/skills/_contracts/glossary-lint.sh <emitted-files>
  ```

  Resolve `<wf-plugin-root>` through the resolver's `resolve_plugin_root({ plugin: "wf", workspaceRoot })`.

Map `pass` / `fail` / `error` exactly as the loop's table says; `error` is never a pass. The lint
scopes each rule by path shape, and a manifest or fragment under `plugins/*/capabilities/**` is in
its `capability` scope; when an emitted path falls outside a check's scope, the loop's scope-honesty
rule applies — report it as *not applicable*, never as clean.

`validate_skill_interface` is **not** in this set: it checks a skill body's slot markers against an
`interface.md`, and this skill emits no skill. Running it here would have no target.

## Edge Cases

- **The resolver is unavailable:** stop before the interview — the check set cannot be run, and an
  unlinted artifact is never emitted.
- **A partitioned kind answered with no scope, or with one another capability owns:** the violated
  rule is explained and question 6 re-asked; no manifest and no fragment file is written.
- **An answer naming `article` as a contribution kind:** explained as the `article:` manifest key
  rather than a row, and re-asked — a row naming it is a validator error.
- **The author declares no contribution at all:** valid — emit the manifest with a zero-row Fragments
  table and a sentence stating the emptiness is deliberate. Registry validation tolerates it.
- **The target capability folder already exists:** stop and ask before overwriting; authored work is
  never silently clobbered.
- **The target plugin cannot be resolved:** ask for it rather than guessing a path.
- **A finding survives the loop's fix cap, or a check returns `error`:** stop and surface it per the
  loop's Stage 5 — the files stay on disk, reported plainly as not clean.
- **The author abandons the interview:** nothing was written; report that no file was emitted.

---

```
NEW-CAPABILITY — <Delivered | Stopped>

Capability: <name>  (kind: <adapter | feature | both>)
Emitted:    plugins/<plugin-name>/capabilities/<name>/manifest.md + <n> fragment file(s)
Checks:     manifest <pass | not applicable> · registry <pass | not applicable> · vocabulary lint <pass | not applicable>
Fixes:      <n> finding(s) fixed across <n> pass(es)
Next:       register the capability by running the owning pack's init skill, then /wf-author-caps:authoring-taxonomy to review the contribution semantics
```

`Delivered` — every file is emitted and every applicable check returned a clean verdict on it.
`Stopped` — the interview yielded no valid answer, or a finding survived the fix cap; the reason and
any open finding are named above the block.

**The final-output block must always be the very last thing output to chat.**
