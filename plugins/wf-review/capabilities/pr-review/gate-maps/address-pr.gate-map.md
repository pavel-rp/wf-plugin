# Gate map — address-pr

**Layer:** the review-address pass's per-claim verification verdicts
**Grammar source:** none
**Labels:** declared
**Model:** claude-opus-5-5

| Label | Eligibility | Basis |
|---|---|---|
| valid | advisory | `address-pr/SKILL.md` Phases 4–6 — a confirmed claim is fixed and its thread resolved; the skill blocks nothing |
| false-positive | advisory | `address-pr/SKILL.md` Phase 6 — replied to with evidence and left open for the reviewer; no edit, no block |

The verdicts appear only in the skill's prose and its final block's count line, never in a
`<…|…>` label group, so this map names no grammar source; the guard checks shape and eligibility.
