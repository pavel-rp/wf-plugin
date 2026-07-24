---
name: undeclared-marker
description: Fixture skill with a well-formed marker no declaration covers. Use never — fixture only.
allowed-tools: [Read]
---

# /wf:undeclared-marker — fixture: an undeclared marker

The marker below is well-formed, but this skill ships no interface.md declaring
`undeclared-marker.ghost`, so the lint must reject it as undeclared.

<!-- wf:slot undeclared-marker.ghost -->
default
<!-- wf:slot-end undeclared-marker.ghost -->

## Edge Cases

None — fixture.

```
UNDECLARED-MARKER — fixture
Next: none — terminus
```
