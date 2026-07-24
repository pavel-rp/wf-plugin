# wf-audit — the audit + self-review pack

A standalone marketplace plugin that ships the **`audit`** and **`sr`** capabilities
together, co-located because `sr` reaches audit's owned adversarial-correctness rubric by a
hardcoded intra-plugin path. Both are `adapter`-kind capabilities — they attach phase
fragments via the registry and ship no skills of their own (only `/wf-audit:init` for
self-registration).

## What ships

| Item | What it is |
|---|---|
| `capabilities/audit/manifest.md` | the `audit` capability's manifest — five `verify \| finding` rows + the composite-retrospective dispatch |
| `capabilities/audit/profile.template.json` | the audit lens-subset profile seed template (all five lenses enabled by default) |
| `capabilities/audit/fragments/{consistency,convention,correctness,finding-contract,operational,retrospective,security}.md` | the seven audit fragments — five lens rubrics, the shared finding contract, and the composite-retrospective procedure |
| `capabilities/sr/manifest.md` | the `sr` capability's manifest — one `pre-commit \| finding` row + the `precommit-self-review = required` constitution article |
| `capabilities/sr/fragments/self-review.md` | the pre-commit self-review lens, reusing `capabilities/audit/fragments/correctness.md` intra-plugin |
| `agents/{consistency,convention,correctness,operational,security}-auditor.md` | the five read-only auditor subagents dispatched at `verify` |
| `agents/audit-retrospective.md` | the optional, on-request composite retrospective / umbrella-verification subagent |
| `/wf-audit:init` | one-command self-registration — records this pack's install root and registers **both** capabilities in one command |

## Capabilities

| Capability | Kind | Path | Attaches | Provides |
|---|---|---|---|---|
| audit | adapter | `plugins/wf-audit/capabilities/audit` | `verify` findings — five adversarial lenses (correctness, security, convention, consistency, operational) | phase fragments + five read-only auditor agents (`wf-audit:correctness-auditor`, `-security-`, `-convention-`, `-consistency-`, `-operational-auditor`). Dependency-free — no `requires:`, so it composes in bare-core too. A profile `lenses` knob selects the subset that runs. Also ships one optional, on-request composite retrospective / umbrella-verification report (`wf-audit:audit-retrospective`), gated by the same registry membership — it composes the `verify` report + distilled PR/CI evidence via the delivery provider, degrading to a local-only spec-conformance + lens-findings retrospective when none is registered |
| sr | adapter | `plugins/wf-audit/capabilities/sr` | `pre-commit` finding — one lightweight adversarial self-review lens on the staged change | one inline `finding` fragment (no skill, no agent). Fills the WF-154 `pre-commit` commit-path seam: the commit agent fires it immediately before recording a commit, and the lens flags systematic-miss bugs (ignored returns, missing null guards, unvalidated data, happy-path oversights) with a concrete `file:line`, gating (`fail`) or annotating (`warn`). **Reuses** the audit capability's owned correctness rubric — single-sourced, never re-authored, resolved via a co-located intra-plugin path — as its lighter pre-commit counterpart. Read-only (writes nothing; proposes fixes in-finding). Dependency-free — no `requires:`, so it composes in bare-core too; unregistered → the seam no-ops and the commit is byte-identical |

## Registering wf-audit downstream

**One command (recommended): `/wf-audit:init`.** After `/wf:init` has bootstrapped the
repo, run `/wf-audit:init` — it records this pack's install root in a gitignored
`## Plugin Roots` mapping and registers **both** `audit` and `sr` as **plugin-anchored**
rows (`plugin:wf-audit/capabilities/audit`, `plugin:wf-audit/capabilities/sr`), then seeds
the audit profile override on divergence (sr ships no template — no-op). Core then resolves
the five `verify` lenses and the `pre-commit` seam through that mapping — no vendored
`plugins/wf-audit/...` needed in the consuming repo. Re-run after a pack upgrade to refresh
the install root; it is idempotent.

**Manual (escape hatch):** when the pack **is** vendored in the consuming repo, add
repo-relative rows to the project's `_local/config.md` `## Capabilities` table by hand
(forward slashes):

```markdown
## Capabilities

| Capability | Path                                |
|------------|--------------------------------------|
| audit      | plugins/wf-audit/capabilities/audit |
| sr         | plugins/wf-audit/capabilities/sr    |
```

With `audit` registered, a core skill firing `verify` (today, `verify-spec`) dispatches the
five lenses and aggregates their findings; unregistered, the phase finds no rows and
produces nothing. With `sr` registered, the commit agent's `pre-commit` seam dispatches the
self-review lens before every commit; unregistered, the commit proceeds byte-identically to
a core with no seam.

## Prerequisites

Neither `audit` nor `sr` declares `requires:` — both are pure read-only reasoning that
reaches no `delivery` or `tracker` provider (`audit`'s five lenses over the branch at
`verify`; `sr`'s one lightweight lens over the staged change at `pre-commit`; the optional
composite retrospective's PR/CI fold-in degrades to a local-only result with no provider
registered rather than requiring one). Both compose in **bare-core** mode (no provider
registered at all).

## How it composes

Capability behaviour (phase fragments) attaches to `wf` core's SDD phases through the
**capability registry** — core iterates the registry, reads each capability's `manifest.md`,
and injects its fragments (or dispatches its subagents) at runtime. This pack ships no
discoverable `/command` beyond `/wf-audit:init` — the five lenses and the retrospective are
reached only through registry rows, never spawned by name from core.
