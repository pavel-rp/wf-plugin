# Gate map — review-pr

**Layer:** the pull-request review's per-finding severities
**Grammar source:** none
**Labels:** declared
**Model:** claude-opus-5-5

| Label | Eligibility | Basis |
|---|---|---|
| blocker | advisory | `review-pr/SKILL.md` Phase 3 — "must fix before merge" is guidance to the author; Phase 5 only posts a PR-level comment and no phase or merge reads the severity |
| major | advisory | `review-pr/SKILL.md` Phase 3 — "should fix"; posted in the review comment only |
| minor | advisory | `review-pr/SKILL.md` Phase 3 — "minor/nit (optional)"; posted in the review comment only |

The severities appear only in the skill's prose and its final block's count line, never in a
`<…|…>` label group, so this map names no grammar source; the guard checks shape and eligibility.
