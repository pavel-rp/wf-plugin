# Corpus item 3 — contribution survival across base-skill rewording (C014-2)

**Model:** claude-opus-4-8
**Kind:** assertion (`expect.json` vs wf-fake scripted threads) · **Tier:** SMOKE
**Scenario:** a shipper with a **registered** `ship.review` fill, driven hermetically against `fake-scripts.json`

## Provenance

**WF-203 comment 2026-07-17** ("C016 watch-list — observations from shipping the ship.review
gate", item **2. Contribution survival across base-skill rewording**): "The fill binds to
`ship`'s `interface.md` `## Slots` declaration + the `<!-- wf:slot ship.review -->` body
marker, not to Phase 4.5's prose. The prose is freely rewordable and the fill survives it
(this is the intended C014 property)." **C014 (WF-322) watch-list** — contribution survival.
**C016 (WF-343) charter OUT-6.**

## The invariant (the C014 property, made a repeatable check)

> A registered `ship.review` fill composes and drives its review ops **regardless of how
> Phase 4.5's prose is worded** — the fill binds to the `## Slots` declaration + the
> `<!-- wf:slot ship.review -->` marker pair, never to the surrounding prose. Rewording the
> base skill's Phase 4.5 body does not drop the contribution.

`runs-current` records **two** runs of the same registered-fill scenario against differently
**reworded** Phase 4.5 prose (run-1 original, run-2 reworded). Both compose the fill and drive
the same review ops — the structural signature is stable across the rewording. If a future
edit dropped or renamed the marker so the fill orphaned, the review ops would vanish; that is
the seeded-breakage case below.

## The five … no — the assertion (`expect.json`)

Structural over the op log + terminal block — never a transcript exact-match:

- `terminal_block`: name `SHIP`, `status_ere` `^Merged$` (the fill addressed the review threads
  and the shipper merged).
- `ops_invoked.required_ops`: the fill's review ops — `delivery:review-threads-read`,
  `delivery:review-thread-reply`, `delivery:pr-merge` — all present (the contribution ran).
- `files_touched`: the op log is present; nothing under `src/` is written (`ship` is a dispatcher).

## Seeded breakage

`seeded-breakage/runs` records the same scenario with the `<!-- wf:slot ship.review -->`
marker **dropped/renamed** — the fill orphans, the slot resolves `unfilled`, and `/wf:ship`
runs plain build → checks → merge with **no** review op. Judged against the same `expect.json`
it turns **red**, naming `ops_invoked` (the review-thread ops are missing) — the contribution
did not survive, exactly the failure this item guards.

## Canned-vs-real disclosure

Real containerized runs need Docker + `CLAUDE_CODE_OAUTH_TOKEN`, unavailable here. These run
sets are **canned artifacts shaped exactly like the WF-345 runner's output tree**;
`fake-scripts.json` is the real wf-fake scripts file the scenario would drive, and
`runner/run-skill.sh` regenerates the run bytes from a live container when one is available.
The assertion machinery (`assert/tiers.sh`) is identical either way (WF-346/347 precedent).

## Invocation

```
assert/tiers.sh smoke --scenario corpus/items/contribution-survival
# → Verdict: PASS   (terminal_block Merged, review ops present across both reworded runs)
```
