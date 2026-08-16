---
name: clean
description: Demonstrates a skill body comfortably under the 500-line budget for the craft-C4 body-length check. Use as the passing control case that keeps check-skill-body-length.sh honest about staying silent.
allowed-tools: [Read]
---

# /fixture:clean — conforming body-length control case

Seeded fixture for `check-skill-body-length.sh --selftest`. This file is a couple of dozen lines
long, far under the 500-line budget, so the body-length check must stay silent on it.

Excluded from the live target set by the `*-fixtures/` shape rule in `skill-targets.sh`.
