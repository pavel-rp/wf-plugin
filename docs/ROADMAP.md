# wf Plugin — Roadmap & Milestones

> **Read this before picking up any `WF-*` issue.** It is the grounding doc for anyone — human or agent — building the wf plugin. **Live tracking lives in Linear** (team `WF`, project *"WF Plugin — decoupling & Zach interop"*); this doc carries the durable model and direction, Linear carries current issue status. The full v2 design lives in `_local/research/capability-registry-v2-design-2026-06-25.md` (gitignored — may be absent on a fresh clone, so the essentials are carried here).

---

## The goal (one line)

**Move *all* tech-stack, domain, and project-specific knowledge out of the core plugin and into composable capabilities.** Core becomes a generic Spec-Driven Development engine that knows nothing about any stack, domain, or project; everything specific is injected at runtime through capabilities.

---

## Vision (end state)

`wf` is a **domain-free SDD harness**. It ships only: a fixed **SDD phase spine**, a **capability registry** + composition mechanism, a **contribution taxonomy** for rendering any capability's output, and a small set of domain-free workflow skills. It carries **zero** stack, domain, or project knowledge.

- **Core knows nothing** about any stack (Angular, .NET), domain (the CRA → Angular migration), or project. It exposes the phase spine, the registry selector, and the taxonomy — nothing else.
- **Knowledge lives in capabilities of any granularity** — a single domain concern (`migration`), a stack (`angular`), a stack-agnostic feature (`browser-qa`), several at once, or a whole-project add-on that wraps existing skills (Zach's ADO pipeline is the motivating example). Core makes **no assumption** about a capability's shape or count — it composes whatever the registry lists.
- **Composition is runtime inline-prose injection — no codegen, no compile step.** Core re-reads the registry every run and follows each active capability's fragments in-context. Edit a fragment once and every project picks it up on the next run; nothing to rebuild or keep in sync.
- **Per-project instance values live downstream** in the consuming repo's `_local/` (paths, the filled profile, the active registry).
- The engine **interoperates with Zach's upstream** ADO pipeline (consume, don't absorb).

**Litmus test for every core change:** *would this still make sense for a totally different stack, domain, and project?* If a core skill names `AuditTrakker.Web`, `ComplianceRisk`, "CRA", "Angular", or a 1:1-parity rule, it's wrong — that knowledge belongs in a capability. After each migration, grep the core skill for stack/domain strings; **zero hits is part of "done".**

---

## Architecture: core + capabilities + project instance

| Tier | Owns | Examples | Hard rule |
|---|---|---|---|
| **Core engine** (the `wf` plugin) | the SDD phase spine, the capability registry + the runtime compose/aggregate mechanism, the contribution taxonomy, and domain-free workflow skills | `spec`, `plan`, `tasks`, `implement`, `verify-spec`, `qa-gen`, `run`, `init`, `constitution`, `branch`, `commit`, `pr`, `classify`, `triage`, `index` | **Zero stack / domain / project knowledge.** Iterates the registry; assumes nothing about which capabilities exist or how many. |
| **Capabilities** (any granularity) | reusable stack / domain / feature / project knowledge — phase fragments and/or their own skills | `migration` (adapter: mapping, parity, rule-audit, type-map); `angular` (stack: test-host scaffolding, stack idioms); `browser-qa` (feature: browser engine); a whole-project bundle (may wrap external skills, e.g. Zach's) | Provide fragments + their own contract/profile. Staged in transitional in-repo folders now → standalone plugins later. **Never inside core.** |
| **Project `_local/`** | this repo's instance values | the active `## Capabilities` registry, each capability's filled profile, per-repo paths, per-task artifacts | Gitignored. Downstream; never committed by the plugin. |

---

## The SDD spine + contribution taxonomy (the heart of v2)

The lifecycle phases are the canonical SDD set (GitHub Spec Kit: **Specify → Plan → Tasks → Implement**) plus wf's `verify`/`qa` extension. Each is a gated, human-approved markdown artifact that feeds the next. Capabilities attach **prose fragments** at these phases; core never names a domain concern. A phase with no attached fragments runs exactly as if inert.

| Phase | Role | Capability contributes | Contribution kind | Aggregation |
|---|---|---|---|---|
| `spec` (Specify — **authoring hub**) | conventions, constraints, acceptance criteria, invariants | authoring **guidance** | aggregate (registry order) |
| `plan` | correspondence/decomposition beyond spec prose | `artifact` | partition by ownership (`source→target`) |
| `tasks` | opinionated decomposition into small, testable units | **task-list** | aggregate |
| `implement` (Implement — **authoring hub**) | stack idioms/scaffolds; apply the plan's mapping | authoring **guidance** | aggregate (registry order) |
| `verify` | assert conformance to spec + spec-derived invariants | `finding` | aggregate (provenance-tagged) |
| `qa-generation` | scenarios from acceptance criteria | `scenario` | aggregate |
| `qa-execution` | the execution engine + environment | `provider` | partition by surface (`engine`/`host`); subagent dispatch |

**Aggregate** = follow every contributor in registry order (general → specific, so the most-specific wins last on additive `guidance`). **Partition** = only the owning capability applies; overlapping ownership is a registry-validation error.

**The constitution** — non-negotiable principles, **composed not authored**. Established by a `wf:constitution` skill auto-invoked by `init` (records the project's clauses + the active registry), consulted as guidance at `spec`, and enforced as `finding`s at `verify`. Core contributes domain-free **process** articles; each capability contributes its own non-negotiables. **Project clauses override capability clauses;** a contradiction between two capabilities' articles is a registry-validation error.

---

## Capability kinds & the granularity-agnostic model

| Kind | Provides | Composes via | Example |
|---|---|---|---|
| `adapter` | phase fragments only; ships no skills | registry (runtime injection) | `migration` |
| `feature` | its own skills/commands/agents; may also attach fragments | native plugin install **+** registry | `browser-qa` |
| `both` | skills **and** fragments | both | a whole-project add-on |

Two composition mechanisms, kept separate: **features compose natively** (install N plugins → their skills are all discoverable, no custom machinery); **phase fragments compose via the registry** at runtime. The same machinery must support narrow (one concern), composed (several at once), and whole-project capabilities. Core never special-cases "the migration domain" or assumes a single active capability — `migration` is simply the **first** capability extracted; the design must hold for the rest.

---

## The core ↔ capability boundary

The boundary is the decoupling. Three parts:

- **Core extension interface** *(capability-agnostic; prose)* — the `## Capabilities` **registry** selector + the named **SDD phases** + the **contribution taxonomy** (`article`/`finding`/`scenario`/`artifact`/`provider` + authoring guidance). Names no stack/domain; ships in core. Empty registry → fully generic core.
- **Capability contract + manifest** *(per capability; prose + a JSON-Schema-over-YAML schema for data slots)* — the capability's `manifest.md` (its `kind` + a fragments table: `phase | contribution-kind | dispatch | scope`) and its profile slots (e.g. migration's `type-map`, `invariants`). Lives **with the capability**, never in core. The schema makes the profile *validatable* — prose-only re-introduces the silent-misread coupling this whole effort removes.
- **Validation** — two layers, fail-fast with actionable messages: per-capability (a profile vs its contract) **and** registry-level (unique names, paths exist + carry a manifest, no overlapping ownership scopes, no contradictory `article` clauses, valid phase/kind references). This is the **reliability leg** — do not defer it.

---

## Sorting rule: four kinds of "project stuff"

When deciding where something new belongs, sort it first — this prevents spaghetti:

| Kind | Example | Home |
|---|---|---|
| Static **DATA** (stack/domain) | type-map, invariants, paths | a capability's profile in `_local/` (instance), shaped by its contract |
| Invariant **BEHAVIOUR** | the workflow spine (core); a stack/domain grammar (capability) | the relevant skill — **core if generic, capability if stack/domain-specific** |
| Variant **BEHAVIOUR** | a stack needs different scaffolding | a **declared fragment** at a phase — never a silent override |
| Live **PROJECT DATA** | ADO work item, DB schema, codebase | an MCP / tool adapter |

Never push behaviour into data, and never let core name a concrete stack/domain/project noun.

---

## Milestones

1. **Extraction → v2.** Reshape core to the registry + SDD-phase + taxonomy model, make it stack- and domain-free, and stage the migration / Angular / browser-QA knowledge out of core as capabilities wired through phase fragments.
2. **Adopt Zach — upstream consume seam.** `/wf:spec` and `/wf:plan` consume Zach's committed Design / Backlog Decomposition (via the root ADO work item's attachment + a read-only parent-chain walk) as scope input; `00_reqs.md` stays the verification source of truth. Read-only, additive, no-op when absent.
3. **Add-on plugins.** Promote the transitional in-repo capability folders into standalone plugins the generic core discovers and composes — single-concern, multi-concern, or whole-project bundles (incl. wrapping external skills like Zach's).

> **Known follow-on:** even after core is domain-free, QA orchestration stays core while the browser engine (`browser-qa` feature) and Angular test-host (`angular` stack) become capabilities — tracked as WF-25 / WF-26.

---

## Execution plan — current state (as of 2026-06-25)

Reshaped from the original v1 extraction plan (`WF-1`…`WF-10`) to the v2 registry model on 2026-06-25. Statuses below are a snapshot — **Linear is the live source of truth.**

**Foundation — done (the frozen N=1 base v2 generalises):**

| Issue | What | State |
|---|---|---|
| `WF-1` | Define the core↔domain contract (v1 single-`{domain}`, three hooks) | **Done** — kept as the N=1 base; reshaped by `WF-21` |
| `WF-10` | Define the no-DI invocation mechanism (config → manifest → inline/subagent) | **Done** — kept & generalised by `WF-22` |
| `WF-2` | Profile + registry validator (fail-fast) | **In progress** — per-capability validator built (`WF-17/18/19` done); registry-level pass is the remaining v2 work |

**v2 foundation — build first (the contract + mechanism the rest depends on):**

| Issue | What |
|---|---|
| `WF-21` | Reshape the core contract — capability registry + SDD phases + contribution taxonomy (supersedes `WF-1`) |
| `WF-22` | Generalise the invocation mechanism — iterate the registry, inject per phase, aggregate per policy (supersedes `WF-10`) |
| `WF-3` | Author per-capability profiles + seed templates (registry-aware) |
| `WF-4` | Behavioural eval baselines for the capability-coupled phases — **must precede the wiring issues** |

**Wire the phases (each renders a contribution kind by injecting active capabilities' fragments):**

| Issue | What |
|---|---|
| `WF-6` | Wire `migration-map` to the `plan` phase — mapping `artifact`, partition-by-ownership |
| `WF-7` | Make `verify-spec` capability-agnostic — aggregate `finding`s at `verify` (also the constitution's enforcement point) |
| `WF-8` | Make `qa-gen` capability-agnostic — `qa-generation` aggregates `scenario`s (absorbs the QA split) |
| `WF-23` | Adopt the `tasks` SDD phase (decomposition gate between `plan` and `implement`) |
| `WF-24` | Add the `wf:constitution` skill — composed, auto-invoked by `init`, enforced at `verify` |

**Extract capabilities out of core:**

| Issue | What |
|---|---|
| `WF-25` | Extract browser-automation QA as a stack-agnostic `feature` capability (`qa-execution` provider) |
| `WF-26` | Extract the Angular stack capability — test-host scaffolding + stack idioms + paths (absorbs the canceled `WF-5`) |

**Finish — naming, init, CI, docs:**

| Issue | What |
|---|---|
| `WF-27` | Naming pass — `domain`→`capability`, `hook`→`phase`/`contribution kind` |
| `WF-9` | Wire `init` (write the registry + auto-invoke `wf:constitution`) + version bump + docs |
| `WF-20` | CI: gate each capability's fixture suite + registry validation on PRs |

*(`WF-5` canceled — Angular stack paths absorbed into `WF-26`. `WF-11`…`WF-19` are the spec/plan/impl sub-issues of `WF-1`/`WF-2`/`WF-10`, all done except the `WF-2` registry pass.)*

---

## Working principles for the dev agent (guardrails)

- **Stage, don't big-bang.** This is prompt text with no compiler — a one-shot refactor fails *silently* (a worse QA plan, a false-positive verdict on the next real task). One issue = one branch/PR with its own acceptance check.
- **Evals between stages.** Baseline behaviour with the `skill-creator` eval harness (`WF-4`) *before* migrating; a migration is "done" only when its eval is **no worse than baseline**.
- **Core stays stack- AND domain-free — verify it.** After each migration, grep the core skill for stack/domain strings (`AuditTrakker.Web`, `ComplianceRisk`, `CRA`, `Angular`, parity invariants); **zero hits is part of Done**.
- **Design for arbitrary capabilities.** Never special-case the migration domain or assume one active capability — core composes whatever the registry lists (narrow, multiple, or a whole-project bundle).
- **Reference the contract by slot / contribution-kind name — never read a profile or fragment "by heading".** If the shape must change, change the contract **and** its validator together.
- **Freeze the interface, not the gold-plating.** Pin the contract *shape* with only the slots the current step needs; extend as later capabilities land.
- **Don't entangle milestones.** Adopt-Zach is a separate track — keep it out of Extraction.
- **Interoperate with Zach, don't absorb.** The consume seam is read-only against ADO; `00_reqs.md` stays the verification source of truth. Don't consume Zach's thinner `plan`/`implement`/`commit-task` commands.

---

## Pointers

- **Tracking:** Linear team `WF`, project *"WF Plugin — decoupling & Zach interop"* (3 milestones). Live status lives there.
- **v2 design (full rationale):** `_local/research/capability-registry-v2-design-2026-06-25.md` (gitignored; may be absent on a fresh clone). Prior notes: `decoupled-profile-architecture-2026-06-24.md`, `reusability-vs-generic.md`.
- **Authoring conventions:** repo-root [`CLAUDE.md`](../CLAUDE.md).
