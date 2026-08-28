# Fixture expectations — the same change, with one adversarial capability registered

The `audit`-registered counterpart to WF-485's empty-registry case. It introduces **no new
change under review**: the input is exactly `defective-change.md`, the same two defects, so
the only variable between the two runs is the registry.

| Run | Registry | Fixture change |
|-----|----------|----------------|
| A (WF-485) | `../registry-fixtures/pass-empty.md` | `defective-change.md` |
| B (this)   | `../registry-fixtures/pass-audit-only.md` | `defective-change.md` |

Run A is the control: no contributor exists, so every core candidate renders. Run B adds one
registered capability contributing five `finding` lenses at `verify`. Comparing B against A
is what the non-duplication measure is read from — which is why B's registry carries exactly
one row. The `EXPECT:` markers are the machine-checkable assertions the guard reads.

> Core names no capability. The capability noun appears **in this fixture and its registry**,
> never in `verify-spec/SKILL.md` — the rule the run exercises is stated over the contribution
> taxonomy (`finding` contributions at the `verify` phase), so it is the *fixture* that
> chooses which capability fills that role.

---

## Obligation 1 — the lens findings survive, provenance-tagged

Nothing the core default added may suppress or degrade a contributed finding. The
reconciliation is **one-directional**: it acts only on core candidates.

EXPECT: fanout=5
EXPECT: lens-findings=preserved
EXPECT: lens-provenance=tagged
EXPECT: reconciliation=one-directional

The fan-out is unchanged — five lenses still dispatch as five, per
`docs/verify-fanout-decision.md`. Each rendered lens finding keeps its own source-capability
provenance tag. No lens finding is dropped, edited, re-tagged, merged, reordered, or withheld
by the reconciliation step, and no other capability's contribution appears in the output.

## Obligation 2 — the lean pass does not duplicate them

### Case W — withdrawn (the no-duplication case)

EXPECT: case=withdraw
EXPECT: candidate=DEFECT-1
EXPECT: changed-side=changed/preflight-check.txt:1
EXPECT: existing-side=existing/unit-descriptor.txt:2

A lens reports the out-of-range bound at `changed/preflight-check.txt:1` and rests it on the
same `existing/unit-descriptor.txt:2` range the core candidate cites. Same changed line, same
supporting evidence — the candidate adds nothing, so it is **withdrawn** and recorded as one
`Withdrawn` line naming the lens finding that covers it. The defect is reported **once**. In
run A the same candidate rendered as a finding; that difference is the measure.

### Case R — retained and cross-referenced (one defect, two perspectives)

EXPECT: case=retain-both
EXPECT: candidate=DEFECT-2
EXPECT: changed-side=changed/batch-summary.txt:1
EXPECT: existing-side=existing/batch-source.txt:3

A lens reports the same `changed/batch-summary.txt:1` derivation, but rests it on different
evidence than the core candidate's `existing/batch-source.txt:3` empty-member-list emitter.
Same real defect seen through two lenses. **Both render**, each keeping its own distinct
provenance and naming the other, so the overlap is **visible** — neither silently collapsed
into one nor silently doubled into two unrelated-looking findings.

### Case N — no overlap

EXPECT: case=no-overlap

A candidate no lens cites at its changed-side `file:line` renders unchanged, exactly as in
run A. Registration adds contributors; it never costs core a finding.

---

## Not gated, and the chain is held harmless

EXPECT: gating=none
EXPECT: verify-block=unchanged

Reconciliation is reporting only. It changes no requirement verdict, no `**Verdict:**` line,
and no `VERIFY —` final-output block — that grepped shape stays byte-identical. It introduces
no stop, prompt, or gate that the single-task chain did not already have, and it adds no
dispatch: it compares two sets already in hand.
