# `05_verify-fix.md` fix-log template

The verbatim template `/wf:verify-fix` writes to the task folder (Phase 7). Rotate any existing file into `05_verify-fix.history.md` first (prepend the old contents above a `---` separator, newest first). Substitute the placeholders; keep the `## Auto-fixed`, `## Awaiting user`, and `## Next` shape.

## Contents

- [Fix-log template](#fix-log-template) — the full fenced block

## Fix-log template

```markdown
# verify-fix: {task-id}

**Source report:** `{task-root}/{task-id}/04_verify.md`
**Branch:** <current branch>
**Implemented by:** <model identifier>

## Auto-fixed (<n>)

1. [FIXED] <requirement id> — <requirement text>
   - Location: `path/to/file.ts:L`
   - Before: `<quoted line>`
   - After:  `<quoted line>`

2. [SKIPPED] <requirement id> — <requirement text>
   - Reason: code state on disk no longer matches the report's "Found" — reclassified to ASK.

3. [FAILED] <requirement id> — <requirement text>
   - Error: <tool error summary>

## Awaiting user (<m>)

- Q1 `<id>` — <one-line summary>. <file:line>
- Q2 `<id>` — <one-line summary>. <file:line>
- ...

(Questions are printed in full in chat; this list is for traceability.)

## Next

Re-run `/wf:verify-spec <id>` to confirm fixes and regenerate `04_verify.md`.
```
