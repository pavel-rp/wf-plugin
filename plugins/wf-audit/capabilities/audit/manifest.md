# Audit capability manifest

**Version:** 1.1.0
**Conforms to:** `plugins/wf/skills/_contracts/capability-registry.contract.md` (manifest schema v2)
**Executed by:** `plugins/wf/skills/_contracts/invocation-runtime.contract.md`
**Capability:** audit (registered in the downstream `_local/config.md` `## Capabilities` table)
**Kind:** adapter (attaches phase fragments via the registry; ships no skills of its own)
**Model:** claude-opus-4-8

---

The audit capability contributes **five adversarial `finding` lenses** at the `verify` phase
(correctness, security, convention, consistency, operational). Registered → the five lenses'
findings aggregate, provenance-tagged; unregistered → the phase finds no rows and produces the
byte-identical no-op. It also ships **one optional, on-request** composite retrospective /
umbrella-verification report (not a phase fragment — see references), gated by the same registry
membership.

## Fragments

Schema `phase | contribution-kind | dispatch | scope`. `subagent:` dispatch names a registered
subagent invoked via the Task tool. `scope` is empty (`—`) for aggregate kinds; `finding`
aggregates **with provenance**, so every row carries no ownership scope token.

| phase  | contribution-kind | dispatch                              | scope |
|--------|-------------------|---------------------------------------|-------|
| verify | finding           | `subagent: wf-audit:correctness-auditor` | —     |
| verify | finding           | `subagent: wf-audit:security-auditor`    | —     |
| verify | finding           | `subagent: wf-audit:convention-auditor`  | —     |
| verify | finding           | `subagent: wf-audit:consistency-auditor` | —     |
| verify | finding           | `subagent: wf-audit:operational-auditor` | —     |

A core skill firing `verify` resolves this capability's profile once, skips excluded lens rows before
Task dispatch, and passes the generic finding contract inline to every enabled row. Each auditor is
read-only, resolves only its own rubric, and returns only its final block. The shared contract reference
is `fragments/finding-contract.md`; it is not fetched at runtime. No auditor is spawned by name from
core — each is reached only through these registry rows.

## Profile seed template

profile-template: profile.template.json

Per-lens descriptions, the profile-subset mechanism, the composite retrospective report, and the
dependency rationale: [`references/onboarding.md`](references/onboarding.md) — read by `init` and
authors, never at phase-fire.
