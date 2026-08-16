---
name: bad-declaration
description: Fixture skill whose interface declares a malformed slot id. Use never — fixture only.
allowed-tools: [Read]
---

# /wf:bad-declaration — fixture: a malformed slot declaration

The interface's `## Slots` row names a malformed `skill.point`, so the lint must
reject the declaration itself (before any marker check).

## Edge Cases

None — fixture.

```
BAD-DECLARATION — fixture
Next: none — terminus
```
