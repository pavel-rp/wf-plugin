# Capability invocation runtime — runtime ops

**Version:** 1.8.0 (WF-208; WF-209 — run-scoped provider forwarding; WF-302 — the bundled-doc content resolution surface; WF-304 — fragment-body dispatch routed through that surface; WF-396 — evidence-selected execution shape; WF-397 — parent-owned bounded escalation; WF-399 — mandatory fixed core-dispatch adoption and compact operational record; WF-496 — the authoritative-`unitCount` rule, the bounded-metadata rejection, and the independent-axes reading; WF-497 — the model tier as one escalation lever rather than the gate itself)
**Role:** the runtime-read half of the invocation runtime — the exact procedure a core skill follows to fire an SDD phase or to resolve a provider surface, with every guard, no-op case, and fail-safe inline. One level deep: no step below requires opening anything beyond this file and its flat sibling below.
**Pair (flat sibling, read directly when needed):** `capability-registry.ops.md` — the registry/mapping schemas, the recorded-root-first self-heal algorithm, the surface operation sets, and the degradation rules this procedure resolves against.
**Reference (rationale, history, v1 lineage, worked demonstrations — never read at boot):** `invocation-runtime.contract.md`.
**Model:** claude-opus-4-8

**Contents:** resolver call root · the five moving parts · 1 registry iteration · 2 per-capability manifest read · 3 per-phase fragment collection · 4 per-fragment dispatch · 5 aggregation · direct provider resolution · run-scoped provider forwarding · content resolution surface · no-op path · generic-only branch rule · fail-safe.

## Resolver call root

Every bundled `wf-resolver` MCP call passes `workspaceRoot`: first run `pwd -P` in the current Agent/session to derive its absolute current workspace directory, then include that value explicitly in the call. An Agent running in a linked worktree derives and passes its own current worktree root — never a parent Agent's root. Omitting `workspaceRoot` is a hard schema error; MCP calls have no default or fallback root.

**Resolver-selected execution shape.**

Immediately before every child execution — fixed core, registry-selected capability, or pack-owned Task/Agent or sibling Skill — call `resolve_routing` with `role`, selector-support facts, and the typed `shapeEvidence`: `workSurface`, `atomicity`, `unitCount`, `unitsIndependent`, `ambiguity`, `risk`, `toolWork`, `validation`, `contextIsolation`, `independentReview`, `returnContract`, and `requestedParallelism`. Supply ordered `unitIds` whenever work has stable unit identity; they are required for multi-unit work and for every retry-capable atomic or isolated route, unique, canonical, stable across attempts, and cardinality-matched. Build each semantic id from the task/edge identity, replace every run outside `[A-Za-z0-9._:/-]` with `-`, trim replacement edges, and use a stable SHA-256 prefix when the result would be empty or exceed 128 characters; never include an attempt number or random value. An atomic initial route that omits `unitIds` is explicitly non-retry: any `postAttempt` for it hard-stops rather than emitting an empty retry identity. Emit one compact operational record containing role; shape + reason; ordered unit ids; model and effort value/inheritance fallback + source; basis; attempt; escalation origin; masking; whether the selection was carried from an earlier item-level decision rather than derived here; diagnostic; retained units; and retry disposition with its `retry.escalation` lever. Include `actualModel` only when the host exposes it; its absence is valid and must not be invented. This record is operational metadata, never artifact `**Model:**` attribution. Any `status: stop` or non-null `diagnostic` is a hard stop before work begins.

Three contract rules govern how a call is composed and how its answer is read:

- **`unitCount` is authoritative.** `atomicity` is derived from it (1 → `atomic`, ≥2 → `composite`) and `unitsIndependent` is clamped to `false` at one unit; a contradictory pair is **normalized, not rejected**, and the derived values come back on `normalizedEvidence` — the same rule the retry path applies when it narrows a set to its insufficient units. `unitIds` cardinality against `unitCount` stays a hard rejection.
- **`basis` and `escalationOrigin` are bounded at 256 characters**, enforced at both the input-schema and resolver layers. Exceeding the bound is a **hard rejection of the whole call, never a truncation** — nothing shortens either field. Whichever layer rejects names the field and the bound (the resolver's own diagnostic adds the length received), so compose within the bound and shorten on rejection.
- **`status` and `executionShape` are independent axes.** `status` says whether to proceed, `executionShape` and `effectiveParallelism` say how. `status: dispatch` with `effectiveParallelism: 1` — the normal answer for every `inline` and `isolated` route — means run this decision's units **one at a time**, and is never a decision to dispatch nothing. **How many units to run is `unitIds.length`, never `effectiveParallelism`:** a dependent multi-unit `isolated` decision legitimately returns several `unitIds` at `effectiveParallelism: 1`, and every one of them is executed.

On `status: dispatch`, obey `executionShape` exactly while preserving the role's existing failure and output contract:

- **`inline`** — execute the unit in the caller context; do not spawn.
- **`isolated`** — invoke one Task subagent and forward only its declared final block.
- **`bounded-parallel`** — dispatch every independent unit, run no more than `effectiveParallelism` Tasks concurrently, and restore deterministic input order before aggregation. The resolver caps concurrency by unit count, the positive caller bound, and a core maximum of four. Never parallelize dependent work.

Pass `model.value` / `effort.value` only when non-null; null preserves inheritance. Preserve the role's shipped model and effort defaults, and retain actual-model attribution on authored artifacts. For `subagent: <agent>` metadata, validate the token as a registered Task target and derive the routing role from its final colon-delimited slug; never hardcode a capability name in core. A malformed derived role, unavailable required selector, or execution shape the dispatch surface cannot perform stops before Task; a genuinely unavailable optional contributor follows its pre-existing no-op contract. A routed `/wf:index` Skill invocation is wrapper-mediated and must not be bypassed with a direct pack-owned `wf:index` Task.

**Parent-owned post-attempt escalation.** The parent judges the returned structured result against its return and validation contracts. Retain the original work input, prior structured result, validation evidence, routing record, shape evidence, initial ordered `unitIds`, and every successful unit result. Submit `postAttempt` to `resolve_routing` with those retained prior `unitIds`; bounded-parallel evaluations additionally supply `postAttempt.units` covering that exact set once each, while atomic or isolated singleton evaluations omit `postAttempt.units` and carry sufficiency/signals at top level. Initial `unitIds` identify retryable work and are not per-unit evaluation records. Only these insufficiency signals are valid: `low-confidence`, `failed-validation`, `conflicting-or-incomplete-evidence`, `repeated-failure`, `increased-risk-or-scope`, `high-severity-review-uncertainty`.

- `retain`: use the successful result; never rerun it at a stronger tier for reassurance.
- `retry`: the parent re-dispatches only the ordered `retry.unitIds`, forwarding the retained context above. Obey the recomputed execution shape, and the exact `retry.nextTier` when it is non-null; a null `retry.nextTier` means the resolver requested no advance, so re-dispatch at the returned selection unchanged. A null `retry.nextTier` with `shapeChanged: false` is a deliberate zero-delta repeat — nothing about the dispatch differs from the attempt that failed, so spend the attempt only when the failure was plausibly transient. Never let a child spawn its replacement.
- `exhausted` / `invalid-stop`: perform no child dispatch; surface the diagnostic and retained successful units.

The default limit is two total attempts. Only the shipped `security-auditor` policy permits attempt three, and only when the signal set is exclusively `high-severity-review-uncertainty`; three is the absolute ceiling. Every retry must retain the prior role, shape evidence, and explicit effort choice/provenance (unless host effort masks it), record non-null `escalationOrigin`, preserve selector provenance and actual-model evidence, and advance exactly one tier through `haiku → sonnet → opus` whenever the model-tier lever applies. Only resolver-derived narrowing of the failed unit set may change the retry shape; caller-supplied post-attempt evidence must not change it. The tier is one escalation lever, not the gate: an advance that was requested and defeated — masked, unavailable, malformed, or non-advancing — stops rather than inherit or repeat, but a lever that does not apply at all, because the runtime cannot honor a model selector, the prior model maps to no tier, or it already holds the top tier, still opens the gate and re-dispatches the narrowed units at the prior selection, re-resolved through the ordinary precedence chain so host enforcement still wins, with `retry.escalation` naming which of the three.

## The moving parts (the generalised procedure)

A core skill firing a phase performs, in order: **1** registry iteration → **2** per-capability manifest read → **3** per-phase fragment collection → **4** per-fragment dispatch → **5** aggregation. There is no dispatcher, codegen, or compile step — composition is reading the registry and following fragments in-context, re-read every run.

## 1. Registry iteration

Read the `## Capabilities` table at the `registryPath`-resolved location (repo-root `wf.config.js` `registryPath`; **default `_local/config.md`** when absent). Walk the rows top to bottom — registry order is the injection order (general → specific) and is preserved through aggregation.

- **`Path` resolution — both shapes.** A **repo-relative** `Path` resolves against the repo root. A **plugin-anchored** `plugin:<plugin-name>/<rel-path>` `Path` resolves via the `## Plugin Roots` mapping, **recorded root first, then the install-manifest self-heal** — execute the algorithm exactly as stated in `capability-registry.ops.md` (recorded-root-first; marketplace-exact key with left-of-`@` fallback; backslash→forward-slash normalization; prefer-existing-`installPath`; in-memory only).
- An **unmapped** plugin-anchored row, or one **unrecoverable** after self-heal, resolves to no readable manifest → that row **no-ops** (fail-safe; the validator is what errors on it).
- Empty or absent table → zero rows → go straight to the no-op path; no manifest is read.
- Core **iterates** — it never looks up a particular capability, counts rows, or tests whether a specific one is present.

## 2. Per-capability manifest read

For each row, read exactly one manifest at the contracted fixed path `<path>/manifest.md` — a single deterministic read; never scan, glob, or guess. Parse its fragments table by the fixed column names `phase | contribution-kind | dispatch | scope` — never by reading a heading. A missing manifest → this capability contributes **nothing** for the invocation (no-op path applies to it); move to the next row.

## 3. Per-phase fragment collection

Select only the fragment rows whose `phase` equals the firing phase; ignore all others. Zero matching rows → this capability contributes the no-op. One or more → each becomes a contributor, carried into dispatch in registry order, **retaining the contributing capability's name** (surfaced as provenance for `finding`/`scenario`/`article`; used only for ordering on additive kinds).

## 4. Per-fragment dispatch

| Fragment `dispatch` | Core action |
|---------------------|-------------|
| `inline: <rel-path>` | Obtain the fragment body through the resolver **content surface** — call `resolve_content` with `workspaceRoot: <current Agent/session absolute workspace directory>`, `class: fragment`, `capability:` this row's capability name, and `ref: <rel-path>` (forward-slash, **relative to the capability's registry path**) — and follow the returned body in-context; return the result in the contribution kind's generic shape. **Never a raw `Read`/`Glob` of the path** (see §"Content resolution surface"). No subagent. |
| `subagent: <agent>` | Invoke the Task tool with `subagent_type: <agent>`, passing the artifact under review and the kind's generic shape; only the agent's final block returns. |
| *(no matching row for the phase)* | No-op — the capability contributes the phase's declared empty result. |
| *(row present, `dispatch` neither `inline:` nor `subagent:`)* | No-op (fail-safe) — never guess a malformed kind. |

Core supplies the generic shape; the capability supplies the content. Core reaches capability behaviour only through the fragment row, never by naming the capability.

## 5. Aggregation

Combine contributors per the firing kind's policy (fixed in `capability-registry.ops.md`'s taxonomy table):

- **aggregate** — follow every contributor in registry order. Additive `guidance` (at `spec`/`implement`) and `task-list` (at `tasks`): apply/append in order; on a `guidance` conflict the most-specific capability — injected last — **wins**. Provenance-carrying `finding`/`scenario`/`article`: tag each contribution with its source capability; order is cosmetic.
- **partition** — only the owning capability applies; there is nothing to merge. Overlapping ownership is a **registry-validation error** (both offenders named), never a runtime merge; the runtime assumes a validated registry and applies the single owner.

## Direct provider resolution (the delivery and tracker invocation modes)

The `delivery` and `tracker` `provider` surfaces are invoked **whenever a core skill needs an operation**, not when a phase fires. The alternate entry point reuses the same primitives:

1. **Registry iteration** — unchanged (step 1 above, including both `Path` shapes and the self-heal).
2. **Per-capability manifest read** — unchanged (step 2).
3. **Scope-equality filter** (replaces per-phase collection): select the row(s) where `contribution-kind = provider` **and** `scope = delivery` (or `scope = tracker`), across the whole registry, **regardless of the row's `phase` value** — the phase there is a registration anchor for the validator, not a filter condition.
4. **Per-fragment dispatch** — unchanged (step 4): `inline:` obtains the body through `resolve_content` (`workspaceRoot: <current Agent/session absolute workspace directory>`, `class: fragment`) and follows it, or `subagent:` via the Task tool. The provider fragment body (the `delivery` / `tracker` operation set) is served by the content surface, **never raw-read** — see §"Content resolution surface".
5. **Aggregation — skipped.** Validated partitioned ownership guarantees at most one match registry-wide; the resolved fragment (or the unconfigured no-op below) *is* the result.

**Unconfigured case** — the filter matches zero rows: structurally the same "zero matching contributors" shape as the no-op path below (scope-filtered instead of phase-filtered). What that no-op resolves to operationally per surface — the plain-directory read fallbacks, the "no delivery provider registered" write statement, the silent local-only `T<NNN>` tracker fallback — is stated in `capability-registry.ops.md` under the two surface sections.

**Write-side diagnosis split** — zero *readable* rows for a surface `<S>` has two distinct causes, never conflated: **(a)** no registered capability owns `<S>` (every manifest readable) → the unchanged "no `<S>` provider registered" message; **(b)** a registered capability's manifest is **unrecoverable** (recorded root dangled, self-heal recovered nothing) → name the unreadable-manifest pack(s) as **candidates** and **hedge** surface attribution, never asserting ownership. **Surfacing:** delivery write — loud/blocking; tracker write — warn-once, then local-only; read on either surface — silent local-only. The full diagnosis text and remedy wording live in `capability-registry.ops.md` (residual diagnosis).

## Run-scoped provider forwarding (resolve once, forward down)

Direct provider resolution above is **per boot** — each subagent that needs a surface re-walks registry → manifest → fragment. A **delivery-chain run** (a `/wf:pr`, `/wf:commit`, or `/wf:branch` invocation plus every provider-operation boot it spawns) collapses that to **one resolution per required surface**: the run's **single resolution point** resolves once and **forwards** the result down its spawn messages.

**Single resolution point** — the highest boot in the run that needs a surface. It runs direct provider resolution above **once per required surface**: one `## Capabilities` read, then one manifest+fragment read per surface (`delivery`, and `tracker` when the run needs it — both in that same pass, never a second registry walk). Every other provider-operation boot in the run **consumes the forwarded result** instead of resolving.

**The forwarded result — the run-scoped resolution record.** Per resolved surface, the minimum a consumer needs to *dispatch* that surface's operations without re-resolving: the surface token, the resolved provider identity (the `owner` capability), and the resolved fragment **content-ref** (the owner capability + its registry-relative fragment `ref`, the locator `resolve_content` reads into the operation set to follow) — **or**, when the surface resolved to no readable provider, that surface's unconfigured/unrecoverable outcome, so the consumer emits the identical degraded behaviour. It carries **no fragment body**: the dispatch read still happens inside the consuming boot's own isolated context — the consumer obtains the fragment body through the resolver's `resolve_content` content surface (`workspaceRoot: <that consumer Agent/session's absolute current workspace directory>`, `class: fragment`, keyed on the forwarded `owner` and fragment `ref`), **never a raw `Read` of the path** — so diff/artifact bodies never reach the parent. The forwarded record never carries `workspaceRoot`; a linked-worktree consumer derives its own.

**Channel — the spawn message.** No typed input channel reaches a subagent, so the record travels as **condensed prose appended to the spawn Task message** — an **optional, backward-compatible** extension of the spawn contract:

- A boot that **receives** a record for a surface **skips resolution** for it (no registry/manifest resolution of its own — it obtains the fragment body through `resolve_content` with `workspaceRoot: <that boot's current Agent/session absolute workspace directory>` plus the forwarded content-ref), dispatches that surface's operations against the record, and **forwards it onward unchanged** to any nested provider-operation boot it spawns.
- A boot that receives **no** record (invoked directly — top of its own chain) **self-resolves** per direct provider resolution above, then forwards its result down.
- Because the extension is optional, an unextended spawn is unchanged: the callee self-resolves exactly as before.

**Never to the inline `/wf:index` write** — it invokes zero provider operations, so no record flows to it and its inline write is untouched.

**Run-scoped only** — the record is one run's runtime value, never persisted or cached beyond the run. The next run re-resolves from the registry (a registry swap is picked up immediately), and core prose still names no concrete provider: the identity is a runtime value flowing through the generic slots.

## Content resolution surface (bundled-doc bodies)

Reading a **bundled non-skill doc** — a capability **fragment** body, a `_contracts/*` **contract** ops doc, a `_shared/*` **shared** convention doc, a skill **references-template**, a pack **profile-template** body, or a composed per-skill **slot** body — goes through the always-loaded `wf-resolver` MCP's **`resolve_content`** tool, **never** a raw `Read`/`Glob` of the version-pinned plugin-cache path. The tool resolves the ref by **reusing** the same snapshot facts as the metadata queries (capability `resolvedPath` / `profileTemplatePath`, the `## Plugin Roots` resolved roots with recorded-root-first self-heal) plus the server's own core-plugin root, then reads the body with the server's own Node `fs`. It is the framed, **additive** exception to the body-free metadata snapshot — that invariant is untouched.

Both fragment entry points route here: a **phase fire** (step 4 `inline:`) and a **provider resolution** (direct or run-scoped-forwarded, `delivery` / `tracker`) obtain the fragment body via `resolve_content` (`workspaceRoot: <current Agent/session absolute workspace directory>`, `class: fragment`), never a raw `Read` of the resolved path.

- **Request** — `workspaceRoot` plus a `class` (exactly one of the six above) and its locator: `fragment` / `profile-template` name a `capability` (+ a relative `ref` for `fragment`); `contract` / `shared` name a bare-filename `ref`; `references-template` names a `skill` (+ a relative `ref`, and an optional `plugin` — omit for a core skill); `slot` names a `skill` + `point`.
- **`served`** → `{path, content}`: one of the five single-path docs, resolved and read prompt-free through the one already-granted MCP surface (any version, any machine, zero per-path config). **`composed`** → `{content, policy, parts}` for `slot`; **`unfilled`** directs the caller to the inline default.
- **`unresolved`** → no body, two distinct diagnoses (a content read is a `local-read` surface → **continue** either way). **Integrity** (an unregistered / dangling-and-unrecoverable capability or plugin root, no declared template, or a resolver-build failure): call `resolve_gate` with `workspaceRoot: <current Agent/session absolute workspace directory>` and `surface: local-read` to obtain the matching degradation class and `/wf:resolve` recovery path. **Bad ref** (`ref-not-found` — the root resolved but no file exists at the joined path): fix the ref's shape — it is relative to its root *including any subfolder* (a fragment ref is `fragments/<doc>.md`; the provider record's `fragmentPath` shows the exact shape) — not a registry problem, so refresh only if the pack was genuinely relocated. **Never a wrong-path body, never a raw-read fall-through.**
- **`refused`** → the ref is outside the six served classes — a **skill body** (invoke the skill via the Skill tool instead) or a **CI-only fixture / validator input** — or a malformed / path-traversal ref.

## No-op path (the generalised `<none>` Null Object)

A phase — or one capability's part of it — no-ops (produces the firing kind's declared empty result; the surrounding SDD skeleton proceeds unchanged) when:

1. the `## Capabilities` registry is **empty or absent**, or
2. a row's manifest at `<path>/manifest.md` does **not exist** — including an unmapped plugin-anchored `Path`, or one whose recorded root dangles and the self-heal still recovers no readable manifest, or
3. a manifest exists but has **no fragment row** for the firing phase, or
4. a fragment row's `dispatch` is neither `inline:` nor `subagent:`.

When no active capability contributes to the firing phase, the **phase as a whole no-ops**: no findings, no scenarios, no correspondence rows, no guidance applied — and **no stack/domain/project term surfaces**.

## Generic-only branch rule

The **only** branch a core skill may evaluate around a phase firing is: **zero contributing fragments vs one or more**. A core skill body must never:

- test `if capability == <some concrete name>`;
- count the registry or key behaviour on how many capabilities are active;
- carry a code path, conditional, or message keyed to one specific capability;
- name a concrete capability anywhere in its body.

Adding or removing a capability requires **zero** edits to any core skill body.

## Fail-safe

A collected fragment row with a malformed/unrecognized `dispatch` is a **no-op** — the runtime never guesses. A bogus-`phase` row never reaches dispatch (collection selects matching-phase rows only). Rejecting bad rows up front — unique names, valid phase/kind references, non-overlapping ownership — is the **validator's** concern, not the runtime's; this fail-safe keeps a core skill from being stranded by a bad manifest until validation runs.
