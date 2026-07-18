# wf-author-caps — the authoring toolkit

Teaches how to author capabilities, skills, and plugins for the `wf` marketplace. Ships the
`author-caps` capability and three skills.

**Model:** claude-opus-4-8

## Skills

| Command | What it does |
|---|---|
| `/wf-author-caps:authoring-guide` | The design half: core-versus-capability sorting, plugin anatomy, interface-first skill design, skill-versus-subagent, native and registry composition, the registration flow, and the canonical vocabulary. |
| `/wf-author-caps:authoring-taxonomy` | The schema half: the SDD phase spine, the seven contribution kinds, aggregate-versus-partition policy, manifest schema v2, the registry row, constitution composition, and registry validation. |
| `/wf-author-caps:init` | One-command self-registration of the `author-caps` capability into the wf capability registry. |

Both reference skills are written to load by **description auto-selection** — ask an authoring
question and the relevant one enters the session with no slash command. Each also stays directly
invocable.

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
