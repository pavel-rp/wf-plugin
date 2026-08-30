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

## Phase 4a — why absence can never be evidence

The reconciliation step exists because the local task folders were treated as an unquestioned source of truth: a folder's state was derived from the highest-numbered artifact present, and nothing ever asked whether the id had already closed. In the run that motivated this, every one of the repository's tracker-id folders was terminal upstream, yet all of them were reported in flight and one was ranked top of the focus list with a "start it" handoff for work that had shipped a week earlier.

The fix is a join, not a fetch: Phase 3c already enumerates the union of the display list and every status the run's map reports — terminal ones included — on every resolution branch, and Phase 3d already carries each enumerated item's lifecycle forward. Reconciliation reads that carried fact and nothing else, which is why it adds no provider call and why its cost is a function of the tracker's status count rather than the number of local folders.

The single hardest rule in the design is that a classification requires a **positive** observation. It is tempting to treat a folder whose id never appeared in any enumeration as finished — after all, it was not found among the open items. That inference is unsound: an item outside the resolved project scope, an item that was deleted, an item under a status the enumeration cap never reached, and an item genuinely in a terminal status are **all equally absent** from the enumeration, and absence carries no information that separates them. The consequence is not academic. A later opt-in sweep acts on the residue classification with an irreversible filesystem move, so a residue inferred from emptiness deletes a user's live task folder. Everything unobserved therefore falls to `neither` and keeps exactly the treatment it had before this step existed — the design's failure mode is "no worse than yesterday", never "silently wrong".

The same reasoning is why the id-shape test only ever selects candidates. A folder name that looks like a tracker id tells you where to look; it tells you nothing about what is there.

## Phase 4a — a lag model, not a precedence model

When the local side and the tracker side disagree, the instinct is to write a precedence rule: decide which side wins and make the other conform. That would be a mistake here, and the rule is stated in the ops body precisely so no later session re-derives it. A precedence rule collapses two genuinely different situations into one, and in doing so it makes the *tracker-behind-local* direction invisible: work that finished locally but was never closed upstream would simply be overwritten by "the tracker is authoritative", and nobody would ever learn about the completion nobody recorded. Modelling the disagreement as **lag** keeps both directions first-class — one side is behind, the design owes a direction and a report — and it keeps the skill honest about the fact that it is observing, not adjudicating.

That is also why the step reports and never acts. Archiving residue, closing an unreported completion, or moving any tracker state are all outside this skill: standup is read-only on every provider surface and writes only the briefing artifact.

## Phase 5 — why the exclusion rules have exactly one owner

The two focus-list exclusions — residue folders, and tracker-sourced items observed in a terminal status — live together in Phase 5 because a filter split across phases is a filter nobody can reason about. Phase 3 makes the open/terminal fact *available*; it deliberately writes no exclusion of its own. One owner, one place, so the answer to "why is this item not in my focus list?" is always found in the same paragraph.

The asymmetry between the two directions is deliberate too. Residue is excluded because it is finished work that would otherwise crowd out live work at the top of the list. An unreported completion is *not* excluded, because its item is still open and recording that completion is genuine remaining work — surfacing it as actionable is the entire point of detecting it.

## Phase 5 — why the empty distiller block is cached too

It is tempting to cache only a *filled* essence — after all, an empty block carries nothing worth reusing. That temptation is exactly the design this cache exists to rule out: a description-less tracker item still costs a full distiller round-trip on every run if its empty result is never persisted, which leaves the "a re-run against unchanged items dispatches zero distillations" measure false for every item without a description. The cache therefore treats the empty block as a first-class cacheable value, keyed and looked up on exactly the same terms as a filled one. The only entries that never reach the cache at all are the ones WF-532 never dispatches in the first place — a bare-core entry, a local-scheme folder, or any other non-tracker-sourced candidate; their absence from the cache file is a consequence of never being a candidate, not a caching decision.

## Evidence and history

This rationale reference was created as part of WF-524 (charter C030, "Make /wf:standup a briefing worth acting on"), which found the ops body at 225 lines against the project's ≤150 behavior-bearing-line budget for a runtime-read document (`CLAUDE.md` §5, `docs/authoring-notes.md`). Eight later sub-tasks in the same charter add behaviour to the ops body; this split gives each of them room without an unrelated restructure bolted on, and gives a later one-shot cleanup nothing left to do. The split is a pure prose relocation — no phase, provider read, output shape, `allowed-tools` entry, or Safety Rules wording changed as part of it.
