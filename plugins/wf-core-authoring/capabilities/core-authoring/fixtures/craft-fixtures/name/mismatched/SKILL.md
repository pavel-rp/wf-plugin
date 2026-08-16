---
name: wf-mismatched
description: Demonstrates a skill name that disagrees with its directory for the craft-C4 name check. Use as the seeded violation proving check-skill-name.sh catches the prefix mistake.
allowed-tools: [Read]
---

# /fixture:mismatched — seeded directory-mismatch violation

Seeded fixture for `check-skill-name.sh --selftest`. The directory is `mismatched` but the declared
`name` is `wf-mismatched` — the classic redundant-prefix mistake, which in a real skill causes a
silent load failure. The name check must flag it, naming the file and the rule.

Excluded from the live target set by the `*-fixtures/` shape rule in `skill-targets.sh`.
