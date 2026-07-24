---
name: malformed-marker
description: Fixture skill whose body carries a malformed slot marker. Use never — fixture only.
allowed-tools: [Read]
---

# /wf:malformed-marker — fixture: a malformed marker

The marker below is malformed — the slot id carries uppercase letters, which the
`skill.point` grammar forbids, so it is neither a well-formed open nor close.

<!-- wf:slot Malformed-Marker.Review -->
default
<!-- wf:slot-end Malformed-Marker.Review -->

## Edge Cases

None — fixture.

```
MALFORMED-MARKER — fixture
Next: none — terminus
```
