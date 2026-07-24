# Audit lens — finding contract reference

**Wired by:** `plugins/wf/skills/verify-spec/SKILL.md` (caller-side dispatch)
**Contributes:** the generic finding shape used by the audit capability's five `verify | finding | subagent:` rows
**Read by:** authors only; auditor agents receive the contract inline and never fetch this file
**Model:** gpt-5.6-sol

---

This reference records the shared semantics every audit lens keeps. The verify caller owns the runtime copy: it applies the optional profile gate before Task dispatch and includes the complete contract in every enabled agent's prompt. Consequently a gated-off lens has no agent boot, and an enabled lens performs no resolver fetch for this file. The same contract bytes still enter each enabled lens context; this is a round-trip optimization, not payload reduction.

## Caller-side profile lens gate

The verify caller resolves the source capability profile once. When its values expose a `lenses` array, the caller derives the contributor id from the dispatch target's final slug (removing one trailing `-auditor`) and skips the row before routing or Task invocation when the id is absent. A missing profile or missing `lenses` key leaves the contributor enabled.

Auditor agents never repeat this gate. Reaching an auditor is proof that the caller enabled it.

## Finding shape

For each real issue, emit one finding and return only this block:

```
AUDIT-<LENS> — <clean | findings>

lens: <lens>
findings:
- severity: <fail | warn>
  location: <file:line, or unit identifier>
  issue: <the concrete defect, one line>
  evidence: <what proves it — a quoted line or grep result>
  recommendation: <the concrete bounded change, or "escalate">
```

`fail` is a real defect that blocks shipment. `warn` is a genuine non-blocking concern. Findings require concrete evidence; never report speculation, style nits, or requirements already covered by the generic audit.

## Clean result

If every rubric check passes, return the block with an empty `findings:` list and `AUDIT-<LENS> — clean`. The core proceeds either way: a lens contributes findings and never halts the workflow itself.
