# Gate map — charter-reviewer

**Layer:** the charter and sub-task decomposition review inside the charter loop
**Grammar source:** `../../../agents/charter-reviewer.md` · block `REVIEWER —` · anchor `- F<N>.1 |`
**Labels:** declared
**Model:** claude-opus-5-5

| Label | Eligibility | Basis |
|---|---|---|
| CRITICAL | may-block | `agents/charter-reviewer.md` §"Mandate" — tagged `blocking: yes` |
| HIGH | may-block | `agents/charter-reviewer.md` §"Mandate" — tagged `blocking: yes`; the size-budget check is floored here |
| MEDIUM | advisory | `agents/charter-reviewer.md` §"Severity" — "weakens quality without blocking"; tagged `blocking: no` |
| LOW | advisory | `agents/charter-reviewer.md` §"Severity" — "Never blocks on its own"; tagged `blocking: no` |
