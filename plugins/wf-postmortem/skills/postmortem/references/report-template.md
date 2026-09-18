# postmortem report template

Runtime-read only on the write path (Phase 4 of `SKILL.md`) — never read at boot. The verbatim
shape every `{task-root}/PM<NNN>__<slug>/report.md` follows, in this section order. Every section
this release cannot fill states so explicitly, verbatim, rather than being omitted — a reader must
be able to tell "not produced yet" from "produced and empty."

```markdown
# Postmortem — <failure description, one line>

**Model:** <runtime model id>
**Created:** <YYYY-MM-DD HH:MM>

---

## Summary

Not yet produced — this release resolves and echoes the hunt scope only; no session has been
located or read (arrives with a later charter sub-task).

## Scope

- **Failure description:** <the resolved description, verbatim, after the redacting write path>
- **Skill:** <resolved skill name | "unscoped">
- **Folder or repository:** <resolved path, verbatim | "not named" | "<name> — unresolved (no matching filesystem path)">
- **Read cap:** <override value, if named | "default, not yet enforced">
- **Session scope:** <"current workspace only" | "current workspace plus <named project>">

## Component and Version

Not yet produced — component and version attribution needs a checked session locator and executed-version
resolution against skill/contract/manifest text (arrives with a later charter sub-task).

## Contributing Factors

Not yet produced — no session has been located or read, so no factor (confirmed or hypothesis) can
be stated yet (arrives with later charter sub-tasks).

## Evidence Record

Not yet produced — no session has been located or read (arrives with a later charter sub-task).

## Localisation

Not yet produced — file-level localisation needs a confirmed contributing factor (arrives with a
later charter sub-task).

## Measured Effect

Not yet produced — measured-effect counts are read from session records, and none has been read yet
(arrives with a later charter sub-task).

## Fix Direction

Not yet produced — fix direction follows from a confirmed contributing factor (arrives with a later
charter sub-task).

## Coverage

Not yet produced — coverage names sessions located, read, read in part, and skipped with reason; no
session has been located yet (locating arrives with a later charter sub-task).

## Recommendation

Not yet produced — the rule-based next-step recommendation is computed from confirmed-factor and
hypothesis counts, neither of which exists yet (arrives with a later charter sub-task).

---

POSTMORTEM — written

Report:  {task-root}/PM<NNN>__<slug>/report.md
Scope:   description="<resolved, redacted>" · skill=<name|unscoped> · folder/repo=<resolved|not named|<name> — unresolved> · cap=<override|default, not yet enforced> · session-scope=<current workspace only|current workspace plus <project>>
Next:    none — terminus
```

## Filling rules

- **Verbatim echo, no paraphrase.** Every resolved value in the Scope section is stated exactly as
  resolved (after the redacting write path has run over it) — never summarized, never reworded.
- **State the default, not just the value.** When a value was defaulted rather than named in the
  prompt, say so explicitly (e.g. `"unscoped"`, `"current workspace only"`, `"default, not yet
  enforced"`) — a reader must be able to tell an explicit choice from a default.
- **An unresolved name is reported, not silently dropped.** A named folder or repository that does
  not resolve to a filesystem path is stated as `"<name> — unresolved (no matching filesystem
  path)"`, and no session-store lookup is attempted for it.
- **Every non-filled section states its own reason** for not being filled yet, naming which later
  charter sub-task fills it — this is not boilerplate, it is the honest gap the charter's staged
  delivery produces.
- **The final-output block is part of the file**, not just chat output — a downstream reader of the
  report file sees the same `POSTMORTEM — written` block this skill prints to chat.
