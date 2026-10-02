# `_local/config.md` default content template

The verbatim template `/wf:init` writes at Phase 2 (substituting the detected Verify Command and the current model id). Read this on the write path only. The `## Capabilities` section's destination follows Phase 2's "One registry, never two" rule — same-file case keeps it here; relocated case writes it only to the resolved registry file. **Strip the `<!-- init directive … -->` HTML comment before writing — it must never reach a written file.**

## Contents

- [Default content](#default-content) — the full fenced config template

## Default content

```markdown
# Skills Configuration

**Model:** <current model id>

Project-specific values used by all `wf:*` skills. Skills MUST read this file at startup and substitute these values — never hardcode them.

## Task Folders

| Key | Value |
|-----|-------|
| **Task Root** | `_local` |
| **Folder Pattern** | `{task-root}/T<NNN>/` (e.g. `_local/T001/`) — the tracker contract's empty-registry default (`capability-registry.contract.md` §"The tracker provider surface", "The id-shape rule"). An active tracker capability supplies its own id shape once registered. |

## Build / Verify

| Key | Value |
|-----|-------|
| **Verify Command** | `<detected by wf:init — see note below>` |

Must exit 0 when the project typechecks (including framework-level checks: templates, metadata, decorators) and non-zero on any error. `wf:init` infers this from your project's `package.json` scripts and framework signals — review the value after running and adjust if the detection picked the wrong script or directory. Used by `wf:plan`, `wf:lite`, and `wf:implement` before they hand off a diff.

## Ship

| Key | Value |
|-----|-------|
| **Context Ceiling** | `150000` |

The stated context bound for a single `/wf:ship` run, in approximate accumulated tokens per shipper. `/wf:ship` checks it at each inter-phase boundary (after a phase's output is committed and pushed); when the run's estimated accumulated context would cross the ceiling, ship flushes and **hands off to a fresh `/wf:ship <id>`** that resumes detect-first — so a long ship stays bounded and still reaches a merged PR with no lost state. **Lower it to force an earlier hand-off** (useful for exercising the crossing); raise it to let a run grow further before handing off. An absent or `<none>` value falls back to the shipped default (`150000`), so a repo initialized before this key existed degrades gracefully. Consumed only by `/wf:ship`.

## Fleet

| Key | Value |
|-----|-------|
| **Review Wait Minutes** | `30` |

How long `/wf:fleet` waits for a requested pull-request review, in whole minutes, measured from the moment it first observes a shipper hand back `awaiting review`. The orchestrator owns this deadline: it records it in the item's scoreboard row, wakes once it has passed, and continues the shipper at most once per accepted send, so a shipper never polls for a review itself. A stop after the runtime accepts the send but before the orchestrator records it can deliver one duplicate continuation; it is harmless, because the resumed run repeats no side effect. `0` means no wait is possible — the item is recorded `review not awaited`, never a pass, and nothing merges. An absent, `<none>`, or unparseable value falls back to the shipped default (`30`), so a repo initialized before this key existed degrades gracefully. Consumed only by `/wf:fleet`.

## Worktree Setup

| Key | Value |
|-----|-------|
| **Dependency Setup Command** | `<none>` |
| **Dependency Setup Timeout** | `600` |

The **one** command that installs this project's dependencies in a freshly prepared worktree — run by the resolver's `run_workspace_setup` in the worktree root, through the platform shell, exactly as written here. `/wf:fleet` has every shipper run it after `prepare_workspace` and before the ceremony, and a failure or a timeout stops that item with a named reason before any phase runs. Only this project config declares it: no capability can supply or inject one. Leave it `<none>` when the project needs no install step — nothing runs then. **Dependency Setup Timeout** is the bound in whole seconds (default `600`, ceiling `3600`). A repo initialized before these keys existed simply has no `## Worktree Setup` section and runs nothing.

**How a value cell is read (every `| **Key** | value |` row in this file).**
- The value is the whole second cell.
- A `|` inside a backtick code span belongs to the value, verbatim. For example, `` `npm ci | tee install.log` `` is the complete pipeline.
- Outside a code span, write a literal pipe as `\|`. For example, `npm ci \| tee install.log` reads as `npm ci | tee install.log`.
- Any other `|` ends the cell, so a third column after the value is ignored.
- Inside a code span, `\|` stays exactly as written.

**How the setup run behaves.**
- The run is serialized per worktree under `_local/resolver/setup.lock`. A concurrent caller waits for the holder and then reports `already-done` instead of running the command again.
- On a timeout, or once the command exits, every process the command started is stopped before the result is reported.

## Version Check

| Key | Value |
|-----|-------|
| **Version Declaration** | `<none>` |

The workspace-relative path (forward slashes) of the file that declares the version of the unit this workspace **publishes** — the already-resolved declaration a run hands to the delivery surface's `newest-published-version-read` when it checks whether the version it is executing still matches the newest published one. It names a *declaration*, never where versions are published. Leave it `<none>` unless this workspace publishes the unit its runs execute: with no declaration there is nothing to ask a published state for, and the currency check renders `not checked — no version declaration configured` — a **stated** non-check, never a report that the installation is current. Read once at Prerequisites by the run-driving skills, at a cost of one provider read per run and none per item. A repo initialized before this key existed simply has no `## Version Check` section and degrades to the same stated non-check.

## QA

| Key | Value |
|-----|-------|
| **QA Baseline Ignore** | `<none>` |
| **QA Rules** | `<none>` |
| **API Controllers Root** | `<auto-detect>` |

**QA Baseline Ignore** — optional allowlist for the **Baseline health** suite `/wf:qa-gen` adds to every plan (no console errors, no failed network requests, view renders). One pattern per line or comma-separated; each is a plain substring or `/regex/`. Console messages and request URLs/statuses matching any pattern are treated as known-benign and won't fail a baseline check — e.g. a noisy third-party widget warning, or an analytics beacon that 404s in dev. Leave as `<none>` to tolerate nothing. Consumed by `/wf:qa-gen`, `/wf:qa-auto`, and `/wf:qa-run`.

**QA Rules** — optional path to the project QA-rules artifact written by `/wf:qa-init` (default `_local/wf-qa.md`). When set, the QA report's severity rubric — defined in `qa-gen`'s report-format reference and applied when `07_qa-report.md` is written — resolves from that artifact instead of the built-in default; the artifact also holds the project's risk-area and environment rules. Leave as `<none>` until `/wf:qa-init` has run — an absent or `<none>` value is treated as not set (built-in default). Referenced everywhere as `{qa-rules}`; `/wf:qa-init` sets it and `/wf:qa-gen` reads it.

**API Controllers Root** is used only by the backend-exercise path (`Type: API` scenarios) — leave the default unless your project differs: directory (relative to repo root) that contains the project's API controller source, used by the `qa-execution` host provider's `api-probe` operation to find a host controller. `<auto-detect>` globs the project's controller-source pattern (skipping compiled-output directories).

## Seed

| Key | Value |
|-----|-------|
| **Architecture Doc** | `<ARCHITECTURE_DOC: repo-relative path (forward slashes) to the default architecture/design doc /wf:seed parses when called with no argument>` |
| **Backlog Path** | `{task-root}/BACKLOG.md` |

The two keys `/wf:seed` reads. **Architecture Doc** is the doc parsed on a zero-argument `/wf:seed` — leave the placeholder until you have an architecture/design doc to seed action items from (or always pass the doc explicitly: `/wf:seed <doc>`). **Backlog Path** is where the append-only backlog is written; the `{task-root}/BACKLOG.md` default suits most projects. A repo initialized before this section existed simply has no `## Seed` keys — `/wf:seed` degrades gracefully (the explicit-doc form still works, and Backlog Path falls back to the same default).

## Standup

| Key | Value |
|-----|-------|
| **Standup Statuses** | `<none>` |

The default tracker workflow statuses `/wf:standup` enumerates open work items for, comma-separated in significance order (most active first — e.g. the in-progress status before the not-started one). `/wf:init` **asks** for this value once and writes the answer here — it is not a key you are expected to discover and fill in by hand. Three states are distinguishable, and a consumer must keep them distinct:

- **Never asked** — the row is absent, or holds the scaffold-time `<none>`. The question has not been put to anyone yet; a repo initialized before the question existed sits here.
- **Skipped** — the row holds `<skipped>`. The user was asked and explicitly declined. That is a real, recorded answer rather than a gap: do not re-ask it, and do not report it as missing configuration.
- **Answered** — any other value: the comma-separated status list to enumerate.

Status names are tracker-specific, so no shipped default could be meaningful. In the never-asked and skipped states alike, `/wf:standup` skips only the by-status work-item section and still renders milestones, cycles, recent activity, and local in-flight tasks; `--status` overrides the configured value in every state.

## Routing

| Role | Model | Effort |
|------|-------|--------|

Optional per-project child-dispatch overrides. Add one row per role using a lowercase role slug (for example `| classify | sonnet | — |`). `Model` accepts a runtime-supported stable alias or full identifier; `Effort` accepts `low`, `medium`, `high`, or `max`. Leave either cell empty or use `—` to inherit that selector independently. The table intentionally starts empty: core ships `haiku` model defaults for `classify` and `branch` and top-tier `opus` defaults for `shipper` and `phase-runner`, while effort remains inherited. Most roles with no row inherit both values. The exception is a role with a **complexity-derived** disposition — currently `finalize` — whose model the resolver computes from the call site's own shape evidence when nothing higher-precedence is set; adding a row for that role here is the documented way to override it back to a fixed value. Effort is never derived.

Immediately before a routed child spawn, core calls the body-free `resolve_routing` resolver query. Precedence is host enforcement → invocation override → this project table → shipped role default → complexity-derived selection → inheritance. The returned operational metadata identifies each selector's source plus any masking or fallback; it never replaces an artifact's `**Model:**` attribution. Optional malformed, unavailable, or selector-unsupported choices record an inheritance fallback rather than claiming the override was honored; required-but-unhonorable choices stop before dispatch.

## Capabilities

<!-- init directive (strip before writing — never emit this comment to any file):
     This `## Capabilities` section goes to the Phase 0 RESOLVED registry location only.
     Resolved location == `_local/config.md` → keep this section here. Resolved location is a
     different file → write this section only to that file, NOT here. See Phase 2 "One registry, never two". -->

| Capability | Path                   |
|------------|------------------------|

The capability registry (see `plugins/wf/skills/_contracts/capability-registry.contract.md`). Each row activates one capability: `Capability` is its name (its identity, decoupled from where it lives) and `Path` is where its `manifest.md` lives, in one of two accepted shapes (forward slashes in both): (a) a **repo-relative folder** (e.g. `plugins/wf-audit/capabilities/audit`), or (b) a **plugin-anchored token** `plugin:<plugin-name>/<rel-path>` naming a capability inside an installed plugin — resolved via the **`## Plugin Roots`** mapping co-located with this table (see the contract's "The two `Path` shapes" and "The `## Plugin Roots` mapping"; run the pack's own self-registering `/init`, e.g. `/wf-git:init`, to populate both). **An empty (header-only) table = fully generic core** — no capability fires and every capability-aware phase runs inert. **One row per active capability.** **Table order = injection order** (general → specific): for additive guidance the most-specific capability is injected last and wins; for provenance-tagged contributions order is cosmetic. Add a row to register a capability (e.g. `audit | plugins/wf-audit/capabilities/audit`).
```
