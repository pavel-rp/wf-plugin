# lifecycle-write-fixtures

The seeded corpus `check-lifecycle-write-scope.sh --selftest` drives (WF-444).

Each file plants exactly one outcome the guard claims to produce, so a green live-tree run means
"the tree is clean" rather than "the check does nothing".

| Fixture | Expected |
|---|---|
| `clean.md` | silent — resolver-managed prose for both declared committed lifecycle artifact classes |
| `arbitrary-write.md` | flagged **W1** — a skill body claiming a write to `.wf/` on its own authority |
| `undeclared-artifact.md` | flagged **W2** — a lifecycle path outside the two declared classes |

The folder name ends in `-fixtures` deliberately: `craft_is_excluded` in `skill-targets.sh` keys on
that shape, so the planted violations sit structurally off the live-tree target set — excluded by
the very rule under test, wherever this folder is later moved to.
