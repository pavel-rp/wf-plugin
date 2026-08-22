---
name: init
description: Sets up a repository for the wf:* skill suite in one journey — admitting the workspace root, discovering installed capability packs, scaffolding the _local/ task folder and default config, taking an explicit pack selection, asking every unresolved setup question once, confirming one plan, and applying it in a single transaction. Re-running an already-set-up repository reconciles it instead, showing one delta of additions, drift repairs and explicitly deselected removals and applying it after the same single confirmation; a settled repository reports no drift and mutates nothing. Use once per new repository before running /wf:spec, and again to add, remove, upgrade or repair packs.
allowed-tools: [Read, Write, Edit, Glob, Bash, AskUserQuestion, Skill, ToolSearch]
---

# /wf:init — Set up a repo in one batched journey

Bootstrap the current repository for the wf:* skill suite as **one coherent
interaction** rather than a scaffold command followed by N per-pack setup
commands. Ten phases run in a fixed order: **1** admit the workspace root, **2**
discover installed packs (recovery, inventory confidence, relayed per-pack
state), **3** scaffold the bare core idempotently outside the pack transaction,
**4** take an explicit selection, **5** ask every unresolved question once, **6**
re-plan with those answers, **7** confirm one plan identity, **8** apply one
transaction, **9** settle the registry-derived scaffolding and inspect, **10**
establish the constitution. On a workspace that already carries lifecycle state,
Phases 4–8 take their **reconcile** form instead (see "The fork" below).

> **The two rules that make this safe.** **Relay, never infer** — every
> lifecycle fact shown to the user is read out of a typed envelope, never
> derived by this skill. **One mutation** — `apply_install` in Phase 8 is the
> only lifecycle write, it runs at most once, and it carries the id of the exact
> plan the user confirmed.

Idempotent, in both forms: a re-run over a settled workspace produces no diff and
never reaches the mutation stage. Rationale lives in the paired
`fresh-init-journey.md` and `reconcile-rationale.md` references, **never read at
runtime**.

---

## Command Syntax

```
/wf:init [--force]
```

| Argument  | Required | Description                                                        |
| --------- | -------- | ------------------------------------------------------------------ |
| `--force` | NO       | Overwrite `_local/config.md` and `_local/README.md` if they exist. |

Selection, answers, and confirmation are taken interactively — no flag
pre-selects a pack, pre-answers a question, or skips the confirmation. The
declared externally-bindable surface (invocation shape, terminal-block status
set, slots, settings) is `interface.md` beside this file: it is the contract,
this body is its implementation.

---

## Safety Rules (NON-NEGOTIABLE)

**Allowed:**

- Read and write files under `_local/`.
- Append (never rewrite) `.gitignore` and `.git/info/exclude`.
- Write the `## Capabilities` registry table to a **configured `registryPath`**
  location that passes the Phase 3 defensive check — the one sanctioned scaffold
  write outside `_local/`, since relocating the registry is that key's purpose.
- Read-only resolution through the bundled `wf-resolver` MCP service:
  `resolve_config`, `resolve_registry`, `resolve_profile`, `resolve_content`,
  `discover_packs`, `plan_install`, `repair_packs`, `resolve_inspect`, plus one
  explicit `resolve_refresh` after the scaffold writes.
- **At most one** `apply_install` call per run — none at all on a settled exit —
  carrying the `expectedPlanId` of the plan the user confirmed, and the sole
  lifecycle mutation this skill performs.
- Invoke `/wf:constitution` through the **Skill** tool.

**Forbidden:**

- Write or edit any file outside the scaffold writes named above.
- Mutate lifecycle state by any path other than that sanctioned `apply_install` —
  no hand-written ledger, no registry row written on a pack's behalf, no
  enablement flipped, no answer persisted directly.
- Call `apply_install` without a confirmation, more than once per run, or with a
  plan id other than the one confirmed.
- Derive a deregistration from anything but an **explicit deselection**: an
  omission, an orphaned registration, a disabled registration, and a missing
  durable record each **retain**, and none may place a pack in `deregister`.
  Nor reconstruct a desired set by inference from machine-local state when the
  durable record is absent — ask instead.
- Report a workspace as settled, or as showing no drift, while an advance is
  withheld or an artifact is retained under any class but the benign one.
- Call `register_pack` — a pack registers its own capability; `init` establishes
  the substrate those registrations attach to.
- **Infer** any lifecycle fact: presence, state, enablement, availability,
  recovery, and whether a question is answered are relayed verbatim from the
  envelope, never derived from a heuristic, a file probe, or a `selectable` flag
  read as eligibility.
- Treat a suggested, personal-tier, or pack-tier value as an answer, or suppress
  a question because such a value exists; or re-ask a question the envelope
  already reports resolved.
- Hold a lock across host phases, or nest one inside another.
- Run builds, tests, linters, or installs.
- Invoke a delivery write op (`branch-create`, `commit`, `push-upstream`,
  `pr-create`) or any destructive version-control operation.
- Probe `${CLAUDE_PLUGIN_ROOT}` or otherwise derive a plugin root, manifest path,
  or override-merged profile value by hand.
- Name any concrete pack, capability, stack, or project noun in this behaviour.

---

## Phase 1: Admit the workspace root

Nothing is written, and no lifecycle state is read, until a root is admitted.

1. **Derive the candidate root** by running `pwd -P` in this Agent/session. In a
   linked worktree, that is the worktree's own root — never a parent Agent's.
   Pass it as `workspaceRoot` on **every** resolver call in this run; omitting it
   is a hard schema error, and the resolver has no default or fallback root.

2. **Call `resolve_config({ workspaceRoot })`.** It returns `{ workspaceRoot,
   registryPath, coreConfig{ taskRoot, … }, idShape }` in one typed query and
   never requires `_local/config.md` to exist — on a fresh repo `coreConfig`'s
   fields come back unset, the state Phase 3 fills. Perform **no** direct config
   parse, plugin-root probe, or manual registry/manifest read.

3. **Relay the admission verdict — never re-derive it.** `resolve_config` carries
   config facts only; the verdict rides the **lifecycle** envelopes. `plan_install`
   and `apply_install` each carry an explicit `admission` block
   (`{ admitted, root, source, reason, diagnostic }`); `discover_packs` reports an
   inadmissible root as `recovery.state: "invalid-root"` with
   `recovery.proceeded: false`. Phase 2 is the first lifecycle call, so its verdict
   lands **before** Phase 3 — an inadmissible declaration never reaches a scaffold
   write. On refusal emit `INIT — stopped`, quoting the diagnostic verbatim. On
   admission carry the **admitted** root, not the candidate, into every later call,
   and report its `source` so a non-cwd root is visible rather than silent.

4. **Resolver unavailable** (the call errors, or the MCP server is not loaded) ⇒
   stop with `INIT — stopped`: "The `wf-resolver` service is not available —
   restart Claude Code so the bundled resolver MCP server loads." A broken
   resolver is a stop condition, not a silent fallback.

---

## Phase 2: Discover installed packs

**One** `discover_packs({ workspaceRoot })` call. Discovery is byte-inert from
the recovered baseline; it never registers, enables, or writes anything.

1. **Read `recovery` first** — it is the one field that can describe a write, and
   it is reported on its own channel precisely so a recovery write is never
   mistaken for a discovery write.
   - `recovery.proceeded: false` ⇒ **halt.** No lifecycle state was read, so
     nothing may be shown or acted on. Emit `INIT — stopped`, relaying
     `recovery.state` and its diagnostics, and direct the user to
     `/wf:resolve` for the recovery path.
   - `recovery.wroteBytes: true` ⇒ say so plainly: recovery restored an
     interrupted transaction, and everything below is asserted from that
     recovered baseline.

2. **Relay `inventory`** — `confidence`, `observedCount`, and
   `mayEstablishAbsence`. When `mayEstablishAbsence` is false, absence is
   **unknown, not established**: never report a pack as missing or orphaned on a
   non-trustworthy inventory.

3. **Relay each entry of `packs[]` as reported** — its `state`, `enablement`,
   `presence`, `registeredCapabilities`, `overlay`, and its declared `questions`.
   Do not recompute any of them, and do not collapse the three `presence` values
   into a two-way present/absent split.

4. **`selectable` is not the eligibility filter.** It reports whether a pack is
   **already operational**, so on a fresh workspace it is false for every pack —
   including every pack the user is about to choose. Never key the Phase 4 offer
   on it.

---

## Phase 3: Scaffold the bare core

The scaffold is an **idempotent prerequisite that sits outside the pack
transaction**: it runs before anything is selected, and a later decline or
rollback never un-scaffolds it.

1. **`_local/`** — create if missing. If it exists as a directory, canonicalize
   it and require that it stays under the canonical admitted root; a symlink
   escaping the workspace is a stop before any write. If `_local` exists as a
   regular file, stop and report the conflict.

2. **Resolve the registry location** from `registryPath`, apply its defensive
   containment check, and place the `## Capabilities` table in exactly one
   destination. The procedure — including the `default` / `configured` /
   `rejected → fell back to default` state the Final Output reports — lives at
   `registry-location.md`, obtained via `resolve_content({ workspaceRoot, class:
   "references-template", skill: "init", ref: "registry-location.md" })` on this
   write path only.

3. **Write `_local/config.md`.** Skip if it exists and `--force` is not set
   ("config.md already present — left untouched").

   The verbatim default content lives at `config-template.md`, obtained via
   `resolve_content({ workspaceRoot, class: "references-template", skill:
   "init", ref: "config-template.md" })` — never a raw read of a plugin-cache
   path. **Strip the `<!-- init directive … -->` HTML comment before writing**:
   it is a build-time aid for this skill and must never reach a written file.

4. **Infer the Verify Command** and substitute it into the template, along with
   the current model id on the `**Model:**` line. The detection procedure lives
   at `verify-command-detection.md`, obtained via `resolve_content({
   workspaceRoot, class: "references-template", skill: "init", ref:
   "verify-command-detection.md" })` on this write path only. Never write a
   hardcoded default; when detection falls back to its TODO placeholder, flag it
   prominently so the user fixes it before running any other skill.

5. **Write `_local/README.md`** — skip if present and `--force` is unset. The
   verbatim content, and the model-id substitution it takes, live at
   `local-readme-template.md`, obtained via `resolve_content({ workspaceRoot,
   class: "references-template", skill: "init", ref:
   "local-readme-template.md" })` on this write path only.

6. **Gitignore `_local/`.** Create `.gitignore` with the single line `_local/`
   if absent; otherwise append `_local/` only when no line already matches
   `_local` or `_local/` exactly. Never rewrite, reorder, or deduplicate existing
   entries.

7. **Inform the resolver.** Call `resolve_refresh({ workspaceRoot, reasons:
   ["/wf:init wrote the bare-core scaffold"] })` so later phases do not rely on
   incidental fingerprint recomputation. A "no such tool" error means the tool is
   **deferred, not missing** — fetch its schema through the host's tool-search
   surface and retry once. A second failure does **not** stop the run (the writes
   landed, and every typed query re-validates its own fingerprints); note that
   the explicit refresh did not confirm.

---

## The fork: fresh journey or reconcile

Take the **reconcile** form when Phase 2 reported any pack already carrying
lifecycle state — a non-empty `registeredCapabilities`, or any evidence
comparison other than `evidence-missing`; otherwise take the fresh form below.
Reconcile replaces Phases 4–8 — a diagnosis before the selection, a desired-set
round instead of a fresh one, and a settled exit that may reach no plan at all;
Phases 1–3 and 9–10 are the shared spine. It adds no flag and no status token,
and its steps defer to Phases 5, 6 and 8 by name. Its procedure lives at
`reconcile-mode.md`,
obtained via `resolve_content({ workspaceRoot, class: "references-template",
skill: "init", ref: "reconcile-mode.md" })` on that path only. Follow it as
written. Four invariants govern it; violating any is a defect, not a judgement:

1. **Removal has exactly one source: an explicit deselection** — never a set
   difference, never an omission. An orphaned registration, a disabled one, and
   one whose durable record is missing each **retain**; the third bootstraps
   *without* deletion.
2. **A settled workspace never enters the mutation stage** — not "enters it and
   does nothing": no plan call, no confirmation, no mutation call at all. And
   settled is not one applicability read — a withheld advance, or an artifact
   retained under any class but the benign one, is **retained divergence**, a
   zero-write state that must never be reported as no drift.
3. **Preselection comes from the durable committed record only.** Where there is
   none, ask; machine-local state may not reconstruct a desired set.
4. **Visible, selectable, deselectable and retained are four properties**, kept
   separate and never collapsed into one value.

---

## Phase 4: Take an explicit selection

Present the relayed inventory and ask which packs to set up. Nothing is selected
by default and nothing is selected automatically.

1. **Offer every pack discovery reported**, each shown with its relayed `state`,
   `presence`, and `enablement`.
2. **Availability is keyed on the relayed `enablement` and `presence`**, never on
   `selectable` (Phase 2 step 4). A pack that is present and not disabled can be
   chosen.
3. **A disabled pack is visible but unavailable.** Show it with its own state,
   do not offer it as a choice, and never flip `enablement` — re-enabling is the
   user's action, outside this run. Selecting one anyway is the planner's error
   to raise, not this skill's to silently correct.
4. **Zero selection is a first-class outcome**, not a degenerate one: the run
   continues, the plan comes back with nothing to do, and the workspace keeps
   the bare-core scaffold and nothing else. Hold the chosen set as `desired`.

---

## Phase 5: Ask every unresolved question, once

1. **Call `plan_install({ workspaceRoot, desired })` with no `answers`.** This
   probing plan is byte-inert; its purpose is to learn what is still unanswered.
2. **Ask exactly `answers.unresolved[]`** — every entry, in one batch, in the
   order given. Each carries `pluginId`, `questionId`, `prompt`, `reason`, and
   `suggestions[]`.
3. **Pre-fill from `suggestions[]` without treating one as an answer.** A
   suggestion — a shipped default, a pack-tier value, or a personal-tier value —
   makes accepting cheap; it never makes the question disappear. Only a valid
   **persisted** value at the declared destination resolves it, and that is a
   fact the envelope reports, not one to judge here.
4. **Never re-ask what the envelope already resolved.** A question absent from
   `answers.unresolved[]` is answered; asking it again is a defect.
5. **One round.** Collect every answer before moving on. Do not ask, plan, and
   ask again.

Hold the collected answers as `answers[]` of `{ pluginId, questionId, value }`.

---

## Phase 6: Re-plan with the answers

Call `plan_install({ workspaceRoot, desired, answers })`. This is the plan the
user will confirm and the plan that will be applied — recomputed over the
answers, not patched from the Phase 5 probe.

Relay from the envelope, without recomputing any of it: `applicability` with its
`applicabilityBasis` (the explicit enumeration of every blocking finding and
every blocking question, so no blocking condition is a silent omission); `mode`,
the dominant lifecycle effect; `actions[]`, every action class in one
deterministic order, saying which are mutating; `registryDelta`, `payloads`,
`artifacts`, `repairs`, `evidenceSeeds`, and `answers.writes[]` — what would
change and what would be retained; `findings[]` with each code and severity; and
`recovery` / `inventory` on their own channels as in Phase 2.

Branch on `applicability`:

- `applicable` ⇒ continue to Phase 7.
- `no-change` ⇒ there is nothing to apply. Skip Phases 7 and 8 entirely and go to
  Phase 9; the run ends `already-initialized` when the scaffold was also
  unchanged, `initialized` otherwise.
- `blocked` / `not-applicable` ⇒ relay `applicabilityBasis` and stop at
  `INIT — partial`: the scaffold stands, no lifecycle mutation was performed.
- `unrecovered` / `invalid-root` ⇒ `INIT — stopped`, relaying the reason.

---

## Phase 7: Confirm exactly this plan

One confirmation, over one plan.

1. **Show the plan and its `identity.planId`**, with `identity.factCount` and
   `identity.coveredFactClasses` — the coverage claim is verifiable from that
   list rather than from a hash nobody can read.
2. **Ask once** whether to apply it.
3. **Declined ⇒ `INIT — declined`.** No `apply_install` call is made, and no
   lifecycle byte is written. Say plainly that the bare-core scaffold remains
   valid and re-running is safe.
4. **Confirmed ⇒ carry that exact `planId`** into Phase 8 as `expectedPlanId`.
   Do not re-plan between the confirmation and the apply; state can change
   between host phases, and the id check is what turns that into a clean refusal
   instead of a stale application.

---

## Phase 8: Apply, once

Call `apply_install({ workspaceRoot, desired, answers, expectedPlanId })` —
**exactly once**, with the confirmed id. This is the only lifecycle mutation in
the run. Locks are taken and released inside the call; never hold one across a
host phase.

Relay the envelope: `status` — `applied`, `rejected`, `rolled-back`, `halted`, or
`invalid-root` — with its single closed `reason` token on every non-`applied`
outcome, reported verbatim and never translated into a plausible neighbouring
class; `applied[]`, what changed, and `deferred[]`, what was deliberately not
changed, each with its own reason; `rollback`, how far a guarded rollback got;
`selfCheck`, `refreshed`, and `residue`, where `residue.clean` is the observable
statement that no journal, backup, or empty backup directory was left behind; and
`recovery` on its own channel as always.

Outcomes: `applied` continues to Phase 9. `rejected` (including
`apply/plan-stale`, the id check doing its job) and `halted` continue to Phase 9
as well, but the run ends `partial` — relay the reason and say the workspace is
unchanged except for the scaffold. `rolled-back` likewise, adding the rollback
disposition. `invalid-root` ends `stopped`.

---

## Phase 9: Settle the resolved view

The registry is now current, so the registry-derived scaffolding runs here — not
in Phase 3, which is bare-core only. This phase always runs, including after a
`no-change` plan and after a rejected apply.

1. **Run the two registry-derived loops** — seed capability profiles, then append
   the conditional page-test exclude. The procedure lives at
   `settle-registry.md`, obtained via `resolve_content({ workspaceRoot, class:
   "references-template", skill: "init", ref: "settle-registry.md" })` on this
   path only. Follow it as written; neither loop names a concrete capability.

2. **Inspect.** Call `resolve_inspect({ workspaceRoot })` and relay `validity`,
   `counts`, and `diagnostics[]` as the run's closing state of the world. When
   Phase 8 reported `refreshed: false`, or no apply ran, call `resolve_refresh`
   once first so the inspect reads a current snapshot.

---

## Phase 10: Establish the constitution

Route this fixed sibling-Skill edge immediately before work: call `resolve_routing`
with `workspaceRoot: <the admitted root>`, `role: "constitution"`, `unitIds: ["init:constitution"]`,
`shapeEvidence: { workSurface: "caller-context", atomicity: "atomic",
unitCount: 1, unitsIndependent: false, ambiguity: "none", risk: "low",
toolWork: "none", validation: "mechanical", contextIsolation: "none",
independentReview: false, returnContract: "mechanically-judgeable",
requestedParallelism: 1 }`, `supportsModelSelector: false`, and
`supportsEffortSelector: false`. Include `actualModel` only when the host
exposes it; emit the compact operational record; pass no selector.

On `status: stop` or a non-null `diagnostic`, keep this phase non-fatal: skip the
constitution refresh, record the resolver's reason, and finish the run.
Otherwise obey the selected `inline` shape and **unconditionally** invoke
`/wf:constitution` through the Skill tool with no arguments. This skill carries
**no existence check of its own** — `constitution`'s establish-or-update default
handles both cases, writing a core-only record when the registry is empty and
updating idempotently when the file exists. If invocation is unavailable, skip
with a one-line note telling the user to run `/wf:constitution` manually — never
stop the run on it.

---

## Edge Cases

- **Inadmissible workspace declaration:** stop in Phase 1 with `INIT — stopped`,
  before any scaffold write. Never scaffold a root the resolver refused.
- **`wf-resolver` service unavailable:** stop in Phase 1. For the Phase 3
  informational refresh only, degrade without stopping. Never hand-parse config
  or the registry as a substitute.
- **`recovery.proceeded: false` at discovery:** halt with `INIT — stopped` —
  nothing may be read or shown from an unrecovered baseline.
- **Non-trustworthy inventory:** absence is unknown, not established — report
  confidence and never call a pack orphaned.
- **Every pack reports `selectable: false`:** the normal fresh-workspace state,
  not an empty offer. Key availability on `enablement`/`presence`.
- **Zero packs selected:** a valid outcome. The plan comes back `no-change`,
  Phases 7 and 8 are skipped, and the workspace carries the scaffold and nothing
  else — no registry row, no payload, no seeded profile, no runner.
- **Plan declined:** `INIT — declined` — the scaffold may remain, no lifecycle
  mutation was performed.
- **`apply/plan-stale`:** the workspace moved between the confirmation and the
  apply. Report it as the id check working, and tell the user to re-run.
- **`_local/` is a regular file, not a directory:** stop and report; do not
  delete.
- **`.gitignore` or `.git/info/exclude` is read-only:** stop and report; do not
  chmod.
- **`--force` passed but nothing needs rewriting, or the repo was set up by an
  older version:** fill in missing pieces idempotently and produce no diff;
  leave existing files alone unless `--force`.
- **Config values do not match the repo:** do not guess — write defaults and tell
  the user to edit.
- **Reconcile over a settled workspace:** no plan call, no confirmation, no
  mutation call — `already-initialized`, `Apply: not run — no drift`. If nothing
  is authorized but something diverged, report retained divergence and what
  diverged; never the words "no drift".
- **An orphaned, disabled, or evidence-missing registration on a reconcile:**
  each is retained. Only an explicit deselection removes anything.

---

## Final Output

```
INIT — <initialized | already-initialized | declined | stopped | partial>

Repo: <admitted root> (source: <admission source>)
Actions:
- _local/ — <created | kept>
- _local/config.md — <created | kept | overwritten>
- _local/README.md — <created | kept | overwritten>
- _local/constitution.md — <established | updated | unchanged | skipped — run /wf:constitution>
- .gitignore entry for _local/ — <appended | already present>
- .git/info/exclude entry for _page-tests/ — <appended | already present | skipped>

Registry: <resolved registry location> (<default | configured | rejected → fell back to default>)

Discovery: <inventory confidence>, <n> pack(s) observed; recovery <recovery state>
Packs:
- <pluginId> — <relayed state> · <presence> · <enablement> · <selected | not selected | unavailable — disabled> · <preselected — durable record | not preselected — no durable record | n/a — fresh> · <retained | deregistering — explicitly deselected>
  (repeat one line per discovered pack; "none" when none was discovered)

Reconcile: <n/a — fresh journey | settled — no drift | retained divergence — <n> item(s) | delta — <a> addition(s), <d> explicit deselection(s)>
Repair: <n> diagnosed · <n> withheld advance(s) · retained by class <retained/shared/edited/ambiguous/unverifiable tally>

Questions: <n> asked, <n> already resolved, <n> answered this run
Plan: <applicability> · mode <mode> · <n> action(s) · planId <planId> (<factCount> facts)
  Source: <repair_packs (empty delta) | plan_install (desired-set delta) | none — no plan computed>
Apply: <applied | rejected | rolled-back | halted | not run — declined | not run — no change | not run — no drift | not run — retained divergence, nothing authorized>
  Reason: <closed reason token, or "—">
  Applied: <n> · Deferred: <n> · Residue: <clean | retained — detail>
  Upgrade: <no-drift | fully-upgraded | partial | retained-divergence | not-assessed | n/a — no apply> · remaining <n> <(class tally)>

Capability profiles:
- <capability-name> — <seeded override [seeded by <model id>] | default in use | skipped — no template | skipped — unsafe capability name | skipped — unreadable manifest>
  (one line per registered capability; "none" when the registry is empty. Append `seeded by <model id>` **only** to a `seeded override` row whose profile format has no schema-permitted attribution slot — Phase 9 step 1.)

Verify Command: <detected command>
  Rule: <which detection rule matched — e.g. "rule 2: typecheck script in web/package.json">
  Rejected candidates: <list any other project roots that could have been picked, or "none">

Next: review `_local/config.md` — confirm the Verify Command matches what you actually run to typecheck the project. Then `/wf:spec <task-id>`.
```

If detection fell back to the TODO placeholder, replace the `Verify Command` line with:

```
Verify Command: ⚠ NOT DETECTED — edit _local/config.md before running any other wf:* skill
  Scanned: <list of package.json / framework-manifest paths found, or "none">
```

**The final output block must always be the very last thing output to chat.**
