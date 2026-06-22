# wf:* Skill Authoring (Claude Code plugin)

How to correctly author and edit the skills and agents in the `wf` plugin. **This file is not loaded at skill runtime.** It applies only when Claude Code is working on the plugin itself — e.g., adding a new `wf:*` skill, or refactoring an existing one. For what the skills do and how to use them, see [`plugins/wf/README.md`](plugins/wf/README.md).

---

## Target runtime

These are **Claude Code skills**, packaged as a plugin and invoked as `/<name>` slash commands (or auto-loaded by Claude when the description matches). They follow the [Agent Skills](https://agentskills.io) open standard. Implications:

- `$ARGUMENTS` (and `$1`, `$2`, …) are supported in skill bodies — use them for positional arguments, and still parse the user's message in prose where the input is freeform.
- Frontmatter fields `user-invocable` and `disable-model-invocation` control invocation: `disable-model-invocation: true` = slash-command only (Claude won't auto-load it); `user-invocable: false` = auto-load only (no slash command).
- `allowed-tools` frontmatter scopes the tools a skill may use.

The SKILL.md spec is shared across Agent-Skills-compatible runtimes — same frontmatter, same folder layout, same progressive-disclosure model. See [Extend Claude with skills](https://code.claude.com/docs/en/skills) and [Skill authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices).

---

## Namespace: the `wf` plugin

The plugin is named `wf`, so every skill it ships is invoked under that namespace as `/wf:<skill>` (e.g. `/wf:spec`, `/wf:qa-auto`). **Skill names themselves are bare** — the folder and the frontmatter `name` are `spec`, `plan`, `qa-auto`, etc., NOT `wf-spec`. The `wf:` you type comes from the plugin name, not from prefixing each skill. Never put `wf` or `wf-` in a skill's `name` — that would produce `/wf:wf-spec` (double namespace).

**Families.** When two or more skills share a concern, group them with a shared second-level prefix in the bare name: `<family>-<variant>`. Example: `test-node` and `test-page` both scaffold tests (invoked `/wf:test-node` and `/wf:test-page`) — `test` is the family, `node` vs `page` names the execution context; the `qa-*` family (`qa-gen`, `qa-run`, `qa-auto`, `qa-host`, `qa-followup`) works the same way. Don't introduce a family prefix for a single skill — it only pays off at two or more siblings. When a new skill turns an existing solo skill into a pair, rename the solo to fit the family in the same change.

---

## SKILL.md file format

Each skill folder (`skills/<name>/`) contains exactly one `SKILL.md`. Frontmatter is required.

```markdown
---
name: <skill-slug>
description: <Third-person sentence about what the skill does>. Use <when the condition that should trigger it>.
allowed-tools: [Read, Write, Edit, Glob, Grep, Bash]
---

# /wf:<name> — <tagline: brief, self-documenting>

<body>
```

### Frontmatter rules

- **`name`:** must match the folder name exactly. Lowercase letters, numbers, hyphens only. ≤64 chars. No reserved words (`anthropic`, `claude`). Invalid characters cause silent load failure.
- **`description`:** ≤1024 chars. **Third person**, not "Use when user asks for /X…". Must state **what** the skill does AND **when** to use it — self-contained, readable without the body, since it's the only content pre-loaded for auto-selection among many skills.
- **`allowed-tools`:** required in this library. Declare the built-in tools the skill needs. Tailor to what Safety Rules actually allow — read-only skills omit `Write`/`Edit`. MCP tools (`sourcebot`, ADO, `mssql_*`) are intentionally omitted; their names are brittle across MCP configs.
- **Optional:** `user-invocable: false` (auto-load only, no slash command); `disable-model-invocation: true` (slash command only, no auto-load).

### H1 convention

`# /<name> — <tagline>`. Slash command, em-dash (not hyphen), short tagline. The tagline supplements the frontmatter description with a fast "what is this" when the file is opened cold.

### Body budget

Keep the body under 500 lines. When it approaches the limit, split into `references/<topic>.md` files at **one level deep** (no chains — Claude may partial-read deeply nested references). Link from `SKILL.md` explicitly. See `skills/test-page/references/backend-smoke.md` for a working example.

For reference files longer than 100 lines, add a table of contents at the top — the model may preview long files with partial reads and needs to see the full scope to decide whether to load more.

---

## Subagent companion (`agents/<name>.md`)

A skill may optionally ship a **subagent companion** for delegation-with-isolation. The host, while executing the skill, invokes the subagent via the **Task** tool (`subagent_type: wf:<name>` — plugin agents are referenced by their namespaced id); the subagent's reasoning runs in an isolated context and only its final block reaches the caller's transcript.

**When to add one:**

- The skill performs a focused judgment task that produces a small structured output (classification, scoring, verdict).
- The reasoning to reach that output is verbose and would otherwise pollute the caller's transcript.
- The same task is called from multiple skills (e.g. `wf:classify` is invoked by `wf:spec`, `wf:plan`, `wf:lite`) and you want one consistent prompt rather than per-caller drift.

**When NOT to add one:**

- The skill is action-oriented (writes files, runs commands, modifies state). Subagents are best for read-only reasoning.
- The skill is only used in one place. The duplication-with-skill-body cost outweighs the isolation benefit.
- The skill's output is already short and structured (one line). Inline is fine; isolation buys nothing.

**File layout.** All subagent files live in the plugin's `agents/` folder, named `<skill-name>.md` (bare, matching the skill). Claude Code auto-discovers them on install — no per-machine configuration. They are NOT co-located with their `SKILL.md`; the `agents/` folder is the canonical, git-tracked home.

```
plugins/wf/
├── agents/
│   └── <skill>.md              # delegation companion — auto-discovered
├── skills/
│   └── <skill>/
│       ├── SKILL.md
│       └── references/         # if the skill body needs more space
```

**Frontmatter for the subagent.** Required: `name` (matches the file's slug) and `description`. Useful optional fields: `tools`, `model`, `color`, `argument-hint`. Default is user- and model-invocable; to keep a subagent invokable only by Claude (never directly by the user), set `user-invocable: false`.

A word on `tools`: it is a **restricting allowlist that overrides** the inherited toolset — a subagent with no `tools:` field inherits the main session's *full* model + tools (built-ins, the **Task** tool, and every connected MCP server), while declaring `tools:` curates the catalog down to exactly what's listed. So keep `tools:` tight **only for narrow, single-purpose agents whose tool needs are known and built-in-only**. **Omit `tools:` entirely for any agent that must reach MCP / ADO / `sourcebot` / DB tools** — especially a generic runner like `wf:phase-runner` that executes arbitrary phases — because a narrow allowlist silently curates those MCP tools out. Omitting is also the config-agnostic choice, since MCP server names vary per downstream repo. (This is why the converted agents in this plugin declare no `tools:` field.)

**Skill body and subagent body — pick one of four patterns.** The choice depends on whether the skill is read-only reasoning vs. action-oriented, how often other skills call it, and whether it loops over N units of work that each warrant context isolation.

- **Pattern B — skill-primary, agent thin-redirect** (used by `wf:classify`, `wf:index`). The skill body is the single source of truth — contract AND procedure live there, with the procedure under a clearly-marked "Procedure (subagent execution — caller, skip this section)" heading. The subagent body is ~20 lines: it tells the subagent to read the skill's SKILL.md and execute its Procedure section against the input. The skill body's Phase 2 explicitly stops the caller before that section. Use when the work is read-only reasoning called from at most a few places, AND the caller paying the SKILL.md-read cost is acceptable.

- **Pattern C — agent-primary, skill thin-wrapper** (used by `wf:branch`). The agent file is the source of truth — full procedure (config resolution, action steps, nested **Task** calls to other skills like `wf:index`) lives there, ~100 lines self-contained. The SKILL.md is ~50 lines: frontmatter, command syntax, and an instruction to spawn the subagent and emit its block verbatim. Use when the skill is **action-oriented** (writes files, runs commands) AND is called as a gate from multiple other skills (`wf:branch` is auto-invoked by `wf:spec`, `wf:plan`, `wf:lite`, `wf:implement`, `wf:verify-fix`). The motivation: client skills invoke the Task tool with `subagent_type: wf:<name>` directly without ever loading the SKILL.md into their context, paying zero caller-side cost. Direct user invocation `/<name>` still works — the thin SKILL.md just spawns the subagent and forwards the block.

- **Pattern A — duplicate-with-fallback** (no current skill). The skill body carries the rubric/decision rules inline so the host can run them directly without delegating. The subagent body carries the same rules. Cost: rules drift between the two files if you forget to sync. Reach for this only if the inline path is genuinely useful. (In Claude Code the **Task** tool is always available, so the fallback rarely triggers — prefer Pattern B/C.)

- **Pattern D — orchestrator-with-utility-subagent** (used by `wf:run --auto` + `wf:phase-runner`). The skill body owns an outer loop and result accumulation; a subagent does one heavy unit of work per iteration. The skill is ~80–150 lines (parses inputs, loops, accumulates one small status block per iteration); the subagent is ~90–150 lines (one iteration with isolated context). Distinct from Pattern B (one subagent for the whole skill, called once) and Pattern C (skill is a thin wrapper around a single self-contained subagent). Use when heavy work repeats N times and each iteration's context can die between iterations — per-file deep-read analysis, per-entity API drives, per-record validation passes, or per-phase chain orchestration. The win is per-iteration isolation: large reads or accumulated state stays in the subagent and never reaches the parent thread.

  **Runtime reality — subagent tools.** A subagent **inherits the main session's full model + tools by default — *unless* its agent file declares a `tools:` field**, which acts as a restricting allowlist that overrides the inherited catalog. So to let a subagent reach MCP / ADO / `sourcebot` / DB tools, **omit `tools:`** (inherit everything) or list the server explicitly with a `<server>/*` wildcard — a narrow built-in-only allowlist silently curates MCP tools *out* (the bug that starved an earlier `wf:phase-runner` cut of its ADO tools on triage). **Nested delegation works out of the box** in Claude Code — a subagent can spawn another subagent via the Task tool with no extra setting (so `wf:branch`→`wf:index` just works). Browser-automation tools (Claude in Chrome / Playwright MCP) are a **separate question**: whether they surface inside a subagent vs. only in the main thread is unverified here, so `wf:qa-auto` stays in-thread until a clean re-probe proves otherwise.

Default to Pattern B for read-only reasoning skills. Default to Pattern C for action-oriented skills that gate other skills. Reach for Pattern D when the heavy work repeats N times and per-iteration context bloat would otherwise overwhelm the parent. Pattern A is a rarely-needed fallback.

**Output contract.** The subagent must emit the same Final Output block shape as the skill, with no narrative outside it. Consumers parse that block.

---

## Body structure

The three full-body workflow-chain skills (`wf:spec`, `wf:plan`, `wf:implement`) share this template — new workflow skills should follow it:

1. Prerequisites (read `_local/config.md`)
2. Command Syntax + Arguments table
3. Safety Rules (Allowed / Forbidden in prose)
4. Phases (numbered, each self-contained)
5. Templates (if the skill produces structured output)
6. Edge Cases
7. Final Output block

**Exception: `wf:branch` follows Pattern C** (see "Subagent companion" above). Its `SKILL.md` is a ~50-line thin wrapper — frontmatter, command syntax, a delegation block that spawns the subagent, and the Final Output template. The full procedure lives in `agents/branch.md`. Don't apply the workflow-chain template to skills that follow Pattern C — the template fields move to the agent file instead.

Auxiliary skills (`wf:verify-spec`, `wf:migration-map`, `wf:test-node`, `wf:test-page`) have a dispatch-on-arguments shape. Template for new ones:

1. Intro paragraph — what the skill does, one paragraph.
2. When to use / When NOT to use — bounded scope statement.
3. Dispatch on arguments — top-level section listing each subcommand as its own `###` block. **Include an empty-input default** (`empty (no arguments) → ...`) for zero-arg invocation.
4. Per-subcommand sections — arguments, steps, expected output.
5. Shared details (conventions, file layouts, output formats, harness specs) — once, near the end.
6. Edge Cases.
7. Final Output block if the skill emits a structured report.

Copy from the closest existing aux skill: `wf:verify-spec` for audits, `wf:migration-map` for structured-report output, `wf:test-node` / `wf:test-page` for test scaffolding.

---

## Per-task index manifest (`index.md`)

Every task folder under `_local/{wi-prefix}-{id}/` carries an `index.md` — a catalogue of all artifacts and small per-task results (branch name, classification verdict, etc.). It is **maintained exclusively by the wf:index subagent** in `agents/index.md`. Big skills do not edit `index.md` themselves — they reach the writer via one of two paths:

- **From a host skill body (Pattern B, or any direct user invocation):** call `/wf:index <ado-id> <slot> "<summary>"`. The `/wf:index` skill body resolves the task folder and forwards to its subagent.
- **From inside another subagent (Pattern C agents like `wf:branch`):** invoke the **Task** tool with `subagent_type: wf:index` and four named args — `task-folder` (absolute path), `slot`, `summary`, `calling-skill`. Bypasses the slash-command's caller-side resolution since the parent agent already knows the absolute path.

Both paths land in the same wf:index subagent, so the "single writer" contract holds.

**Authoring contract for any wf:* skill that writes per-task state:**

After writing your artifact (or after producing a single-string result for slots like `branch` / `classify`), invoke `/wf:index` with three positional args:

```
/wf:index <ado-id> <slot> "<summary>"
```

- `<ado-id>` — the task ID you're working on.
- `<slot>` — pick from the catalogue in `skills/index/SKILL.md`. Common: `triage`, `reqs`, `spec`, `plan`, `verify`, `verify-fix`, `migration-map`, `lite`, `branch`, `classify`, `tests`, `page-tests`, `research`, `assets`, `artifacts`. Unknown slots become custom rows.
- `<summary>` — one-liner ≤80 chars describing what you produced. For string slots like `branch` or `classify`, the summary IS the value (e.g. `feature/6396-add-csv-export`, `feat (high)`).

`/wf:index` creates the file from a seed template on first call, so no skill needs its own bootstrap step. Status cells are auto-derived — callers don't compute them.

Drift policy: the underlying artifacts are the source of detailed truth. If a skill forgets to call `/wf:index`, the index becomes stale but the artifact is unaffected.

**When NOT to call `/wf:index`:** read-only skills (e.g. `wf:verify-spec`) still call it — recording an audit pass IS a per-task result. The exceptions are skills with no per-task footprint at all and `wf:index` itself.

---

## Shared conventions (every skill enforces these)

- **Config.** Project values (`{ado-project}`, `{wi-prefix}`, `{task-root}`, database names, migration paths) live in the downstream repo's `_local/config.md`, not here. Skills read that file as their first step and substitute placeholders. If absent, stop and direct the user to `/wf:init`. To add a new config key, edit the default template in `skills/init/SKILL.md` (Phase 2), then reference it as `{placeholder}` in the consuming skill.
- **Default modes.** Zero-argument invocation must do something useful. For `wf:*` skills that take an ADO ID, infer it from `git branch --show-current` (first 3+-digit run); require an explicit arg only if inference fails. First run for a new task is the exception — no branch exists yet.
- **Safety Rules.** Every skill declares explicit Allowed / Forbidden lists in prose. Common forbiddens: modifying source outside `_local/`, running builds/tests/installs, destructive git. `wf:implement`, `wf:verify-fix`, and `wf:qa-followup` are the skills that modify **product** source. `wf:qa-host` also writes source, but only **test scaffolding** — never product code. `wf:commit` and `wf:pr` are the **git-delivery** skills — the only ones that stage/commit/push and open a PR (beyond `wf:branch`'s upstream push); destructive git stays forbidden for them too.
- **Final-output block.** Every skill ends with a fenced status block (`SPEC — Complete`, `PLAN — Complete`, `BRANCH — <state>`, etc.). Must be the very last thing emitted — downstream skills and users grep for it.
- **Next-step suggestion.** Every user-invocable skill's final block ends with a `Next:` line naming the command(s) to run next — or `Next: none — terminus`. Branch it on the skill's own result where useful; when offering a fork, pick a default. Utility/subagent skills consumed by callers (`wf:classify`, `wf:branch`, `wf:index`) are the exception — no `Next:`.
- **Tool preferences.** For code search, try an indexed MCP tool (`sourcebot`) first; fall back to `Grep`/`Glob` only when no indexed tool is available or a file-pattern search is specifically needed. Same pattern for DB work — prefer `mssql_*` MCP tools. ADO MCP tools are read-only for work-item fetches — with one library-wide write exception: `wf:spec` Phase 0 backfills `System.Description` on a `Dev`-titled child whose description is empty, from parent context.
- **Branch gate pattern.** Skills that require being on the task branch (`wf:spec`, `wf:plan`, `wf:implement`, `wf:verify-fix`, `wf:qa-followup`) invoke the **Task** tool with `subagent_type: wf:branch` early if HEAD isn't on `*/<id>-*`. **Calling `/wf:branch` from another skill is forbidden** — it would load `wf:branch/SKILL.md` into the caller's context, which is the exact cost the subagent is meant to avoid. `wf:branch` follows Pattern C: the subagent is self-sufficient — it resolves config, derives the branch name, runs git, and updates `index.md` (via a nested **Task** call to `wf:index`) all in its own isolated context.
- **`## Edge Cases` heading.** Every skill's stop-conditions section uses this heading for consistency.
- **Model attribution.** Every artifact a skill writes must include the current model's identifier in its metadata block — a `**Model:** <model identifier>` line, or a verb-shaped variant (`**Fetched by:**`, `**Generated by:**`, `**Implemented by:**`, `**Audited by:**`) when the skill didn't author the content from scratch. The identifier is the model name as reported in the runtime's system prompt (e.g., `claude-opus-4-8`). If the runtime doesn't expose it, write `unknown` rather than guessing.

---

## Adding a new skill — checklist

1. Pick a bare `<name>` slug (no `wf`/`wf-` prefix — see the namespace rule).
2. Create folder `skills/<name>/` with `SKILL.md`.
3. Frontmatter: `name` matches folder; third-person `description` with both "what" and "when"; `allowed-tools` list tailored to the skill's safety rules.
4. H1: `# /wf:<name> — <tagline>`.
5. Body: workflow-chain template for workflow skills; copy from the closest aux skill otherwise.
6. Zero-argument default: define what happens when the user types `/wf:<name>` with nothing else.
7. `## Edge Cases` section listing stop conditions with the action to take.
8. Final-output block (fenced, starts with `<NAME> — <state>`, ending with a `Next:` line) at the very end.
9. If the skill reads config: reference `_local/config.md` and direct missing-file users to `/wf:init`.
10. If the skill warrants delegation isolation (see "Subagent companion" above), add `agents/<name>.md`. Pick the right pattern by skill type:
    - **Pattern B** — read-only reasoning skills called from at most a few places. Agent file is ~20 lines pointing at the skill's `## Procedure` section; skill body stays the single source of truth.
    - **Pattern C** — action-oriented skills called as a gate from multiple other skills. Agent file is ~100 lines (full procedure self-contained); skill body is a ~50-line wrapper for direct user invocation. Other skills invoke the subagent via the Task tool directly, never via the slash command.
    - **Pattern A** — rare; only for an inline fallback path that's genuinely needed. Mirror the rubric in both files; expect drift.

    No install-step changes needed — Claude Code auto-discovers everything in `agents/` and `skills/` on install.
11. If the skill produces any per-task artifact or string result, invoke `/wf:index` after writing it (see "Per-task index manifest" above).
12. Update `plugins/wf/README.md`'s skill inventory.

---

## Editing rules

- **Edit `SKILL.md` in place.** Skills are invoked by folder name; renaming or moving breaks invocation (and existing task artifacts that reference slash-command names).
- **Never hardcode project constants.** Add the key to `skills/init/SKILL.md` (Phase 2), then reference it as `{placeholder}` in the consuming skill. Existing repos that already have a populated `_local/config.md` will need the new key added manually.
- **Preserve the final-output block shape.** Parsers rely on the exact `NAME — status` format.
- **No build tooling.** This directory is prose. No `package.json`, no lint configs, no TypeScript.
- **Never write outside `_local/`.** The only exceptions are `wf:implement`, `wf:verify-fix`, `wf:qa-followup` (product source), and `wf:qa-host` (test scaffolding only). All other skills are sandboxed to the task folder.

---

## Anti-patterns to avoid

- **No Windows-style paths.** Use forward slashes in SKILL.md content, even on Windows. Forward slashes work across every runtime (PowerShell, Bash, Node, Git), don't collide with markdown's escape character, and match canonical style. Backslashes are correct only inside regexes and code fences with real escape semantics.
- **Don't offer multiple approaches without a default.** Pick the right tool or pattern and state it. Mention alternatives only as escape hatches ("Use X. For Y case, use Z instead."). Offering three options without guidance forces the model to pick — usually badly.
- **Don't reference tools or fields the runtime doesn't expose.** Frontmatter fields outside the documented set, or slash-command references to non-existent helpers, pass through literally. Stick to the fields listed above; for arguments use `$ARGUMENTS`/`$1`/`$2` or parse the message in prose.
- **Don't punt to the model.** If a step has an exact command (test runner, git command, API call), write it. If a decision has one right answer given the context, state it. "The model will figure it out" isn't a spec.

---

## What lives outside this plugin

- The downstream Compliance Risk repo itself — this is where skills actually operate when invoked. Paths like `AuditTrakker.Web/`, `ComplianceRisk.Sql/Sequence/`, `_local/ADO-<id>/` refer to that repo, not here.

---

## Commit workflow

**Always commit to a feature branch, never to `main`.** Before staging any change in this repo, check the current branch (`git rev-parse --abbrev-ref HEAD`). If it's `main` (or `master`), create and switch to a feature branch first — name it `feat/<short-description>`, `fix/<short-description>`, `chore/<short-description>`, etc., matching the wf:branch prefix taxonomy. Then stage, commit, and push that branch; the user opens the PR. Direct commits to `main` are forbidden even when the change is "obviously safe" — review-via-PR is the floor.

When the working tree has uncommitted changes already and you realize you're on `main`, create the feature branch with `git checkout -b <name>` (which carries the dirty changes onto the new branch) before staging anything.

---

## NO AI ADS IN COMMITS

Commit messages, PR descriptions, and any artifact a skill writes must **never** include:

- `Co-Authored-By: Claude …` trailers
- `🤖 Generated with Claude Code` footers
- Any other "written by AI" attribution, emoji, or promotional tagline

Commit like a human. Skill templates that emit suggested commit commands (`wf:implement` handoff, etc.) must not include these trailers either. If you find one in an existing template, remove it.
