# Fixture registry — a concrete tracker provider composes with a delivery provider (passes)

A real tracker binding (`ado`, owning `surface = tracker` — the surface that now carries
the WF-158 query operations) composes with a `delivery` provider in one registry: two
**distinct** provider surfaces, no partition collision. This is the exact surface pairing
a prioritized cross-tracker briefing needs — tracker query operations alongside delivery
activity — proving the extended tracker surface still validates clean next to delivery.

## Capabilities

| Capability     | Path                                                                |
|----------------|----------------------------------------------------------------------|
| ado            | plugins/wf/skills/_contracts/registry-fixtures/caps/fixture-ado      |
| delivery-owner | plugins/wf/skills/_contracts/registry-fixtures/caps/delivery-owner   |
