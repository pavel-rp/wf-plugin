# wf-author-caps — the authoring toolkit

Teaches how to author capabilities, skills, and plugins for the `wf` marketplace — and scaffolds
them. Ships the `author-caps` capability and five skills across two families: the `authoring-*`
reference pair, and the `new-*` scaffolders that emit real, already-linted files.

**Model:** claude-opus-4-8

## Skills

| Command | What it does |
|---|---|
| `/wf-author-caps:authoring-guide` | The design half: core-versus-capability sorting, plugin anatomy, interface-first skill design, skill-versus-subagent, native and registry composition, the registration flow, and the canonical vocabulary. |
| `/wf-author-caps:authoring-taxonomy` | The schema half: the SDD phase spine, the seven contribution kinds, aggregate-versus-partition policy, manifest schema v2, the registry row, constitution composition, and registry validation. |
| `/wf-author-caps:new-skill` | The build half: interviews for a skill's name, purpose, invocation shape, and zero-argument default, emits a conforming `SKILL.md`, then self-lints it and fixes its own findings before handing it back. Never a template with placeholders. |
| `/wf-author-caps:new-capability` | The other build half: interviews for a capability's name, kind, and each phase contribution, emits a schema-v2 manifest plus every declared fragment file at exactly the path its row names, then self-lints the set — manifest validation, registry validation, vocabulary lint — and fixes its own findings before handing it back. |
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

`new-capability` is the first sibling to inherit it, supplying only its own three inputs — the
interview questions, the emission template, and its check set (manifest validation, registry
validation, and the vocabulary lint; the skill-interface validator has no target on a manifest
emission). Its emission machinery — the schema-v2 manifest shape, the Fragments-row rules, and the
fragment-file rules — is likewise factored into one file,
`skills/new-capability/references/capability-emission.md`, so a scaffolder that emits a capability as
part of a larger artifact set composes those rules by reference instead of restating them.

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

`author-caps` is declared `kind: both` — it ships the skills above **and** attaches five phase
fragments, every one dispatched `inline:` with an aggregate (`—`) scope:

| Phase | Kind | Fragment |
|---|---|---|
| `spec` | `guidance` | Interface-first design prompts — settle invocation shape, terminal block, declared slots, and declared settings keys before any body prose. |
| `implement` | `guidance` | In-loop authoring conventions — slug and folder agreement, tool-declaration rules, the terminal block, the ops/reference budget. |
| `verify` | `finding` | Structural validation — manifest, registry, and skill-interface verdicts mapped into the verify phase's finding format. |
| `verify` | `finding` | Reference existence — dead command, agent, and path references, the defect class that ships unnoticed on fallback branches. |
| `qa-generation` | `scenario` | Authoring scenarios — interface-matches-body, declared paths resolve, registration composes, and the inert unregistered case. |

The pack's authoring non-negotiables ship as repeatable `article:` manifest **keys** (not
fragments-table rows — `article` is not a contribution kind), composed by the constitution skill
and surfaced in fresh sessions through the existing session-start injection path. This pack adds no
hook.

Every fragment carries an explicit no-op clause, and all findings are provenance-tagged
`author-caps`. Rationale for the row shapes lives in
`capabilities/author-caps/references/fragment-rationale.md`, which is never read at runtime.

It owns no provider surface, declares no `requires:` and no `conflicts:`, and ships no
`profile-template:`. The `qa-generation` scenarios name `wf-sandbox-testing` as their eventual
execution engine as a **declaration only** — nothing is wired to it.
