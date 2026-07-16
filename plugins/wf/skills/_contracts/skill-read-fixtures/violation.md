# FIXTURE — deliberate violations for out4-skill-read-guard.sh --selftest.
# Model: claude-opus-4-8
#
# Every non-comment, non-blank line below is a planted SKILL.md read/glob
# INSTRUCTION the guard MUST flag. The --selftest asserts each one is caught.
# This file lives under _contracts/, so the guard's real-tree scan never sees it
# (it would otherwise turn CI permanently red). Comment lines (starting with #)
# and blanks are ignored by the count.

1. Read the `<skill>` skill (`${CLAUDE_PLUGIN_ROOT}/skills/<skill>/SKILL.md`, the folder mapped in Step 1).
1. Read the wf-angular:qa-host skill (`${CLAUDE_PLUGIN_ROOT}/skills/qa-host/SKILL.md`).
Glob the plugin cache for skills/spec/SKILL.md and follow its body.
When CLAUDE_PLUGIN_ROOT fails, Search("C:/Users/.../plugins/cache/**/wf/**/skills/spec/SKILL.md").
Before executing, read plugins/wf/skills/plan/SKILL.md and run each step.
- Load step: `${CLAUDE_PLUGIN_ROOT}/skills/qa-engine/SKILL.md`
