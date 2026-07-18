# wf-author-caps — the authoring toolkit

Teaches how to author capabilities, skills, and plugins for the `wf` marketplace — and scaffolds
them. Ships the `author-caps` capability and four skills across two families: the `authoring-*`
reference pair, and the `new-*` scaffolders that emit real, already-linted files.

**Model:** claude-opus-4-8

## Skills

| Command | What it does |
|---|---|
| `/wf-author-caps:authoring-guide` | The design half: core-versus-capability sorting, plugin anatomy, interface-first skill design, skill-versus-subagent, native and registry composition, the registration flow, and the canonical vocabulary. |
| `/wf-author-caps:authoring-taxonomy` | The schema half: the SDD phase spine, the seven contribution kinds, aggregate-versus-partition policy, manifest schema v2, the registry row, constitution composition, and registry validation. |
| `/wf-author-caps:new-skill` | The build half: interviews for a skill's name, purpose, invocation shape, and zero-argument default, emits a conforming `SKILL.md`, then self-lints it and fixes its own findings before handing it back. Never a template with placeholders. |
| `/wf-author-caps:init` | One-command self-registration of the `author-caps` capability into the wf capability registry. |

Both reference skills are written to load by **description auto-selection** — ask an authoring
question and the relevant one enters the session with no slash command. Each also stays directly
invocable.

## The scaffolder pattern

`new-skill` establishes the discipline every `new-*` scaffolder in this plugin follows: **interview →
emit → self-lint → fix-and-re-run → hand back only clean.** That loop lives in exactly one file —
`skills/new-skill/references/scaffolder-loop.md` — written over an abstract emitted artifact set, so a
sibling scaffolder supplies only its own interview questions and emission template and inherits the
rest unchanged. Reuse it; never fork it.

Two properties it guarantees: no emitted file carries a placeholder, and no artifact is handed back
with an open finding — an unfixable one stops the run with the finding surfaced instead.

## Install and register

Install the plugin from the marketplace, then — once, after `/wf:init` — run:

```
/wf-author-caps:init
```

Registration is only needed for the capability's **phase contributions**. The three skills above
reach you by native plugin composition the moment the plugin is installed; no registry row is
involved. A project that never registers the capability behaves exactly as it did before the plugin
existed.

## The capability

`author-caps` is declared `kind: both` — it ships skills today and attaches phase fragments
(guidance at `spec` and `implement`, a `finding` at `verify`, a `scenario` at `qa-generation`, plus
constitution articles) in a later change. Its fragments table currently ships empty by design;
registry validation tolerates zero rows, so the capability registers ahead of its first
contribution.

It owns no provider surface, declares no `requires:` and no `conflicts:`, and ships no
`profile-template:`.
