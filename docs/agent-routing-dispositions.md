# Production-agent routing dispositions

This matrix is the auditable routing disposition for every production agent in the four bounded agent roots. It documents policy; `plugins/wf/mcp/src/resolver/routing.ts` remains the runtime source of shipped defaults.

Disposition meanings:

- `shipped-static` — the resolver supplies the listed model when no higher-precedence choice wins.
- `adaptive` — the role must adapt to the work; no static model or effort is introduced here.
- `evidence-gated` — quality or side-effect sensitivity requires role-specific comparison evidence before a static default may ship.
- `deferred` — the named owner decides the routing change; no static default is introduced here.

For every row, host enforcement, invocation override, project override, shipped default, and inheritance retain WF-394 precedence. `inherit` means the selector remains unset at this layer.

WF-399 completed fixed core-owned adoption; WF-400 completes live capability adoption for registry-selected verify findings, QA engine/host providers, retrospective bulk distillation, and pack-owned index updates. The two authoritative inventories and guards are `plugins/wf/skills/_contracts/core-dispatch-inventory.tsv` / `core-dispatch-routing-guard.sh` and `capability-dispatch-inventory.tsv` / `capability-dispatch-routing-guard.sh`. Pack-owned index work reaches the already-routed `/wf:index` wrapper; the optional retrospective's own on-request entrypoint remains caller-owned because the repository has no executable caller. Adoption changes no disposition, default, effort, attempt limit, artifact attribution, or role outcome.

## Complete production matrix

| Role | Agent path | Surface | Disposition | Model | Effort | Attempt limit | Evidence or owner |
|---|---|---|---|---|---|---|---|
| `branch` | `plugins/wf/agents/branch.md` | core | `shipped-static` | `haiku` | `inherit` | `2` | WF-394 bounded the deterministic branch gate to Haiku and pinned its routing contract. |
| `charter-decomposer` | `plugins/wf/agents/charter-decomposer.md` | core | `adaptive` | `inherit` | `inherit` | `2` | Multi-step structural decomposition varies with charter scope. |
| `charter-reviewer` | `plugins/wf/agents/charter-reviewer.md` | core | `evidence-gated` | `inherit` | `inherit` | `2` | [CAL-charter-reviewer](agent-routing-calibration.md#cal-charter-reviewer) retains inheritance pending matched contract-scored comparisons. |
| `charter-writer` | `plugins/wf/agents/charter-writer.md` | core | `adaptive` | `inherit` | `inherit` | `2` | Charter synthesis varies with ambiguity and product scope. |
| `classify` | `plugins/wf/agents/classify.md` | core | `shipped-static` | `haiku` | `inherit` | `2` | WF-394 bounded the seven-bucket rubric to Haiku and pinned its routing contract. |
| `commit` | `plugins/wf/agents/commit.md` | core | `evidence-gated` | `inherit` | `inherit` | `2` | [CAL-commit](agent-routing-calibration.md#cal-commit) retains inheritance pending delivery-contract comparisons. |
| `context-distiller` | `plugins/wf/agents/context-distiller.md` | core | `adaptive` | `inherit` | `inherit` | `2` | Bulk CI and review inputs vary materially in size and complexity. |
| `phase-runner` | `plugins/wf/agents/phase-runner.md` | core | `adaptive` | `inherit` | `inherit` | `2` | The delegated phase determines reasoning depth and tool use. |
| `pr` | `plugins/wf/agents/pr.md` | core | `evidence-gated` | `inherit` | `inherit` | `2` | [CAL-pr](agent-routing-calibration.md#cal-pr) retains inheritance pending synthesis and terminal-contract comparisons. |
| `audit-retrospective` | `plugins/wf-audit/agents/audit-retrospective.md` | audit | `evidence-gated` | `inherit` | `inherit` | `2` | [CAL-audit-retrospective](agent-routing-calibration.md#cal-audit-retrospective) retains inheritance pending finding-quality comparisons. |
| `consistency-auditor` | `plugins/wf-audit/agents/consistency-auditor.md` | audit | `deferred` | `inherit` | `inherit` | `2` | [CAL-consistency-auditor](agent-routing-calibration.md#cal-consistency-auditor) defers to WF-380/WF-381 ownership. |
| `convention-auditor` | `plugins/wf-audit/agents/convention-auditor.md` | audit | `deferred` | `inherit` | `inherit` | `2` | [CAL-convention-auditor](agent-routing-calibration.md#cal-convention-auditor) defers to WF-380/WF-381 ownership. |
| `correctness-auditor` | `plugins/wf-audit/agents/correctness-auditor.md` | audit | `deferred` | `inherit` | `inherit` | `2` | [CAL-correctness-auditor](agent-routing-calibration.md#cal-correctness-auditor) defers to WF-380/WF-381 ownership. |
| `operational-auditor` | `plugins/wf-audit/agents/operational-auditor.md` | audit | `deferred` | `inherit` | `inherit` | `2` | [CAL-operational-auditor](agent-routing-calibration.md#cal-operational-auditor) defers to WF-380/WF-381 ownership. |
| `security-auditor` | `plugins/wf-audit/agents/security-auditor.md` | audit | `deferred` | `inherit` | `inherit` | `3` | [CAL-security-auditor](agent-routing-calibration.md#cal-security-auditor) preserves bounded escalation and defers to WF-380/WF-381 ownership. |
| `qa-engine` | `plugins/wf-browser-qa/agents/qa-engine.md` | browser-QA | `evidence-gated` | `inherit` | `inherit` | `2` | [CAL-qa-engine](agent-routing-calibration.md#cal-qa-engine) retains inheritance pending matched browser-scenario evidence. |
| `qa-host` | `plugins/wf-angular/agents/qa-host.md` | Angular | `evidence-gated` | `inherit` | `inherit` | `2` | [CAL-qa-host](agent-routing-calibration.md#cal-qa-host) retains inheritance pending source-validity comparisons. |

The two `shipped-static` rows are the complete static-default set. No role starts on static Opus, no Sonnet default is claimed without qualifying evidence, and all effort choices inherit. Adaptive, evidence-gated, and deferred rows add no hidden model or effort default.

## Inlined roles (no agent)

- `index` — WF-379 removed the `index` agent and inlined the single-row `index.md` write into the caller's own context. The `/wf:index` wrapper routes `inline` with both selectors unset — the role stays a map-key-only in `routing.ts` (no shipped static default, disposition equivalent to `adaptive`). It backs no production agent, so it holds no row in the agent matrix above; core and capability call sites reach it through the routed wrapper, never a dispatched subagent.
