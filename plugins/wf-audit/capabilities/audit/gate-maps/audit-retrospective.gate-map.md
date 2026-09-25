# Gate map — audit-retrospective

**Layer:** the on-request composite retrospective report's verdict
**Grammar source:** `../fragments/retrospective.md` · block `# retrospective:` · anchor `**Composite verdict:**`
**Labels:** declared
**Model:** claude-opus-5-5

| Label | Eligibility | Basis |
|---|---|---|
| PASS | advisory | `fragments/retrospective.md` §"Compose the composite report" — a report verdict only; the layer is read-mostly and its sole write is the report artifact |
| PASS WITH WARNINGS | advisory | `fragments/retrospective.md` §"Compose the composite report" — summarises warnings already carried by the verify report; no phase or merge reads it |
| FAIL | advisory | `fragments/retrospective.md` §"Compose the composite report" — folds blocking signals owned by other layers into a report; the retrospective itself gates nothing |
