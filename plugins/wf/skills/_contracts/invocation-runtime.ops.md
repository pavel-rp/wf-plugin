# Capability invocation runtime — runtime ops

**Version:** 1.0.0 (WF-208)
**Role:** the runtime-read half of the invocation runtime — the exact procedure a core skill follows to fire an SDD phase or to resolve a provider surface, with every guard, no-op case, and fail-safe inline. One level deep: no step below requires opening anything beyond this file and its flat sibling below.
**Pair (flat sibling, read directly when needed):** `capability-registry.ops.md` — the registry/mapping schemas, the recorded-root-first self-heal algorithm, the surface operation sets, and the degradation rules this procedure resolves against.
**Reference (rationale, history, v1 lineage, worked demonstrations — never read at boot):** `invocation-runtime.contract.md`.
**Model:** claude-fable-5

**Contents:** the five moving parts · 1 registry iteration · 2 per-capability manifest read · 3 per-phase fragment collection · 4 per-fragment dispatch · 5 aggregation · direct provider resolution · no-op path · generic-only branch rule · fail-safe.

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
| `inline: <rel-path>` | Read `<path>/<rel-path>` — forward-slash, **relative to the capability's registry path** — and follow it in-context; return the result in the contribution kind's generic shape. No subagent. |
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
4. **Per-fragment dispatch** — unchanged (step 4): `inline:` read-and-follow, or `subagent:` via the Task tool.
5. **Aggregation — skipped.** Validated partitioned ownership guarantees at most one match registry-wide; the resolved fragment (or the unconfigured no-op below) *is* the result.

**Unconfigured case** — the filter matches zero rows: structurally the same "zero matching contributors" shape as the no-op path below (scope-filtered instead of phase-filtered). What that no-op resolves to operationally per surface — the plain-directory read fallbacks, the "no delivery provider registered" write statement, the silent local-only `T<NNN>` tracker fallback — is stated in `capability-registry.ops.md` under the two surface sections.

**Write-side diagnosis split** — zero *readable* rows for a surface `<S>` has two distinct causes, never conflated: **(a)** no registered capability owns `<S>` (every manifest readable) → the unchanged "no `<S>` provider registered" message; **(b)** a registered capability's manifest is **unrecoverable** (recorded root dangled, self-heal recovered nothing) → name the unreadable-manifest pack(s) as **candidates** and **hedge** surface attribution, never asserting ownership. **Surfacing:** delivery write — loud/blocking; tracker write — warn-once, then local-only; read on either surface — silent local-only. The full diagnosis text and remedy wording live in `capability-registry.ops.md` (residual diagnosis).

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
