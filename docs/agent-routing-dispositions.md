# Production-agent routing dispositions

This matrix is the auditable routing disposition for every production agent in the four bounded agent roots. It documents policy; `plugins/wf/mcp/src/resolver/routing.ts` remains the runtime source of shipped defaults.

Disposition meanings:

- `shipped-static` — the resolver supplies the listed model when no higher-precedence choice wins.
- `adaptive` — the role must adapt to the work; no static model or effort is introduced here.
- `evidence-gated` — quality or side-effect sensitivity requires role-specific comparison evidence before a static default may ship.
- `deferred` — the named owner decides the routing change; no static default is introduced here.

For every row, host enforcement, invocation override, project override, shipped default, and inheritance retain WF-394 precedence. `inherit` means the selector remains unset at this layer.

## Complete production matrix

| Role | Agent path | Surface | Disposition | Model | Effort | Attempt limit | Evidence or owner |
|---|---|---|---|---|---|---|---|
| `branch` | `plugins/wf/agents/branch.md` | core | `shipped-static` | `haiku` | `inherit` | `2` | WF-394 bounded the deterministic branch gate to Haiku and pinned its routing contract. |
| `charter-decomposer` | `plugins/wf/agents/charter-decomposer.md` | core | `adaptive` | `inherit` | `inherit` | `2` | Multi-step structural decomposition varies with charter scope. |
| `charter-reviewer` | `plugins/wf/agents/charter-reviewer.md` | core | `evidence-gated` | `inherit` | `inherit` | `2` | Fresh-eyes quality review requires role-specific comparison evidence. |
| `charter-writer` | `plugins/wf/agents/charter-writer.md` | core | `adaptive` | `inherit` | `inherit` | `2` | Charter synthesis varies with ambiguity and product scope. |
| `classify` | `plugins/wf/agents/classify.md` | core | `shipped-static` | `haiku` | `inherit` | `2` | WF-394 bounded the seven-bucket rubric to Haiku and pinned its routing contract. |
| `commit` | `plugins/wf/agents/commit.md` | core | `evidence-gated` | `inherit` | `inherit` | `2` | Delivery-writing output requires role-specific comparison evidence. |
| `context-distiller` | `plugins/wf/agents/context-distiller.md` | core | `adaptive` | `inherit` | `inherit` | `2` | Bulk CI and review inputs vary materially in size and complexity. |
| `index` | `plugins/wf/agents/index.md` | core | `deferred` | `inherit` | `inherit` | `2` | WF-379 owns removal/inlining disposition. |
| `phase-runner` | `plugins/wf/agents/phase-runner.md` | core | `adaptive` | `inherit` | `inherit` | `2` | The delegated phase determines reasoning depth and tool use. |
| `pr` | `plugins/wf/agents/pr.md` | core | `evidence-gated` | `inherit` | `inherit` | `2` | Delivery-writing synthesis requires role-specific comparison evidence. |
| `audit-retrospective` | `plugins/wf-audit/agents/audit-retrospective.md` | audit | `evidence-gated` | `inherit` | `inherit` | `2` | Composite verification quality requires role-specific comparison evidence. |
| `consistency-auditor` | `plugins/wf-audit/agents/consistency-auditor.md` | audit | `deferred` | `inherit` | `inherit` | `2` | WF-380/WF-381 own audit consolidation and verification fan-out. |
| `convention-auditor` | `plugins/wf-audit/agents/convention-auditor.md` | audit | `deferred` | `inherit` | `inherit` | `2` | WF-380/WF-381 own audit consolidation and verification fan-out. |
| `correctness-auditor` | `plugins/wf-audit/agents/correctness-auditor.md` | audit | `deferred` | `inherit` | `inherit` | `2` | WF-380/WF-381 own audit consolidation and verification fan-out. |
| `operational-auditor` | `plugins/wf-audit/agents/operational-auditor.md` | audit | `deferred` | `inherit` | `inherit` | `2` | WF-380/WF-381 own audit consolidation and verification fan-out. |
| `security-auditor` | `plugins/wf-audit/agents/security-auditor.md` | audit | `deferred` | `inherit` | `inherit` | `3` | A third attempt is permitted only for `high-severity-review-uncertainty`; every other signal exhausts after two attempts. |
| `qa-engine` | `plugins/wf-browser-qa/agents/qa-engine.md` | browser-QA | `evidence-gated` | `inherit` | `inherit` | `2` | Browser execution quality requires role-specific comparison evidence. |
| `qa-host` | `plugins/wf-angular/agents/qa-host.md` | Angular | `evidence-gated` | `inherit` | `inherit` | `2` | Source-mutating test-host work requires role-specific comparison evidence. |

The two `shipped-static` rows are the complete static-default set. No role starts on static Opus, no Sonnet default is claimed without qualifying evidence, and all effort choices inherit. Adaptive, evidence-gated, and deferred rows add no hidden model or effort default.
