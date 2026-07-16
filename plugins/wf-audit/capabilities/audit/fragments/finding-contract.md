# Audit lens — shared finding contract (boot doc)

**Wired by:** `plugins/wf-audit/capabilities/audit/manifest.md` (the five
`verify | finding | subagent:` rows)
**Contributes:** a `finding` at the `verify` phase, per
`plugins/wf/skills/_contracts/capability-registry.contract.md`
**Read by:** every audit auditor on boot, alongside its own lens rubric
**Model:** claude-opus-4-8

---

The single contract every audit lens shares — it fixes the profile lens-gate, the finding
shape, and the no-op, so a core skill firing `verify` aggregates all lenses uniformly. Each
auditor reads this file **and** its one lens rubric on boot — two direct reads, one level
deep, no further nesting. Follow it exactly.

## Profile lens-gate (run first)

Obtain the resolved audit profile by calling the bundled `wf-resolver` MCP tool
`resolve_profile("audit")` — it returns `{ capability, present, values }`, the
override-merged profile **values** directly (`_local/profiles/audit.profile.json` override
merged over the capability's shipped default, precedence: **override > capability
default**); you perform no direct profile-file read of your own. If `present` is `true`
**and** `values.lenses` does **not** contain your own lens id, emit the empty findings block
(see No-op) and stop — do no audit work. If `present` is `false`, or your lens id is listed,
proceed. (No override present = the shipped default: all lenses enabled.) If the
`wf-resolver` service is unavailable, stop and report that the resolver runtime is not
loaded (restart Claude Code) — do not hand-read the profile file as a fallback (WF-272
diagnostics/recovery).

## The finding shape you return

Walk the work under review against every check in your lens rubric. For each real issue,
emit one finding. Return **only** this fenced block — no prose around it:

```
AUDIT-<LENS> — <clean | findings>

lens: <lens>
findings:
- severity: <fail | warn>
  location: <file:line, or unit identifier>
  issue: <the concrete defect, one line>
  evidence: <what you observed that proves it — a quoted line or grep result>
  recommendation: <the concrete change that resolves it, or "escalate" if not bounded>
```

Severity: `fail` = a real defect that must not ship (it drives the verdict to FAIL, like a
failed requirement); `warn` = a genuine concern that does not block. Only report issues you
can cite with concrete evidence — no speculation, no style nits, no restating requirements
the generic audit already covers.

## No-op

If every check passes (or the lens is gated off), return the block with an empty findings
list and `AUDIT-<LENS> — clean`. An empty result is the conformant / not-applicable signal;
never STOP the verdict and never surface a lens/capability term on this path. The core
proceeds either way — this lens contributes findings, it does not halt the workflow.
