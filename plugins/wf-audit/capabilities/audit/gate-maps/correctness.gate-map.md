# Gate map — correctness lens

**Layer:** the correctness audit lens's findings at the verify phase
**Grammar source:** `../fragments/finding-contract.md` · block `AUDIT-<LENS> —` · anchor `- severity:`
**Labels:** declared
**Model:** claude-opus-5-5

| Label | Eligibility | Basis |
|---|---|---|
| fail | may-block | `fragments/finding-contract.md` §"Finding shape" — "`fail` is a candidate for the core-computed blocking set, not an unconditional gate" |
| warn | advisory | `fragments/finding-contract.md` §"Finding shape" — "`warn` is non-blocking" |
