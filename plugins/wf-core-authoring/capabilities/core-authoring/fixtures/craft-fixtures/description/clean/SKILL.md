---
name: clean
description: Demonstrates a conforming description for the craft-C4 description check — a third-person statement of what the skill does. Use as the passing control case that keeps check-skill-description.sh honest about staying silent.
allowed-tools: [Read]
---

# /fixture:clean — conforming description control case

Seeded fixture for `check-skill-description.sh --selftest`. Its description opens with the
third-person `Demonstrates`, sits far under the 1024-character limit, and carries a `Use ...`
trigger clause, so all three assertions must stay silent on it.

Excluded from the live target set by the `*-fixtures/` shape rule in `skill-targets.sh`.
