# Gate map — sr

**Layer:** the pre-commit self-review's findings on the staged change set
**Grammar source:** `../fragments/self-review.md` · block `SR —` · anchor `- severity:`
**Labels:** declared
**Model:** claude-opus-5-5

| Label | Eligibility | Basis |
|---|---|---|
| fail | may-block | `fragments/self-review.md` §"Gate vs annotate — the severity signal" — "`fail` gates": the seam does not record the commit |
| warn | advisory | `fragments/self-review.md` §"Gate vs annotate — the severity signal" — "`warn` annotates": the commit proceeds |
