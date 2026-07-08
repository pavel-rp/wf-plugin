# Fixture registry — delivery composes alongside tracker + engine (passes)

The extended delivery provider (WF-157) composes with a tracker `provider` and a
qa-execution `engine` `provider` in one registry — three **distinct** surfaces,
no partition collision. Proves the delivery surface (whatever its operation set)
composes with the other provider surfaces, not just in isolation.

## Capabilities

| Capability     | Path                                                                |
|----------------|----------------------------------------------------------------------|
| delivery-owner | plugins/wf/skills/_contracts/registry-fixtures/caps/delivery-owner   |
| tracker-owner  | plugins/wf/skills/_contracts/registry-fixtures/caps/tracker-owner    |
| engine-owner   | plugins/wf/skills/_contracts/registry-fixtures/caps/engine-owner     |
