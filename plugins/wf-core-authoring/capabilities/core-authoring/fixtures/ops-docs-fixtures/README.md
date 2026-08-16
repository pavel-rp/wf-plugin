# ops-docs-fixtures — seeded pass/fail cases for `check-ops-docs.sh --selftest`

Each folder plants exactly one violation (or, for `clean/`, none), so the selftest can prove the
guard discriminates before the live-tree scan is trusted. **Never fix a violation in here** — the
violation *is* the fixture.

| Folder | Plants | Guard proven |
|---|---|---|
| `clean/` | nothing | the guards stay silent on a well-formed pair |
| `over-budget/` | a 150+-line `*.ops.md` | GUARD 1 (line budget) |
| `heading-orphan/` | a `## ` heading absent from the reference | GUARD 2 (heading parity) |
| `no-pair/` | an `*.ops.md` with no reference half | GUARD 2 (pairing) |
| `contract-pointer/` | `contract.md` on an unlabeled line | GUARD 4 (contract-pointer ban) |
| `empty/` | a covered folder with no `*.ops.md` at all | the never-vacuously-green rule |
| `bad-link/` | a `](file.md#anchor)` that does not resolve | GUARD 3 (cross-link anchors) |

The folder name carries the `-fixtures` suffix on purpose: `craft_is_excluded` in
`skill-targets.sh` excludes that shape at any depth, so nothing seeded here can enter a real-tree
target set.

**Model:** claude-opus-5[1m]
