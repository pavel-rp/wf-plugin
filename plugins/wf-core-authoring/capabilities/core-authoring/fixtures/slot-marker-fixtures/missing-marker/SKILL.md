---
name: missing-marker
description: Fixture skill that declares a slot but never places its marker. Use never — fixture only.
allowed-tools: [Read]
---

# /wf:missing-marker — fixture: a declared slot with no marker

The interface declares `missing-marker.review`, but this body places no marker
for it, so the lint must flag the orphaned declaration.

## Edge Cases

None — fixture.

```
MISSING-MARKER — fixture
Next: none — terminus
```
