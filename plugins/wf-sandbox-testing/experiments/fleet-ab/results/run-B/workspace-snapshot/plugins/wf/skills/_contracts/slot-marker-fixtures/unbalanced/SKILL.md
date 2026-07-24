---
name: unbalanced
description: Fixture skill whose slot marker opens but never closes. Use never — fixture only.
allowed-tools: [Read]
---

# /wf:unbalanced — fixture: an unbalanced marker

The opening marker below is never closed, so the lint must flag the missing
`wf:slot-end`.

<!-- wf:slot unbalanced.review -->
default with no closing marker

## Edge Cases

None — fixture.

```
UNBALANCED — fixture
Next: none — terminus
```
