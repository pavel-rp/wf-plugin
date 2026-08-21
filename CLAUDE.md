# Authoring the `wf` plugin

Engineering guide for building and editing the `wf` Claude Code plugin itself — its skills, agents, capabilities, and manifests. **Not loaded at skill runtime** — only when Claude Code works *on this repository*. Runtime behaviour lives in each skill's `SKILL.md`; the user-facing catalogue in [`plugins/wf/README.md`](plugins/wf/README.md).

**The two rules that govern everything else:** **core names zero stack/domain/project nouns** (§1), and **every change ships a version bump** (§8).

Deeper repo-specific detail (v1→v2 status, target-placement table, CI-guard mechanics, full versioning tiers) lives in [`docs/authoring-notes.md`](docs/authoring-notes.md) — read it on demand. General authoring detail is owned by the `wf-author-caps` skills, pointed to inline below rather than restated here.

---

## 1. The one rule: core vs capability

**Core ships zero stack, domain, or project knowledge.** Everything specific is a capability that attaches to the spine at runtime.

**Litmus test for every core change:** *would this still make sense for a totally different stack, domain, and project?* If a core skill names `AcmeLedger.Web`, `RiskSuite`, "LRP", "Angular", a C#→TS rule, or a 1:1-parity invariant, it's wrong — that knowledge belongs in a capability. After editing a core skill, grep it for stack/domain strings; **zero hits is part of "done".**

Sort anything new before you place it:

| Kind | Example | Home |
|---|---|---|
| Invariant **behaviour**, generic | the workflow spine, the gate model | a **core** skill |
| Invariant **behaviour**, stack/domain | a migration grammar, an Angular scaffold | a **capability** fragment or skill |
| Static **data** (stack/domain) | type-map, invariants, paths | the downstream `_local/` profile, shaped by a capability contract |
| Live **project data** | ADO work item, DB schema, codebase | an MCP / tool adapter |

Never push behaviour into data, and never let core name a concrete stack/domain/project noun.

---

## 2. What `wf` is

`wf` is a **domain-free Spec-Driven Development (SDD) harness** shipped as a Claude Code plugin. Core provides the workflow spine and a composition mechanism; all stack/domain/project knowledge enters through **capabilities**.

- A fixed **SDD phase spine** — `spec → plan → tasks → implement → verify → qa` — each phase a gated, human-approved markdown artifact feeding the next.
- A **capability registry** (default `_local/config.md`). Core iterates it; it never names a capability or assumes how many exist. Empty registry = fully generic core.
- Capabilities attach **prose fragments** to phases, typed by a fixed contribution taxonomy.
- A composed **constitution** of non-negotiable principles, established at setup, enforced at `verify`.
- Composition is **runtime inline-prose injection — no codegen, no compile step.** Core re-reads the registry every run.

> v1→v2 is in flight — the v2 composition mechanism has shipped; residual v1 skill bodies are still migrating. Build new things to the v2 shape; generalise v1 code toward it **staged, never big-bang** (§7). Status, history, and the reference `migration` adapter example: [`docs/authoring-notes.md`](docs/authoring-notes.md) · [`docs/ROADMAP.md`](docs/ROADMAP.md).

---

## 3. Repository map

`ls plugins/` is the current pack list; each pack's own README states what it provides. The core plugin is `plugins/wf/`, and `plugins/wf/mcp/` is the only non-prose subtree — the bundled Node/TS resolver runtime.

Each pack ships an `init` skill that self-registers its capability; `capabilities/<name>/manifest.md` declares its fragments. Component folders (`skills/`, `agents/`) live at the **plugin root**, never inside `.claude-plugin/` — auto-discovered on install. Per-pack detail is in each pack's own README/manifest; the deeper annotated map is in [`docs/authoring-notes.md`](docs/authoring-notes.md).

---

## 4. The SDD spine & capabilities

Phases are the **injection points**. A capability touches only the phases it has something to say about; a phase with no attached fragments runs exactly as if inert (no domain term surfaces).

| Phase | Contribution kind | Aggregation |
|---|---|---|
| `spec` (authoring hub) | authoring **guidance** | aggregate |
| `plan` | `artifact` | partition by ownership *(reserved — no active instance)* |
| `tasks` | **task-list** | aggregate |
| `implement` (authoring hub) | authoring **guidance** | aggregate |
| `verify` | `finding` | aggregate (provenance-tagged) |
| `qa-generation` | `scenario` | aggregate |
| `qa-execution` | `provider` | partition by surface; subagent dispatch |

- **aggregate** — follow every contributor in **registry order** (general → specific; most-specific wins last on additive guidance).
- **partition** — only the *owning* capability applies; overlapping ownership is a registry-validation error. `provider` partitions by a `surface` token; `artifact` by a `source→target` pair.
- `finding`/`scenario`/`article` carry provenance, so order is cosmetic.

**The registry** lives at `wf.config.js` `registryPath` (default `_local/config.md`), a `## Capabilities` table of `Capability | Path`. A `Path` is a repo-relative folder or a `plugin:<name>/<rel-path>` token resolved through a per-machine, gitignored `## Plugin Roots` map written by each pack's `init`. Table order = injection order.

**Capability kinds:** `adapter` (fragments only, no skills), `feature` (own skills/agents, may also attach fragments), `both`. Features compose **natively** (plugin install); fragments compose **via the registry** at runtime.

**The constitution** is composed not authored: core process articles + each registered capability's non-negotiables + the project's own clauses, aggregated by `/wf:constitution` (auto-invoked by `init`). Consulted as guidance at `spec`, enforced as findings at `verify`. **Precedence: project clauses override capability clauses**; a contradiction between two capabilities' articles is a registry-validation error.

**For the full taxonomy, manifest schema v2, aggregation semantics, and registry validation → invoke `/wf-author-caps:authoring-taxonomy`.**

---

## 5. Authoring skills & subagents

**Full frontmatter rules, body templates, subagent patterns, and canonical vocabulary → invoke `/wf-author-caps:authoring-guide`. To scaffold a conforming skill/capability/pack/provider → `/wf-author-caps:new-skill` · `new-capability` · `new-pack` · `new-provider` (these *are* the checklists).**

The traps that break silently — keep these resident:

- **Bare `name`, no `wf`/`wf-` prefix** (the namespace comes from the plugin; prefixing yields `/wf:wf-spec`). `name` must match the folder exactly; invalid characters cause silent load failure.
- **`description`** must stand alone (third-person what + when) — it's the only content preloaded for auto-selection. Avoid `<` `>` (break frontmatter parsing).
- **`allowed-tools`** lists built-ins only — **omit MCP tools** (`sourcebot`, ADO, `mssql_*`); their names are brittle across configs. Read-only skills omit `Write`/`Edit`.
- **H1 convention:** `# /wf:<name> — <tagline>`.
- **Body budget:** keep under ~500 lines; split into `references/<topic>.md` **one level deep** (no chains). **Runtime-read docs split ops/reference** — the ops doc is ≤150 behavior-bearing lines, rationale in a paired reference never read at runtime; TOC past 100 lines. (Test per clause: *does removing it leave a plausible-but-wrong next action?*)
- **Families:** group siblings sharing a concern as `<family>-<variant>` (`qa-gen`/`qa-run`/`qa-auto`); don't prefix a lone skill.

Subagents (`agents/<name>.md`, bare, auto-discovered) — the two CI-enforced gotchas:

- **Omit `tools:`** for any agent that must reach MCP. The field is a *restricting allowlist that overrides* the inherited toolset — declaring a narrow built-in list **silently starves the agent of MCP/ADO/`sourcebot`/DB tools**. Omitting is also the config-agnostic choice.
- **An agent never filesystem-reads a sibling skill body — it *invokes* it** via the Skill tool (`/wf:<skill>`). A `Read`/`Glob` of `${CLAUDE_PLUGIN_ROOT}/skills/*/SKILL.md` or `plugins/*/skills/*/SKILL.md` as a *load step* is a defect (trips the workspace-boundary prompt, breaks on the next version bump). A failed Skill invocation hard-stops into the agent's `— error` block; **never fall back to Reading the body.** Prose *references* to a skill path are fine — only a read/glob *instruction* is banned. Enforced by `out4-skill-read-guard.sh`.

---

## 6. Shared conventions (every skill enforces)

- **Config first.** Project values live in the downstream `_local/config.md`, never hardcoded; each tracker/delivery pack owns its own config section. Reading it is step one; if absent, stop and direct the user to `/wf:init`. To add a key, edit the default template in `skills/init/SKILL.md`, then reference it as `{placeholder}`.
- **Useful zero-argument default.** Id-inferring skills infer the id from the current branch (first 3+-digit run) via the delivery contract's `current-branch-query`; require an explicit arg only when inference fails.
- **Safety Rules** in prose (Allowed / Forbidden). **Never write outside `_local/`** — only exceptions: source-mutating skills (`implement`, `verify-fix`, `qa-followup`), `qa-host`, `ship` (scoped: the Phase 4.2 CI-remediation loop only), and `add-term` (scoped: the authoring glossary file only). `commit`/`pr` are the only delivery-writing skills; destructive VC operations stay forbidden everywhere.
- **The one committed-lifecycle exception.** The resolver runtime — and only it — manages **declared** committed lifecycle artifacts under `.wf/`: the portable install-state ledger `.wf/install-state.json`, the committed project-override tier `.wf/slots/<skill>.<point>.md`, and any destination a capability declares in a complete `## Payloads` row. **`.wf/` is not a general writable home** — authority comes from the resolver's *lifecycle ownership* plus a *declared artifact class*, never from the path prefix. An ordinary skill or agent reaches those artifacts through the resolver and still writes only inside `_local/`; this adds **no** skill to the exception list above. Enforced by `check-lifecycle-write-scope.sh` (in the `wf-core-authoring` pack's fixture suite), which rejects both an unowned write claim and an undeclared artifact class.
- **Final-output block.** Every skill ends with a fenced `NAME — status` block as the very last thing emitted (downstream skills grep it) — preserve the exact shape. User-invocable skills end it with a `Next:` line (or `Next: none — terminus`).
- **`## Edge Cases`** — exact heading for the stop-conditions section.
- **Model attribution.** Every artifact carries the runtime model id — a `**Model:** <id>` line (or verb-shaped variant: `**Fetched by:**`, `**Audited by:**`); write `unknown` rather than guessing.
- **Tool preferences.** Prefer indexed MCP (`sourcebot` for code, `mssql_*` for DB); fall back to `Grep`/`Glob` only when none fits. ADO MCP tools are read-only.
- **Per-task index.** After writing a per-task artifact, call `/wf:index <id> <slot> "<summary>"` (the sole writer of each task's `index.md`); it performs the single-row read-modify-write inline in the caller's context via the Skill tool — no dispatched subagent.

---

## 7. Working principles & anti-patterns

- **Stage, don't big-bang.** No compiler here — a one-shot refactor fails *silently*. One issue = one branch/PR with its own acceptance check.
- **Eval between stages.** Baseline a skill's behaviour before migrating; "done" = eval no worse than baseline.
- **Freeze the interface, not the gold-plating.** Pin the contract *shape* with only the slots the current step needs.
- **Reference the contract by slot/kind name** — never read a profile or fragment "by heading". Change the contract and its validator together.
- **Design for arbitrary capabilities** — never special-case one domain or assume a single active capability.

Anti-patterns: **no Windows-style paths** (forward slashes everywhere except regexes/real-escape fences); **don't offer multiple approaches without a default** (state the right tool; mention alternatives only as escape hatches); **don't punt to the model** ("the model will figure it out" is not a spec); **don't reference tools or frontmatter the runtime doesn't expose** (they pass through literally).

---

## 8. Plugin mechanics & versioning

**Every PR to `main` is a release.** Bump the touched plugin's two `version` fields — `plugins/<plugin>/.claude-plugin/plugin.json` **and** its `.claude-plugin/marketplace.json` `plugins[]` entry (kept equal) — **plus** the marketplace top-level `version` (bumps on any change). A change spanning N plugins bumps each plugin's pair + the top-level once. One bump per PR; on a mixed PR use the highest applicable tier:

- **PATCH** — no invocation-contract change: bug fix, reworded description, `references/` edit, **any docs-only change** (README, this file).
- **MINOR** — backward-compatible capability change: new skill/agent/family, new subcommand/argument, new config key or contribution kind. **Pre-1.0, breaking changes also bump MINOR** (renaming/removing a skill, changing an argument, changing a grepped final-output block shape).
- **MAJOR** — reserved, to declare the contract stable.

The "breaking" contract = the invocation surface: slash-command names, skill arguments, final-output block shapes. Manifest field-lists and full tier nuance: [`docs/authoring-notes.md`](docs/authoring-notes.md). Run `claude plugin validate` before publishing.

**Commit workflow.** **Always commit to a feature branch, never `main`.** Check first (`git rev-parse --abbrev-ref HEAD`); if `main`/`master`, create `feat/…`/`fix/…`/`chore/…` (`git checkout -b` carries dirty changes over). Stage, commit, push; the user opens the PR. The repo is prose-only **except `plugins/wf/mcp/`** (the bundled resolver runtime with its own `package.json`/lockfile/`dist/`).

**NO AI ADS.** Commit messages, PR descriptions, and any artifact a skill writes must **never** include `Co-Authored-By: Claude` trailers, "Generated with Claude Code" footers, or any AI-attribution, emoji, or promotional tagline. Commit like a human. Remove any such trailer you find in a template.

---

## 9. Editing rules

Edit `SKILL.md` in place — renaming/moving breaks invocation and existing task artifacts. Never hardcode project constants (add a config key). Preserve final-output block shapes. After editing a core skill, grep it for stack/domain strings — zero hits. Bump the version (§8).
