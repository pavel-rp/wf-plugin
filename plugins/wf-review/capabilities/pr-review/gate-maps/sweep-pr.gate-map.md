# Gate map — sweep-pr

**Layer:** the post-merge review sweep's per-finding dispositions
**Grammar source:** `../fragments/closeout-review.md` · block `DISPOSITION —` · anchor `disposition:`
**Labels:** declared
**Model:** claude-opus-5-5

| Label | Eligibility | Basis |
|---|---|---|
| issue filed | advisory | `fragments/closeout-review.md` §"Step 4" — the survivor is filed as a tracker issue after the merge has landed; nothing is held |
| verified-invalid | advisory | `fragments/closeout-review.md` §"Step 4" — "record the one-line code evidence; file nothing" |
| moot | advisory | `fragments/closeout-review.md` §"Step 4" — "record what satisfies it; file nothing" |
| unverifiable | advisory | `fragments/closeout-review.md` §"Step 4" — recorded with its reason; it drives a `Partial` run status, never a block |
| absent | advisory | `fragments/closeout-review.md` §"Step 4" — a statement about the review, not a candidate; file nothing |
