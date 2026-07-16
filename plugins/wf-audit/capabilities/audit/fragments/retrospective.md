# Composite retrospective report — composition procedure (boot doc)

**Owned by:** the audit capability (`plugins/wf-audit/capabilities/audit/`)
**Read by:** `wf-audit:audit-retrospective` on boot, when the composite report is requested
**Wired by:** `plugins/wf-audit/capabilities/audit/manifest.md` (§"Composite retrospective report")
**Model:** claude-opus-4-8

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
`resolve_registry` — it returns `capabilities[]` (each `{ name, kind, manifestPath, fragments[],
articles[], provenance, validity }`), already resolved from the `## Capabilities` registry and
each capability's `manifest.md`; you perform no direct registry-file read or manifest walk of your
own. If the `wf-resolver` service is unavailable, stop and report that the resolver runtime is not
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
`activity-read` — by calling the bundled `wf-resolver` MCP tool `resolve_provider("delivery")`
**once** — the typed query that returns the run-scoped resolution record `{ surface, owner,
fragmentPath, state, candidates?, degradation }`. The resolver has already resolved the
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

Distill only the **bulk**; read the **compact** signals directly:

- **`pr-comments-read`** — the review-comment **bodies** are bulk. Hand the batch (each body
  tagged with its thread id) to `wf:context-distiller` with a `MODE: review` line, so the bulk
  stays in the distiller's isolated context; fold its compact `REVIEW DISTILL` verdicts in.
- **`checks-read`** — the check **summary** (names + pass/fail states) is compact: read it
  directly. For a **failing** check whose provider exposes a failing-log reference, hand that
  **reference** to `wf:context-distiller` with a `MODE: ci` line — it self-fetches the bulk log
  in its own context — and fold the compact `CI DISTILL` block in. Never pull a raw log into this
  report's own context.
- **`activity-read`** — the recent-activity summary is compact: read it directly.

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
catalogue it: invoke `wf:index` (Task tool, `subagent_type: wf:index`) with the task folder, slot
`retrospective`, and a ≤80-char summary.

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
