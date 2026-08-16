---
name: clean
description: Demonstrates a conforming skill name for the craft-C4 name check. Use as the passing control case that keeps check-skill-name.sh honest about staying silent.
allowed-tools: [Read]
---

# /fixture:clean — conforming name control case

Seeded fixture for `check-skill-name.sh --selftest`. Its `name` is 5 characters and equals its
directory, so the name check must stay silent on it.

Excluded from the live target set by the `*-fixtures/` shape rule in `skill-targets.sh`.
