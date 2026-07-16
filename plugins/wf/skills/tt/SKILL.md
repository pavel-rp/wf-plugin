---
name: tt
description: Authors convention-matching tests for the current branch's changed files. Resolves the change set through the delivery provider's branch-changes read, decides which changes need coverage, discovers the project's existing test framework and conventions, aggregates any test-authoring guidance registered capabilities attach at the implement phase, writes tests that mirror those conventions, runs them, and reports. Framework-agnostic with a discover-and-match default that stands alone when no testing capability is registered. Creates or modifies only test files. Use after implementing a change to add or extend its tests, or when asked to write tests for what changed on the branch.
allowed-tools: [Read, Write, Edit, Glob, Grep, Bash, Task]
---

# /wf:tt — Author convention-matching tests for the branch's changes

Author tests for the code that changed on the current branch. `tt` resolves **what
changed** through the delivery provider's branch-changes read, decides which changes
warrant coverage, and writes tests that **match the project's own conventions** — then
runs them and reports.

`tt` is **framework-agnostic and capability-agnostic**. Its base is a **discover-and-match
default**: it infers the project's test framework, assertion style, file-naming, and
location by reading the existing tests, and mirrors them — it never hardcodes a stack.
On top of that default it **fires the `implement` phase**, aggregating any test-authoring
`guidance` the project's registered capabilities attach, so the authored tests follow the
stack's own idioms when a testing capability is registered. With none registered, the
discover-and-match default stands alone.

**Creates or modifies only test files.** It never touches production source, never stages
or publishes anything.

---

## Prerequisites

**Before any other phase**, obtain project config from the bundled `wf-resolver` MCP service
via `resolve_config` — it returns `{ workspaceRoot, registryPath, coreConfig{ taskRoot,
verifyCommand, … }, idShape }`, already resolved from `_local/config.md` (core performs no
direct config-file parse). All references to `{task-root}` (`coreConfig.taskRoot`) and
`{verify-command}` (`coreConfig.verifyCommand`) below come from that query — never hardcode
them. If the resolver reports the project is uninitialized (no resolved config / absent
`_local/config.md`), stop and instruct the user to run `/wf:init` first. If the `wf-resolver`
service is unavailable, stop and report that the resolver runtime is not loaded (restart
Claude Code) — do not hand-parse config as a fallback.

---

## Command Syntax

```
/wf:tt [<id>] [--files <paths>] [--base <ref>]
```

### Arguments

| Argument         | Required | Description                                                                                                                                                                       |
| ---------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<id>`           | NO       | Task id — whatever shape the active tracker produced, or a local `T<NNN>` id. Used only to (a) source a change set from the task's artifacts when no delivery provider is registered, and (b) record the run in the per-task index. Falls back to inferring from the current branch; unresolved is fine — `tt` still runs off the change set. |
| `--files <paths>` | NO      | Explicit change set — a space- or comma-separated list of files to author tests for. Overrides change-set resolution entirely (used regardless of provider state). |
| `--base <ref>`   | NO       | Override the ref the branch is diffed against when reading the change set. When omitted, the delivery provider determines the base. |

### Id resolution (optional)

If `<id>` is provided, use it verbatim. If omitted, try to infer a numeric token by
extracting the first 3+-digit run from the current branch name (via `current-branch-query`,
reached through the `wf-resolver` `resolve_provider("delivery")` query below), then resolve that token against
`{task-root}` by the same extraction on each existing folder's name — exactly one match
reuses that folder's full name as `<id>`. Any failure (no delivery provider, no branch
token, zero or multiple folder matches) leaves `<id>` unresolved — a non-fatal outcome:
`tt` still authors tests for the change set, it just skips the per-task index update.

---

## Safety Rules (NON-NEGOTIABLE)

`tt` authors tests. The constraints below scope what that authorization covers.

**Allowed:**

- Read any file in the project (`Read`, `Glob`, `Grep`); prefer an indexed code-search MCP
  (`sourcebot`) for cross-file lookups, falling back to `Grep`/`Glob`.
- Read the change set through the **delivery** surface (read-only) — `branch-changes-read`
  and, for id inference, `current-branch-query`.
- Fire the `implement` phase to aggregate test-authoring `guidance` (read-only fragment
  following, or a `subagent:` dispatch via the **Task** tool).
- **Create or modify test files** — the only files `tt` writes — at whatever location and
  in whatever naming the discovered conventions (refined by aggregated guidance) dictate.
- Run the authored tests via the project's test-invocation convention (Phase 5).
- Invoke `/wf:index` when `<id>` resolved, to record the run.

**Forbidden:**

- Modify, create, or delete any **non-test** file — production source, config, docs,
  build files. `tt` writes test files and nothing else.
- Stage, publish, or open a pull request; run any destructive version-control operation.
  Those are the delivery steps' job, not `tt`'s.
- Run any command other than the project's test-invocation — no ad-hoc installs, no
  builds beyond running the tests.
- Name a concrete framework, runner, assertion library, file extension, or version-control
  command in anything it writes or reports. Conventions are **discovered and mirrored**,
  never assumed.

---

## Direct provider resolution (how the change set is read)

Every delivery operation this file invokes — `branch-changes-read` (the change set) and
`current-branch-query` (optional id inference) — is reached by calling the bundled
`wf-resolver` MCP tool `resolve_provider("delivery")`, the typed query that returns the
run-scoped resolution record `{ surface, owner, fragmentPath, state, candidates?,
degradation }` for the `delivery` surface. The resolver has already resolved the
`## Capabilities` registry, the owning capability's `manifest.md`, and any plugin-anchored
root (post install-manifest self-heal, per `capability-registry.ops.md` §"Recorded-root-first
resolution with install-manifest self-heal"); core performs **no** registry / manifest /
plugin-root read of its own. Follow the returned `fragmentPath` in this skill's own context to
invoke the ops (the resolver returns paths and metadata only, never a fragment body). If the
`wf-resolver` service is unavailable, stop and report that the resolver runtime is not loaded —
do not hand-parse the registry as a fallback (WF-272 diagnostics/recovery).

**`tt` branches on the record's `state` itself — it does not read the change set and inspect
the return to guess whether a provider exists.** The `state` (`ok` vs
`unconfigured`/`unrecoverable`) is the toggle; the read op's return distinguishes only *how
much* changed. The two never conflate: "no delivery provider registered" (`state:
unconfigured`/`unrecoverable`) and "provider present but nothing changed" (`state: ok`, empty
change set) are distinct outcomes handled in Phase 1.

---

## Phase 1: Resolve the change set

Determine the set of changed files to author tests for, in this order:

1. **`--files` override.** If `--files` was passed, that list **is** the change set — skip
   the rest of this phase. (An override is honored regardless of provider state.)

2. **Resolve the delivery record** via `resolve_provider("delivery")` (above), then branch on
   the record's `state` — **not** on any change-set return:

   - **`state: ok` (delivery provider registered):** read the change set via
     `branch-changes-read` (passing `--base` when supplied; otherwise the provider
     determines the base). Each entry is a path plus its change status.
     - A **non-empty** set → carry it into Phase 2.
     - An **empty** set → the branch is **clean**: nothing has changed, so there is nothing
       to test. Report a clean branch and stop (final block `TT — Nothing to test`). This
       is distinct from the provider-absent path below — a registered provider that finds
       no changes is a valid "clean branch" result, not a missing-provider condition.

   - **`state: unconfigured`/`unrecoverable` (no delivery provider registered):** do **not** read the change
     set through the surface — that would silently enumerate the working directory and mask
     the absence. Degrade instead, in order:
     1. an explicit `--files` list — already handled in step 1;
     2. **an artifact-derived change set** — if `<id>` resolved and the task folder holds a
        plan (`02_plan.md`) or tasks (`03_tasks.md`) artifact, take the relevant files those
        artifacts name as the change set;
     3. otherwise **stop** (final block `TT — No change set`): "No delivery provider is
        registered, so the branch's changes can't be read. Register a delivery provider
        (e.g. `/wf-git:init`), or pass the files to test explicitly: `/wf:tt --files <paths>`."
     Never fall back to a raw working-directory scan dressed up as a change set.

**Filter the change set to testable source.** Drop entries that don't warrant tests — the
test files themselves, config, docs, generated output, pure-markup or data files, and any
file of a kind the project does not test (judged by what the discovered tests in Phase 2
actually cover). Deleted entries (status `D`) need no new test — note that their existing
tests may want removal, but `tt` does not delete production source, so surface it as a
heads-up rather than acting on it.

---

## Phase 2: Discover conventions and decide coverage

**Discover-and-match scan.** Before writing anything, learn how this project tests. Find the
existing test files (glob the repo for the patterns test files follow — sibling-to-source,
a dedicated test tree, or both) and read a representative sample to extract:

- the **test framework / runner** in use (from imports, config, and invocation);
- the **assertion style** (which assertion API the tests call);
- the **file-naming convention** (suffix/prefix and extension test files use);
- the **location convention** (next to source, under a test root, or under `_local/`);
- the **structure idioms** (grouping, naming of individual cases, setup/teardown);
- the **comment/header convention** (so attribution in Phase 4 mirrors it).

If the project has **no** existing tests, note it: the discover-and-match default has no
sample to mirror, so it falls back to the most conventional shape for the detected language
and places tests adjacent to source — and the coverage summary flags that the project had no
prior test convention to match.

**Coverage decision.** For each testable changed file, determine:

- **Does it already have a test?** Look for a test whose name/location maps to the changed
  file under the discovered convention. If one exists, plan to **extend** it for the new or
  changed behavior rather than duplicate it.
- **Does it warrant a test?** Read the change to pick real cases worth covering — the happy
  path, each boundary, each error/empty/null branch actually present. Skip files whose
  changes are untestable in isolation (pure wiring, generated code) and say so.

Produce a short coverage plan: for each file, `new test` / `extend test` / `skip (reason)`.

---

## Phase 3: Aggregate implement-phase authoring guidance

Fire the **`implement`** phase and aggregate any **`guidance`** contributions the registered
capabilities attach to it — the seam through which a testing capability supplies the stack's
test-authoring idioms. Obtain the ordered active registry as metadata from the `wf-resolver`
MCP service — do **not** read `## Capabilities` or any `manifest.md` yourself — referencing the
taxonomy by **phase name / contribution-kind name**, never by heading:

1. **Call `resolve_registry`** on the `wf-resolver` service. It returns the ordered active
   `capabilities[]` (**in registry order**, general → specific), each already resolved from the
   registry and its `manifest.md`: `{ name, kind, manifestPath, fragments[] { phase,
   contributionKind, dispatch, scope }, articles[], provenance, validity }`. The resolver has
   done the registry iteration, per-capability manifest read, and plugin-anchored root
   self-heal; core reads only this metadata. If the `wf-resolver` service is unavailable, stop
   and report that the resolver runtime is not loaded — do not hand-parse the registry (WF-272
   diagnostics/recovery).
2. **Collect** only the fragment rows (across the returned `capabilities[]`, preserving
   registry order) whose `phase` is `implement` and whose `contributionKind` is `guidance`.
   Ignore all other rows for this firing.
3. **Dispatch each collected fragment** on its `dispatch` metadata (the resolver returns
   paths/metadata only — never a fragment body, so the dispatch read stays in this skill's own
   context):
   - `inline: <rel-path>` → read the fragment at its resolved path (relative to the
     capability's resolved registry path) and **follow it in-context**, applying its authoring
     idioms.
   - `subagent: <agent>` → invoke the **Task** tool with `subagent_type: <agent>`, passing
     the change set and coverage plan; apply the guidance its final block returns.
4. **Aggregate additively in registry order.** `guidance` composes on top of the
   discover-and-match default; a **later** (more-specific) contributor **wins** on any
   direct conflict with the default or an earlier contributor. A capability's guidance may
   be **self-scoped** — contributing nothing for a change it doesn't govern (its no-op);
   apply only what each contributor actually returns.

**No-op (the only permitted branch is "zero `implement` guidance fragments" vs "one or
more"):** if `resolve_registry` returns an empty `capabilities[]`, no fragment row matches
the `implement` phase under the `guidance` kind, or a `dispatch` is malformed (neither
`inline:` nor `subagent:`), that contributor — or the whole phase — produces **nothing**.
The **discover-and-match default then stands alone**: no capability term surfaces, no broken
subagent reference, no STOP. **Never** name a concrete capability, count the registry, or
carry a per-capability code path.

---

## Phase 4: Author the tests

Author (or extend) the planned tests, composing the **discover-and-match default** with the
**aggregated guidance** (most-specific wins). For each file in the coverage plan:

- **Mirror the discovered conventions** — the framework, assertion style, file-naming,
  location, and structure the existing tests use, as refined by any aggregated guidance. Do
  not introduce a framework or assertion style the project doesn't already use.
- **Write real cases, not placeholders.** Cover the branches picked in Phase 2 — the happy
  path, each boundary, each error/empty/null case. Never emit generic `TODO` stubs.
- **Extend, don't duplicate.** When a mapping test already exists, add cases to it rather
  than creating a parallel file.
- **Attribution.** Prepend a single attribution line to each **newly created** test file in
  that file's own comment syntax (mirror how sibling test files comment) —
  `Authored by: <model id>`, using the runtime model id (write `unknown` if unavailable).
  Never an AI-promotional tagline. When extending an existing file, leave its header alone.

Write **only** test files. If authoring a test would require touching production source
(e.g. the code isn't exported or is untestable as written), do **not** make that change —
record it as a blocker in the report and leave the file unwritten.

---

## Phase 5: Run the authored tests

Run the tests just written, using the project's **test-invocation convention** — the command
the existing tests already run under (discovered in Phase 2), or `{verify-command}` from
config when that command exercises the tests. Run only that command — no ad-hoc installs, no
unrelated builds.

- **All green** → record pass counts; proceed to Phase 6.
- **Failures** → capture the failing cases and their output. A failure may mean the test is
  wrong **or** the code under test is. `tt` does **not** fix production source — report the
  failures with enough detail for the user to decide, leaving the authored tests in place.
- **Can't run** (no runnable test-invocation discoverable) → report the tests as authored
  but unrun, and name what's missing (e.g. an uninitialized test runner) so the user can run
  them.

---

## Phase 6: Report and index

**Chat summary**, in this order:

- **Change set:** how it was resolved (delivery read / `--files` / artifact-derived) and how
  many files it held.
- **Coverage:** per file — `new` / `extended` / `skipped (reason)`.
- **Conventions:** one line — the discovered convention `tt` matched, and whether capability
  guidance refined it (`discover-and-match default alone` when none was registered).
- **Run result:** pass/fail counts, or the unrun reason.
- **Authored files:** the test files created or modified.

**Index (only when `<id>` resolved).** Invoke `/wf:index {id} tests "<n> authored · <r>"`
(substitute the count and a short run result) to record the run in the per-task index. Skip
this when `<id>` did not resolve.

---

## Edge Cases

- **No delivery provider registered (bare-core mode):** detected via the delivery record's
  `state` (`unconfigured`/`unrecoverable`) from `resolve_provider("delivery")`, never via a change-set return. `tt` degrades to an explicit
  `--files` list or an artifact-derived change set, or stops with a register-a-provider /
  pass-files message — never a raw working-directory fallback dressed as a change set.
- **Delivery provider registered but the branch is clean:** `branch-changes-read` returns an
  empty set — a valid "nothing to test" result, reported as `TT — Nothing to test`. Distinct
  from the provider-absent path above.
- **No testing capability registered:** the `implement`-guidance firing no-ops; the
  discover-and-match default stands alone and still produces tests. Not an error.
- **Project has no existing tests:** the discover-and-match scan has nothing to mirror. Fall
  back to the most conventional shape for the detected language, place tests adjacent to
  source, and flag in the summary that there was no prior convention to match.
- **A capability's `guidance` is self-scoped and contributes nothing** for this change (e.g.
  the change is production-only, or outside the capability's stack): apply only what
  contributors actually return; the default carries the rest. Never force a capability's
  idiom onto a change it doesn't govern.
- **Authoring a test would require changing production source:** do not make the change.
  Record it as a blocker and leave that file's test unwritten — `tt` writes only test files.
- **`subagent:` fragment names an unavailable agent:** treat that fragment as a no-op (it
  contributes no guidance) and continue on the remaining contributors and the default —
  never STOP on a missing capability.
- **Only deleted files changed:** nothing new to cover. Note that the deleted code's existing
  tests may want removal, but `tt` does not act on production deletions — surface it and stop
  with `TT — Nothing to test`.

---

## Final Output

End the chat reply with this fenced block, after the chat summary:

```
TT — <Authored | Nothing to test | No change set | Blocked>

<change-set summary>: <n> files · <a> new, <e> extended, <s> skipped · tests <PASS <p>/<t> | FAIL <f>/<t> | unrun>
Conventions: <discovered convention matched | + capability guidance | discover-and-match default alone>
Next: <see below>
```

The `Next:` line is **always present**, branched on the state:

- **Authored, tests pass** → `/wf:verify-spec {id}` to audit the change, or `/wf:commit {id}`
  to ship it (omit `{id}` when it didn't resolve).
- **Authored, tests fail** → fix the code or the authored tests, then re-run `/wf:tt`.
- **Nothing to test** → `Next: none — clean branch, nothing changed to cover.`
- **No change set** → `Next: register a delivery provider (/wf-git:init) or re-run with --files <paths>.`

**The final output block must always be the very last thing output to chat.**
