# Fixture expectations — four lenses report the same defect at one location

Fourth fixture in the reconciliation set (WF-566). Same registry as `audit-registered.md`
(`../registry-fixtures/pass-audit-only.md`) — the real five lenses, unchanged. Unlike the
other three fixtures in this set (which cover the lean-pass/lens reconciliation), this one
tests SUB-2's cross-lens collapse rule in isolation: four of the five lenses (correctness,
security, convention, consistency) each independently report the **same** real defect at
the **same** `file:section`, on their own evidence and their own rubric `check:` number.
The fifth lens (operational) is clean.

---

## The collapse

EXPECT: case=collapse
EXPECT: fingerprint=changed/preflight-check.txt:validate|missing-null-guard
EXPECT: lenses=correctness,security,convention,consistency
EXPECT: defect-keys=1

Four lens findings at one location, naming the same defect, collapse into **one** finding.
The collapsed finding lists all four contributing lenses, each lens's own `evidence`
string, and each lens's own `<lens>/<check>` provenance — none dropped, edited, or
re-tagged. The fifth lens (operational) delivered a clean result and contributes nothing
at this location.

EXPECT: provenance=correctness/4,security/2,convention/1,consistency/3
EXPECT: evidence=preserved-per-lens

## Still not gated by mere existence

EXPECT: gating=none

The collapse changes the finding **count**, never the blocking-set classification of the
survivor: whether the collapsed finding blocks is still decided by anchoring (§"The
blocking set"), unchanged by this fixture.
