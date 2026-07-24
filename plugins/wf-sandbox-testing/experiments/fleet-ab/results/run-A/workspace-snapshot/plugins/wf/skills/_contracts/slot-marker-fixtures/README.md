# slot-marker-fixtures — the test suite for skill-slot-marker-lint.sh

Each subfolder is a stand-in skill folder (a `SKILL.md`, optionally an
`interface.md`) exercising exactly one behavior of the slot-marker lint. They
live under `_contracts/` so the lint's real-tree scan (`plugins/*/skills/*/`)
never reaches them — the `--selftest` drives them explicitly and asserts each
one's pass/fail outcome and defect text.

| Fixture | Expect | Exercises |
|---------|--------|-----------|
| `slotfree`           | pass | no declaration, no markers — the lint is inert |
| `wellformed-replace` | pass | a declared `replace` slot with a matching marker pair |
| `wellformed-append`  | pass | a declared `append` slot with a matching marker pair |
| `malformed-marker`   | fail | a `<!-- wf:slot… -->` comment that is not a well-formed marker (D2) |
| `undeclared-marker`  | fail | a well-formed marker whose id no `## Slots` row declares (D3) |
| `missing-marker`     | fail | a declared slot with no marker in the body (D5) |
| `unbalanced`         | fail | an opening marker with no matching close (D4) |
| `bad-declaration`    | fail | a `## Slots` row whose id is not a well-formed `skill.point` (D1) |
