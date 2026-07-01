# wf-marketplace

Claude Code marketplace hosting the `wf` core plugin and the `wf-caps` default-capabilities pack:

- **[wf](plugins/wf/)** — the domain-free Spec-Driven Development spine: a `wf:*` skill chain for spec → plan → implement → verify → QA → commit/PR, carrying zero stack, domain, or project knowledge.
- **[wf-caps](plugins/wf-caps/)** — the default stack/domain-capabilities pack that attaches to the spine (migration, browser-qa, the angular test host, and the node-ts test harness).

## Install

In Claude Code:

```
/plugin marketplace add pavel-rp/wf-plugin
/plugin install wf
/plugin install wf-caps
```

(Replace `pavel-rp/wf-plugin` with the repo's actual `owner/name` once pushed, or use a local path / full git URL.)

Then, in any git repo you want to work in:

```
/wf:init
```

`/wf:init` is per-repo: it scaffolds `_local/` for per-task artifacts, adds gitignore entries, and writes the Node test runner. No per-machine setup is needed — Claude Code auto-discovers the plugin's skills and agents on install, and nested subagent delegation (e.g. `wf:branch`→`wf:index`) works out of the box.

## What's in the plugin

The plugin is named `wf`, so its skills are invoked as `/wf:<skill>` — `/wf:spec`, `/wf:plan`, `/wf:qa-auto`, etc. (skill names are bare; the `wf:` prefix comes from the plugin namespace).

See **[plugins/wf/README.md](plugins/wf/README.md)** for the full, authoritative skill and subagent reference. In brief, the skills cover triage → spec → plan → implement → verify → QA → commit/PR, plus a `/wf:run` dispatcher that drives the safe front of the chain hands-off.

## Authoring

See **[CLAUDE.md](CLAUDE.md)** for conventions when adding or editing skills and agents in this plugin.
