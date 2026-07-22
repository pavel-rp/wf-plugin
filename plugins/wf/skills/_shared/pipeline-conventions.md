# wf core — shared pipeline conventions

Runtime procedures shared verbatim by more than one core SDD-pipeline skill. Each skill
that used to inline one of these blocks now points here and keeps only its own
skill-specific parameters (its command name, artifact filename, and where it prints a
warning). Editing a procedure once here keeps every skill in lockstep and ends the drift
risk that copies invited.

**This is a runtime-read reference** — a skill opens it mid-run to follow the named
section. It is one level deep (a skill reads its `SKILL.md`, then this file — no chain
below). Reference a section by its **heading name**, never by line number.

**Contents:** Id inference from the current branch · Branch gate (bare-core aware) ·
Artifact rotation into `.history.md` · Report/spec staleness check.

> Two adjacent shared walks live elsewhere and are **not** repeated here: the
> phase-firing aggregation walk (registry → manifest → fragment → dispatch → aggregate)
> is `invocation-runtime.ops.md` §"The moving parts"; the delivery/tracker
> **Direct provider resolution** walk each skill carries in its own
> "Direct provider resolution" section is `invocation-runtime.ops.md`
> §"Direct provider resolution". This file covers only the core-skill mechanics those
> two don't.

---

## Id inference from the current branch

When a skill is invoked with **no explicit id**, infer it from the branch. Substitute
`/wf:<skill>` in every stop message below with the invoking skill's own command.

1. Resolve the current branch via `current-branch-query` (direct provider resolution to
   the `delivery` surface — see the skill's own "Direct provider resolution" section) and
   extract the first 3+-digit run — the **branch-inferred token**. With zero readable
   `delivery` rows this falls back silently to the plain-directory case (no branch to
   infer from). If no numeric token can be extracted from the branch at all, stop: "No
   task id provided and none could be inferred from the current branch. Pass it
   explicitly: `/wf:<skill> <id>`."
2. **Resolve that token against `{task-root}`**: apply the same first-3+-digit-run
   extraction to each existing folder's name and compare it to the branch-inferred token
   (mirroring `spec/SKILL.md`'s Validation-section resolution logic — this matches both a
   tracker-prefixed shape and the local `T<NNN>` scheme's own form uniformly).
   - **Exactly one match** — reuse that folder's full name as `{task-id}` verbatim.
   - **Zero matches** — stop: "No task id provided and the branch-inferred token
     `<token>` doesn't match an existing task folder. Pass it explicitly:
     `/wf:<skill> <id>`."
   - **More than one match** — stop: "No task id provided and the branch-inferred token
     `<token>` matches more than one task folder. Pass it explicitly: `/wf:<skill> <id>`."

An explicit `<id>` argument is used verbatim as `{task-id}` — opaque, whatever shape the
active tracker capability produces, or the local `T<NNN>` scheme — with no normalization
and no branch read. After resolving `{task-id}` (either path), a skill that needs a
branch-name match extracts the first 3+-digit run from it — `{numeric-id}` — used **only**
for the branch-gate match, never for the task folder or any operation.

Skills that verify a required artifact exists after resolving the id (e.g. `00_reqs.md`,
`04_verify.md`) keep that confirmation step in their own body — it is skill-specific.

---

## Branch gate (bare-core aware)

Before mutating anything, a skill confirms the working branch matches the task. It uses
`{numeric-id}` (the first 3+-digit run of `{task-id}`, above) **only** for the
branch-name match.

1. **Resolve delivery-surface ownership first** — the scope-equality filter
   (`contribution-kind = provider` **and** `scope = delivery`) of direct provider
   resolution, applied before any branch read. **Zero matching rows (bare-core mode)** —
   the gate is skipped entirely: no branch is resolved, `wf:branch` is not invoked, no
   error and no stop. Report "Branch gate skipped — no delivery provider registered
   (bare-core mode)." and continue. **One matching row** — resolve the current branch via
   `current-branch-query` and apply step 2.
2. **If the resolved branch name contains `/{numeric-id}-`** — proceed. **Otherwise** —
   call `resolve_routing` immediately before dispatch with `role: "branch"`,
   `shapeEvidence: { workSurface: "external-context", atomicity: "atomic", unitCount: 1,
   unitsIndependent: false, ambiguity: "none", risk: "elevated", toolWork: "bounded",
   validation: "mechanical", contextIsolation: "useful", independentReview: false,
   returnContract: "mechanically-judgeable", requestedParallelism: 1 }`,
   `supportsModelSelector: true`, and `supportsEffortSelector: false`. Emit the compact
   operational record (role; shape + reason; model/effort value or inheritance fallback +
   source; basis; attempt; escalation origin; masking; actual model when available;
   diagnostic; retained units; retry disposition), separately from artifact attribution.
   If `status: stop` or `diagnostic` is non-null, stop and surface the
   diagnostic. Otherwise obey `executionShape` per `invocation-runtime.ops.md`
   §"Resolver call root"; this evidence selects `isolated`, so invoke one
   **Task** with `subagent_type: wf:branch`, passing `{task-id}` and the forwarded
   `delivery` resolution record resolved above (the optional spawn extension —
   `invocation-runtime.ops.md` §"Run-scoped provider forwarding"). Pass the model selector
   only when non-null, and preserve inherited effort when effort is null. (Do NOT call
   `/wf:branch` — that loads its `SKILL.md` into this skill's context. The subagent is
   self-sufficient.) On `BRANCH — created`/`switched`/`already-active`, continue. On
   `BRANCH — Error`, stop and surface the subagent's reason.

Each skill keeps its own behavior for **Task-tool unavailability** (some skills skip the
gate with a stated reason and proceed on the current branch; others treat it as a hard
stop) — that tail stays in the skill body.

---

## Artifact rotation into `.history.md`

A skill that overwrites a re-runnable artifact `<NN_name>.md` rotates the prior copy into
`<NN_name>.history.md` first, so every past run is retained:

- Read the current `<NN_name>.md` if it exists.
- Prepend its contents to `<NN_name>.history.md` (newest entry on top), followed by a
  `---` separator on its own line, followed by any prior history contents.
- If `<NN_name>.md` doesn't exist yet (first run), skip the rotation.
- If `<NN_name>.history.md` doesn't exist yet, create it from the rotated content alone.
- Then write the new `<NN_name>.md`.

Each archived entry is self-identifying via its own header. The history file grows
unbounded — the user prunes it manually if it gets noisy. When a skill's
`<path-to-artifact>` override form is used, write both files as siblings of that path
instead.

---

## Report/spec staleness check

To detect whether the branch moved since an artifact was written, invoke
`last-commit-timestamp-query` via direct provider resolution to the `delivery` surface
(see the skill's own "Direct provider resolution" section) and compare it against the
artifact's own recorded moment (`**Audited at:**`, `Run date`, or a spec's fetch/author
date — whichever that skill records). Interpret both values as calendar moments and
compare chronologically — **never a string compare**.

- **Last-commit timestamp at or before the artifact's moment** — proceed normally.
- **Last-commit timestamp after it** — the branch has moved since the artifact was
  written; cited evidence may be stale. Warn the user (the skill decides where the
  warning prints and how loud) and continue anyway.
- **The artifact's moment is absent, or either value can't be confidently parsed as a
  calendar moment** — skip the check silently. This is a soft/advisory check, not a hard
  gate.

With zero readable `delivery` rows, `last-commit-timestamp-query` falls back silently to
a plain-directory-safe timestamp read — no VCS invocation of any kind.
