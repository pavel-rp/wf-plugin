# The `_local/README.md` template

Read on the scaffold write path only — `/wf:init` Phase 3 reaches this file
through `resolve_content({ workspaceRoot, class: "references-template", skill:
"init", ref: "local-readme-template.md" })`, never a raw `Read` of a
plugin-cache path, and never at boot.

Write the fenced content below verbatim, substituting the current model id on the
`**Model:**` line. Skip the write entirely when `_local/README.md` already exists
and `--force` is unset.

```markdown
# _local/

**Model:** <current model id>

Per-task artifacts managed by the wf:* skill suite. Everything here is gitignored.

- `T<NNN>/` — task folders (requirements, spec, plan, research, artifacts)
- `config.md` — project-specific values consumed by every wf:* skill

Safe to nuke if you want a clean slate. Nothing here is version-controlled.
```
