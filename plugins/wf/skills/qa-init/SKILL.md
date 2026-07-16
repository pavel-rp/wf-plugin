---
name: qa-init
description: Builds or refreshes a project QA-rules artifact under _local/ for the QA family — /wf:qa-gen reads it at plan-generation time, and the QA report's severity rubric (defined in qa-gen's report-format reference, applied by the run-assistants when 07_qa-report.md is written) resolves from it. Does a bounded read-only scan that detects the project's own stack, risk, and environment signals and reflects them back, asks a domain-free questionnaire (risk areas, environment, severity, acceptance), writes the rules file with a project severity rubric, and sets the qa-rules config key to the artifact path. Re-runnable — update mode merges newly-derived rules while preserving manual edits. Use before /wf:qa-gen to give the QA flow project-specific severity and risk rules, or to refresh them as the project evolves.
allowed-tools: [Read, Write, Edit, Glob, Grep, Bash]
---

# /wf:qa-init — Project QA-rules builder

Build or refresh a project **QA-rules artifact** — the file the QA report's severity rubric resolves from, and the home for the project's risk, environment, and acceptance rules. `/wf:qa-gen` reads the pointer at plan-generation time; the rubric itself is applied when `07_qa-report.md` is written — by the run-assistants (`/wf:qa-run`, `/wf:qa-auto`) following `qa-gen`'s report-format reference. The skill does a bounded, read-only scan that **detects** the project's own signals and **reflects** them back (it names no fixed stack — the taxonomy is discovered at runtime, never enumerated), asks a domain-free questionnaire seeded by those signals, writes one artifact under `_local/`, and sets the `{qa-rules}` config key to its path.

This is the **one mechanism** behind the `qa-rules` hook: `/wf:qa-init` writes the artifact and sets the pointer; `/wf:qa-gen` reads `{qa-rules}`, and the report format it defines resolves the severity rubric from that same artifact when the report is written. With `{qa-rules}` unset, the report format falls back to its built-in default — nothing breaks.

**Read-mostly authoring skill.** It reads the repo, writes exactly one artifact under `_local/`, and updates the config key (also under `_local/`). It never touches source, and update mode never clobbers manual edits.

---

## Prerequisites

**Before any other phase**, obtain project config from the bundled `wf-resolver` MCP service via `resolve_config` — it returns `{ workspaceRoot, registryPath, coreConfig{ taskRoot, qaRules, … }, idShape }`, already resolved from `_local/config.md` (core performs no direct config-file parse). If the resolver reports the project is uninitialized (no resolved config / absent `_local/config.md`), stop and instruct the user to run `/wf:init` first. If the `wf-resolver` service is unavailable, stop and report that the resolver runtime is not loaded (restart Claude Code) — do not hand-parse config as a fallback. Read:

- `{task-root}` (`coreConfig.taskRoot`) — used only to keep the artifact out of task folders (the artifact is project-level, not per-task).
- `{qa-rules}` (`coreConfig.qaRules`) — the current pointer, if set. An absent or `<none>` value means no artifact exists yet (create mode). A set value naming an existing file means update mode.

Never hardcode any of these — they all resolve from `_local/config.md` via the resolver. The one direct `_local/config.md` **write** this skill performs is setting the `{qa-rules}` key in Phase 5 — see that phase.

---

## Command Syntax

```
/wf:qa-init [path]
```

### Arguments

| Argument | Required | Description |
| -------- | -------- | ----------- |
| `[path]` | NO | Optional repo-relative override for the artifact location (forward slashes, must stay inside `_local/`). Defaults to the current `{qa-rules}` value when set, otherwise `_local/wf-qa.md`. |

**Zero-argument default:** a bare `/wf:qa-init` does the full build/refresh — it resolves the artifact path from `{qa-rules}` (or the default), scans, asks the questionnaire, writes/merges the artifact, and sets `{qa-rules}`. No argument is ever required.

**Validation:**

- If `[path]` is given and resolves outside `_local/`, stop: "The QA-rules artifact must live inside `_local/`. Pass a path under `_local/` or omit the argument."
- If `[path]` disagrees with an already-set `{qa-rules}` pointing at a different existing file, stop and ask which to use before writing (see Edge Cases) — never silently strand the old artifact.

---

## Safety Rules (NON-NEGOTIABLE)

**Allowed:**

- Read any file in the project (`Read`, `Glob`, `Grep`) for the bounded detect-and-reflect scan.
- Write or merge the single QA-rules artifact **inside `_local/` only**.
- Update the `{qa-rules}` key in `_local/config.md` (inside `_local/`).

**Forbidden:**

- Modify any source file, spec, plan, or any file outside `_local/`.
- Name a concrete stack, language, framework, product, or project in this skill body — signals are **detected and reflected**, never enumerated as a fixed taxonomy.
- Run builds, tests, installs, or any version-control operation.
- Restructure or overwrite an existing artifact in a way that could drop manual edits — update mode **merges** (see Phase 4); anything riskier is an ask-first boundary.
- Add AI-attribution, emoji, or promotional text to the artifact or any file.
- Exceed the scan budget in Phase 2.

---

## Phase 1: Resolve mode and artifact path

1. **Resolve the artifact path.** Use `[path]` if given; else `{qa-rules}` if set; else the default `_local/wf-qa.md`.
2. **Determine the mode.**
   - **Create mode** — the resolved path names no existing file. Build the artifact from scratch.
   - **Update mode** — the resolved path names an existing file. Read it in full first; Phase 4 merges into it, preserving manual edits.
3. Report the resolved path and mode before scanning.

---

## Phase 2: Bounded detect-and-reflect scan

Detect the project's own signals so the questionnaire and the artifact speak in the project's terms. **Detect by mechanism, never by enumerating a taxonomy** — read what the repo reveals and reflect the names *it* uses back to the user.

**Hard budget — respect it strictly:**

- At most **4** searches (`Grep`/`Glob`).
- At most **6** file reads.
- Stop the moment you have enough to seed the questionnaire. Burning the budget is not a goal.

**What to detect (by reading, not guessing):**

1. **Primary stack** — read the dependency-manifest and lock files, top-level config filenames, and the dominant source-file extensions to infer the project's primary language, framework, and test tooling. Record the names the repo itself uses.
2. **Runtime surfaces** — how the project is exercised: a user-facing app, one or more service endpoints, a command-line entry point, background workers. Note which are present.
3. **Shared-infrastructure risk surfaces** — locate the modules/directories that concentrate blast radius: authentication, persistence, data migrations, security boundaries, and any billing or compliance controls the repo names. Note which exist.
4. **Existing quality signals** — whether a test suite, a typecheck/build command, a lint config, or existing QA artifacts are already present. This calibrates how strict the acceptance bar should be.

**Reflect, don't assert.** Summarize the detected signals back in the project's own vocabulary — a short "here's what I detected" list — and let the user correct it. If a search returns nothing distinctive (sparse or unfamiliar repo), say so plainly and lean on the questionnaire; never invent a stack the repo doesn't show.

---

## Phase 3: Domain-free questionnaire

Ask a compact set of questions, **seeded by the reflected signals** from Phase 2. Keep them generic — the project supplies the specifics. Group into four areas; skip any the user has already answered via config or prior artifact.

1. **Risk areas** — which surfaces are highest-stakes (where a mistake hurts most), and which are low-risk. Offer the detected shared-infrastructure surfaces as a starting point for the user to confirm or amend.
2. **Environment** — how QA scenarios are run and what preconditions they need: the runtime surfaces detected above, auth/credential state, data fixtures or seed state, and any known-benign noise to tolerate.
3. **Severity** — how failures map to High / Medium / Low for this project. Seed with the built-in default (High = data correctness, auth, security, release-blocker; Medium = important-flow regression; Low = visual/polish) and let the user adjust the boundaries to their domain.
4. **Acceptance** — the standing bar every change must clear before it ships (e.g. which checks are non-negotiable, what "done" means for a QA pass here).

Ask only what you can't already answer from the scan or an existing artifact. In update mode, focus the questions on what has changed since the artifact was last written.

---

## Phase 4: Write or merge the artifact

Write to the resolved path (inside `_local/`). Use the template below; substitute the reflected signals and the questionnaire answers. The artifact carries a `**Model:**` line and **no AI-attribution, emoji, or promotional text**.

**Create mode:** write the full artifact from the template.

**Update mode (merge — never clobber):**

1. Read the existing artifact in full (already done in Phase 1).
2. **Preserve every existing line the user may have edited.** Merge section by section under the artifact's headings: add newly-derived rules that aren't already present; leave existing rule text untouched.
3. **Do not delete or rewrite** existing rules to "clean up" — additive merge only.
4. If the existing artifact's structure has diverged enough that a safe section-by-section merge isn't possible (headings renamed/removed, hand-authored layout), **stop and ask** before restructuring — restructuring that risks dropping manual edits is an ask-first boundary (see Boundaries in the spec).
5. Refresh the `**Model:**` line and an `**Updated:**` timestamp; leave the original `**Created:**` line intact.

---

## Phase 5: Set the pointer

Set the `{qa-rules}` key in `_local/config.md` to the artifact's repo-relative path (forward slashes) — the **one** direct `_local/config.md` write this skill performs (all reads go through the resolver). After the write, the resolver re-validates its input fingerprints on the next query and rebuilds the snapshot automatically — no manual step is required. This is what makes qa-init's output and the `report-format.md` severity hook **one mechanism** — with the key set, the QA report's severity rubric resolves from this artifact; with it unset, the report format's built-in default applies.

- If the key is already set to the same path, leave it as-is.
- If it was `<none>` / absent, set it now.
- If it named a *different* existing artifact, you already resolved that conflict in Phase 1 validation — set it to the confirmed path.

---

## Template: the QA-rules artifact

```markdown
# QA Rules — <project name as the repo names itself>

**Created:** <YYYY-MM-DD HH:mm>
**Updated:** <YYYY-MM-DD HH:mm>
**Model:** <model identifier>

Read by `/wf:qa-gen` via `{qa-rules}`; the severity rubric below is applied by the QA run-assistants when the QA report is written. Hand-edit freely — `/wf:qa-init` update mode merges new rules without discarding your edits.

---

## Detected signals

- **Primary stack:** <detected language / framework / test tooling, in the repo's own terms>
- **Runtime surfaces:** <detected — e.g. app UI, service endpoints, CLI, workers>
- **Shared-infrastructure risk surfaces:** <detected — the modules that concentrate blast radius>
- **Existing quality signals:** <detected test suite / typecheck / lint / prior QA artifacts, or "none">

---

## Risk areas

| Surface | Risk | Notes |
|---------|------|-------|
| <highest-stakes surface> | High | <why a mistake here hurts most> |
| <mid surface> | Medium | <one line> |
| <low-stakes surface> | Low | <one line> |

---

## Environment

- **How scenarios run:** <the runtime surface(s) a tester/agent exercises>
- **Auth / credential state:** <what a scenario assumes about login/tokens>
- **Data preconditions:** <fixtures or seed state scenarios rely on>
- **Known-benign noise:** <console/network patterns to tolerate — mirrors {qa-baseline-ignore} where relevant>

---

## Severity rubric

The rubric the QA report's Defects section resolves when `{qa-rules}` points here — defined by `qa-gen`'s report format, applied by the run-assistants when `07_qa-report.md` is written.

- **High** — <this project's release-blocker bar — e.g. data correctness, auth, security>.
- **Medium** — <important-flow / UX regression bar>.
- **Low** — <visual or polish bar>.

---

## Acceptance

- <the standing bar every change clears before it ships>
- <non-negotiable checks for a QA pass in this project>
```

Keep the artifact's own content project-specific — that's the point. Only this SKILL.md stays stack-free; the artifact it emits names the project's real stack.

---

## Edge Cases

- **No artifact yet (create mode).** Resolve the default path, build from scratch, set `{qa-rules}`. This is the first-run default.
- **Artifact exists with manual edits (update mode).** Merge additively; preserve every hand-edited line. If a safe merge isn't possible, stop and ask before restructuring — never clobber.
- **Unfamiliar or sparse stack.** The scan finds nothing distinctive. Not an error: say so, lean on the questionnaire, and write the artifact from the answers. The body still names no stack — it reflects only what the user confirms.
- **Config missing.** The resolver reports the project is uninitialized (absent `_local/config.md`). Stop and direct the user to `/wf:init`.
- **`{qa-rules}` already set to a different existing path than `[path]`.** Stop and ask which artifact is authoritative before writing — don't strand the old one or write a second parallel QA-rules surface.
- **Empty repo / nothing to scan.** Skip the scan, proceed directly to the questionnaire, write from answers.

---

## Final Output

```
QA-INIT — <Created | Updated>

Artifact:  <resolved artifact path>
Mode:      <create | update>
Pointer:   {qa-rules} = <resolved path>
Detected:  <one-line summary of the reflected signals>
Rules:     <N risk areas · severity rubric · environment · acceptance>

Next:      /wf:qa-gen <id>    — generate a QA plan; its report now resolves the severity rubric from this artifact
```

**The final output block must always be the very last thing output to chat.**
