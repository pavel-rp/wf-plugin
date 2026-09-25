# Gate map — verify-spec

**Layer:** the spec-conformance audit's report verdict
**Grammar source:** `../../verify-spec/references/verify-template.md` · block `# verify-spec:` · anchor `**Verdict:**`
**Labels:** declared
**Model:** claude-opus-5-5

| Label | Eligibility | Basis |
|---|---|---|
| PASS | advisory | `verify-spec/SKILL.md` §"Verdicts" — evidence matches; `run/SKILL.md` Phase 3 routes `PASS` straight to `qa-gen`, holding nothing |
| FAIL | may-block | `run/SKILL.md` Phase 3 routes `FAIL` into the `verify-fix` loop and its stop gate |
| PARTIAL | may-block | `run/SKILL.md` Phase 3 routes `PARTIAL` into the `verify-fix` loop exactly as `FAIL` |

The verdict is computed from the blocking set, which is where lens severities and the critic's
confirmations meet. Lens severities are the contributing capabilities' own labels and are mapped in
their own maps; the critic's verdicts are mapped in `critic.gate-map.md`.
