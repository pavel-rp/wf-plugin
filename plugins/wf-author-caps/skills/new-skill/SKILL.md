---
name: new-skill
description: Scaffolds a new, conforming SKILL.md by interviewing the author for the skill's name, purpose, invocation shape, and zero-argument default, emitting the real file against the live authoring contracts, then self-linting it and fixing its own findings before handing anything back. Use when the user wants to create, scaffold, generate, or start a new skill for a wf plugin, or asks for a conforming SKILL.md rather than an explanation of the conventions.
allowed-tools: [Read, Write, Edit, Glob, Grep, Bash, AskUserQuestion, ToolSearch]
---

# /wf-author-caps:new-skill — interview in, clean SKILL.md out

Before any resolver MCP call, run `pwd -P` and use the returned absolute current Agent/session workspace directory as `workspaceRoot`. In a linked-worktree Agent, that cwd is the Agent's own worktree; never inherit a parent root. Pass it explicitly on every call. Omitting `workspaceRoot` is a hard schema error; resolver MCP calls have no default or fallback root.

Turns four answers into a real `skills/<name>/SKILL.md` that already passes the same gates the
repository's own pull-request checks apply. It emits **finished files, never a template** — no `TODO`
survives to the author, and no artifact is handed back with a validator finding still open.

For *why* the conventions are what they are, use `/wf-author-caps:authoring-guide`. This skill is the
build half: it applies them.

**Model:** claude-opus-4-8

---

## Prerequisites

The bundled `wf-resolver` MCP service must be loaded — it supplies the typed validator this skill
self-lints with and the plugin roots it resolves paths from. Those tools (`validate_skill_interface`,
`resolve_plugin_root`) are **deferred**: their schemas load on demand, so a "no such tool" on first
reach means *not yet fetched*, not *not installed*. Fetch them through the host's tool-search surface
and retry once. Only if the retry still fails, stop and report that the resolver runtime is not
loaded (restart Claude Code); do not hand-roll the checks.

## Command Syntax

```
/wf-author-caps:new-skill [<name>] [--plugin <plugin-name>]
```

| Argument | Required | Description |
|---|---|---|
| `<name>` | NO | The bare skill slug. Validated on arrival like any interview answer; an invalid one is explained and re-asked, not repaired. |
| `--plugin <plugin-name>` | NO | The plugin the skill is emitted into. Defaults to the sole plugin under `plugins/` when exactly one exists; otherwise asked. |

### Zero-argument default

A bare invocation runs the full interview from question 1 — the intended path. Every argument above
is a shortcut that pre-answers one question; a pre-answered question is validated identically and
re-asked when it fails.

## Safety Rules (NON-NEGOTIABLE)

**Allowed:**

- Read any file in the workspace, and glob it to detect the target plugin and collisions.
- Write and edit files **only** under the resolved `plugins/<plugin-name>/skills/<name>/` folder.
- Run the resolver's `validate_skill_interface({ plugin: <plugin-name>, skill: <name>, workspaceRoot })` tool and the repository's `glossary-lint.sh`.
- Resolve the declared `new-skill.constraints` slot via `resolve_content({ workspaceRoot, ... })`
  (`class: slot`, `skill: new-skill`, `point: constraints`) — **one call per marker** — and, only on
  a `composed` outcome, follow the served body as prose in this skill's own context, which
  authorizes **exactly** the constraints that body names.

**Forbidden:**

- Write or edit anything outside the target skill folder — no manifest, no registry row, no version
  manifest, no existing skill body. This skill emits one skill folder and nothing else.
- Emit a file containing `TODO`, `FIXME`, `XXX`, or any fill-me-in marker.
- Hand back an artifact carrying an open finding, or report a check as clean without running it.
- Write the current model id as an AI-attribution trailer, a "generated with" footer, an emoji, or a
  promotional tagline into any emitted file.
- Overwrite an existing `SKILL.md` without asking first.
- Improvise a constraint, a check, or any other operation at the `new-skill.constraints` marker when
  its slot is unfilled, unresolved, or refused — the inline-default region is executed **exactly**.

---

## The procedure

This skill follows the plugin's shared scaffolder loop — interview → emit → self-lint →
fix-and-re-run → hand back only clean. **That loop is the single rule source and is not restated
here.** Obtain it through the resolver's `resolve_content` (`workspaceRoot`, `class: references-template`,
`plugin: wf-author-caps`, `skill: new-skill`, `ref: scaffolder-loop.md`) and follow it, supplying the
two skill-specific inputs below. Never reach it by a raw `Read` of the plugin-cache path.

### Input 1 — the four interview questions and the rule each answer is bound to

Ask in order, validating each answer on arrival (loop Stage 1). The rule column is what a rejected
answer is explained against.

| # | Question | The answer must satisfy |
|---|---|---|
| 1 | **Name** — the bare slug for the skill | Lowercase letters, digits, and hyphens only; 64 characters or fewer; **bare** — carrying no plugin prefix, because the namespace already comes from the plugin name and re-prefixing yields a doubled command. It must equal the folder it will live in, and must not collide with an existing skill folder in the target plugin. When two or more skills share a concern, the slug takes the `family-variant` shape. |
| 2 | **Purpose** — what it does, and the condition that should trigger it | Must yield a third-person description of 1024 characters or fewer stating **what** the skill does **and when** to use it, with the trigger stated early, containing no angle brackets (they break frontmatter parsing). It is the only content preloaded for auto-selection, so it must stand alone. |
| 3 | **Invocation shape** — its arguments, and what it is allowed to touch | Every argument is named with its required/optional status and meaning. What it touches determines `allowed-tools`: list only the built-in tools the body actually needs — a read-only skill declares no `Write` or `Edit` — and name no MCP tool, since those names are brittle across configurations. |
| 4 | **Zero-argument default** — what a bare invocation does | Must name a concrete useful behavior. "Nothing", "prints usage", or "errors" is not a valid answer: a bare invocation must do something useful. Re-ask until a real default is given. |

Answer 1 also fixes the emission path: `plugins/<plugin-name>/skills/<name>/SKILL.md`. Resolve
`<plugin-name>` from `--plugin`, else from a sole `plugins/*` folder, else ask. Emission targets this
downstream plugin shape — never core's own tree.

### Input 2 — the emission template

Emit exactly one file at that path, with these parts in this order and no others left empty:

1. **Frontmatter** — `name` (answer 1, matching the folder), `description` (answer 2, third person),
   `allowed-tools` (answer 3, tailored). No other field: an unrecognised one passes through
   literally.
2. **H1** — `# /<plugin-name>:<name> — <short tagline>`, with an em-dash.
3. **A one-paragraph intro** stating what the skill does, then a `**Model:** <current model id>`
   attribution line.
4. **Command Syntax** — a fenced invocation line and an argument table from answer 3, followed by a
   **Zero-argument default** paragraph from answer 4.
5. **Safety Rules** — explicit Allowed and Forbidden lists in prose, derived from answer 3. Writing
   outside the paths answer 3 named is forbidden by default.
6. **The body** — numbered, self-contained phases for a phase-shaped skill, or one `###` block per
   subcommand (including the empty-input default) for a dispatch-shaped one. Keep it under about 500
   lines; when it would exceed that, split the overflow into `references/<topic>.md` exactly one
   level deep and address it through the `resolve_content` references form.
7. **`## Edge Cases`** — that exact heading, listing the real stop conditions for this skill.
8. **The final-output block** — a fenced `NAME — status` block, the very last thing the skill emits,
   whose last line is `Next: <command>` or `Next: none — terminus`.

Use forward slashes in every path. Address any reference file through the `resolve_content` form
above — a plain relative markdown link to one is classified as a raw-read instruction and fails the
repository's content-read guard.

#### Additional constraints on the emitted skill

This is the declared `new-skill.constraints` composition point — reached once the emission template
above has stated the scaffolder's own rules and **before** the check set below runs, so anything
attached here shapes the file while it is still being emitted rather than being reported on it after
the fact. Resolve it lazily with **one** call: `resolve_content({ workspaceRoot, ... })` with
`class: slot`, `skill: new-skill`, `point: constraints`. Act on the typed outcome — never improvise
a constraint at this marker:

- **`{status: unfilled}`** (no slot contribution registered and no personal
  `_local/slots/new-skill.constraints.md` override) → execute **exactly** the inline-default region
  below, then continue to Input 3.
- **`{status: composed, content, policy, …}`** → one or more fills are registered. This point's
  policy is **`append`**, so the inline default below applies **first** and the resolver has already
  concatenated every contribution in registry order with any personal override last; **follow the
  served `content` as prose** in this skill's own context, in the order served, then continue to
  Input 3. Do not re-order it, select among the parts, or drop any — composition is the resolver's
  job, and the whole served body applies here.
- **`{status: unresolved}`** (registry-invalid / ref-not-found) or **`{status: refused}`** → do not
  improvise: run the inline-default region below (continue to Input 3) and state the resolver's
  reason. Follow the content surface's degradation discipline — never a wrong-path body, never a
  raw-read fall-through.

<!-- wf:slot new-skill.constraints -->
No additional constraint applies. The emission template above is the whole rule set the emitted file
is held to, and no operation of any kind is emitted at this point. Continue to Input 3.
<!-- wf:slot-end new-skill.constraints -->

### Input 3 — the check set the loop runs (Stage 3)

Run both, over the emitted file, on every pass:

- **The interface-marker validator** — the resolver's `validate_skill_interface` tool with
  `{ plugin: <plugin-name>, skill: <name>, workspaceRoot }`. It checks body slot markers against the skill's
  `interface.md` `## Slots` declarations under defect ids `D1`–`D5`. A skill emitted with no declared
  slots and no markers is **inert by construction** and passes clean — that is the expected verdict
  here, and it still must be obtained by running the tool, never assumed. Map `pass`/`fail`/`error`
  exactly as the loop's table says; `error` is not a pass.
- **The vocabulary lint** — `glossary-lint.sh`, invoked with the emitted file as an explicit
  argument, since it has no whole-tree default:

  ```bash
  bash <core-authoring-root>/capabilities/core-authoring/fixtures/glossary-lint.sh <emitted-file>
  ```

  Resolve `<core-authoring-root>` through the resolver's
  `resolve_plugin_root({ plugin: "wf-core-authoring", workspaceRoot })`. That pack is
  **maintainer-only and optional**: when it is not installed the root does not resolve, and this
  check is then **not applicable** — report it that way and continue, never as clean and never as an
  error. The vocabulary itself still lives in core at
  `plugins/wf/skills/_contracts/GLOSSARY.md`; only the lint that enforces it ships with the
  maintainer pack. The lint also scopes each rule by path shape; a file emitted outside
  `plugins/*/skills/**/SKILL.md` is out of its `skill-body` scope, and the loop's scope-honesty rule
  then applies — report it as *not applicable*, never as clean.

The registry and manifest validators are **not** in this set: this skill emits a lone skill file and
no registry artifact, so they have no target here.

## Edge Cases

- **The resolver is unavailable:** stop before the interview — the check set cannot be run, and an
  unlinted artifact is never emitted.
- **A slug violating the naming rules:** explained against the rule and re-asked; no file is written.
- **The target skill folder already exists:** stop and ask before overwriting; authored work is never
  silently clobbered.
- **The target plugin cannot be resolved:** ask for it rather than guessing a path.
- **A finding survives the loop's fix cap, or a check returns `error`:** stop and surface it per the
  loop's Stage 5 — the file stays on disk, reported plainly as not clean.
- **The author abandons the interview:** nothing was written; report that no file was emitted.

---

```
NEW-SKILL — <Delivered | Stopped>

Skill:    /<plugin-name>:<name>
Emitted:  plugins/<plugin-name>/skills/<name>/SKILL.md
Checks:   interface-marker <pass | not applicable> · vocabulary lint <pass | not applicable>
Fixes:    <n> finding(s) fixed across <n> pass(es)
Next:     /wf-author-caps:authoring-guide to review where this skill belongs, then register the plugin's capability with its init skill
```

`Delivered` — the file is emitted and every applicable check returned a clean verdict on it.
`Stopped` — the interview yielded no valid answer, or a finding survived the fix cap; the reason and
any open finding are named above the block.

**The final-output block must always be the very last thing output to chat.**
