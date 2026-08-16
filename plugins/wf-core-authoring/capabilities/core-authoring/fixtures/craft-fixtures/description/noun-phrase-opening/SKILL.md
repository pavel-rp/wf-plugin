---
name: noun-phrase-opening
description: Stack-agnostic control case whose description opens on a noun phrase rather than a verb. Use as the second passing control, proving the third-person proxy does not punish a legitimate noun-phrase opening.
allowed-tools: [Read]
---

# /fixture:noun-phrase-opening — noun-phrase control case

Seeded fixture for `check-skill-description.sh --selftest`. Several live skills open their
description on a noun phrase (`Stack-agnostic ...`, `Dependency-ordered ...`) rather than a
third-person verb. Those are valid "what" statements, so rule (d) of the D2 decision procedure
must accept them. This fixture is the standing proof that the denylist has not grown teeth it
should not have — if a future edit to `IMPERATIVES` starts rejecting noun phrases, this case
fails first.

Excluded from the live target set by the `*-fixtures/` shape rule in `skill-targets.sh`.
