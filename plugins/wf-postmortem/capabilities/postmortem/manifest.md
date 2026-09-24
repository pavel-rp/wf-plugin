# postmortem capability manifest

**Version:** 0.6.0
**Conforms to:** `plugins/wf/skills/_contracts/capability-registry.ops.md` §"Manifest schema v2"
**Capability:** postmortem (a native feature capability; **registration is required**)
**Kind:** feature (ships the guided `/wf-postmortem:postmortem` skill and `/wf-postmortem:init`; attaches **no** SDD phase fragment)
**Model:** claude-sonnet-5

---

postmortem ships a **guided session-mining skill** that turns a maintainer's prose failure report
into an explicit, echoed hunt scope and then **reads session records in scope** — named explicitly by
the maintainer, or located automatically behind one replaceable seam — each in its own isolated
reader agent, composing the report from those readers' compact, already-redacted return blocks.
Everything reaches its user by **native plugin composition** — `/wf-postmortem:postmortem` is invoked
directly as a skill, never fired by a phase.

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

## Profile seed template

profile-template: profile.template.json

Carries the one capability-owned config value this pack reads today: `eval-log-path` (surfaced to
maintainers as `Eval Log Path`) — an optional, project-configured absolute path to an eval log the
`coverage-cross-check.md` fallback-evidence sourcing step reads, confined to the resolved
`workspaceRoot` and windowed exactly as every other untrusted source this pack reads. Unset by
default (`null`); a project sets it via its own `_local/profiles/postmortem.profile.json` override.
A project that configured the value under the pre-existing `_local/config.md` `## Postmortem`
`**Eval Log Path:**` heading is still read through a documented fallback (`coverage-cross-check.md`)
so it is not broken by this move — a one-time Coverage note recommends migrating it here.

## Scope of this release

This manifest registers the capability that ships the scope-resolution, session-locating,
session-reading, mechanism-verification, read-cap/continuation, and coverage-cross-check/
fallback-evidence slices of a charter (C035, umbrella WF-587). Reading a session record (named
explicitly, or **located** automatically behind one replaceable seam) in an isolated reader, checking
every reader-suggested mechanism two-sided against the audited pack's executed-version text and a
checked session locator, bounding each hunt with a per-run read cap that a `--report <path>`
follow-up can continue in place, and — on every hunt — cross-checking coverage against task folders
and delivery history to name any in-scope run left with no session, drawing labelled fallback
evidence only when a finding is under-evidenced from sessions alone or left no session record, have
all landed. Registering `postmortem` today changes no core phase behaviour and names no path or
convention specific to any one repository.
