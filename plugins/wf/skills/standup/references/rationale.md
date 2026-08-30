# /wf:standup — design rationale and worked explanation

This is the paired reference for `plugins/wf/skills/standup/SKILL.md`. It is never read at runtime — the ops body carries every clause an agent needs to execute correctly; this file carries the *why*, the worked explanation, and the degradation-justification prose that clause used to state inline, before the ops body was brought back inside its runtime-read budget (WF-524).

## Why abstract provider operations

Core reaches every provider read only through the abstract **delivery** and **tracker** operations; it never knows or names which concrete tool implements them. That indirection is what makes the same briefing render identically against whichever tracker pack is registered, and is what keeps the briefing (and this skill body) free of any concrete product string — the grep-clean requirement in Safety Rules is the enforceable consequence of this design choice, not an arbitrary style rule.

With no delivery or tracker provider registered, standup degrades to a local-only briefing: no provider operation is attempted and no capability term surfaces anywhere in the output. This is the same "no capability term surfaces" guarantee every capability-aware phase in the wf spine makes when its registry is empty.

## Phase 1 — why a direct, self-resolving invocation

standup is a **direct invocation** — the top of its own chain — and spawns no provider-operation subagent. Unlike a skill that forwards a resolved provider record to a dispatched subagent (e.g. `wf:branch` invoked by another skill), standup resolves each surface itself, once, and reuses the record for every read in that phase's body.

The `resolve_provider` call has already done the expensive work: the resolver has resolved the `## Capabilities` registry, each owning capability's `manifest.md`, and any plugin-anchored root (post install-manifest self-heal — see `capability-registry.ops.md` §"Recorded-root-first resolution with install-manifest self-heal"). standup performs no registry, manifest, or plugin-root read of its own; that would duplicate work the resolver already guarantees. If the `wf-resolver` service itself is unavailable, standup stops and reports it rather than hand-parsing the registry as a fallback — see WF-272 for the diagnostics/recovery rationale behind that rule.

The resolved provider records are runtime values, never a name baked into the skill body — that is what lets a project swap its tracker pack without editing this file.

An older repo initialized before the `## Standup` config section existed simply has `standupStatuses` unset in its resolved config; that surfaces as "no default" rather than an error, because a config key added after a project's `/wf:init` run should never retroactively break it.

## Phase 3 — the two zero-readable-tracker cases

The ops body's "zero readable tracker provider" case actually covers two distinct provider-record states, deliberately handled the same way for a read:

- **Genuinely unconfigured** (`state: unconfigured`) — no capability owns the `tracker` surface at all.
- **Registered-but-unrecoverable** (`state: unrecoverable`) — a capability is registered but its manifest could not be read; the recorded root dangled and the install-manifest self-heal recovered nothing.

Both degrade identically for a **read**: silent, local-only, no message, no capability term. They are *not* required to be told apart here because the difference only matters for a **write** (a write-side operation would name the record's `owner` and hint at a stale-root fix — the "hedged candidate-naming diagnosis" other skills perform on a delivery/tracker write). standup performs no write through any provider (Safety Rules), so that diagnosis never applies and the two cases collapse to one clause in the ops body without losing any actionable distinction.

## Command Syntax — the zero-argument default's milestone/cycle note

Milestones and cycles are enumerated on every run regardless of the resolved status list, because `list_milestones`/`list_cycles` take no status argument — they need no status to enumerate. That is why the zero-argument default renders milestones and cycles even when no `--status` and no **Standup Statuses** default are configured (the by-status *work-item* section is the only one that can be skipped).

## Evidence and history

This rationale reference was created as part of WF-524 (charter C030, "Make /wf:standup a briefing worth acting on"), which found the ops body at 225 lines against the project's ≤150 behavior-bearing-line budget for a runtime-read document (`CLAUDE.md` §5, `docs/authoring-notes.md`). Eight later sub-tasks in the same charter add behaviour to the ops body; this split gives each of them room without an unrelated restructure bolted on, and gives a later one-shot cleanup nothing left to do. The split is a pure prose relocation — no phase, provider read, output shape, `allowed-tools` entry, or Safety Rules wording changed as part of it.
