# Fixture registry — two delivery owners at different phases still overlap (fails)

`delivery-owner` anchors its `delivery` provider at `implement`;
`delivery-owner-spec` anchors its `delivery` provider at `spec`. Surface
ownership is partitioned by the `delivery` scope token alone — **phase-agnostic**
— so two owners of the same surface are an overlap error naming both, even when
their fragments sit at different phases. (The existing `fail-delivery-overlap.md`
exercises the same-phase case; this one locks the phase-agnostic property.)

## Capabilities

| Capability          | Path                                                                     |
|---------------------|---------------------------------------------------------------------------|
| delivery-owner      | plugins/wf/skills/_contracts/registry-fixtures/caps/delivery-owner        |
| delivery-owner-spec | plugins/wf/skills/_contracts/registry-fixtures/caps/delivery-owner-spec   |
