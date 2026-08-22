---
name: init
description: Onboards the wf-angular pack by entering the canonical /wf:init lifecycle with wf-angular seeded into the selection round, so a project gets the same discovery, question, delta, confirmation and apply it would get from /wf:init itself. Preserves every registration the project already has and adds wf-angular to them; it decides nothing about the pack's state, asks nothing of its own, and performs no registry write. The angular capability supplies the qa-execution host surface. Use after /wf:init to activate the test-host execution provider; re-run any time — a re-run over a settled project reports no drift and mutates nothing. /wf:init is the canonical command and does the same thing for every pack at once.
allowed-tools: [Skill, Bash]
---

# /wf-angular:init — Onboard the wf-angular pack (a compatibility alias onto the shared lifecycle)

This skill is a **compatibility alias**: it contributes exactly one thing to the
canonical setup lifecycle — "add `wf-angular` to the desired set" — and then gets
out of the way. Everything else, from admitting the workspace root to the single
`apply_install` that registers the capability, belongs to `/wf:init` and happens
there.

It follows the compatibility-alias route that core declares in `/wf:init`'s
interface contract and defines procedurally in that skill's `alias-route.md`,
matching the reference conversion in `plugins/wf-fake/skills/init/SKILL.md`.

> **What this skill does not decide.** Whether `wf-angular` is installed, enabled,
> already registered, or drifted. Whether a repair is needed. What may be
> deleted. Which questions are still unanswered. What the delta contains.
> Whether to apply it. Every one of those is answered by the canonical
> lifecycle, which this skill merely enters. There is deliberately **no
> conditional in this body that reads existing state.**

**This pack asks nothing.** The `angular` capability declares no interview
question, so the canonical question round asks nothing on its behalf and this
skill emits **no prompt of its own** — not a confirmation invented to fill the
gap, not a "nothing to configure" acknowledgement, not a synthesized question
about a value the pack could infer. Silence is the correct behaviour. The single
canonical confirmation of the delta is the only interaction in the run, and it
belongs to `/wf:init`. Profile data the capability ships keeps its working
defaults and is not a question; a project that wants to override it edits its own
profile override, outside this run.

> **`/wf:init` is the canonical command.** It runs this same journey for every
> installed pack in one pass, so it is the one to reach for. This alias remains a
> legitimate permanent entry point for anyone who already types it.

---

## Command Syntax

```
/wf-angular:init
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
  `resolve_gate`. Registration happens inside the canonical apply, and nowhere
  else.
- Read, infer, or report any lifecycle fact of its own: presence, enablement,
  registration, drift, recovery, or whether a question is answered.
- Prompt for anything. This pack declares no question, so the correct output is
  silence — never a substitute prompt, a placeholder check, or a value carried
  forward.
- Seed anything but this pack's own id, seed more than one id, or pass a
  selection, an answer, or a confirmation on the command line.
- Render a delta, take a confirmation, or emit a second terminal block.
- Derive, validate, or second-guess the workspace root. The canonical route
  admits the root; this skill enters that route and inherits the same admitted
  workspace by identity, not by imitating the check.
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
   `workspaceRoot: "<workspace-root>"`, `role: "init"`, `unitIds: ["angular:init"]`,
   `shapeEvidence: { workSurface: "caller-context", atomicity: "atomic",
   unitCount: 1, unitsIndependent: false, ambiguity: "none", risk: "low",
   toolWork: "none", validation: "mechanical", contextIsolation: "none",
   independentReview: false, returnContract: "mechanically-judgeable",
   requestedParallelism: 1 }`, `supportsModelSelector: false`, and
   `supportsEffortSelector: false`. Emit the compact operational record. On
   `status: stop` or a non-null `diagnostic`, stop before the invocation and
   report the resolver's reason. Otherwise obey the selected `inline` shape, pass
   no selector, and invoke `/wf:init --seed wf-angular` through the **Skill** tool.

2. **Relay what comes back, verbatim.** The `INIT` block is this skill's Final
   Output. Add the host note below it and nothing else — no re-derived status,
   no second block, no restated delta.

---

## Edge Cases

- **`/wf:init` has not run yet:** not a precondition this skill checks. `/wf:init`
  *is* what is being invoked, and it scaffolds the bare core itself before any
  pack transaction.
- **`wf-angular` is disabled:** the seed is reported *not applied*; the pack stays
  visible, retained and **unavailable**, and its enablement is never flipped.
  Re-enabling the plugin is the user's action, outside this run. The rest of the
  run proceeds normally.
- **`wf-angular` is already set up and the project is settled:** the canonical
  settled exit — no plan call, no confirmation, no mutation call at all —
  reported as `already-initialized` / `Apply: not run — no drift`. This is the
  expected outcome of re-running, not a degenerate one.
- **The question round asks nothing for this pack:** expected, and the whole
  point. A pack that declares no question contributes none, and no prompt is
  synthesized to stand in for one. Another pack in the same desired set may still
  have its own question asked in that one round.
- **The project has drifted:** the canonical repair plan handles it. A withheld
  advance or a retained-but-not-benign artifact is reported as retained
  divergence, never as no drift.
- **The project already has other packs set up:** they are all preserved. Entering
  through this command **adds** `wf-angular` to them and deregisters nothing —
  omission is never a removal.
- **A root override is in play:** it targets the same admitted workspace `/wf:init`
  targets, because this skill enters that one route rather than re-deriving a root
  of its own.
- **Recovery ran before the route:** it is reported on its own channel, separately
  from the delta, exactly as `/wf:init` reports it.
- **The plan is declined:** `INIT — declined`; nothing was registered and
  re-running is safe.
- **`/wf:init` cannot be invoked** (the Skill tool is unavailable, or the
  invocation errors): stop and report it. Never substitute a registration of this
  skill's own, and never fall back to reading the sibling body.

---

## Final Output

Relay the canonical block verbatim — this skill runs the canonical lifecycle, so
it reports the canonical contract:

```
INIT — <initialized | already-initialized | declined | stopped | partial>

<the block /wf:init returned, verbatim, including its Seed: line>

Host note:
- angular owns the qa-execution host surface — do not register it alongside another pack claiming that surface, which would overlap partitioned ownership.
```

If the routing call stopped the run, or `/wf:init` could not be invoked, emit
instead:

```
INIT — stopped

Seed: wf-angular — not applied (alias could not enter the canonical lifecycle)
Reason: <the resolver diagnostic, or the invocation error, verbatim>

Next: resolve the reason above, then re-run /wf-angular:init.
```

**Both blocks are breaking replacements for the previous `WF-ANGULAR-INIT — <status>`
block** (MINOR, pre-1.0): one shared route has one terminal contract. The command
itself is unchanged — same name, same zero arguments, same end state.

**The final-output block must always be the very last thing output to chat.**
