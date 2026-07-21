---
name: authoring-guide
description: Explains how to author a wf capability, skill, or marketplace plugin — how to structure a plugin, where a skill body versus a subagent belongs, how a skill declares a composition point, how knowledge attaches to the SDD phase spine, and how a plugin self-registers. Use whenever the user asks how to write, structure, scaffold, extend, or register a wf capability, skill, subagent, fragment, or plugin, asks where some piece of authoring knowledge belongs, or asks why their capability or fragment is not firing.
allowed-tools: [Read, Glob, Grep, Bash]
---

# /wf-author-caps:authoring-guide — how to author for the wf marketplace

Before any resolver MCP call, run `pwd -P` and use the returned absolute current Agent/session workspace directory as `workspaceRoot`. In a linked-worktree Agent, that cwd is the Agent's own worktree; never inherit a parent root. Pass it explicitly on every call. Omitting `workspaceRoot` is a hard schema error; resolver MCP calls have no default or fallback root.

The design half of the authoring toolkit: what to build, where it belongs, and how it reaches a
user. For the exact schemas and token vocabularies — the contribution taxonomy, manifest schema v2,
phase and kind semantics — use `/wf-author-caps:authoring-taxonomy`.

**Model:** claude-opus-4-8

## Contents

- [The sorting rule](#the-sorting-rule-core-versus-capability)
- [Plugin anatomy](#plugin-anatomy)
- [Interface-first skill design](#interface-first-skill-design)
- [Skill or subagent](#skill-or-subagent)
- [How knowledge attaches](#how-knowledge-attaches)
- [The registration flow](#the-registration-flow)
- [Canonical vocabulary](#canonical-vocabulary)
- [Edge Cases](#edge-cases)

---

## The sorting rule: core versus capability

**Core ships zero stack, domain, or project knowledge.** Everything specific enters through a
capability. Before writing anything, sort it:

| What it is | Where it goes |
|---|---|
| Invariant behavior, generic | a core skill |
| Invariant behavior, stack- or domain-specific | a capability fragment or a capability's own skill |
| Static project data (paths, type maps, invariants) | the downstream `_local/` profile, shaped by a contract |
| Live project data (work items, schemas, source) | an MCP or tool adapter |

The litmus test for core: *would this still make sense for a completely different stack, domain, and
project?* If it names a concrete framework, product, or repository, it belongs in a capability.

## Plugin anatomy

A marketplace plugin is a directory under `plugins/`, with component folders at the **plugin root**
— never inside `.claude-plugin/`, which holds only the manifest:

```
plugins/<plugin-name>/
├── .claude-plugin/plugin.json      # name, version, description, author, repository, license
├── README.md                       # user-facing catalogue of what it ships
├── skills/<slug>/SKILL.md          # one folder per skill, auto-discovered
│   └── references/<topic>.md       # progressive disclosure, exactly one level deep
├── agents/<name>.md                # subagent companions, auto-discovered
└── capabilities/<name>/
    ├── manifest.md                 # kind + fragments table
    └── fragments/<topic>.md        # the prose each fragment row points at
```

It also needs a `plugins[]` entry in the marketplace manifest whose `version` matches its own
`plugin.json`. Every change ships a version bump: the touched plugin's two fields plus the
marketplace top-level.

## Interface-first skill design

Design the **invocation surface** before the body. That surface is what downstream consumers grep
and what a version bump is measured against: the slash-command name, the arguments, and the shape of
the final-output block.

1. **Name it.** The frontmatter `name` is **bare** and matches the folder exactly — the namespace
   comes from the plugin name, so re-prefixing yields a doubled command. Two or more skills sharing a
   concern group as `<family>-<variant>`.
2. **Write the description before the body.** It is the only content preloaded for auto-selection,
   so it must stand alone: third person, stating **what** it does and **when** to use it, trigger
   early. This is the one mechanism that loads a skill on the model's own initiative — a plain
   document has no auto-trigger at all.
3. **Declare the tools.** `allowed-tools` lists the built-in tools the body needs, tailored to its
   Safety Rules. Omit MCP tool names — they are brittle across configurations.
4. **Fix the final-output block.** Every skill ends with a fenced `NAME — status` block as the very
   last thing emitted, ending in a `Next:` line naming the command to run (or `Next: none —
   terminus`). Changing that shape is breaking.
5. **Then write the body.** Keep it under ~500 lines; when it grows, split into `references/` one
   level deep and link explicitly. Give any reference file over ~100 lines a table of contents.
   Define the zero-argument default — a bare invocation must do something useful — and give the
   stop-conditions section the exact heading `## Edge Cases`.

Any doc the skill opens **at runtime** is bounded harder: ≤150 lines, only behavior-bearing steps,
guards, and outcome mappings. Test each clause by removing it — if that leaves a plausible-but-wrong
next action, it is behavior-bearing. Rationale and history move to a paired reference file.

## Skill or subagent

Ship a subagent companion when the work is verbose reasoning yielding a small structured result,
when it would otherwise pollute the caller's context, or when several skills need the same unit.
Skip it when the skill is action-oriented, used in one place, and already emits one short line.

Two rules govern them: **omit the `tools:` field** unless you mean to restrict, since it overrides
the inherited toolset and silently starves the subagent of MCP access; and **never filesystem-read a
sibling skill body — invoke the skill.** The four delegation patterns and both rules in full live at
`subagents-and-vocabulary.md`, obtained via the resolver's `resolve_content` (`workspaceRoot`, `class:
references-template`, `plugin: wf-author-caps`, `skill: authoring-guide`, `ref:
subagents-and-vocabulary.md`) — never a raw `Read` of the plugin-cache path.

## How knowledge attaches

Two composition mechanisms, deliberately kept separate:

- **Skills compose natively.** Install the plugin and its skills are discoverable — no registry row, no custom machinery, nothing to configure.
- **Phase contributions compose through the registry**, at runtime. A capability declares fragments in its manifest; core re-reads the registry every run and injects the prose inline. No codegen, no compile step — edit a fragment once and every project picks it up next run.

Core iterates whatever is registered and never names a capability or assumes how many exist. An
empty registry means a fully generic core — every phase runs as if inert. That inert-by-default
property is the contract a new capability must not break.

## The registration flow

Registration is one command. The plugin ships an `init` skill calling the resolver's typed
`inspect_pack` and `register_pack` tools with its **stable plugin id**; core resolves the install
path, validates the manifest, computes a fingerprint, and owns the registry write end-to-end —
including a self-check that the capability resolves afterward.

What an `init` skill must **not** do: probe the plugin-root environment variable, derive an install
root itself, or hand-edit the registry — those are core's job through the typed tools. Inspect
first and skip the write entirely when inspection reports invalid, so a broken install never
produces a partial registration.

## Canonical vocabulary

Authored prose is linted against a canonical vocabulary, and the lint fails a pull request on any
file that change touches — always on a file it adds. Author to it from the start rather than fixing
violations at the end. The entries that bite most often, and the on-touch severity model, ship in
the same reference doc named above (`ref: subagents-and-vocabulary.md`).

## Edge Cases

- **A fragment is not firing:** the capability is almost certainly unregistered — skills compose
  natively, contributions do not. Run the plugin's `init` skill.
- **The command comes out doubled:** the frontmatter `name` carries a namespace prefix. Make it bare.
- **The skill never auto-loads:** its description states the trigger too late, or model invocation is disabled.
- **The body outgrew the budget:** split into `references/` one level deep — never a chain, since a partial read misses anything nested deeper.
- **Unsure whether it is core or capability:** apply the litmus test; when it still fits both, it belongs in the capability.

```
AUTHORING-GUIDE — Delivered

Covered: core-versus-capability sorting · plugin anatomy · interface-first skill design · skill-versus-subagent · native and registry composition · the registration flow · canonical vocabulary

Next: /wf-author-caps:authoring-taxonomy for the contribution taxonomy, manifest schema v2, and phase and kind semantics
```
