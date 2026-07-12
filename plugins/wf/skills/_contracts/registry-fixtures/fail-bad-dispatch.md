# Fixture registry — a fragment's dispatch column is malformed (fails, WF-239)

The dispatch must be `inline: <rel-path>` or `subagent: <agent>`; a bare path with
no prefix is rejected, naming the offender.

## Capabilities

| Capability   | Path                                                             |
|--------------|------------------------------------------------------------------|
| bad-dispatch | plugins/wf/skills/_contracts/registry-fixtures/caps/bad-dispatch |
