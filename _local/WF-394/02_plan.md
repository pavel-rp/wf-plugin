# WF-394 — Establish configurable cheap routing for bootstrap roles

**Type:** feat
**Alternative:** —
**Complexity:** L
**Depends on:** —
**Created:** 2026-07-21 14:30
**Model:** gpt-5.6-sol[1m]
**Spec:** 01_spec.md

> This is an L-complexity item. Consider breaking it into sub-tasks before executing.

---

## Description

Introduce a typed, observable routing contract for child dispatches, including safe cheap defaults for `classify` and `branch`, project and invocation overrides, host masking, validation, and explicit runtime-limit fallbacks. Apply the contract at every current bootstrap-role call site without changing either role's behavior or terminal block, then preflight and complete the WF-376 tracker promotion atomically.

---

## Approach

Add routing as a body-free typed resolver surface backed by a pure decision function. Parse the new role-keyed `## Routing` table into the cached resolver snapshot, resolve model and effort independently under host → invocation → project → shipped-default → inheritance precedence, and return a compact record with provenance, masking, fallback, attempt, escalation, and actual-model observability. Callers resolve that record immediately before spawning `classify` or `branch`, pass only runtime-supported selectors to the Task/Agent invocation, and preserve inherited effort when the current host cannot honor a per-invocation effort selector. Regression tests will drive both the pure precedence matrix and the MCP projection, including unsupported runtimes and required-override stops.

The tracker write is a separate, implementation-time operation: first read WF-376, WF-372, WF-373, and every WF-394–WF-400 child and validate the complete intended graph and description edits; only after that preflight succeeds, promote WF-376, replace its obsolete pre-charter wording with the C025 umbrella text, and materialize the dependency edges declared by the child briefs without leaving a partial restructure.

---

## Relevant Files

**Must change:**
- `plugins/wf/mcp/src/resolver/routing.ts` — define and resolve the typed routing decision and diagnostics.
- `plugins/wf/mcp/src/resolver/config.ts` — parse the role-keyed project routing table without constraining role names.
- `plugins/wf/mcp/src/resolver/types.ts` — carry routing configuration and decision metadata in typed resolver records.
- `plugins/wf/mcp/src/service.ts` — expose routing resolution from the cached snapshot.
- `plugins/wf/mcp/src/tools.ts` — register the typed `resolve_routing` MCP query and its request schema.
- `plugins/wf/mcp/test/routing.test.ts` — cover precedence, defaults, masking, independent effort, invalid values, unknown roles, unavailable selectors, and required stops.
- `plugins/wf/skills/init/references/config-template.md` — add the declarative `## Routing` role table and explain optional model/effort cells.
- `plugins/wf/skills/_shared/pipeline-conventions.md` — route shared `branch` gates before Task dispatch.
- `plugins/wf/skills/spec/SKILL.md` — route its direct classifier and bootstrap branch dispatches.
- `plugins/wf/skills/plan/SKILL.md` — route its direct classifier and bootstrap branch dispatches.
- `plugins/wf/skills/lite/SKILL.md` — route its direct classifier and bootstrap branch dispatches.
- `plugins/wf/skills/classify/SKILL.md` — route user-invoked classifier delegation.
- `plugins/wf/skills/branch/SKILL.md` — route user-invoked branch delegation.
- `plugins/wf/agents/commit.md` — route its direct nested branch gate.
- `plugins/wf/README.md` — document the routing configuration and resolver query.
- `plugins/wf/mcp/dist/server.mjs` — commit the rebuilt self-contained resolver bundle.
- `plugins/wf/.claude-plugin/plugin.json` — apply the core MINOR version bump.
- `.claude-plugin/marketplace.json` — keep the wf entry synchronized and bump the marketplace version.

**May change:**
- `plugins/wf/mcp/src/resolver/resolve.ts` — include parsed routing rows in snapshot construction if the config parser cannot do so without an explicit projection.
- `plugins/wf/mcp/test/parsers.test.ts` — add focused markdown-table parser cases alongside the routing matrix.
- `plugins/wf/mcp/test/service.test.ts` — assert the new query reuses one fingerprint-fresh snapshot and leaks no bodies.
- Other core skill or agent prose found by the final dispatch search — update only when it directly spawns `wf:classify` or `wf:branch` outside the shared convention.

**Read-only context:**
- `plugins/wf/mcp/src/resolver/settings.ts` — precedent for typed defaults, project overrides, and loud validation.
- `plugins/wf/mcp/test/settings.test.ts` — precedent for resolver override tests.
- `plugins/wf/agents/classify.md` — classifier behavior and exact terminal-block contract to preserve.
- `plugins/wf/agents/branch.md` — branch behavior, provider access, and exact terminal-block contract to preserve.
- `plugins/wf/skills/fleet/SKILL.md` — existing per-shipper model selection and runtime precedence context.

---

## Progress

- [x] STEP-001: Read affected files and confirm approach
- [x] STEP-002: Build and test the routing decision substrate
- [x] STEP-003: Expose routing through the resolver MCP runtime
- [x] STEP-004: Route shared and classifier bootstrap dispatches
- [ ] STEP-005: Finish bootstrap integration, release metadata, and tracker promotion
- [ ] STEP-006: Run build/typecheck — confirm no regressions
- [ ] STEP-007: Ready for review — suggested commit message `feat(WF-394): establish configurable cheap routing for bootstrap roles`

---

## Execution Plan

### - [x] STEP-001: Read affected files and confirm approach

**Goal:** Verify the planned approach is sound. Check that no recent changes conflict with the plan and that the identified files are still the right targets.

**Files to read:**
- `plugins/wf/mcp/src/resolver/config.ts`
- `plugins/wf/mcp/src/resolver/types.ts`
- `plugins/wf/mcp/src/resolver/settings.ts`
- `plugins/wf/mcp/src/service.ts`
- `plugins/wf/mcp/src/tools.ts`
- `plugins/wf/skills/init/references/config-template.md`
- `plugins/wf/skills/_shared/pipeline-conventions.md`
- `plugins/wf/agents/classify.md`
- `plugins/wf/agents/branch.md`
- Every current `wf:classify` and `wf:branch` Task/Agent call site found by repository search

Confirm from the live Claude Code subagent contract that per-invocation model selection is supported, effort is definition/session-scoped unless the runtime exposes an invocation selector, `CLAUDE_CODE_SUBAGENT_MODEL` or equivalent host enforcement outranks lower choices, and actual runtime model is reported only when observable. Do not claim an override was honored when the runtime cannot honor or reveal it.

**Depends on:** —

---

### - [x] STEP-002: Build and test the routing decision substrate

**Goal:** Add a pure, domain-free routing resolver that parses project rows and produces the complete observable decision before any child is spawned.

**Changes:**

- Define the decision fields `role`, `executionShape`, `model`, `effort`, `source`, `basis`, `attempt`, `escalationOrigin`, `fallback`, `masked`, and optional `actualModel`, keeping model and effort provenance independent inside the record.
- Ship `haiku` model defaults for `classify` and `branch` only; leave effort inherited and unknown roles safely inherited.
- Parse a role-keyed routing table with independently optional model and effort cells, accepting arbitrary valid role names rather than only shipped-default roles.
- Resolve host enforcement over invocation over project over shipped default over inheritance, validate aliases/full identifiers against supplied runtime support, and distinguish malformed, unavailable, unsupported, and required-but-unhonorable choices without silently substituting another tier.
- Cover the full precedence and negative-path matrix, including masking, absent rows, unknown roles, independent effort inheritance, runtimes without selectors, and actual-model omission when unavailable.

**Files:**
| File | Action |
|------|--------|
| `plugins/wf/mcp/src/resolver/routing.ts` | create |
| `plugins/wf/mcp/src/resolver/config.ts` | modify |
| `plugins/wf/mcp/src/resolver/types.ts` | modify |
| `plugins/wf/mcp/test/routing.test.ts` | create |
| `plugins/wf/mcp/test/parsers.test.ts` | modify if parser cases are not fully covered in the routing suite |

**Depends on:** STEP-001

---

### - [x] STEP-003: Expose routing through the resolver MCP runtime

**Goal:** Make callers obtain a fingerprint-fresh routing decision through one typed query, with no config reparse or environment probing in skill prose.

**Changes:**

- Project parsed routing rows into the cached snapshot and expose a `resolve_routing` service method with bounded inputs for invocation choices, required flags, execution shape, basis, attempt/escalation context, runtime selector support, host enforcement, and available models.
- Register the MCP schema and return either a dispatchable record or an explicit pre-dispatch stop diagnostic.
- Assert service calls reuse the cached snapshot, remain body-free, and preserve compatibility with projects that have no `## Routing` section.
- Rebuild the committed resolver bundle after source tests pass.

**Files:**
| File | Action |
|------|--------|
| `plugins/wf/mcp/src/service.ts` | modify |
| `plugins/wf/mcp/src/tools.ts` | modify |
| `plugins/wf/mcp/src/resolver/resolve.ts` | modify if snapshot projection requires it |
| `plugins/wf/mcp/test/service.test.ts` | modify |
| `plugins/wf/mcp/dist/server.mjs` | regenerate |

**Depends on:** STEP-002

---

### - [x] STEP-004: Route shared and classifier bootstrap dispatches

**Goal:** Apply the routing query immediately before the common branch gate and every direct classifier spawn while retaining the child agents' tools, behavior, provider access, and exact output blocks.

**Changes:**

- Teach the shared branch-gate procedure to request the `branch` decision, emit compact operational routing metadata, pass the selected model only when supported, preserve inherited effort when unsupported, and stop only for required-override failures.
- Update the spec, plan, lite, and user-facing classify dispatch paths to resolve the `classify` decision under the same contract rather than inheriting accidentally.
- Preserve `CLASSIFY — Complete|Error` parsing, classification bucket semantics, `BRANCH — created|switched|already-active|Error` parsing, and forwarded provider records.

**Files:**
| File | Action |
|------|--------|
| `plugins/wf/skills/_shared/pipeline-conventions.md` | modify |
| `plugins/wf/skills/spec/SKILL.md` | modify |
| `plugins/wf/skills/plan/SKILL.md` | modify |
| `plugins/wf/skills/lite/SKILL.md` | modify |
| `plugins/wf/skills/classify/SKILL.md` | modify |

**Depends on:** STEP-003

**Completed:** Added the typed cached routing parser/decision, `resolve_routing` service and MCP tool, focused precedence/negative-path tests, and routing preflight at the shared branch gate plus direct classifier dispatches. Later branch-wrapper, commit-agent, documentation, release, and tracker work remains in STEP-005.

---

### - [ ] STEP-005: Finish bootstrap integration, release metadata, and tracker promotion

**Goal:** Close the remaining direct branch paths, publish the configuration contract, and atomically promote WF-376 before dependent umbrella work proceeds.

**Changes:**

- Route the user-facing branch wrapper and commit agent's nested branch gate through the same decision surface; run a repository-wide dispatch search to confirm no current `classify` or `branch` spawn bypasses routing.
- Document `## Routing`, selector precedence, masking/fallback semantics, and the new resolver query; bump wf `0.80.0` to `0.81.0`, synchronize the marketplace wf entry, and bump the marketplace top-level from `0.108.0` to `0.109.0` (rebase and recompute these values if the delivery base advanced).
- Perform a complete read-only tracker preflight over WF-372, WF-373, WF-376, and WF-394–WF-400: verify each issue exists, capture current parent/related/blocker edges, validate every declared `Depends on` relation and the exact description rewrite, and stop with no writes if any intended mutation is unavailable or ambiguous.
- After a successful preflight, retitle WF-376 to `Complexity-aware model routing and delegation`, remove its WF-372 parent, preserve/add WF-372 as related, remove the obsolete WF-376→WF-373 bootstrap edge and wording, connect WF-394 as the bootstrap blocker where specified (including WF-373), materialize every child brief's declared dependency as blocker edges, and verify the complete graph and umbrella description after mutation.

**Files:**
| File | Action |
|------|--------|
| `plugins/wf/skills/branch/SKILL.md` | modify |
| `plugins/wf/agents/commit.md` | modify |
| `plugins/wf/skills/init/references/config-template.md` | modify |
| `plugins/wf/README.md` | modify |
| `plugins/wf/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` | modify |

**Implementation status (2026-07-21):** All non-version portions are complete: the branch wrapper, commit agent, and the additional direct implement branch gate found by the repository-wide dispatch audit now resolve routing before spawn; the classify consumer contract has no bypass; the config template plus README document `## Routing` and `resolve_routing`; and the tracker preflight, mutation, and postcondition verification completed successfully. Targeted resolver, bundle, smoke, vocabulary, ops-doc, and skill-read guards pass. **Pending and intentionally unchecked:** version-manifest changes only.

**Depends on:** STEP-004

---

### - [ ] STEP-006: Run build/typecheck — confirm no regressions

**Goal:** Verify the changes compile and do not break existing functionality.

**Command:** `(cd plugins/wf/mcp && npm run build)`

Also run the resolver test, bundle verification, smoke test, registry fixture/guard chain, vocabulary on-touch check, and `claude plugin validate`; confirm regression scenarios preserve classification buckets plus branch prefix/task-id while allowing descriptive branch-tail variation.

**Depends on:** STEP-005

---

### - [ ] STEP-007: Ready for review

**Goal:** Hand off the implemented change for review. `/wf:implement` does not commit, push, or open a PR — it ticks this step and records a suggested commit message for whichever step commits next (`/wf:commit`, or a manual commit).

**Suggested commit message:** `feat(WF-394): establish configurable cheap routing for bootstrap roles`

**Depends on:** STEP-006

---

## Done When

- The resolver test suite proves shipped defaults, project/invocation/host precedence, masking, independent effort inheritance, arbitrary and unknown roles, malformed/unavailable/unsupported values, required stops, and selector-limited runtimes, and the full MCP test suite exits 0.
- Repository search finds no `wf:classify` or `wf:branch` dispatch that bypasses the routing decision; default calls select `haiku`, existing terminal blocks remain byte-shape compatible, and regression scenarios retain classifier buckets and branch prefix/task-id.
- `(cd plugins/wf/mcp && npm run build)` exits 0, the committed bundle verifies, all repository guards pass, and plugin manifests validate at synchronized versions.
- WF-376 has the promoted title and C025 umbrella description, no WF-372 parent, WF-372 as a related issue, no obsolete WF-376→WF-373 edge, and all preflighted WF-394–WF-400 dependency edges verified after mutation.
