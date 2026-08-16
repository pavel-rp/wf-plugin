---
name: over-length
description: Demonstrates a description padded past the 1024-character limit, seeded for the craft-C4 description check. This clause exists only to add characters, and it is repeated so the measured length clears the cap. This clause exists only to add characters, and it is repeated so the measured length clears the cap. This clause exists only to add characters, and it is repeated so the measured length clears the cap. This clause exists only to add characters, and it is repeated so the measured length clears the cap. This clause exists only to add characters, and it is repeated so the measured length clears the cap. This clause exists only to add characters, and it is repeated so the measured length clears the cap. This clause exists only to add characters, and it is repeated so the measured length clears the cap. This clause exists only to add characters, and it is repeated so the measured length clears the cap. This clause exists only to add characters, and it is repeated so the measured length clears the cap. This clause exists only to add characters, and it is repeated so the measured length clears the cap. Use as the seeded violation that isolates the length rule from the other two.
allowed-tools: [Read]
---

# /fixture:over-length — seeded description-length violation

Seeded fixture for `check-skill-description.sh --selftest`. The description is padded past the
1024-character cap with a deliberately repeated filler clause. It still opens in the third person
and still carries a `Use ...` trigger clause, so the length rule fires in isolation and the
assertion cannot be satisfied by an incidental D2 or D3 hit.

Excluded from the live target set by the `*-fixtures/` shape rule in `skill-targets.sh`.
