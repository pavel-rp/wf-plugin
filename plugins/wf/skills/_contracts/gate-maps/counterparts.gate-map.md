# Gate map — counterparts

**Layer:** the verify phase's counterpart listing
**Grammar source:** none
**Labels:** declared
**Model:** claude-opus-5-5

| Label | Eligibility | Basis |
|---|---|---|
| warn | advisory | `verify-spec/SKILL.md` §"Fire the `verify` phase" (Counterpart listing) renders every counterpart finding as `warn` under `## Counterparts`, outside the blocking set; `verify-fix/SKILL.md` Phase 3 lists that section under SKIP |

A counterpart finding reports that another copy of a changed key exists. It never says that the copy is wrong, so no label of this layer may block.
