# `05_verify-fix.md` fix-log template

The verbatim template `/wf:verify-fix` writes to `{fix-log-dir}05_verify-fix.md` (Phase 7; `{fix-log-dir}` per `SKILL.md` §"The fix-log location" — the task folder, or the sibling of the override path). Rotate any existing file into `{fix-log-dir}05_verify-fix.history.md` first (prepend the old contents above a `---` separator, newest first). Substitute the placeholders; keep the `## Auto-fixed`, `## Awaiting user`, `## Dispositions`, and `## Next` shape. `## Dispositions` is always rendered; its `none` line appears only when the source report has no ledger.

## Contents

- [Fix-log template](#fix-log-template) — the full fenced block

## Fix-log template

```markdown
# verify-fix: {task-id}

**Source report:** `{fix-log-dir}04_verify.md`
**Branch:** <current branch>
**Attempt:** <k>
**Implemented by:** <model identifier>

## Auto-fixed (<n>)

1. [FIXED] <requirement id> — <requirement text>
   - Location: `path/to/file.ts:L`
   - Fingerprint: `<fp>`
   - Before: `<quoted line>`
   - After:  `<quoted line>`

2. [SKIPPED] <requirement id> — <requirement text>
   - Fingerprint: `<fp>`
   - Reason: code state on disk no longer matches the report's "Found" — reclassified to ASK.

3. [FAILED] <requirement id> — <requirement text>
   - Fingerprint: `<fp>`
   - Error: <tool error summary>

## Awaiting user (<m>)

- Q1 `<id>` — <one-line summary>. <file:line>
- Q2 `<id>` — <one-line summary>. <file:line> — routed, prior: <outcome> (scope <k>)
- ...

(Questions are printed in full in chat; this list is for traceability.)

## Dispositions (<d>)

- `path/to/file:<section>|<defect>` — accepted — first seen round 1
- `path/to/file:<section>|<defect>` — pending — first seen round 2 — this run: FIXED
- `path/to/file:L|R<n>` — escalated — this run: awaiting user
- none — source report carries no ledger

(Copied from the source report per `finding-disposition.md` §"Copying it into the fix log";
counterpart and adversarial entries carry none.)

## Next

Re-run `/wf:verify-spec <id>` to confirm fixes and regenerate `04_verify.md`.
```
