# postmortem capability manifest

**Version:** 0.1.0
**Conforms to:** `plugins/wf/skills/_contracts/capability-registry.ops.md` §"Manifest schema v2"
**Capability:** postmortem (a native feature capability; **registration is required** — see references)
**Kind:** feature (ships the guided `/wf-postmortem:postmortem` skill and `/wf-postmortem:init`; attaches **no** SDD phase fragment)
**Model:** claude-sonnet-5

---

postmortem ships a **guided session-mining skill** that turns a maintainer's prose failure report
into an explicit, echoed hunt scope and a fixed-shape report skeleton. Everything reaches its user
by **native plugin composition** — `/wf-postmortem:postmortem` is invoked directly as a skill, never
fired by a phase.

It owns **no** provider surface and contributes **no** phase fragment — it does not touch the
`spec → plan → tasks → implement → verify → qa` spine. Registering it is a **presence-only**
declaration: it adds one `## Capabilities` row so registry validation acknowledges the pack and a
downstream project can record that the skill is active, exactly as `sandbox-testing` registered
ahead of its own first contribution fragment. With the row present or absent, no capability-aware
phase changes — the skill is invoked directly, never fired by a phase.

## Fragments

**None.** postmortem declares an empty fragments table — it is a feature pack whose value is its
own skill, not a contribution to any SDD phase. Registry validation accepts a capability with zero
fragment rows (the `sandbox-testing`/`pr-review`-before-its-slot precedent).

| phase | contribution-kind | dispatch | scope |
|-------|-------------------|----------|-------|
| —     | —                 | —        | —     |

## Scope of this release

This manifest registers the capability that ships the scope-resolution slice of a larger,
multi-sub-task charter (C035, umbrella WF-587): locating and reading session records, verifying
claimed mechanisms, stating fix direction, enforcing a read cap, and drawing fallback evidence each
arrive with a later sub-task, extending this same skill body in place rather than adding a new
capability. Registering `postmortem` today changes no core phase behaviour and names no path or
convention specific to any one repository.
