# Fixture registry — one delivery owner carries the whole (branch-changes-extended) surface (passes)

`branch-changes-read` (WF-176) extends the delivery provider surface's **read
side** with one more operation, without adding a new surface, phase, or
contribution kind. A single capability still owns the whole `delivery` surface —
every write op, every read op, and the new `branch-changes-read` together — so
the registry validates clean. Proves the extended surface stays a **single
partitioned owner**: the new read op is not a separate surface to be split off.

## Capabilities

| Capability      | Path                                                                |
|-----------------|----------------------------------------------------------------------|
| delivery-owner  | plugins/wf/skills/_contracts/registry-fixtures/caps/delivery-owner   |
