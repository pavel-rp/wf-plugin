---
name: init
description: Onboards the wf-node-ts pack by entering the canonical /wf:init lifecycle with wf-node-ts seeded into the selection round, so a project gets the same discovery, question, delta, confirmation and apply it would get from /wf:init itself. Preserves every registration the project already has and adds wf-node-ts to them; it decides nothing about the pack's state, asks nothing of its own, and performs no registry write and no payload write. The pack ships the node-ts capability, whose declared payload installs the test runner. Use after /wf:init to activate the Node/TypeScript pure-helper test harness; re-run any time — a re-run over a settled project reports no drift and mutates nothing. /wf:init is the canonical command and does the same thing for every pack at once.
allowed-tools: [Skill, Bash]
---

# /wf-node-ts:init — Onboard the wf-node-ts pack (a compatibility alias onto the shared lifecycle)

This skill is a **compatibility alias**: it contributes exactly one thing to the
canonical setup lifecycle — "add `wf-node-ts` to the desired set" — and then gets
out of the way. Everything else, from admitting the workspace root to the single
`apply_install` that registers the capability and installs its declared payload,
belongs to `/wf:init` and happens there.

It follows the compatibility-alias route that core declares in `/wf:init`'s
interface contract and defines procedurally in that skill's `alias-route.md`,
matching the reference conversion in `plugins/wf-fake/skills/init/SKILL.md`.

> **What this skill does not decide.** Whether `wf-node-ts` is installed, enabled,
> already registered, or drifted. Whether a repair is needed. What may be
> deleted. Which questions are still unanswered. What the delta contains.
> Whether to apply it. Whether the runner is present, current, or hand-edited.
> Every one of those is answered by the canonical lifecycle, which this skill
> merely enters. There is deliberately **no conditional in this body that reads
> existing state.**

**This pack asks nothing.** The `node-ts` capability declares no interview
question, so the canonical question round asks nothing on its behalf and this
skill emits **no prompt of its own** — not a confirmation invented to fill the
gap, not a "nothing to configure" acknowledgement, not a synthesized question
about a value the pack could infer. Silence is the correct behaviour. The single
canonical confirmation of the delta is the only interaction in the run, and it
belongs to `/wf:init`.

**The runner arrives through the canonical payload transaction, and by no other
route.** The `node-ts` capability declares one `## Payloads` row — its own
`payloads/testkit-run.mjs` to the workspace runner destination — and the
canonical apply installs that payload as part of the same single transaction that
writes the registry row, for **selected owners only**. This skill therefore never
copies, writes, refreshes, repairs, or verifies the runner, and it holds **no
fallback**: there is no "if the payload did not arrive, write it ourselves" path,
because a second route would be a second implementation of a transaction that has
exactly one. The runner's own behaviour is untouched by this change — only the
route by which it arrives is now the shared one.

> **`/wf:init` is the canonical command.** It runs this same journey for every
> installed pack in one pass, so it is the one to reach for. This alias remains a
> legitimate permanent entry point for anyone who already types it.

---

## Command Syntax

```
/wf-node-ts:init
```

Takes no arguments — unchanged from before this skill became an alias. Selection
and confirmation are taken interactively **by the canonical lifecycle**; this
skill pre-ticks one box and passes nothing else.

---

## Safety Rules (NON-NEGOTIABLE)

**Allowed:**

- Run `pwd -P` once to obtain the absolute workspace root for the routing call.
- Call the bundled `wf-resolver` `resolve_routing` tool to route the one
  sibling-Skill edge below.
- Invoke `/wf:init` through the **Skill** tool, with this pack's own stable
  plugin id as the seed.
- Relay the `INIT` terminal block that invocation returns.

**Forbidden:**

- Call any lifecycle resolver tool — `discover_packs`, `plan_install`,
  `apply_install`, `repair_packs`, `register_pack`, `inspect_pack`, or
  `resolve_gate`. Registration and payload installation happen inside the
  canonical apply, and nowhere else.
- Read, infer, or report any lifecycle fact of its own: presence, enablement,
  registration, drift, recovery, payload state, or whether a question is
  answered.
- Prompt for anything. This pack declares no question, so the correct output is
  silence — never a substitute prompt, a placeholder check, or a value carried
  forward.
- Seed anything but this pack's own id, seed more than one id, or pass a
  selection, an answer, or a confirmation on the command line.
- Render a delta, take a confirmation, or emit a second terminal block.
- Derive, validate, or second-guess the workspace root. The canonical route
  admits the root; this skill enters that route and inherits the same admitted
  workspace by identity, not by imitating the check.
- Roll back, undo, or repair anything. Mutation and rollback are the canonical
  transaction's, taken and released within it; this skill owns no undo and takes
  no lock of its own.
- Write, copy, refresh, or remove the test runner, or any other declared payload
  destination — and never as a fallback when a payload is reported unavailable.
  The declared payload row is the runner's only route into a workspace.
- Write or edit **any** file, including `_local/config.md` and any profile
  override. This skill performs no write at all.
- Filesystem-read a sibling skill's body — `/wf:init` is reached through the
  **Skill** tool, and a failed invocation stops into the error block below rather
  than falling back to a read.
- Run builds, tests, installs, or any network or version-control operation.

---

## Onboarding procedure

One step, and it is the whole skill.

1. **Route the edge, then enter the lifecycle.** Run `pwd -P` once and hold the
   absolute result as `<workspace-root>` — in a linked-worktree Agent that is the
   Agent's own worktree, never a parent's. Call `resolve_routing` with
   `workspaceRoot: "<workspace-root>"`, `role: "init"`,
   `unitIds: ["node-ts:init"]`, `shapeEvidence: { workSurface: "caller-context",
   atomicity: "atomic", unitCount: 1, unitsIndependent: false, ambiguity: "none",
   risk: "low", toolWork: "none", validation: "mechanical", contextIsolation:
   "none", independentReview: false, returnContract: "mechanically-judgeable",
   requestedParallelism: 1 }`, `supportsModelSelector: false`, and
   `supportsEffortSelector: false`. Emit the compact operational record. On
   `status: stop` or a non-null `diagnostic`, stop before the invocation and
   report the resolver's reason. Otherwise obey the selected `inline` shape, pass
   no selector, and invoke `/wf:init --seed wf-node-ts` through the **Skill**
   tool.

2. **Relay what comes back, verbatim.** The `INIT` block is this skill's Final
   Output. Add the runner note below it and nothing else — no re-derived status,
   no second block, no restated delta.

---

## Edge Cases

- **`/wf:init` has not run yet:** not a precondition this skill checks. `/wf:init`
  *is* what is being invoked, and it scaffolds the bare core itself before any
  pack transaction.
- **`wf-node-ts` is disabled:** the seed is reported *not applied*; the pack stays
  visible, retained and **unavailable**, and its enablement is never flipped.
  Re-enabling the plugin is the user's action, outside this run. The rest of the
  run proceeds normally. No payload is installed for a pack that never entered the
  desired set.
- **`wf-node-ts` is already set up and the project is settled:** the canonical
  settled exit — no plan call, no confirmation, no mutation call at all —
  reported as `already-initialized` / `Apply: not run — no drift`. This is the
  expected outcome of re-running, not a degenerate one.
- **The question round asks nothing for this pack:** expected, and the whole
  point. A pack that declares no question contributes none, and no prompt is
  synthesized to stand in for one. Another pack in the same desired set may still
  have its own question asked in that one round.
- **The runner is absent from the workspace:** not a state this skill reads,
  reports, or repairs. The declared payload row is what installs it, inside the
  canonical apply, and the canonical envelope is where that outcome is reported.
- **The runner has been hand-edited:** the payload row's own refresh discipline
  decides what happens, and a retained-but-not-benign artifact is reported as
  retained divergence. This skill neither compares nor overwrites it.
- **A payload is reported unavailable:** the canonical envelope says so and the
  run reports it. There is no fallback write here — a missing pack source is a
  pack-install problem, not something an alias resolves by writing the file
  itself.
- **The project has drifted:** the canonical repair plan handles it. A withheld
  advance or a retained-but-not-benign artifact is reported as retained
  divergence, never as no drift.
- **The project already has other packs set up:** they are all preserved. Entering
  through this command **adds** `wf-node-ts` to them and deregisters nothing —
  omission is never a removal.
- **A root override is in play:** it targets the same admitted workspace `/wf:init`
  targets, because this skill enters that one route rather than re-deriving a root
  of its own.
- **Recovery ran before the route:** it is reported on its own channel, separately
  from the delta, exactly as `/wf:init` reports it.
- **The apply is rolled back:** the canonical transaction's rollback restores the
  workspace — payload destinations included — and reports it on the canonical
  envelope. This skill neither performs nor narrates an undo of its own.
- **The plan is declined:** `INIT — declined`; nothing was registered, no payload
  was installed, and re-running is safe.
- **`/wf:init` cannot be invoked** (the Skill tool is unavailable, or the
  invocation errors): stop and report it. Never substitute a registration of this
  skill's own, never write the runner directly, and never fall back to reading the
  sibling body.

---

## Final Output

Relay the canonical block verbatim — this skill runs the canonical lifecycle, so
it reports the canonical contract:

```
INIT — <initialized | already-initialized | declined | stopped | partial>

<the block /wf:init returned, verbatim, including its Seed: line>

Runner note:
- the test runner is installed by the node-ts capability's declared payload row inside the canonical apply, for selected owners only; this command installs nothing itself and holds no fallback.
```

If the routing call stopped the run, or `/wf:init` could not be invoked, emit
instead:

```
INIT — stopped

Seed: wf-node-ts — not applied (alias could not enter the canonical lifecycle)
Reason: <the resolver diagnostic, or the invocation error, verbatim>

Next: resolve the reason above, then re-run /wf-node-ts:init.
```

**Both blocks are breaking replacements for the previous
`WF-NODE-TS-INIT — <status>` block** (MINOR, pre-1.0): one shared route has one
terminal contract. The command itself is unchanged — same name, same zero
arguments, same end state.

**The final-output block must always be the very last thing output to chat.**
