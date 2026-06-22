# wf-marketplace

Claude Code marketplace hosting the `wf` plugin. Currently hosts one plugin:

- **[wf](plugins/wf/)** — the `wf:*` skill chain for ADO-tracked tasks (the C# / ASP.NET MVC → Angular / TypeScript migration).

## Install

In Claude Code:

```
/plugin marketplace add pavel-rp/wf-plugin
/plugin install wf
```

(Replace `pavel-rp/wf-plugin` with the repo's actual `owner/name` once pushed, or use a local path / full git URL.)

Then, in any git repo you want to work in:

```
/wf:init
```

`/wf:init` is per-repo: it scaffolds `_local/` for per-task artifacts, adds gitignore entries, and writes the Node test runner. No per-machine setup is needed — Claude Code auto-discovers the plugin's skills and agents on install, and nested subagent delegation (e.g. `wf:branch`→`wf:index`) works out of the box.

## What's in the plugin

The plugin is named `wf`, so its skills are invoked as `/wf:<skill>` — `/wf:spec`, `/wf:plan`, `/wf:qa-auto`, etc. (skill names are bare; the `wf:` prefix comes from the plugin namespace).

See **[plugins/wf/README.md](plugins/wf/README.md)** for the full skill reference. In brief: 22 skills and 7 subagents covering triage → spec → plan → implement → verify → QA → commit/PR, plus a `/wf:run` dispatcher that drives the safe front of the chain hands-off.

## Authoring

See **[CLAUDE.md](CLAUDE.md)** for conventions when adding or editing skills and agents in this plugin.
