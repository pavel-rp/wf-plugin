# wf-marketplace

Claude Code marketplace hosting the `wf` core plugin and the `wf-caps` default-capabilities pack:

- **[wf](plugins/wf/)** — the domain-free Spec-Driven Development spine: a `wf:*` skill chain for spec → plan → implement → verify → QA → commit/PR, carrying zero stack, domain, or project knowledge.
- **[wf-caps](plugins/wf-caps/)** — the default stack/domain-capabilities pack that attaches to the spine (migration, the angular test host, and the node-ts test harness).
- **[wf-browser-qa](plugins/wf-browser-qa/)** — the standalone browser-QA feature pack: a stack-agnostic browser-automation QA engine (`qa-execution` engine provider) that core's `/wf:qa-auto` dispatches to.

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

## What's in the plugins

Each plugin's skills are invoked under its own namespace: core `wf` skills as `/wf:<skill>` (`/wf:spec`, `/wf:plan`, `/wf:qa-auto`, …) and `wf-caps` skills as `/wf-caps:<skill>` (skill names are bare; the namespace prefix comes from the plugin).

See **[plugins/wf/README.md](plugins/wf/README.md)** for the full, authoritative core skill and subagent reference. In brief, the core skills cover triage → spec → plan → implement → verify → QA → commit/PR, plus a `/wf:run` dispatcher that drives the safe front of the chain hands-off. See **[plugins/wf-caps/README.md](plugins/wf-caps/README.md)** for the stack/domain capabilities that attach to the spine.

## Authoring

See **[CLAUDE.md](CLAUDE.md)** for conventions when adding or editing skills and agents in this plugin.
