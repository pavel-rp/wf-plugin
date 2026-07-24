# Fixture registry — two tracker claimants amid a delivery provider (fails)

The concrete `ado` tracker binding and the generic `tracker-owner` both claim
`surface = tracker`; a `delivery` provider sits alongside them without collision. The
overlapping tracker ownership is a validation error naming **both** tracker offenders —
the extra delivery surface never masks the tracker partition collision.

## Capabilities

| Capability     | Path                                                                |
|----------------|----------------------------------------------------------------------|
| ado            | plugins/wf/skills/_contracts/registry-fixtures/caps/fixture-ado      |
| delivery-owner | plugins/wf/skills/_contracts/registry-fixtures/caps/delivery-owner   |
| tracker-owner  | plugins/wf/skills/_contracts/registry-fixtures/caps/tracker-owner    |
