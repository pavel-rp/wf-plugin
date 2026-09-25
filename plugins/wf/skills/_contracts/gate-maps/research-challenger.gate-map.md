# Gate map — research-challenger

**Layer:** the independent challenge of a research recommendation
**Grammar source:** `../../../agents/research-challenger.md` · block `RESEARCH-CHALLENGER —` · anchor `- X1 |`
**Labels:** declared
**Model:** claude-opus-5-5

This layer gates nothing today: the host records every challenge as accepted, rebutted, or open,
and the research run completes either way. Every label is therefore `advisory`.

| Label | Eligibility | Basis |
|---|---|---|
| high | advisory | `research/SKILL.md` — an open high-severity challenge caps Confidence at `Low`; it never halts the run |
| medium | advisory | `agents/research-challenger.md` §"Mandate" — "confidence should drop or a consequence is missing" |
| low | advisory | `agents/research-challenger.md` §"Mandate" — "a wording or grading correction" |
