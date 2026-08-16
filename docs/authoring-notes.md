# Authoring notes — deferred detail

Repo-specific lookup that [`CLAUDE.md`](../CLAUDE.md) points at but doesn't keep resident. Read on demand. General authoring detail (taxonomy, schema, frontmatter, templates) is owned by the `wf-author-caps` skills — invoke `/wf-author-caps:authoring-taxonomy` or `/wf-author-caps:authoring-guide` rather than duplicating it here.

## Table of contents

- [v1 → v2 status](#v1--v2-status)
- [Target placement — what is core vs what extracts](#target-placement--what-is-core-vs-what-extracts)
- [The migration reference adapter](#the-migration-reference-adapter)
- [CI-guard mechanics](#ci-guard-mechanics)
- [Versioning tiers & manifest fields](#versioning-tiers--manifest-fields)

---

## v1 → v2 status

The v2 composition mechanism has **shipped** — the frozen contracts in `plugins/wf/skills/_contracts/` (`capability-registry`/`invocation-runtime`), `validate-registry.sh` with its registry-fixtures, and several v2-wired skills (`verify-spec`, `qa-gen`, `qa-auto`, `tasks`, `constitution`, `run`). Residual v1 skill bodies are still migrating (e.g. the single `{domain}` assumption still baked into unextracted bodies).

When you add something new, build it to the v2 shape. When you touch v1 code, generalise it toward v2 — **staged, never big-bang** (`CLAUDE.md` §7). Full rationale: `_local/research/capability-registry-v2-design-2026-06-25.md` (gitignored — may be absent on a fresh clone). Roadmap grounding: [`ROADMAP.md`](ROADMAP.md).

Delivery & tracker knowledge has **fully extracted** (WF-119 charter, closed at WF-137). `init`, `branch`, `commit`, and `pr` stay **core** — they speak only the abstract delivery/tracker **contract operations** (`branch-create`, `commit`, `push-upstream`, `pr-create`, `current-branch-query`, `workspace-root-resolve`; `get`/`create_umbrella`/`create_child`/`update`/`list_children`/`post_comment`/`set_status`/`attach_link`), reached via direct provider resolution. Concrete git mechanics live in `wf-git`; Azure-DevOps and Linear in `wf-ado`/`wf-linear`. With no delivery/tracker provider registered, core degrades to a **silent, local-only, `T<NNN>`-id, git-free bare-core mode**: every branch gate skips with a stated reason, id inference and workspace-root resolve via the plain-directory fallback, no capability term surfaces.

---

## Target placement — what is core vs what extracts

The current skills are v1-shaped. Their v2 homes:

| Stays **core** (generic) | Extracts to a **capability** |
|---|---|
| `spec`, `plan`, `tasks`, `implement`, `run` | `migration-map` → `migration` (adapter): `verify` `finding` (1:1 audit of an *implemented* migration — not a `plan` artifact) |
| `verify-spec`, `qa-init`, `qa-gen`, `qa-run`, `qa-followup`, `tt` (orchestration only) | `rule-audit` parity logic → `migration`: `verify` `finding` + constitution `article`s |
| `init`, `constitution`, `branch`, `commit`, `pr`, `tf` | parity-suite → `migration`: `qa-generation` `scenario` |
| `classify`, `triage`, `index`, `lite`, `seed`, `standup` | `qa-auto` browser driving → `browser-qa` (feature): `qa-execution` `provider` |
| | `qa-host`, `test-page` Angular scaffolding → an `angular` stack capability: `qa-execution` |

QA splits cleanly: orchestration (`qa-gen` plan structure, the `qa-run`/`qa-followup` loop, baseline-health) stays core; the browser **engine** and stack **test-host** are provider capabilities; parity is a migration fragment.

**Reserved — `artifact` at `plan` has no active instance.** It was modeled on the migration mapping, which is actually a `verify` `finding` (it audits *implemented* code). The slot is kept for a future **forward** `plan`-correspondence fragment — authored from spec + source *before* code exists — not a post-implementation audit. Don't wire an audit skill here.

---

## The migration reference adapter

**Migration is the reference `adapter` capability** (ships in the private `wf-caps` marketplace since WF-261 — no longer in this repo, but still the documented example). Its v1 hooks map to v2 fragments: `rule-audit` → `finding` at `verify` (+ constitution `article`s); `parity-suite` → `scenario` at `qa-generation`; `mapping` (the migration-map 1:1 audit) → a second `finding` at `verify` — it audits an *implemented* migration against the legacy source (reads the migrated diff; stops if no target exists), so it is verify-time conformance, **not** a `plan` artifact; and it **gains** authoring `guidance` at `spec`/`implement` and a `task-list` at `tasks`.

---

## CI-guard mechanics

The rules these enforce are stated resident in `CLAUDE.md` §5; the mechanism is here.

**Canonical vocabulary.** `plugins/wf/skills/_contracts/GLOSSARY.md` — one entry per term, each carrying the ERE that makes it violation-testable. `glossary-lint.sh` parses that file directly (no rule transcribed into the script) and fails drifting prose, naming the file, the offending term, and the canonical alternative. It takes an explicit file set (`glossary-lint.sh <file>...`) or `--selftest` — no whole-tree default (the severity model is on-touch). `GLOSSARY.md` itself and every `*-fixtures/` folder under `_contracts/` are structurally off the surface.

**On-touch PR gate.** `glossary-on-touch.sh` supplies that file set: it diffs against the PR's base commit, filters the touched set to the lint surface (`plugins/*/skills/**/*.md`, `plugins/*/capabilities/**/*.md`, `plugins/*/agents/*.md`, minus the structural exclusions), and lints exactly that. **A violation hard-fails on a file the PR touched, and always on a file it added; an untouched pre-existing violator never fails the gate.** When nothing touched is on the surface, the gate skips and passes; when the touched set comes back empty it fails loudly (so a shallow checkout can't silently disable it). It runs as its own step in `.github/workflows/ci.yml` (it needs the base sha, which the guard chain can't see); `registry-fixtures/run.sh` gates its scoping self-test.

**Ops-doc budget.** `check-ops-docs.sh` enforces the ≤150-line runtime-read ops budget. Since WF-369 it and `skill-slot-marker-lint.sh` are carried by the `wf-core-authoring` pack (`plugins/wf-core-authoring/capabilities/core-authoring/fixtures/`) and registered in that folder's own `run.sh`, which CI discovers by convention — core's `registry-fixtures/run.sh` no longer invokes either.

**Sibling skill-read guard.** `out4-skill-read-guard.sh` (wired into the CI chain via `registry-fixtures/run.sh`) fails any PR reintroducing a filesystem-read *instruction* against a sibling skill body; its instruction-vs-prose classifier and false-positive exclusions are documented in the script header.

---

## Versioning tiers & manifest fields

Tier selection and the every-PR-is-a-release rule are resident in `CLAUDE.md` §8. The manifest field-lists:

**`plugins/wf/.claude-plugin/plugin.json`** carries `name` (`wf`), `version`, `description`, `author`, `repository`, `license`, `keywords`.

**`.claude-plugin/marketplace.json`** carries the marketplace metadata, a top-level `version`, and a `plugins[]` entry per plugin (`name`, `source: ./plugins/<plugin>`, `version`, …). Unrecognised fields warn; type mismatches fail `claude plugin validate`.

**Capability `manifest.md` (schema v2):**

- `kind:` `adapter` | `feature` | `both`.
- **Fragments table** — one row per fragment: `phase | contribution-kind | dispatch | scope`. `dispatch` is `inline: <rel-path>` (read-and-follow) or `subagent: <agent>` (heavy work). `scope` is required only for partitioned kinds — `provider` → a `surface` enum token; `artifact` → a `source→target` pair.
- `skills:` — for `feature` kinds, where its skills live (documentation; native composition handles loading).
- `profile-template:` — when it fills contract slots with project values; `init` seeds a downstream override at `_local/profiles/<name>.profile.json` only on divergence (override > default).
- `requires:` / `conflicts:` — optional; resolved at registry validation.

**Registry validation** (fail-fast at `init`/`validate`): capability names unique; every declared `path` exists and carries a `manifest.md`; no overlapping ownership scopes across active capabilities (name both offenders); no contradictory `article` clauses (project clauses override; capability-vs-capability contradiction fails); `requires:` satisfied and `conflicts:` not both active; every fragment row names a phase and contribution kind core actually defines.
