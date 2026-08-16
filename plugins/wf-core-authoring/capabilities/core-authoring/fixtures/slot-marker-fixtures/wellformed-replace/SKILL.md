---
name: wellformed-replace
description: Fixture skill with one declared replace slot and a matching marker pair. Use never — fixture only.
allowed-tools: [Read]
---

# /wf:wellformed-replace — fixture: a well-formed replace slot

Run the review step below. When a capability fills the slot, its content
replaces the inline default; when unfilled, execute exactly the inline default
with no improvisation.

<!-- wf:slot wellformed-replace.review -->
Default review: read the change set and confirm it matches the spec.
<!-- wf:slot-end wellformed-replace.review -->

## Edge Cases

None — fixture.

```
WELLFORMED-REPLACE — fixture
Next: none — terminus
```
