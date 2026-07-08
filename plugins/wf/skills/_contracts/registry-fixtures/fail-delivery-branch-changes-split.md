# Fixture registry — the branch-changes read op cannot be split to a second delivery owner (fails)

Adding `branch-changes-read` (WF-176) is tempting to hand to a **separate**
capability from the one owning the delivery write ops. It cannot be: the
`delivery` surface is partitioned by its **scope token alone**, so any second
capability claiming `delivery` — even one meant only for the new read op —
collides with the existing owner. Both offenders are named. This locks that the
extended surface stays a single owner (the pass-side of `pass-delivery-branch-changes.md`).

## Capabilities

| Capability       | Path                                                                   |
|------------------|-------------------------------------------------------------------------|
| delivery-owner   | plugins/wf/skills/_contracts/registry-fixtures/caps/delivery-owner     |
| delivery-owner-2 | plugins/wf/skills/_contracts/registry-fixtures/caps/delivery-owner-2   |
