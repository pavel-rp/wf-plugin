# /wf:init — interface declaration

The machine-readable, externally-bindable surface of `init`. A resolver reads
this file for the skill's declared slots and settings — **never** the SKILL.md
body. Everything in the body outside the declared slot markers is freely
rewordable implementation; the five sections below are the stable, contracted
surface (invocation shape, terminal block, slots + merge policies, settings
keys, safety rules).

## Invocation

`/wf:init [--force]`

`--force` overwrites `_local/config.md` and `_local/README.md` when they already
exist. It is the only argument, and the setup journey adds none: selection,
answers, and confirmation are taken interactively, never from the command line.

## Terminal block

`INIT — <initialized | already-initialized | declined | stopped | partial>`

| status | meaning |
|---|---|
| `initialized` | the scaffold is in place and the journey completed — either a plan was applied, or there was nothing to apply |
| `already-initialized` | a re-run over an unchanged workspace produced no diff |
| `declined` | the plan was presented and not confirmed; the scaffold may exist, no lifecycle mutation was performed |
| `stopped` | a hard stop before any write — an inadmissible workspace declaration, an unavailable resolver, or a discovery baseline that could not be recovered |
| `partial` | some phases completed and a later one did not; the block names which |

`declined` and `stopped` are new in this contract, so the status set is a
breaking change to a grepped final-output block shape (MINOR, pre-1.0).

## Slots

_(none)_

## Settings

_(none)_

## Safety rules

**Allowed:** read and write files under `_local/`; append (never rewrite)
`.gitignore` and `.git/info/exclude`; write the `## Capabilities` registry table
to a **configured `registryPath`** location that passes the defensive check —
the one sanctioned scaffold write outside `_local/`, since relocating the
registry is that key's whole purpose; read-only resolution through the bundled
`wf-resolver` service (`resolve_config`, `resolve_registry`, `resolve_profile`,
`resolve_inspect`, `discover_packs`, `plan_install`) and the one explicit
`resolve_refresh` after the scaffold writes; **one** `apply_install` call per
run, carrying the `expectedPlanId` of the exact plan the user confirmed — the
sole lifecycle mutation this skill performs, and the sole writer of any
lifecycle artifact; invoke the sibling `/wf:constitution` through the **Skill**
tool; and pass `workspaceRoot` explicitly on every resolver call.

**Forbidden:** write or edit any file outside the scaffold writes named above;
mutate lifecycle state by any path other than the single `apply_install` call —
no hand-written ledger, no registry row written on a pack's behalf, no
enablement flipped; call `apply_install` without a confirmation, more than once
per run, or with a plan id other than the one confirmed; call
`register_pack` (a pack registers its own capability; `init` establishes the
substrate those calls attach to); **infer** any lifecycle fact the resolver
reports — presence, state, enablement, availability, recovery, or whether a
question is answered are relayed verbatim from the envelope, never derived from
a heuristic, a file probe, or a `selectable` flag read as eligibility; treat a
suggested, personal-tier, or pack-tier value as an answer, or suppress a
question because one exists; re-ask a question the envelope already reports
resolved; hold a lock across host phases or nest one inside another; run
builds, tests, linters, or installs; invoke any delivery write operation
(`branch-create`, `commit`, `push-upstream`, `pr-create`) or any destructive
version-control operation; probe `${CLAUDE_PLUGIN_ROOT}` or otherwise derive a
plugin root, manifest path, or override-merged profile value by hand; name any
concrete pack, capability, stack, or project noun anywhere in this skill's
behaviour.
