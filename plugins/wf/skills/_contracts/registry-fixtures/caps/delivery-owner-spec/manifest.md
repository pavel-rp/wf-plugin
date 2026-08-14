# delivery-owner-spec capability manifest (fixture)

**Kind:** adapter

A second delivery-surface owner whose `provider` fragment is anchored at a
**different** phase (`spec`, not `implement`). Surface-ownership uniqueness is
checked by the `delivery` scope token alone, independent of the anchoring phase,
so this still overlaps `delivery-owner` — the fixture that proves it
(`fail-delivery-overlap-phases.md`).

## Fragments

| phase | contribution-kind | dispatch                | scope    |
|-------|--------------------|--------------------------|----------|
| spec  | provider           | `subagent: wf:phase-runner` | delivery |
