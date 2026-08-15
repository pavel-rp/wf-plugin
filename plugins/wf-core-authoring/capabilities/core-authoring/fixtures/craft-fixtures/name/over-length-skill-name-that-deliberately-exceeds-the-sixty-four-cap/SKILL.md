---
name: over-length-skill-name-that-deliberately-exceeds-the-sixty-four-cap
description: Demonstrates a skill name past the 64-character cap for the craft-C4 name check. Use as the seeded violation that isolates the length rule from the directory-match rule.
allowed-tools: [Read]
---

# /fixture:over-length — seeded name-length violation

Seeded fixture for `check-skill-name.sh --selftest`. The `name` is 67 characters, three over the
64-character cap. Its directory carries the identical name on purpose, so the directory-match rule
stays silent and the selftest's assertion can only be satisfied by the length rule actually firing.

Excluded from the live target set by the `*-fixtures/` shape rule in `skill-targets.sh`.
