# `pr-version-claims` — rationale (reference, never read at slot-fire)

**Model:** claude-opus-5-5

Paired reference for `fragments/pr-version-claims.md`, the core-authoring fill of the core
`pr.body-check` slot (WF-757, charter C039 OUT-4).

## Why a capability, not core

Version-bump and PR-body mismatches were 8% of the review escapes the charter measured. The fix
needs two things: a point in `/wf:pr` where a composed body can be checked before creation, and a
rule saying what a correct body looks like. The point is generic — any project may want to check a
body — so core declares it as `pr.body-check` with an inline default that checks nothing. The rule
is not generic: which files carry versions, and that a bump touches a `plugin.json` / marketplace
pair, is this repository's release convention (`CLAUDE.md` §8). Core never names it; this
maintainer-only capability does.

## Why the check stops creation

The actors are maintainers and unattended shippers. An annotation on an already-open pull request is
exactly what a shipper walks past; a stop before creation is not. The stop reuses the existing
`PR — Error` terminal, so the invocation surface and the block shape are unchanged, and
`/wf:ship` surfaces it as a blocked run with the flagged text as its reason.

## Why a script, and why it is selftest-only

A prose rule followed by a model is a plausible-but-wrong generator. The rule is therefore one
script, `fixtures/check-pr-version-claims.sh`, whose header defines "set" and "claim" and whose
`--selftest` pins the mismatch, match, no-claims, and prior-version-only cases. It compares one body
with one diff, so there is no tree to scan and it registers in `fixtures/run.sh` as selftest-only.

## Known limits

- A claim is a semver on a line that says "version" or "bump". A body announcing a release number
  without either word is not checked; widening the claim grammar risks flagging dependency pins.
- The check compares claims against what is set; it does not require the body to mention every bump.
