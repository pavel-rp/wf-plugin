# Fixture registry — empty (passes)

Purpose-built minimal registry for the core lean adversarial pass: a well-formed
`## Capabilities` table carrying a header and **zero** rows. It resolves to an empty
`capabilities[]`, which is the state the pass's acceptance is measured on.

This repo's own registry is deliberately **not** usable for that measurement — it
registers eight capabilities, several of which contribute at the `verify` phase, so a run
against it cannot show what core alone does. This fixture is the isolated control.

## Capabilities

| Capability | Path |
|------------|------|
