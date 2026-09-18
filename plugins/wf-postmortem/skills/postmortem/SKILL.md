---
name: postmortem
description: Turns a maintainer's prose failure report into an explicit, echoed hunt scope and a fixed-shape report skeleton — resolving a required failure description plus optional skill/folder-or-repository/read-cap, echoing every resolved value and every applied default. Asks one question for a missing description in an interactive run; stops with no report in a run with no interactive channel. Locates and reads no session record in this release. Use when a maintainer wants to start a guided postmortem hunt over prior agent sessions and needs the scope and report skeleton fixed before locating or reading arrives with a later release.
allowed-tools: [Write, Glob, Bash, AskUserQuestion]
---

# /wf-postmortem:postmortem — Resolve a failure prompt to an echoed hunt scope

Turn a prose failure report into an explicit hunt scope, echoed verbatim in a fixed-shape report
skeleton. This release resolves and echoes the scope only — it locates and reads no session record;
that arrives with a later charter sub-task (C035, umbrella WF-587).

---

## Prerequisites

Before the first bundled resolver MCP call, run `pwd -P` and use the returned absolute current
Agent/session workspace directory as `workspaceRoot` in every call.

**Before any other phase**, obtain project config via `resolve_config({ workspaceRoot, ... })` — it
returns `{ workspaceRoot, registryPath, coreConfig{ taskRoot, … } }`, already resolved from
`_local/config.md`. All references to `{task-root}` below come from `coreConfig.taskRoot`. If the
resolver reports the project is uninitialized (no resolved config / absent `_local/config.md`),
stop and instruct the user to run `/wf:init` first. If the `wf-resolver` service is unavailable,
stop and report that the resolver runtime is not loaded — do not hand-parse config as a fallback.

---

## Command Syntax

```
/wf-postmortem:postmortem [<description>] [--skill <name>] [--folder <path>] [--repo <name>] [--cap <n>]
```

| Argument | Required | Description |
|---|---|---|
| `<description>` | conditionally | The failure description. Required unless the run can ask interactively for it. |
| `--skill <name>` | NO | Scope the hunt to one named skill. Omit for an unscoped hunt. |
| `--folder <path>` | NO | Scope the hunt to a named local folder. Resolved against the filesystem only. |
| `--repo <name>` | NO | Scope the hunt to a named repository. Resolved against the filesystem only. |
| `--cap <n>` | NO | Override the read cap. This release only echoes the override — its value and enforcement arrive with a later charter sub-task. |

`--folder` and `--repo` are mutually exclusive framings of the same "another project" input — pass
at most one.

---

## Safety Rules (NON-NEGOTIABLE)

**Allowed:**

- Read `_local/config.md` via `resolve_config`.
- Resolve `--folder`/`--repo` against the local filesystem only (`Glob`, `Bash` for an existence
  check).
- Read the report template and redaction references via `resolve_content({ workspaceRoot, ... })`
  (`class: references-template`, `plugin: wf-postmortem`, `skill: postmortem`).
- Scan `{task-root}` (`Glob`) to mint the next `PM<NNN>__<slug>` id.
- Write the report file inside its own seeded `{task-root}/PM<NNN>__<slug>/` folder, and any
  scratch file inside the fixed `{task-root}/scratch/` — both only through the redacting write path.
- Ask exactly one interactive question (`AskUserQuestion`) when the failure description is missing
  and an interactive channel is available.

**Forbidden:**

- Look up, locate, or read any session record — this release resolves scope only.
- Map a resolved folder or repository path to any session store — that mapping belongs to a later
  charter sub-task's seam.
- Write outside the report's own seeded folder and the fixed `{task-root}/scratch/`.
- Touch `plugins/wf/` or any other existing pack.
- Write a report, or any scratch file, without first passing every value through the redacting
  write path (`redaction.md`, resolved via `resolve_content`).
- Guess whether an interactive channel is available — establish it from the tool catalog itself
  (Phase 2).
- Ask more than one question per run.

---

## Phase 1: Resolve inputs and defaults

1. **Failure description.** Take `<description>` verbatim when passed. When absent, proceed to
   Phase 2 before resolving anything else — a missing description is handled there, not defaulted
   here.
2. **Skill.** Take `--skill` verbatim when passed. Absent → the scope is unscoped ("skill:
   unscoped" in the echo).
3. **Folder or repository.** Take at most one of `--folder`/`--repo`. Resolve it against the local
   filesystem only — never against any session store, which is out of scope for this release. The
   value is free-form user text: pass it to `Glob` as a pattern, or to `Bash` as a single quoted
   argument, and never concatenate it into a composed command line. Four outcomes:
   - **Both passed** → stop immediately with the `POSTMORTEM — stopped` block (Final Output),
     reason "both --folder and --repo passed — they are mutually exclusive framings of the same
     input; pass at most one." Write nothing; never silently prefer one over the other.
   - Neither passed → the scope defaults to the current workspace's sessions only; the Scope
     section's "Folder or repository" field states `"not named"` and `session-scope` echoes
     `"current workspace only"`.
   - Passed and resolves to an existing filesystem path → echo the resolved path verbatim;
     `session-scope` echoes `"current workspace plus <project>"`, where `<project>` is the resolved
     path itself (the same value just echoed for `--folder`/`--repo`).
   - Passed and does **not** resolve to an existing filesystem path → echo it as unresolved
     (`"<name> — unresolved (no matching filesystem path)"`) and attempt no further lookup. The
     `session-scope` echo (Final Output) for this outcome states `"current workspace only"` — an
     unresolved name never widens the session scope, since nothing about it was confirmed to name
     another project.
4. **Read cap.** Take `--cap` verbatim when passed and echo it as the override in force. Absent →
   echo `"default, not yet enforced"` — this release neither assigns a real default value nor
   enforces any cap; that arrives with a later charter sub-task.

---

## Phase 2: Missing-description handling

Only when Phase 1 step 1 found no `<description>`.

1. **Establish interactive-channel availability from the tool catalog itself** — check whether
   `AskUserQuestion` is present in the tools available to this run. Never guess from the invocation
   context; a headless dispatch (e.g. this skill invoked from within an isolated subagent) has the
   tool absent from its own catalog, which is the only signal this step reads.
2. **Available (interactive run).** Ask exactly one question with `AskUserQuestion` — a short prompt
   for the failure description, offering no preset options (free text). Use the answer as the
   resolved description and continue to Phase 3 as a guided run.
3. **Unavailable (headless run).** Stop immediately. Write nothing — no report, no scratch file.
   Emit the `POSTMORTEM — stopped` terminal block (Final Output) with the reason "no failure
   description given and no interactive channel available to ask for one."

---

## Phase 3: Redact, then mint the report folder

Redaction runs **before** any value pulled from the prompt is used in a path or a file — the report
folder's own name is a write, exactly like the file inside it, so it passes through the same
redacting write path rather than being minted from the raw prompt.

1. **Obtain the redaction reference** via `resolve_content({ workspaceRoot, ... })` (`class:
   references-template`, `plugin: wf-postmortem`, `skill: postmortem`, `ref: redaction.md`) — never
   a raw `Read` of the plugin-cache path.
2. **Redact, then neutralize structure, in every value pulled from the prompt** — the failure
   description and any resolved skill/folder/repository name — before it is used anywhere,
   including in a folder or file name. First run each through `redaction.md`'s recognized shapes.
   Then neutralize markdown structure in the result: collapse newlines and backticks to single
   spaces and strip any leading `#`, so a description can forge neither a heading nor a fenced
   `POSTMORTEM — written` block inside the report. There is exactly one write path (this one) and
   every write, and every path derived from prompt text, passes through it.
3. **Mint the id.** Scan `{task-root}` (including any `_archive/` subfolder) for folders matching
   `PM` + digits + `__` — digits only — take the highest existing number, increment by one, zero-pad
   to 3 digits, starting at `PM001`. Slug the **redacted** failure description (step 2's output, not
   the raw prompt) by this rule, which is complete as stated and depends on no other skill's scheme:
   lowercase it; collapse every character outside `a-z0-9` to a single `-` (this removes `/`, `\`
   and `.`, and therefore any `..` segment, along with whitespace and control characters); trim
   leading and trailing `-`; truncate to 40 characters; if nothing remains, use `report`.
4. **Create the folder with one exclusive fail-if-exists create.** A plain existence check followed
   by a separate create is a check-then-act race — two concurrent invocations can both pass the
   check before either creates, both mint the same `PM<NNN>`, and the second clobbers the first's
   `report.md`. The create itself must be what fails when the target is already there.

   **Use `Bash`: `mkdir <path>` — without `-p`.** `-p` is exactly what must not be used here: it
   succeeds silently on an existing directory, which is the opposite of the required signal. Pass
   the path as a single quoted argument, never concatenated into a composed command line. Read the
   outcome from that one command:

   | Outcome | Meaning | Action |
   |---|---|---|
   | exit 0 | the folder did not exist and this run created it | continue to Phase 4 |
   | non-zero, stderr names an already-exists condition (`File exists` / `EEXIST`) | a true id collision | re-mint (step 3) and retry, within the bound below |
   | non-zero, any other stderr (`Permission denied`, `No such file or directory`, `No space left on device`, `Read-only file system`, an invalid path) | **not** a collision | stop — see below |

   An already-exists stderr is the **only** collision signal. Any other non-zero exit stops the run
   immediately with the `POSTMORTEM — stopped` block (Final Output), stating the failing reason
   verbatim — never retried, because re-minting a number repairs nothing about an unwritable,
   missing, or full `{task-root}`.

   **Bound the retry to 3 create attempts per run** (the first plus at most 2 re-mints). Exhausting
   the bound stops the run with the `POSTMORTEM — stopped` reason "report-folder id contention —
   3 consecutive collisions"; never loop further.

   This release records no per-task index row for the minted folder (charter assumption #9).

---

## Phase 4: Write the report

1. **Obtain the report template** via `resolve_content({ workspaceRoot, ... })` (`class:
   references-template`, `plugin: wf-postmortem`, `skill: postmortem`, `ref: report-template.md`) —
   never a raw `Read` of the plugin-cache path. The redaction reference was already obtained in
   Phase 3.
2. **Fill the Scope section** with every resolved value and every applied default from Phase 1,
   verbatim after Phase 3's redaction. Fill the Summary and every other section with the template's
   stated "not yet produced" text — this release cannot fill them (no session has been located or
   read).
3. **Write** `{task-root}/PM<NNN>__<slug>/report.md` per the template shape, including the
   `**Model:**` attribution line (the runtime model id — `unknown` rather than guessed) and the
   fenced `POSTMORTEM — written` final-output block, matching this skill's own Final Output shape
   verbatim, as the file's own trailing content. Any scratch file this run produces is written under
   the fixed `{task-root}/scratch/`, through the same redacting write path.

---

## Edge Cases

- **`_local/config.md` absent.** Stop and point to `/wf:init`; write nothing.
- **A named folder or repository that does not resolve to a filesystem path.** Report it as
  unresolved in the Scope section (Phase 1 step 3); no session-store lookup is attempted, and the
  run otherwise proceeds normally.
- **No failure description, interactive run.** Ask exactly one question (Phase 2 step 2), then
  proceed guided with the answer.
- **No failure description, no interactive channel.** Stop with a stated reason; write no report
  (Phase 2 step 3) — never an unguided hunt.
- **A description that is empty after trimming.** Treated the same as no description at all — Phase
  2 applies.
- **Both `--folder` and `--repo` passed.** Stop with a stated reason (Phase 1 step 3); write
  nothing — never silently prefer one framing over the other.
- **A redaction match found inside the description itself.** The redacted form (with `[REDACTED]`
  markers) is what reaches the Scope section — the report never carries the original matched
  string, even though the description is otherwise echoed verbatim.
- **A description carrying markdown structure** (a leading `#`, a fenced block, newlines). Phase 3
  step 2 neutralizes it after redaction, so the embedded value can forge neither a heading nor a
  second `POSTMORTEM — written` block inside the report.
- **A report-folder create that fails for a reason other than an already-exists collision** — an
  unwritable or missing `{task-root}`, a full disk, a read-only filesystem. Stop with that reason
  stated (Phase 3 step 4); never retried, because re-minting repairs none of it.
- **Three consecutive id collisions.** The create is attempted at most 3 times per run; exhausting
  the bound stops with a stated contention reason rather than looping.
- **A seeded folder left with no `report.md`** by a run interrupted between Phase 3 and Phase 4.
  The next run's scan still counts it as taken — ids are never reused — and the empty folder is
  left in place for the maintainer. Reclaiming an id is out of scope for this release.
- **The pack installed but not registered.** No core `wf:*` phase behaves any differently; this
  skill's own invocation is unaffected either way, since it attaches to no phase.

---

## Final Output

Written:

```
POSTMORTEM — written

Report:  {task-root}/PM<NNN>__<slug>/report.md
Scope:   description="<resolved, redacted>" · skill=<name|unscoped> · folder/repo=<resolved|not named|<name> — unresolved> · cap=<override|default, not yet enforced> · session-scope=<current workspace only|current workspace plus <project>>
Next:    none — terminus
```

Stopped:

```
POSTMORTEM — stopped

Reason: <one sentence — e.g. "no failure description given and no interactive channel available to ask for one", or "_local/config.md absent — run /wf:init first">
Next:   <the command that clears the block, e.g. "/wf:init", or "re-run with a failure description">
```

**The final-output block must always be the very last thing output to chat.**
