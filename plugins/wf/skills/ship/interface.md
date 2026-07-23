# /wf:ship — interface declaration

The machine-readable, externally-bindable surface of `ship`. A resolver reads
this file for the skill's declared slots and settings — **never** the SKILL.md
body. Everything in the body outside the declared slot markers is freely
rewordable implementation; the five sections below are the stable, contracted
surface (invocation shape, terminal block, slots + merge policies, settings
keys, safety rules).

## Invocation

`/wf:ship [<id>] [--status <name>]`

## Terminal block

`SHIP — <Merged | Blocked | Handed-off>`

## Slots

| slot (skill.point) | merge policy | purpose                                                                 |
|--------------------|--------------|-------------------------------------------------------------------------|
| ship.review        | replace      | the review-address step between green checks and the merge (Phase 4.5); the inline default drives no reviewer |

## Settings

_(none)_

## Safety rules

**Allowed:** read the task folder and its artifacts; obtain config via the
`wf-resolver` `resolve_config({ workspaceRoot, ... })` query; read-only resolution via
`workspace-root-resolve` and `current-branch-query`; resolve the `delivery`
surface once and invoke its **read** operations (`pr-detect`, `checks-read`) via
`resolve_content({ workspaceRoot, ... })` (`class: fragment`); resolve the `ship.review` slot via
`resolve_content({ workspaceRoot, ... })` (`class: slot`); invoke the sibling `wf:*` commands this skill
drives through the **Skill** tool (`/wf:branch`, `/wf:run` and each gated
`/wf:*` it names, `/wf:pr`, `/wf:tf`).

**Forbidden:** write or edit any file (artifact, source, or config) — `ship` is
a dispatcher; finalize a merge while any delivery check is failing or unsettled
(never merge a red PR); run any destructive version-control operation or invoke
`pr-merge` directly (the single merge write is `/wf:tf`'s); improvise a review
step at the `ship.review` marker when the slot is unfilled or unresolved; name
any concrete tracker, delivery, or stack tool anywhere in this skill's
behaviour; write the model id, any AI-attribution trailer, a "generated with"
footer, an emoji, or any promotional tagline into any comment, commit, or output.
