# Authoring the `wf` plugin

This is the engineering guide for building and editing the `wf` Claude Code plugin itself — its skills, agents, capabilities, and manifests. **It is not loaded at skill runtime.** It loads only when Claude Code is working *on this repository*. Runtime behaviour lives in each skill's `SKILL.md`; the user-facing catalogue lives in [`plugins/wf/README.md`](plugins/wf/README.md).

Read this top-to-bottom once, then use it as a lookup. The two rules that govern everything else: **core names zero stack/domain/project nouns** (§2), and **every change ships a version bump** (§11).

---

## 1. What `wf` is — and where the code is

`wf` is a **domain-free Spec-Driven Development (SDD) harness**, shipped as a Claude Code plugin. The core provides a workflow spine and a composition mechanism; *all* stack, domain, and project knowledge enters through **capabilities** that attach to the spine at runtime.

**The v2 model (what you are building toward):**

- A fixed **SDD phase spine** — `spec → plan → tasks → implement → verify → qa` — each phase a gated, human-approved markdown artifact that feeds the next.
- A **capability registry** in the downstream repo's `_local/config.md`. Core iterates it; it never names a capability or assumes how many exist.
- Capabilities attach **prose fragments** to phases, typed by a fixed **contribution taxonomy** (§4). Core renders any capability's output uniformly.
- A composed **constitution** of non-negotiable principles, established at setup and enforced at `verify`.
- Composition is **runtime inline-prose injection — no codegen, no compile step.** Core re-reads the registry every run; edit a fragment once and every project picks it up next run.

> **Status: v1 → v2 in flight.** The v2 composition mechanism has **shipped** — the frozen contracts in `plugins/wf/skills/_contracts/` (`capability-registry`/`invocation-runtime`), `validate-registry.sh` with its registry-fixtures, and several v2-wired skills (`verify-spec`, `qa-gen`, `qa-auto`, `tasks`, `constitution`, `run`); residual v1 skill bodies are still migrating toward it (e.g. the single `{domain}` assumption still baked into unextracted skill bodies). This guide describes the **v2 target**. When you add something new, build it to the v2 shape below. When you touch v1 code, generalise it toward v2 — **staged, never big-bang** (§10). Full rationale: `_local/research/capability-registry-v2-design-2026-06-25.md` (gitignored — may be absent on a fresh clone, so the essentials are carried here). Roadmap grounding: [`docs/ROADMAP.md`](docs/ROADMAP.md).

---

## 2. The one rule: core vs capability

**Core ships zero stack, domain, or project knowledge.** Everything specific is a capability.

**Litmus test for every core change:** *would this still make sense for a totally different stack, domain, and project?* If a core skill names `AuditTrakker.Web`, `ComplianceRisk`, "CRA", "Angular", a C#→TS rule, or a 1:1-parity invariant, it's wrong — that knowledge belongs in a capability. After editing a core skill, grep it for stack/domain strings; **zero hits is part of "done".**

Sort anything new before you place it:

| Kind | Example | Home |
|---|---|---|
| Invariant **behaviour**, generic | the workflow spine, the gate model | a **core** skill |
| Invariant **behaviour**, stack/domain | a migration grammar, an Angular scaffold | a **capability** fragment or skill |
| Static **data** (stack/domain) | type-map, invariants, paths | the downstream `_local/` profile, shaped by a capability contract |
| Live **project data** | ADO work item, DB schema, codebase | an MCP / tool adapter |

Never push behaviour into data, and never let core name a concrete stack/domain/project noun.

---

## 3. Repository map

```
.                              # marketplace repo root
├── CLAUDE.md                  # this file
├── .claude-plugin/
│   └── marketplace.json       # marketplace manifest (ships wf core + the wf-caps, wf-git, wf-ado, wf-linear packs)
├── plugins/wf/                # CORE PLUGIN — domain-free SDD spine
│   ├── .claude-plugin/
│   │   └── plugin.json        # plugin manifest
│   ├── README.md              # user-facing skill catalogue
│   ├── skills/                # one folder per skill (auto-discovered)
│   │   ├── <name>/SKILL.md
│   │   └── _contracts/        # v1 frozen foundation — sibling of the skill folders
│   └── agents/<name>.md       # subagent companions (auto-discovered)
├── plugins/wf-caps/           # DEFAULT-CAPABILITIES PLUGIN — non-core stack/domain skills + capabilities
│   ├── .claude-plugin/plugin.json
│   ├── skills/<name>/SKILL.md # e.g. migration-map (auto-discovered → /wf-caps:*)
│   ├── agents/<name>.md
│   └── capabilities/migration/ # the migration capability: manifest + fragments + profile
│       ├── manifest.md         # how it attaches to the spine
│       └── fragments/          # v2 fragment prose the migration capability attaches to the spine
├── plugins/wf-git/            # DELIVERY-PROVIDER PACK — the git capability owning the delivery surface
│   ├── skills/init/SKILL.md   # /wf-git:init — self-registration
│   └── capabilities/git/      # manifest.md + fragments/delivery.md (branch-create/commit/push-upstream/pr-create)
├── plugins/wf-ado/            # TRACKER-PROVIDER PACK — the ado capability owning the tracker surface
│   ├── skills/init/SKILL.md   # /wf-ado:init
│   └── capabilities/ado/      # manifest.md + fragments/tracker.md (Azure DevOps work-item bindings)
├── plugins/wf-linear/         # TRACKER-PROVIDER PACK — the linear capability (second, independent tracker binding)
│   ├── skills/init/SKILL.md   # /wf-linear:init
│   └── capabilities/linear/   # manifest.md + fragments/tracker.md (Linear MCP bindings)
├── docs/ROADMAP.md            # committed grounding doc
└── _local/                    # gitignored: research notes, working tracking
```

Component folders (`skills/`, `agents/`) live at the **plugin root**, never inside `.claude-plugin/` — Claude Code auto-discovers them on install. Only `plugin.json` (and, at repo root, `marketplace.json`) live in `.claude-plugin/`.

---

## 4. The SDD spine — phases, contributions, constitution

Phases are the **injection points**. A capability touches only the phases it has something to say about; a phase with no attached fragments runs exactly as if inert (no domain term surfaces).

| Phase | Role | What a capability contributes | Contribution kind |
|---|---|---|---|
| `spec` (Specify — **authoring hub**) | conventions, constraints, acceptance criteria, invariants | authoring **guidance** | aggregate |
| `plan` | correspondence/decomposition that can't live as spec prose | `artifact` | partition by ownership |
| `tasks` | opinionated decomposition into small, independently testable units | **task-list** | aggregate |
| `implement` (Implement — **authoring hub**) | stack idioms/scaffolds; apply the plan's mapping | authoring **guidance** | aggregate |
| `verify` | assert conformance to the spec + spec-derived invariants | `finding` | aggregate (provenance-tagged) |
| `qa-generation` | scenarios derived from acceptance criteria | `scenario` | aggregate |
| `qa-execution` | the execution engine + environment (browser driver, test-host) | `provider` | partition by surface; subagent dispatch |

**Aggregation policy by kind** (how core combines multiple contributors):

- **aggregate** — follow every contributor, in **registry order** (general → specific, so the most-specific wins last on additive `guidance`).
- **partition** — only the *owning* capability applies; overlapping ownership is a registry-validation error. `artifact` partitions by a `source→target` token pair (e.g. `csharp→ts`); `provider` partitions by a `surface` token (`engine`, `host`, …).
- `finding`/`scenario`/`article` carry **provenance**, so order is cosmetic for them.
- **Reserved — `artifact` at `plan` has no active instance.** It was modeled on the migration mapping, which is actually a `verify` `finding` (it audits *implemented* code). The slot is kept for a future **forward** `plan`-correspondence fragment — one authored from spec + source *before* code exists — **not** a post-implementation audit. Don't wire an audit skill here.

**The constitution** — non-negotiable principles, **composed not authored**:

- **Established** by a `/wf:constitution` skill, **auto-invoked by `init`** (re-runnable to update). It records the project's own clauses and the active registry; it does **not** bake a composed file — articles compose at runtime.
- **Consulted** as guidance at `spec`; **enforced** as `finding`s at `verify`.
- Core contributes domain-free **process** articles (spec is source of truth; no phase skips its gate; never commit to `main`; nothing writes outside `_local/` except designated source-mutating skills; model attribution on every artifact; no AI attribution in commits; config in `_local/config.md`). Each capability contributes its own non-negotiables.
- **Precedence: project clauses override capability clauses.** A contradiction between two *capabilities'* articles is a registry-validation error.

---

## 5. Capabilities — how knowledge attaches

**The registry** lives at a configurable location — `wf.config.js` `registryPath`, **defaulting to the downstream `_local/config.md`** when unset (default-absent path byte-identical to before the key existed):

```markdown
## Capabilities

| Capability | Path                    |
|------------|-------------------------|
| migration  | plugins/wf-caps/capabilities/migration |
| browser-qa | capabilities/browser-qa                |
```

Empty table = fully generic core. Name is decoupled from path so the binding survives a capability moving to a standalone plugin. Table order = deterministic injection order (general → specific).

A `Path` is one of two shapes, **both runtime-resolved**: a repo-relative folder (for a vendored capability), or a **plugin-anchored** `plugin:<plugin-name>/<rel-path>` token (for a capability shipping inside an installed plugin). The plugin-anchored token resolves through a `## Plugin Roots` mapping (`| Plugin | Root |`) co-located with the registry — the `<plugin-name>→install-root` datum `${CLAUDE_PLUGIN_ROOT}` alone can't supply (it resolves only the *executing* plugin's root). That mapping is **per-machine, gitignored, and written by a pack's own init skill** — e.g. `/wf-caps:init` records wf-caps's install root and self-registers its capabilities as plugin-anchored rows, collapsing onboarding to one command (no hand-edited `_local/config.md`); core only reads the generic map. Full semantics: `capability-registry.contract.md` §"The `## Plugin Roots` mapping".

**Capability kinds:**

| Kind | Provides | Composes via | Example |
|---|---|---|---|
| `adapter` | phase fragments only; ships no skills | registry (runtime injection) | `migration` |
| `feature` | its own skills/commands/agents; may also attach fragments | native plugin install **+** registry | `browser-qa` |
| `both` | skills **and** fragments | both | a whole-project add-on |

Two composition mechanisms, kept separate: **features compose natively** (install N plugins → their skills are all discoverable, no custom machinery); **phase fragments compose via the registry** at runtime.

**Manifest schema v2** (`{path}/manifest.md`):

- `kind:` `adapter` | `feature` | `both`.
- **Fragments table** — one row per fragment: `phase | contribution-kind | dispatch | scope`. `dispatch` is `inline: <rel-path>` (read-and-follow) or `subagent: <agent>` (heavy work). `scope` is required only for partitioned kinds — `provider` → a `surface` enum token; `artifact` → a `source→target` token pair.
- `skills:` — for `feature` kinds, where its skills live (documentation; native composition handles loading).
- `requires:` / `conflicts:` — optional; resolved at registry validation.

**Registry validation** (fail-fast script at `init`/`validate`, on top of the per-capability profile check):

- capability names unique; every declared `path` exists and carries a `manifest.md`;
- no overlapping ownership scopes (`artifact`/`provider`) across active capabilities — name both offenders;
- no contradictory `article` clauses across capabilities (project clauses override; capability-vs-capability contradiction fails);
- `requires:` satisfied, `conflicts:` not both active;
- every fragment row names a phase **and** contribution kind that core actually defines.

**Migration is the reference `adapter` capability.** Its v1 hooks map to v2 fragments: `rule-audit` → `finding` at `verify` (+ constitution `article`s); `parity-suite` → `scenario` at `qa-generation`; `mapping` (the migration-map 1:1 audit) → a second `finding` at `verify` — it audits an *implemented* migration against the legacy source (reads the migrated diff; stops if no target exists), so it is verify-time conformance, **not** a `plan` artifact; and it **gains** authoring `guidance` at `spec`/`implement` and a `task-list` at `tasks`.

---

## 6. What is core vs what extracts (target placement)

The current skills are v1-shaped. Their v2 homes:

| Stays **core** (generic) | Extracts to a **capability** |
|---|---|
| `spec`, `plan`, `tasks` (new), `implement`, `run` | `migration-map` → `migration` (adapter): `verify` `finding` (1:1 audit of an *implemented* migration — not a `plan` artifact) |
| `verify-spec`, `qa-gen`, `qa-run`, `qa-followup` (orchestration only) | `rule-audit` parity logic → `migration`: `verify` `finding` + constitution `article`s |
| `init`, `constitution` (new), `branch`, `commit`, `pr` | parity-suite → `migration`: `qa-generation` `scenario` |
| `classify`, `triage`, `index`, `lite`, `seed` | `qa-auto` browser driving → `browser-qa` (feature): `qa-execution` `provider` |
| | `qa-host`, `test-page` Angular scaffolding → an `angular` stack capability: `qa-execution` |

QA splits cleanly: orchestration (`qa-gen` plan structure, the `qa-run`/`qa-followup` loop, baseline-health) stays core; the browser **engine** and the stack **test-host** are provider capabilities; parity is a migration fragment.

**Delivery & tracker knowledge has fully extracted (WF-119 charter, closed at WF-137).** `init`, `branch`, `commit`, and `pr` stay **core** — they are no longer "core-with-git-inline". They now speak only the abstract delivery/tracker **contract operations** (`branch-create`, `commit`, `push-upstream`, `pr-create`, `current-branch-query`, `workspace-root-resolve`; `get`/`create_umbrella`/`create_child`/`update`/`list_children`/`post_comment`/`set_status`/`attach_link`), reached via **direct provider resolution**. The concrete git mechanics live in the `wf-git` **delivery `provider`** pack; the Azure-DevOps and Linear mechanics in the `wf-ado` and `wf-linear` **tracker `provider`** packs. With no delivery/tracker provider registered, core degrades to a **silent, local-only, `T<NNN>`-id, git-free bare-core mode**: every branch gate skips with a stated reason, id inference and workspace-root resolve via the plain-directory fallback, and no capability term surfaces.

---

## 7. Authoring a skill (`SKILL.md`)

Each skill folder (`skills/<name>/`) holds exactly one `SKILL.md`. Frontmatter is required.

```markdown
---
name: <skill-slug>
description: <Third-person sentence: what it does>. Use <the condition that triggers it>.
allowed-tools: [Read, Write, Edit, Glob, Grep, Bash]
---

# /wf:<name> — <short, self-documenting tagline>

<body>
```

**Frontmatter rules:**

- **`name`** — must match the folder name exactly. Lowercase letters, digits, hyphens; ≤64 chars. **Bare name, no `wf`/`wf-` prefix** (the `wf:` namespace comes from the plugin name; prefixing yields `/wf:wf-spec`). Invalid characters cause silent load failure.
- **`description`** — ≤1024 chars, **third person**, stating **what** the skill does **and when** to use it. It is the only content preloaded for auto-selection, so it must stand alone. Put the trigger early; avoid `<` `>` (they break frontmatter parsing).
- **`allowed-tools`** — required in this library. List the built-in tools the skill needs, tailored to its Safety Rules (read-only skills omit `Write`/`Edit`). **Omit MCP tools** (`sourcebot`, ADO, `mssql_*`) — their names are brittle across configs.
- **Optional invocation control:** `user-invocable: false` (auto-load only, no slash command); `disable-model-invocation: true` (slash command only, no auto-load). Don't introduce frontmatter fields outside this set — unrecognised fields pass through literally.

**H1 convention:** `# /wf:<name> — <tagline>` (slash command, em-dash, short tagline).

**Body budget & progressive disclosure:** keep the body under ~500 lines. When it grows, split into `references/<topic>.md` **one level deep** (no chains — partial reads miss deeply nested files). Link from `SKILL.md` explicitly. Give any reference file over ~100 lines a table of contents at the top.

**Namespace & families.** Skills are invoked `/wf:<skill>`; agents are referenced `subagent_type: wf:<agent>`. When two or more skills share a concern, group them with a `<family>-<variant>` bare name (`qa-gen`/`qa-run`/`qa-auto`; `test-node`/`test-page`). Don't introduce a family prefix for a lone skill — when a second sibling appears, rename the solo to fit the family in the same change.

**Body templates.** SDD-phase skills (`spec`, `plan`, `implement`) follow: (1) Prerequisites (read `_local/config.md`) → (2) Command Syntax + Arguments → (3) Safety Rules (Allowed/Forbidden in prose) → (4) Phases (numbered, self-contained) → (5) Templates → (6) `## Edge Cases` → (7) Final-output block. Auxiliary skills (`verify-spec`, `migration-map`, `test-*`) follow a dispatch-on-arguments shape: intro → when/when-not → a `###` block per subcommand (**include an empty-input default**) → shared conventions once → `## Edge Cases` → Final-output block. Copy from the closest existing skill rather than inventing structure.

---

## 8. Authoring a subagent (`agents/<name>.md`)

A skill may ship a subagent companion for **delegation-with-isolation**: the host invokes it via the **Task** tool (`subagent_type: wf:<name>`), the subagent reasons in an isolated context, and only its final block reaches the caller. All agent files live in the plugin's `agents/` folder, named `<skill-name>.md` (bare), auto-discovered on install.

**Add one when** the skill does focused read-only reasoning that yields a small structured output, the reasoning is verbose enough to pollute the caller, or the same task is called from several skills. **Don't** when the skill is action-oriented and used in one place, or its output is already one short line.

**Frontmatter:** `name` (matches the file) and `description` required; `model`, `color`, `argument-hint` optional. Set `user-invocable: false` to keep it Claude-only.

> **The `tools` field is a *restricting allowlist that overrides* the inherited toolset.** Omit it and the subagent inherits the full session — built-ins, the Task tool, **and every connected MCP server**. Declare a narrow built-in-only list and you **silently starve it of MCP/ADO/`sourcebot`/DB tools** (the bug that cut an earlier `phase-runner` off from ADO). So **omit `tools:`** for any agent that must reach MCP — which is why the converted agents here declare none. Omitting is also the config-agnostic choice (MCP server names vary per repo). Nested delegation works out of the box.

**Pick one of four patterns:**

| Pattern | Source of truth | Use when | Example |
|---|---|---|---|
| **B** — skill-primary, thin agent | skill body (procedure under a "caller, skip this" heading); agent is ~20 lines pointing at it | read-only reasoning, called from a few places, caller can pay the SKILL.md read | `classify` |
| **C** — agent-primary, thin skill | agent file (~100 lines, self-contained); SKILL.md (~50 lines) just spawns it and forwards the block | action-oriented skill that **gates** many others; callers invoke the subagent directly and pay zero caller-side cost | `branch`, `index` |
| **D** — orchestrator + utility agent | skill owns an outer loop + accumulation; agent does one heavy unit per iteration | heavy work repeats N times and each iteration's context can die between iterations | `run --auto` + `phase-runner` |
| **A** — duplicate-with-fallback | rubric mirrored in both files (expect drift) | rare — only when an inline fallback path is genuinely needed | — |

Default to **B** for read-only reasoning, **C** for action-oriented gates, **D** for repeated heavy work. **Output contract:** the subagent emits the same Final-output block shape as the skill, with no narrative outside it — consumers parse that block.

---

## 9. Shared conventions (every skill enforces)

- **Config.** Project values (`{task-root}`, `{verify-command}`, database names, paths, the capability registry) live in the downstream `_local/config.md`, not here — each registered tracker/delivery pack owns its own config section (e.g. `## Azure DevOps`, `## Linear`), not core. Reading that file is step one; if absent, stop and direct the user to `/wf:init`. To add a key, edit the default template in `skills/init/SKILL.md`, then reference it as `{placeholder}` — **never hardcode a project constant.**
- **Default modes.** Zero-argument invocation must do something useful. For id-inferring skills, infer the id from the current branch via the delivery contract's `current-branch-query` (first 3+-digit run), resolved against `{task-root}`; require an explicit arg only when inference fails.
- **Safety Rules.** Every skill declares explicit Allowed / Forbidden lists in prose. **Never write outside `_local/`** — the only exceptions are the source-mutating skills (`implement`, `verify-fix`, `qa-followup`) and `qa-host` (test scaffolding only). `commit`/`pr` are the only delivery-writing skills (beyond `branch`'s upstream push), and they act only through the delivery-provider contract; destructive version-control operations stay forbidden everywhere.
- **Final-output block.** Every skill ends with a fenced status block (`SPEC — Complete`, `BRANCH — <state>`, …) as the **very last thing emitted** — downstream skills and users grep for it. Preserve the exact `NAME — status` shape when editing.
- **Next-step suggestion.** Every user-invocable skill's final block ends with a `Next:` line naming the command(s) to run, or `Next: none — terminus`. Utility subagents consumed by callers (`classify`, `branch`, `index`) are exempt.
- **`## Edge Cases`.** Every skill's stop-conditions section uses this exact heading.
- **Tool preferences.** Prefer an indexed MCP tool (`sourcebot`) for code search, `mssql_*` for DB; fall back to `Grep`/`Glob` only when no indexed tool fits. ADO MCP tools are read-only for work-item fetches.
- **Model attribution.** Every artifact a skill writes carries the current model id in its metadata — a `**Model:** <id>` line (or a verb-shaped variant: `**Fetched by:**`, `**Generated by:**`, `**Audited by:**`). Use the id from the runtime's system prompt (e.g. `claude-opus-4-8`); write `unknown` if unavailable rather than guessing.

**Per-task index (`index.md`).** Each task folder under `{task-root}/{task-id}/` carries an `index.md` catalogue, maintained **exclusively by the `wf:index` subagent**. After writing any per-task artifact (or a string result like a branch name), a skill calls `/wf:index <id> <slot> "<summary ≤80 chars>"`; agents already holding the absolute path invoke the Task tool with `subagent_type: wf:index` directly. Slots are catalogued in `plugins/wf/agents/index.md`; unknown slots become custom rows. The underlying artifacts are the source of truth — a missed index call goes stale but loses nothing.

---

## 10. Working principles (guardrails for the v1 → v2 build)

- **Stage, don't big-bang.** This is prompt text with no compiler — a one-shot refactor fails *silently* (a worse QA plan, a false-positive verdict on the next real task). One issue = one branch/PR with its own acceptance check.
- **Eval between stages.** Use the `skill-creator` eval harness to baseline behaviour before migrating a skill; a migration is "done" only when its eval is **no worse than baseline**.
- **Freeze the interface, not the gold-plating.** Pin the contract *shape* with only the slots the current step needs; extend as later capabilities land.
- **Reference the contract by slot/kind name** — never read a profile or fragment "by heading". If the shape must change, change the contract **and** its validator together.
- **Design for arbitrary capabilities.** Never special-case "the migration domain" or assume one active capability — core composes whatever is registered (narrow, multiple, or a whole-project bundle).

**Anti-patterns:**

- **No Windows-style paths.** Forward slashes in all `SKILL.md` content, even on Windows — they work across PowerShell, Bash, Node, Git, and don't collide with markdown's escape character. Backslashes only inside regexes and real-escape code fences.
- **Don't offer multiple approaches without a default.** Pick the right tool and state it; mention alternatives only as escape hatches ("Use X; for Y, use Z instead").
- **Don't punt to the model.** If a step has an exact command, write it. If a decision has one right answer in context, make it. "The model will figure it out" is not a spec.
- **Don't reference tools or fields the runtime doesn't expose.** Undocumented frontmatter and references to non-existent helpers pass through literally.

---

## 11. Plugin mechanics

**Manifests.** `plugins/wf/.claude-plugin/plugin.json` carries `name` (`wf`), `version`, `description`, `author`, `repository`, `license`, `keywords`. `.claude-plugin/marketplace.json` carries the marketplace metadata and a `plugins[]` entry (`name`, `source: ./plugins/wf`, `version`, …). Run `claude plugin validate` before publishing; unrecognised fields warn, type mismatches fail.

**Versioning — multi-plugin marketplace.** The marketplace hosts more than one plugin (`wf` core + `wf-caps`), each versioned independently. Two invariants:

- **Per plugin:** `plugins/<plugin>/.claude-plugin/plugin.json` → `version` **equals** that plugin's `version` in the `.claude-plugin/marketplace.json` `plugins[]` entry. Bump both together when that plugin changes.
- **Marketplace:** `.claude-plugin/marketplace.json` → top-level `version` bumps on **any** change (a bump to any plugin, an added/removed plugin).

Plugins are consumed straight from the marketplace, so **every PR to `main` is a release — bump the touched plugin's two fields plus the marketplace top-level on every merged change** (a change spanning both plugins bumps each plugin's pair + the top-level). Pick the tier by what changed:

- **PATCH** (`0.5.0 → 0.5.1`) — no change to the invocation contract: a bug fix, reworded description, fixed URL, internal refinement, a `references/` edit, or **any docs-only change** (README, this file).
- **MINOR** (`0.5.0 → 0.6.0`) — a backward-compatible capability change: a new skill/agent, a whole new **family** (one bump for the batch), a new subcommand/argument, a new config key or contribution kind. **Pre-1.0, breaking changes also bump MINOR** — renaming/removing a skill, changing an argument, or changing a final-output block shape that downstream skills grep.
- **MAJOR** (`→ 1.0.0`) — reserved, to declare the contract stable. After 1.0 the breaking changes above move up to MAJOR.

One bump per PR; on a mixed PR use the **highest** applicable tier. The contract that defines "breaking" is the invocation surface: slash-command names, skill arguments, and final-output block shapes.

**Commit workflow.** **Always commit to a feature branch, never to `main`.** Check the branch first (`git rev-parse --abbrev-ref HEAD`); if it's `main`/`master`, create `feat/…`, `fix/…`, or `chore/…` (matching the `branch` prefix taxonomy) — `git checkout -b` carries any dirty changes onto it. Stage, commit, push; the user opens the PR. No build tooling lives in this directory — it is prose (no `package.json`, no lint configs).

**NO AI ADS.** Commit messages, PR descriptions, and any artifact a skill writes must **never** include `Co-Authored-By: Claude` trailers, "Generated with Claude Code" footers, or any AI-attribution, emoji, or promotional tagline. Commit like a human. Remove any such trailer you find in an existing template.

---

## 12. Adding things — checklists

**New skill:** ① bare `<name>` slug (no `wf-`). ② `skills/<name>/SKILL.md` with frontmatter (`name` = folder; third-person `description` with what + when; tailored `allowed-tools`). ③ H1 `# /wf:<name> — <tagline>`. ④ body from the closest existing skill template. ⑤ define the zero-argument default. ⑥ `## Edge Cases`. ⑦ Final-output block ending in `Next:`. ⑧ if it reads config, point missing-file users to `/wf:init`. ⑨ if it warrants isolation, add `agents/<name>.md` (pick pattern B/C/D — §8). ⑩ if it produces a per-task artifact, call `/wf:index`. ⑪ update `plugins/wf/README.md`. ⑫ bump the version (§11).

**New capability:** ① choose `kind` (adapter/feature/both). ② create `{path}/manifest.md` with the fragments table (`phase | contribution-kind | dispatch | scope`). ③ author each fragment as prose at the path its row names. ④ for partitioned kinds, declare a non-overlapping `scope` (`surface` token / `source→target` pair). ⑤ add constitution `article`s if it has non-negotiables. ⑥ for `feature` kinds, ship skills/agents as a normal plugin and document them under `skills:`. ⑦ if it fills contract slots with project values, ship an authoritative default template — the baseline shape (which may carry angle-bracketed placeholder slots) a project overrides — and declare it via `profile-template:` — `init` seeds a downstream override at `_local/profiles/<name>.profile.json` only on divergence (hybrid precedence: override > default). ⑧ register it in the `## Capabilities` registry (at the `registryPath`-resolved location, default `_local/config.md`). ⑨ ensure registry validation passes (§5).

**Editing rules:** edit `SKILL.md` in place — renaming/moving breaks invocation and existing task artifacts. Never hardcode project constants (add a config key instead). Preserve final-output block shapes. After editing a core skill, grep it for stack/domain strings — zero hits.