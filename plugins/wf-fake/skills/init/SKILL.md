---
name: init
description: Onboards the wf-fake fixture pack by entering the canonical /wf:init lifecycle with wf-fake seeded into the selection round, so a fixture project gets the same discovery, question, delta, confirmation and apply it would get from /wf:init itself. Preserves every registration the project already has and adds wf-fake to them; it decides nothing about the pack's state, runs no interview of its own, and performs no registry write. The fake capability owns BOTH the delivery and tracker provider surfaces with a hermetic, scripted, op-recording in-memory binding. Use once (after /wf:init) inside a fixture project only — never a real project, where fake would trip the surface-overlap validation against a real delivery or tracker pack. Re-run any time; a re-run over a settled fixture reports no drift and mutates nothing.
allowed-tools: [Skill, Bash]
---

# /wf-fake:init — Onboard the wf-fake fixture pack (the reference compatibility alias)

This skill is a **compatibility alias**: it contributes exactly one thing to the
canonical setup lifecycle — "add `wf-fake` to the desired set" — and then gets out
of the way. Everything else, from admitting the workspace root to the single
`apply_install` that registers the capability, belongs to `/wf:init` and happens
there.

It is the **reference implementation** of the alias route declared in core's
`skills/init/interface.md` and procedurally defined in that skill's
`references/alias-route.md`. A pack author converting their own setup command
should read the conversion table in core's `references/alias-rationale.md` and
mirror what this file does.

> **What this skill does not decide.** Whether `wf-fake` is installed, enabled,
> already registered, or drifted. Whether a repair is needed. What may be
> deleted. Which questions are still unanswered. What the delta contains.
> Whether to apply it. Every one of those is answered by the canonical
> lifecycle, which this skill merely enters. There is deliberately **no
> conditional in this body that reads existing state.**

The `fake` capability owns **both** the `delivery` and `tracker` provider surfaces
with a hermetic, in-memory, scripted, op-recording binding (see the fake
capability's onboarding reference). It is meant **only for fixture projects** — a
project whose registry lists `fake` and no real delivery/tracker pack.

> **Fixture-only — the overlap check is a feature.** Registering `fake` in a real
> project alongside a real delivery or tracker pack correctly trips the registry's
> partitioned-ownership overlap validation, failing and naming both offenders.
> That is the contract working as designed, not a bug. Only set `fake` up where it
> is the sole owner of both surfaces.

---

## Command Syntax

```
/wf-fake:init
```

Takes no arguments — unchanged from before this skill became an alias. Selection,
answers and confirmation are taken interactively **by the canonical lifecycle**;
this skill pre-ticks one box and passes nothing else.

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
- Seed anything but this pack's own id, seed more than one id, or pass a
  selection, an answer, or a confirmation on the command line.
- Render a delta, take a confirmation, or emit a second terminal block.
- Write or edit **any** file, including `_local/config.md`. This skill performs
  no write at all.
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
   `workspaceRoot: "<workspace-root>"`, `role: "init"`, `unitIds: ["fake:init"]`,
   `shapeEvidence: { workSurface: "caller-context", atomicity: "atomic",
   unitCount: 1, unitsIndependent: false, ambiguity: "none", risk: "low",
   toolWork: "none", validation: "mechanical", contextIsolation: "none",
   independentReview: false, returnContract: "mechanically-judgeable",
   requestedParallelism: 1 }`, `supportsModelSelector: false`, and
   `supportsEffortSelector: false`. Emit the compact operational record. On
   `status: stop` or a non-null `diagnostic`, stop before the invocation and
   report the resolver's reason. Otherwise obey the selected `inline` shape, pass
   no selector, and invoke `/wf:init --seed wf-fake` through the **Skill** tool.

2. **Relay what comes back, verbatim.** The `INIT` block is this skill's Final
   Output. Add the two fixture notes below it and nothing else — no re-derived
   status, no second block, no restated delta.

**The `## Fake` config section is no longer written here.** Both fake fragments
document working defaults for `Fake Scripts` (`_local/fake/scripts.json`) and
`Fake Op Log` (`_local/fake/op-log.jsonl`), and every shipped fixture already
carries the section, so the write was not load-bearing — dropping it removes this
skill's last private path. A fixture that wants different paths sets the section
itself. A pack whose value has **no** working default takes the other route
instead: declare it as an `ask[]` entry on the pack's `profile.template.json`, so
the canonical question round asks it and the canonical apply persists it.

---

## Edge Cases

- **`/wf:init` has not run yet:** not a precondition this skill checks. `/wf:init`
  *is* what is being invoked, and it scaffolds the bare core itself before any
  pack transaction.
- **`wf-fake` is disabled:** the seed is reported *not applied*; the pack stays
  visible, retained and **unavailable**, and its enablement is never flipped.
  Re-enabling the plugin is the user's action, outside this run. The rest of the
  run proceeds normally.
- **`wf-fake` is already set up and the project is settled:** the canonical
  settled exit — no plan call, no confirmation, no mutation call at all —
  reported as `already-initialized` / `Apply: not run — no drift`. This is the
  expected outcome of re-running, not a degenerate one.
- **The project has drifted:** the canonical repair plan handles it. A withheld
  advance or a retained-but-not-benign artifact is reported as retained
  divergence, never as no drift.
- **The project already has other packs set up:** they are all preserved. Entering
  through this command **adds** `wf-fake` to them and deregisters nothing —
  omission is never a removal.
- **Recovery ran before the route:** it is reported on its own channel, separately
  from the delta, exactly as `/wf:init` reports it.
- **The plan is declined:** `INIT — declined`; nothing was registered and
  re-running is safe.
- **`/wf:init` cannot be invoked** (the Skill tool is unavailable, or the
  invocation errors): stop and report it. Never substitute a registration of this
  skill's own, and never fall back to reading the sibling body.
- **Co-registered with a real delivery/tracker pack:** if registry validation
  later reports a surface overlap naming `fake` and a real pack, that is the
  contract working as designed. Remove `fake` from any non-fixture registry.

---

## Final Output

Relay the canonical block verbatim — this skill runs the canonical lifecycle, so
it reports the canonical contract:

```
INIT — <initialized | already-initialized | declined | stopped | partial>

<the block /wf:init returned, verbatim, including its Seed: line>

Fixture notes:
- fake owns both the delivery and tracker surfaces — keep it out of any non-fixture registry.
- Seed the scripts file (see the pack's scripts-format reference) before driving ops; `Fake Scripts` and `Fake Op Log` have working defaults, so no config edit is required.
```

If the routing call stopped the run, or `/wf:init` could not be invoked, emit
instead:

```
INIT — stopped

Seed: wf-fake — not applied (alias could not enter the canonical lifecycle)
Reason: <the resolver diagnostic, or the invocation error, verbatim>

Next: resolve the reason above, then re-run /wf-fake:init.
```

**Both blocks are breaking replacements for the previous `WF-FAKE-INIT — <status>`
block** (MINOR, pre-1.0): one shared route has one terminal contract. The command
itself is unchanged — same name, same zero arguments, same end state.

**The final-output block must always be the very last thing output to chat.**
