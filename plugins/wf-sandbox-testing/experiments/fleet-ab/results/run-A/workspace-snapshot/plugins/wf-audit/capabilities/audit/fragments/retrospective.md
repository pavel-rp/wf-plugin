# Composite retrospective report — composition procedure (boot doc)

**Owned by:** the audit capability (`plugins/wf-audit/capabilities/audit/`)
**Read by:** `wf-audit:audit-retrospective` on boot, when the composite report is requested
**Wired by:** `plugins/wf-audit/capabilities/audit/manifest.md` (§"Composite retrospective report")
**Model:** claude-opus-4-8


Before following any resolver MCP call in this document, run `pwd -P` and use the returned absolute current Agent/session workspace directory as `workspaceRoot`. In a linked-worktree Agent, that cwd is the Agent's own worktree; never inherit a parent root. Pass it explicitly on every call. Omitting `workspaceRoot` is a hard schema error; resolver MCP calls have no default or fallback root.
---

The audit capability's **optional, on-request** composite output — a process-retrospective and
composite (umbrella) verification over a **completed** task. It is **not** a `verify`-phase
fragment: it composes *over* the lens findings the `verify` phase already produced, so it runs
only when requested, never automatically on every verify. It is gated by the **same registry
toggle as the five lenses** — the audit capability's registration — and reaches no provider it
cannot degrade without.

**Contents:** registry-membership gate · inputs · delivery evidence (fold-in + degradation) ·
composition · report artifact · degradation summary · final block.

## Registry-membership gate (run first)

Obtain the ordered active registry as metadata by calling the bundled `wf-resolver` MCP tool
`resolve_registry({ workspaceRoot })` — it returns `capabilities[]` (each `{ name, kind, resolvedPath, manifestPath,
provenance, validity, fragments, articles, requires, conflicts, profileTemplatePath }`), already
resolved from the `## Capabilities` registry and each capability's `manifest.md`; you perform no
direct registry-file read or manifest walk of your own. If the `wf-resolver` service is unavailable, stop and report that the resolver runtime is not
loaded — do not hand-parse the registry as a fallback (WF-272 diagnostics/recovery). If **no row's
`name` is `audit`** (by convention the capability registers under that name, resolving to this
capability's manifest), emit `RETROSPECTIVE — not-registered` and stop: write nothing. This is the
**same registry membership** a core skill firing `verify` resolves to dispatch the five lens rows —
the identical on/off datum (the `lenses` profile is only the subset selector applied *after*
dispatch, never the gate). Registered → the report may emit; unregistered → neither the lenses nor
this report run. Never surface this as an error.

## Inputs to compose (read, in order)

1. **The verify report** — `04_verify.md` in the resolved task folder. This is the composite's
   **primary input**: the spec-conformance verdict and the aggregated, provenance-tagged lens
   findings already live here. **Do not re-run the lenses or re-derive conformance** — that
   re-implements `verify-spec`; read its result. If `04_verify.md` is **absent**, stop with
   `RETROSPECTIVE — needs-verify` and direct the requester to run `/wf:verify-spec {task-id}`
   first — never emit a hollow composite from a verify that has not run.
2. **The requirements** — `00_reqs.md` in the task folder — the task's intent and acceptance
   criteria the retrospective reflects against.
3. **The change under retrospective** — the branch's change summary against the base, gathered
   directly against the local working tree (diff/log inspection has no delivery operation today —
   the same documented contract-completeness gap `verify-spec` records, not a workaround).

## Delivery evidence (fold in only when a delivery provider is registered)

Reach three **read-side** delivery operations — `pr-comments-read`, `checks-read`,
`activity-read` — by calling the bundled `wf-resolver` MCP tool `resolve_provider({ surface: "delivery", workspaceRoot })`
**once** — the typed query that returns the run-scoped resolution record `{ surface, owner,
fragmentPath, state, degradation, diagnostics }`. The resolver has already resolved the
`## Capabilities` registry, the owning capability's `manifest.md`, and any plugin-anchored root
(post install-manifest self-heal, `capability-registry.ops.md` §"Recorded-root-first resolution
with install-manifest self-heal"); you perform no registry / manifest / plugin-root read of your
own. On `state: ok`, follow the returned `fragmentPath` in your own context to dispatch each
operation. **On `state: unconfigured` or `unrecoverable` (zero readable `delivery` rows), all
three resolve to an empty result** (`capability-registry.ops.md` §"The delivery provider surface"
→ unconfigured reads: an empty result, no error, no warning). That empty result **is** the
local-only degradation: compose the retrospective from spec-conformance + lens findings alone,
omit the evidence section entirely, and surface **no** provider/tool term on that path. If the
`wf-resolver` service is unavailable, stop and report that the resolver runtime is not loaded —
do not hand-parse the registry as a fallback (WF-272 diagnostics/recovery).

Distill only the **bulk**; read compact signals directly. Immediately before every review-batch or failing-log `wf:context-distiller` Task attempt, call `resolve_routing` with `workspaceRoot: <absolute pwd -P workspace root>`, `role: "context-distiller"`, a canonical singleton `unitIds` value (`audit-retrospective:distill:review` or `audit-retrospective:distill:ci:<check>`), replacing every run outside `[A-Za-z0-9._:/-]` with `-`, trimming replacement edges, and using a stable SHA-256 prefix if the result is empty or exceeds 128 characters, `supportsModelSelector: true`, `supportsEffortSelector: false`, and `shapeEvidence: { workSurface: "external-context", atomicity: "atomic", unitCount: 1, unitsIndependent: false, ambiguity: "material", risk: "elevated", toolWork: "material", validation: "judgment", contextIsolation: "required", independentReview: false, returnContract: "mechanically-judgeable", requestedParallelism: 1 }`. Include `actualModel` only when exposed; emit the compact operational record separately from artifact attribution. Stop that evidence fold-in before Task on `status: stop`, diagnostic, or non-`isolated` shape; otherwise pass non-null `model.value` only, then validate the compact block. This parent alone owns any `postAttempt`, retaining identity/evidence; the child never self-replaces.

- <!-- capability-route:audit-distill-review --> **`pr-comments-read`** — route one `MODE: review` distiller Task over the thread-id-tagged body batch; fold its compact `REVIEW DISTILL` verdicts in.
- <!-- capability-route:audit-distill-ci --> **`checks-read`** — read compact names/states directly. For each failing check with a log reference, route one `MODE: ci` distiller Task over that reference; it self-fetches the bulk, and only its compact `CI DISTILL` block returns.
- **`activity-read`** — read the compact recent-activity summary directly.

## Compose the composite report

Compose these sections (grounded in the artifacts above — never invented):

- **Composite verdict** — `PASS | PASS WITH WARNINGS | FAIL`, derived from: the `04_verify.md`
  verdict, the lens `fail` findings (any drives FAIL), a distilled **code-class** CI failure
  (drives FAIL; an `infra/transient` one does not), and any `valid` distilled review finding.
  Map the verify verdict thus: `FAIL` or any lens `fail` or a code-class CI failure → `FAIL`; a
  verify `PARTIAL`, a lens `warn`, or a `valid` review finding → at least `PASS WITH WARNINGS`;
  `PASS` with none of those → `PASS`.
- **Spec-conformance summary** — carried from `04_verify.md` (do not recompute).
- **Lens-findings roll-up** — the audit lenses' findings from `04_verify.md`, provenance-tagged.
- **Delivery evidence** — the distilled PR-review verdicts and CI diagnosis. **Present only when a
  delivery provider contributed**; omit the whole section on the local-only path.
- **Process retrospective** — an honest what-went-well / what-to-improve over the task lifecycle
  (spec clarity, plan drift, finding density, iteration count), reasoned from the artifacts.
- **Recommended next actions** — a short, ordered list.

## Report artifact

Write `{task-root}/{task-id}/09_retrospective.md`. Its header carries model attribution and the
commit coordinates so a reader can tell which state it reflects:

```
# retrospective: {task-id}

**Composite verdict:** <PASS | PASS WITH WARNINGS | FAIL>
**Branch:** `<branch>`   **Commit:** `<HEAD SHA>`
**Evidence:** <local-only | delivery: PR review + CI>
**Composed by:** <model identifier>
**Composed at:** <ISO 8601 timestamp>
```

Carry **no** AI-attribution or promotional content — model attribution only. After writing,
<!-- capability-route:audit-index --> catalogue it by invoking `/wf:index {task-id} retrospective "<summary ≤80 chars>"` through the **Skill** tool. Its wrapper owns the fixed `index` routing decision; never dispatch `wf:index` directly.

## Degradation summary (the only branches)

- audit **not registered** → `RETROSPECTIVE — not-registered`; nothing written.
- `04_verify.md` **absent** → `RETROSPECTIVE — needs-verify`; direct to `/wf:verify-spec`.
- **no delivery provider** (or a registered one whose reads return empty) → local-only composite
  (spec-conformance + lens findings + retrospective); no evidence section, no provider term. A
  delivery **read** degrades **silently** local-only per the delivery-surface contract — never a
  warning, never an error; the local composite is the source of truth.
- **cannot proceed at all** (config absent, or the report artifact cannot be written) →
  `RETROSPECTIVE — error` with a one-sentence reason; leave nothing partial behind.

## Final block

Emit exactly one, as the very last thing:

```
RETROSPECTIVE — <composed | not-registered | needs-verify | error>

{task-id}: composite <PASS | PASS WITH WARNINGS | FAIL | —>
Evidence: <local-only | delivery: PR review + CI>
Report: {task-root}/{task-id}/09_retrospective.md
```
