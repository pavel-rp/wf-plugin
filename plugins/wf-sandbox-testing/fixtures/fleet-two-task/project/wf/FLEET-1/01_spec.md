# FLEET-1 — Fleet two-task umbrella

**Type:** feat
**Complexity:** M
**Model:** claude-opus-4-8

---

## Objective

The hermetic umbrella for the accepted fleet-two-task measurement fixture. It fans out to
**exactly two** independent synthetic runtime children — FLEET-2 and FLEET-3 — each driven by
its own ship orchestrator through the full ceremony (triage → spec → plan → tasks → implement
→ verify → qa → pr → finalize). The umbrella ships no product source; it exists only to define
a deterministic two-child fleet run whose per-message/tool accounting is captured for measurement.

## Success Criteria

- [ ] The run carries exactly two children (FLEET-2, FLEET-3), each independent.
- [ ] Each child is driven by its own ship orchestrator across the full ceremony.
- [ ] The run exercises the full role inventory (see `../../roles.json`), including all five
      audit lenses and a deterministic verify-fix + recheck per child.
