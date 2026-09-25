# Gate map — qa-followup triage

**Layer:** the triage that sorts every non-passing QA scenario into one bucket
**Grammar source:** none
**Labels:** declared
**Model:** claude-opus-5-5

The triage buckets are prose headings with no single output-block alternation, so this map names
no grammar source; the guard checks only that each declared bucket carries a valid eligibility.

| Label | Eligibility | Basis |
|---|---|---|
| UNBLOCK | advisory | `qa-followup/SKILL.md` Phase 5 — a harness fix and re-run; a scenario still blocked afterwards is re-bucketed to ESCALATE, so this bucket holds nothing itself |
| DEFECT | may-block | `qa-followup/SKILL.md` Phase 6 — a source fix behind the single remediation approval gate |
| ESCALATE | may-block | `qa-followup/SKILL.md` — needs the user; an all-escalated run ends `QA-FOLLOWUP — ESCALATED`, which `run/SKILL.md` Phase 3 treats as a halt |
