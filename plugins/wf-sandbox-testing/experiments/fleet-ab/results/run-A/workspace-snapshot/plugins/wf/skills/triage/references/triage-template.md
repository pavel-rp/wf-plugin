# `triage.md` template

The verbatim template `/wf:triage` emits at write time (Phase 5). Overwrite prior versions. Substitute the placeholders; keep the metadata block, `## Scores` table, `## Verdict reasoning`, `## Recommended next step`, and `## Notes` shape (downstream skills read the `**Size:**` field).

## Contents

- [triage.md Template](#triagemd-template) — the full fenced block

## triage.md Template

```markdown
# {task-id} — Triage

**Created:** <YYYY-MM-DD HH:mm>
**Model:** <model identifier>
**Verdict:** <lite | full | split | blocked | clarify>
**Size:** <S | M | L | —>
**Confidence:** <high | low>

---

## Scores

| Dimension     | Score | Anchor match                                    |
| ------------- | ----- | ----------------------------------------------- |
| Scope         | N     | <one-line reason from the rubric anchor>        |
| Clarity       | N     | <one-line reason>                               |
| Design        | N     | <one-line reason>                               |
| Risk          | N     | <one-line reason>                               |
| Dependencies  | N     | <one-line reason>                               |
| **Total**     | NN/25 |                                                 |

---

## Verdict reasoning

<1–2 sentences: which rule fired and why. Reference the specific dimension scores that triggered it.>

---

## Recommended next step

```
<exact command, e.g. `/wf:lite {id}` or `/wf:spec {id}`>
```

<1 sentence: what this command will do and why it fits.>

---

## Notes

<Optional. Include only if:>
<- Any dimension is borderline (score adjacent to a verdict boundary)>
<- Evidence was thin (did not find expected modules in the repo scan)>
<- Task has unusual signals worth flagging (e.g. mentions migrations, touches compliance code)>
<- Verdict is `clarify` or `split` — list the specific ambiguities or sub-task candidates>
```
