---
name: imperative
description: Create a seeded imperative opening for the craft-C4 description check. Use as the violation proving the third-person half of the reduction is asserted, and that the failure message names which half was missed.
allowed-tools: [Read]
---

# /fixture:imperative — seeded imperative-opening violation

Seeded fixture for `check-skill-description.sh --selftest`. The description opens with the bare
imperative `Create` instead of the third-person `Creates`. Everything else about it conforms — it
is well under the 1024-character limit and carries a `Use ...` trigger clause — so the D2 rule
fires in isolation and the assertion cannot be satisfied by a length or missing-clause hit.

Excluded from the live target set by the `*-fixtures/` shape rule in `skill-targets.sh`.
