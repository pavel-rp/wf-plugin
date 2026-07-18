# Corpus item 5 — orphaned overrides at upgrade (C014-4)

**Model:** claude-opus-4-8
**Kind:** assertion (`expect.json` vs wf-fake scripted responses) · **Tier:** SMOKE
**Scenario:** `/wf:ship FAKE-1` with a personal `_local/slots/ship.review.md` override present, hermetic against `fake-scripts.json`

## Provenance

**WF-203 comment 2026-07-17** ("C016 watch-list — observations from shipping the ship.review
gate", item **4. Orphaned overrides at upgrade**): "A personal `_local/slots/ship.review.md`
override (tier rank 30) supersedes the pack contribution (rank 10) wholesale under `replace`.
On a pack upgrade that changes the gate … an orphaned override silently keeps the old gate
with no warning that it now shadows a newer, stricter pack fill." **C014 (WF-322) watch-list**
— orphaned overrides at upgrade. **C016 (WF-343) charter OUT-6.**

## The invariant (the C014 property, made a repeatable check)

> When a personal `_local/slots/ship.review.md` override is present it wins under `replace`
> over the pack fill (rank 30 > rank 10): the override's behaviour composes and drives the
> override's own review ops. The override file is present in the run's workspace and the
> override's gate — not the pack's — is what fires.

`runs-current` records the override-present scenario: the override's (older, stricter) gate
holds and the run ends `SHIP — Blocked`, with `_local/slots/ship.review.md` present in the
workspace snapshot. **Watch-list caveat (documented, not asserted):** there is currently no
mechanism flagging the override as stale-relative-to-an-upgraded-pack-fill — this item pins
that the override *wins*; the staleness signal remains an open watch-list risk.

## The assertion (`expect.json`)

Structural over the op log + workspace + terminal block — never a transcript exact-match:

- `terminal_block`: name `SHIP`, `status_ere` `^Blocked$` (the override's gate held).
- `files_touched.required_globs`: `_local/fake/op-log.jsonl` **and**
  `_local/slots/ship.review.md` (the override is present and won). `forbidden_globs`: `src/*`.
- `ops_invoked.required_ops`: `delivery:review-threads-read`, `delivery:review-thread-reply`
  (the override's review ops ran, not the pack fill's).

## Seeded breakage

`seeded-breakage/runs` records the same scenario with the override **removed** — no
`_local/slots/ship.review.md`, the pack fill resolves unfilled, and `/wf:ship` runs plain
build → checks → merge (`SHIP — Merged`, no review op). Judged against the same `expect.json`
it turns **red**, naming `files_touched` (the override file is missing), `terminal_block`
(`Merged`, not `Blocked`) and `ops_invoked` (the review ops are gone) — the override no longer
composes, exactly the precedence property this item guards.

## Canned-vs-real disclosure

Real containerized runs need Docker + `CLAUDE_CODE_OAUTH_TOKEN`, unavailable here. These run
sets are **canned artifacts shaped exactly like the WF-345 runner's output tree**, with the
personal override seeded into the run workspace; `runner/run-skill.sh` regenerates the run
bytes from a live container when one is available. The assertion machinery is identical either
way (WF-346/347 precedent).

## Invocation

```
assert/tiers.sh smoke --scenario corpus/items/orphaned-override
# → Verdict: PASS   (terminal_block Blocked, override file present, override review ops fired)
```
