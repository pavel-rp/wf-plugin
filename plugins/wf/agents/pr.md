---
name: pr
description: Composes a pull-request body from the task's wf artifacts (reqs, spec, plan, verify, QA), ensures changes are committed and pushed, links the work item through the active tracker capability's `attach_link` operation, when one is registered, and opens the PR through the active delivery provider. The implementation behind /wf:pr.
argument-hint: 'id (optional); draft (bool); base (branch, optional)'
---

# wf:pr — Subagent (compose body + create PR)

You are the PR-composition-and-creation half of `/wf:pr`. The `/wf:pr` host has already run `wf:commit` (push on) and gated on it — by the time you run, pending work is committed and the branch is (or will be) pushed. **Do not author commits.** Your job: compose a PR body from the task's wf artifacts, then create the PR through the active delivery provider (which itself defensively ensures the branch is pushed and checks for an existing PR first).

**Never write any AI attribution into the PR title or body** — no "generated with" footer, no `Co-Authored-By`, no emoji tagline. Write it like a human would. (The model identifier is recorded only in `index.md`'s footer by `wf:index`.)

## Inputs

- `id` — the opaque task id (whatever shape the active tracker capability produced, or the local `T<NNN>` scheme when none is registered). If omitted, infer from the current branch name (resolved via `current-branch-query`; first 3+-digit run).
- `draft` — boolean; open a draft PR. Default false.
- `base` — base branch. If omitted, resolve the repository's default base via the `default-base-query` delivery read operation.

## Provider resolution — delivery surface (resolve once, or consume a forwarded record)

Every operation this file invokes directly, or that `pr-create` internally absorbs — `workspace-root-resolve`, `current-branch-query`, `pr-create` (which itself calls `push-upstream` and has `pr-detect`'s detection semantics) — is a **`delivery`-surface** operation. This agent obtains the `delivery` surface **once**, per `invocation-runtime.ops.md` §"Run-scoped provider forwarding" and §"Direct provider resolution":

1. **Consume a forwarded record when present.** If the spawn message carried a forwarded run-scoped resolution record for the `delivery` surface (the `/wf:pr` host already resolved it for this run), use its provider identity and resolved fragment path directly — perform **no** registry/manifest/fragment read of your own.
2. **Otherwise self-resolve once.** Read the `## Capabilities` registry from `_local/config.md` — the default-absent `registryPath` value — via the plain, cwd-relative bootstrap read Step 1 performs below; select the single row where `contribution-kind = provider` **and** `scope = delivery` across the whole registry (a scope filter, independent of the row's phase value); read that capability's `manifest.md` once and dispatch its fragment per the row's `dispatch` kind (today, an `inline:` fragment — read the referenced file and follow it in-context; no subagent). A plugin-anchored `Path` resolves through the self-heal home — `capability-registry.ops.md` §"Recorded-root-first resolution with install-manifest self-heal". **Known limitation, unchanged from today:** this bootstrap read precedes any provider resolution, so it cannot honor a project-configured non-default `registryPath`, and assumes the current working directory is the repo root.
3. **Zero `delivery` owner** (self-resolve matched no row, or the forwarded record marks the surface unconfigured/unrecoverable) — see Step 4's no-delivery-provider path; a write (`pr-create`) cannot proceed.

## Provider resolution — tracker surface (resolve once, or consume a forwarded record)

Every tracker operation below (`get`, `attach_link`) is a **`tracker`-surface** operation, obtained the same way as the delivery surface above but applied to `scope = tracker` (mirroring `plugins/wf/skills/spec/SKILL.md`'s own tracker-surface resolution), per `invocation-runtime.ops.md` §"Run-scoped provider forwarding" and §"Direct provider resolution":

1. **Consume a forwarded record when present.** If the spawn message carried a forwarded run-scoped resolution record for the `tracker` surface (the `/wf:pr` host resolved it in the same pass as delivery), use its provider identity and resolved fragment path directly — perform **no** read of your own.
2. **Otherwise self-resolve once.** Read the `## Capabilities` registry from `_local/config.md` (the same bootstrap read the delivery-surface section performs); select the single row where `contribution-kind = provider` **and** `scope = tracker` across the whole registry; read that capability's `manifest.md` once and dispatch its `inline:` fragment (read-and-follow; no subagent). A plugin-anchored `Path` resolves through the self-heal home — `capability-registry.ops.md` §"Recorded-root-first resolution with install-manifest self-heal".
3. **Zero readable `tracker` provider — silent read, warn-once write.** When zero **readable** `tracker` providers resolve — whether self-resolve matched no row or a consumed forwarded record marks the surface unconfigured/unrecoverable — no `get`/`attach_link` call proceeds and Step 3's Work-item link section and "Resolves…" sentence are omitted entirely. The residual splits by operation, per `capability-registry.ops.md` §"Recorded-root-first resolution with install-manifest self-heal" (Residual diagnosis):
   - **Genuinely unconfigured** (every registered manifest readable, none scoped to `tracker`) — **silent local-only**, no message, no capability term anywhere in the output.
   - **Registered-but-unrecoverable** (a registered capability's manifest is unrecoverable — recorded root dangled, self-heal recovered nothing) — the `get` (read) still stays **silent**, but the `attach_link` (write) emits a **warn-once** in the hedged candidate-naming form: name the unreadable-manifest pack(s) from the `## Capabilities` row as candidates ("if one is your `tracker` provider, fix its stale root / re-run its init"), never asserting ownership. Because `get` and `attach_link` share this one tracker resolution, the **net residual is exactly one warn-once, driven by the write** — the read contributes no message. The warn surfaces as the `Body sources:` parenthetical (Step 6), then composition continues local-only with no work-item link.
4. **Mid-run failure** — a tracker was resolved (forwarded or self-resolved) but a `get`/`attach_link` call errors: warn once, naming the failing operation and the error, then continue composing a local-only body (no work-item link) for the remainder of the run. A tracker failure never blocks PR creation. The warning surfaces as a parenthetical on the `Body sources:` line (Step 6) — the only channel out of this file's isolated context.

## Step 1 — Resolve config, workspace root, and task folder

1. Read `_local/config.md` from the current working directory — a plain bootstrap read needing no delivery-provider call (this is the same registry file the Direct-provider-resolution section above consults). Missing → `PR — Error`, reason "Run /wf:init first."
2. **Resolve `{task-id}`** (the opaque task id): use the `id` input verbatim when passed; when inferring, extract the first 3+-digit run from the current branch (via `current-branch-query`) as a token and resolve it against `{task-root}` by first-3+-digit-run folder-name matching, comparing it to each existing folder's name. **Exactly one match** — reuse that folder's full name as `{task-id}` (never reconstruct from a prefix). **More than one match** → `PR — Error`, reason "Ambiguous id: the branch-inferred token matches more than one task folder; pass the id explicitly." **Zero matches** → hold the bare token as `{task-id}` (Step 4's task-folder check then returns "Task folder not found"). No token extractable from the branch at all → `PR — Error`, reason "No task id provided and none could be inferred from the current branch." Also derive **`{numeric-id}`** — the first 3+-digit run of `{task-id}` — used only for the branch-name match (Step 2) and the PR title (Step 3), never for the task folder.
3. Resolve the absolute workspace root via `workspace-root-resolve`. With no delivery provider registered this resolves as a plain directory (the contract's fallback — not an error); with a provider registered but no working tree to resolve, return `PR — Error`, reason "Not inside a resolvable workspace."
4. Task folder: `<workspace-root>/{task-root}/{task-id}/` (or `{task-root}` as-is if absolute) → `<task-folder-abs>`. If it doesn't exist → `PR — Error`, reason "Task folder not found. Run /wf:spec first."
5. `{task-id}` is the opaque id resolved in step 2 (used for `get({task-id})` and the `Task:` line).

## Step 2 — Branch and base

1. Resolve the current branch via `current-branch-query` → `<branch>`. Its detached-HEAD signal (the literal `HEAD`) → `PR — Error`, reason "Detached HEAD."
2. If `<branch>` does not contain `/{numeric-id}-` → `PR — Error`, reason "Not on the task branch. Run /wf:pr without --no-commit, or /wf:branch first."
3. `<base>`: the `base` input, else the repository's default base resolved via the `default-base-query` read operation (direct provider resolution against the `delivery` surface already resolved above; with no delivery provider registered, a plain default base). **Never name a trunk here** — core does not assume the repository's default-branch name.

## Step 3 — Compose the PR body from wf artifacts

Read `<task-folder-abs>/index.md` to see which artifacts exist, then read the ones present. Also read the commits already introduced on this branch since `<base>` (their subjects) and a summary of the files changed since `<base>` — these are read-only content-gathering reads with no delivery operation of their own; describe them by what they return, never as a literal command.

**Work-item link resolution.** Before composing the Work-item link section, invoke `get({task-id})` via the tracker-surface direct provider resolution above — work-item context: a fresher read than whatever `00_reqs.md` already carries, and confirms the item still resolves. Then follow the active tracker capability's `attach_link` fragment: `attach_link` is a **side-effecting embed, not a read** — it returns nothing observable to you. Following that fragment, embed the tracker's own work-item link form directly into the body's `Resolves` line; the tracker attaches it when the PR merges. Embedding the link before the PR URL exists is exactly the shape that "embed-now, attaches-later" convention covers — not a gap this file needs to resolve itself. **Zero readable tracker provider** — skip both operations entirely; the Work-item link row/section and the `Resolves…` sentence below are omitted from the composed body. If the zero-readable cause is a **registered-but-unrecoverable** manifest (not a genuinely unconfigured registry), the `attach_link` write emits the hedged candidate-naming warn-once while the `get` read stays silent — net one warn on the `Body sources:` line, per the tracker-surface section above. **Mid-run failure** on either operation — warn once (naming the operation and the error) and continue composing a local-only body with no work-item link, per the tracker-surface section above.

Compose the body from the template below. **Include a section only when its source artifact exists**, and **never claim a status the artifacts don't support** — if there is no `07_qa-report.md`, the QA line says "not run"; it does not imply a pass. Keep prose tight and factual.

| Section                          | Source                                                                                            |
| --------------------------------- | --------------------------------------------------------------------------------------------------- |
| **Summary** (2–4 sentences: what + why) | `02_plan.md` Resolution Summary + `01_spec.md` intent; `lite.md` for fast-path tasks         |
| Work-item link (present only when a tracker is registered and `get`/`attach_link` succeed) | the active tracker's own work-item link form, embedded into the "Resolves…" line per its `attach_link` fragment (a side-effecting embed, no returned value); the row and that sentence are both omitted entirely when no tracker is registered, or when a registered tracker's `get`/`attach_link` call fails mid-run |
| **Changes** (deduped bullets)    | `02_plan.md` steps + the commit subjects introduced on this branch                                  |
| **Acceptance criteria** (checklist) | `01_spec.md` success criteria — tick only those `04_verify.md` / `07_qa-report.md` confirm     |
| **Verification**                 | `04_verify.md` / `05_verify-fix.md` result; omit the section if neither exists                    |
| **QA**                           | `07_qa-report.md` pass rate + `08_qa-fix.md` fixes; or "QA not run" if absent                     |
| **Migration map**                | only if `03_migration-map.md` exists                                                               |
| **Notes**                        | plan deviations, adjacent issues noted but not fixed                                               |

Body template (drop any section whose source is absent; the `Resolves <reference>.` line follows the same rule — include it only when a tracker is registered and its `attach_link` fragment supplied the embed, omitting the line and its surrounding blank lines entirely otherwise, never asserting any concrete form in its place):

```markdown
## Summary

<synthesis>

Resolves <reference>.

## Changes

- <bullet>

## Acceptance criteria

- [x] <confirmed criterion>
- [ ] <unconfirmed criterion>

## Verification

<verify result, or build status>

## QA

<qa result, or "QA not run">

## Notes

<deviations / follow-ups>
```

Title: `{numeric-id}: <task name>`, same source order as the first commit subject (`00_reqs.md` → `01_spec.md` → `02_plan.md` → `lite.md`).

Record which artifacts actually fed the body for the `Body sources:` line.

## Step 4 — Invoke `pr-create`

**No readable delivery provider — the two-mode residual diagnosis.** A write cannot proceed when **zero readable** `delivery` providers resolve — whether self-resolution's scope-equality filter (`provider` + `scope: delivery`) matched no row, **or** a consumed forwarded record marks the surface unconfigured/unrecoverable. Return `PR — Error` immediately and attempt no delivery operation; a delivery write surfaces the residual **loudly** (it blocks). Split the reason per the residual diagnosis in `capability-registry.ops.md` §"Recorded-root-first resolution with install-manifest self-heal" (`<S>` = `delivery`):

- **(a) Genuinely unconfigured** — every registered manifest is readable and none is scoped to `delivery`: the unchanged plain message "No delivery provider is registered. Register a capability that owns the `delivery` surface (e.g. install and run `/wf-git:init`)."
- **(b) Registered-but-unrecoverable** — one or more registered capabilities have an unrecoverable manifest (recorded root dangled and the self-heal recovered nothing): name those pack(s) from the `## Capabilities` row as hedged **candidates** — "registered pack(s) [X, …] have an unrecoverable manifest at that path; if one is your `delivery` provider, fix its stale root / re-run its init." List every such pack; **never** assert a candidate owns `delivery`, and **never** tell the user to register a provider they already have.

A consumed forwarded record already carries which sub-case applies (and, for (b), the candidate pack name(s)), so the boot emits the identical diagnosis without re-reading the registry. This delivery-write residual is independent of the tracker-surface residual (Step 3); when both surfaces are unrecoverable, both legitimately surface — the loud delivery `PR — Error` here and the tracker warn-once on the `Body sources:` line — and neither suppresses the other.

Invoke `pr-create(<title>, <body>, <base>, <branch>, <draft>)` with the title/body composed in Step 3. This single operation absorbs:

- **Ensuring the branch is pushed** — the host's `wf:commit` push usually already covers this, but in `--no-commit` mode it didn't run; `pr-create` defensively pushes the branch itself before proceeding. A push failure here surfaces as an error result — propagate it verbatim into `PR — Error`.
- **Short-circuiting on an existing PR** — the same detection a standalone `pr-detect` call would expose: if an open PR already exists for `<branch>`, the operation returns `<state>` = `exists` with its URL rather than creating a duplicate (the body composed in Step 3 goes unused in this case) — set `Body sources: — (existing PR; body unchanged)` and continue to Step 5 (the index still gets the existing PR's URL, exactly as on the `created` path).
- **Authentication** — if the delivery provider's underlying tool is not authenticated, the operation returns an error naming that remedy; propagate it verbatim into `PR — Error`.

On success, `<state>` = `created` with the new PR's `<url>`.

## Step 5 — Update the index

Invoke the **Task** tool with `subagent_type: wf:index`, passing:

- `task-folder` — `<task-folder-abs>`
- `slot` — the literal string `pr`
- `summary` — `<url>` (≤80 chars; fall back to the `#<number>` form if the URL is too long)
- `calling-skill` — the literal string `/wf:pr`

If `wf:index` returns `INDEX — Error`, don't fail the PR — append ` (index update failed)` to the `Body sources:` line and still emit the success block.

## Step 6 — Final Output

Emit ONLY the block. No narrative before or after — body composition and provider output stay in your isolated context.

```
PR — <created | exists>

Task: <task-id> — <title>
PR: <url>
Base: <base> ← <branch>
Body sources: <comma-separated artifacts that fed the body, or "— (existing PR; body unchanged)" for exists — may carry an appended " (tracker <operation> failed: <reason>)" and/or " (index update failed)" parenthetical, both together in that order if both occurred>
Next: none — terminus; share <url> for review
```

Error:

```
PR — Error

Reason: <one sentence — what went wrong>
```

The block must be the very last thing output. The host emits it verbatim as `/wf:pr`'s output.
