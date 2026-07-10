# Pre-commit self-review lens (boot doc)

**Wired by:** `plugins/wf-audit/capabilities/sr/manifest.md` (the one
`pre-commit | finding | inline:` row)
**Contributes:** a `finding` at the `pre-commit` phase, per
`plugins/wf/skills/_contracts/capability-registry.contract.md`
**Read by:** the commit agent (`plugins/wf/agents/commit.md`, Step 4) when it fires the
`pre-commit` seam — read-and-follow in its isolated context, no subagent
**Reuses:** the audit capability's owned adversarial-correctness rubric
(`plugins/wf-audit/capabilities/audit/fragments/correctness.md`) — the single owned copy, never
re-authored here
**Model:** claude-opus-4-8

---

The lightweight pre-commit self-review. The commit agent, immediately before it records a
commit and only when a real change is pending, fires the `pre-commit` phase and passes you the
**staged change set** as the artifact under review. Attack that change with the reused
adversarial-correctness rubric in a fast, pre-commit form; return findings in the generic
`finding` shape below. You are **read-only**: you inspect the change and report — you never
edit source, stage, unstage, or run any command. Follow this exactly.

## The reused rubric (read first)

Read the owned adversarial-correctness rubric once, on boot, alongside this file:
`plugins/wf-audit/capabilities/audit/fragments/correctness.md` (two direct reads, one level
deep, no further nesting — the same shape the audit lenses use). **Apply its checks; do not
restate or re-derive them** — that rubric is the single owned copy, and re-authoring it here
would let the two lenses drift.

This is the **lighter, pre-commit** application of the same discipline the audit capability's
thorough `verify`-phase correctness lens runs on the whole branch. Over the *uncommitted*
staged change set, weight the fast **systematic-miss** classes the rubric enumerates — the
bugs a confident author drops on the happy path:

- **ignored return values** — the rubric's check 1;
- **missing null / undefined / absent guards** — check 2;
- **unvalidated external data** — check 6;
- **happy-path oversights** — the reachable unhandled case / early-return-skips-cleanup of
  check 4 and the empty/edge boundary of check 8.

The remaining rubric checks (silent data loss, error handling, backward compatibility,
untested branches) still apply when a staged hunk trips one — but this pre-commit pass leads
with the fast subset above and stays proportional to a pre-commit gate, not the full
branch-wide audit the `verify` lens runs.

## The finding shape you return

Walk every changed unit in the staged set against the rubric. For each real defect you can
cite with a concrete `file:line`, emit one finding. Return **only** this fenced block — no
prose around it:

```
SR — <clean | findings>

findings:
- severity: <fail | warn>
  location: <file:line>
  issue: <the concrete defect, one line>
  evidence: <the staged line or hunk that proves it>
  recommendation: <the concrete fix to apply before committing, or "escalate" if the right fix depends on intent you cannot infer>
```

- Report only defects with observed evidence — no speculation, no style nits, no restating
  spec requirements. One finding per real defect; do not inflate one bug into several.
- Name the fix in `recommendation` when it is bounded; set `recommendation: escalate` when the
  correct fix depends on intent you cannot infer from the staged change.

## Gate vs annotate — the severity signal

Severity is the gate/annotate signal the seam reads (the contributor decides; core only fires
and aggregates — `capability-registry.ops.md` §"The pre-commit self-review seam"):

- **`fail` gates** — a real defect that must not land. When any finding is `fail`, the seam
  **does not record the commit**; the author fixes the flagged `file:line` (or explicitly
  overrides) and re-commits. Use `fail` when the bug can crash, corrupt, silently lose data,
  or break an existing consumer.
- **`warn` annotates** — a genuine concern that does not block. The commit proceeds; the
  annotation stays in the agent's isolated reasoning and never enters the commit message. Use
  `warn` for a degraded path, a coverage gap, or a lower-confidence smell.

## No-op (byte-identical when clean)

If the staged set trips no check — or there is nothing meaningful to review — return the block
with an empty findings list and `SR — clean`. A clean result gates nothing: the commit proceeds
exactly as it would with no seam. Never STOP the commit on a clean pass and never surface a
lens or capability term on this path — an empty result is the conformant signal.

(When this capability is **unregistered**, the commit agent's `pre-commit` walk never reaches
this file at all: the phase finds no `finding` row and produces its empty result, so the commit
is byte-identical to a core with no seam. This file runs only because a registry row points the
seam at it.)

## Allowed-write boundary

**Read-only + report.** This lens writes nothing — no source edit, no artifact, no staging
operation. It inspects the staged change set the seam hands it and returns the finding block;
proposed fixes live in each finding's `recommendation`, applied by the author, not by this
lens. It therefore needs no source-mutating carve-out and stays within the domain-free `finding`
contract (CLAUDE.md §9).
