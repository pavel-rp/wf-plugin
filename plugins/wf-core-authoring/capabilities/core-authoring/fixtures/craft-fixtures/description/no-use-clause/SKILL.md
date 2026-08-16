---
name: no-use-clause
description: Demonstrates a description that states what the skill does but never states when to reach for it, seeded for the craft-C4 description check.
allowed-tools: [Read]
---

# /fixture:no-use-clause — seeded missing-trigger violation

Seeded fixture for `check-skill-description.sh --selftest`. The description opens in the third
person and is well under the 1024-character limit, but carries no trigger clause at all — the
"when" half of the reduction is simply absent. The D3 rule fires in isolation, and its message
must name the missing half so the author knows what to add.

Excluded from the live target set by the `*-fixtures/` shape rule in `skill-targets.sh`.
