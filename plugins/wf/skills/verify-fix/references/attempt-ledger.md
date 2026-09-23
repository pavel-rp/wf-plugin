# The attempt ledger — field set and rebuild algorithm

The paired reference for `verify-fix/SKILL.md`'s `## The attempt ledger` section. Read at
runtime, at the rebuild step that section names — the same "followed in-context" role
`verify-fix-template.md` already plays at Phase 7. This split keeps the skill body's own
section a short pointer while the field set and rebuild algorithm live here in full.

Simpler than `verify-spec/references/finding-ledger.md`'s own ledger: this ledger's scope
key `k` is always an **explicit** input (`verify-fix/SKILL.md` Phase 1.5 — the `--attempt`
flag, else the highest recorded scope, else `1`), never derived from a round boundary. There
is no `PASS`/pre-fingerprint-boundary walk to perform — every trail entry already carries its
own scope in its `**Attempt:** <k>` header, so the rebuild is a flat parse-and-group, not a
fold bounded by a discovered boundary.

## Contents

- [Ledger field set](#ledger-field-set)
- [Fingerprint identity](#fingerprint-identity)
- [Rebuild algorithm](#rebuild-algorithm)
- [Routing rule](#routing-rule)

## Ledger field set

One entry per distinct `(fingerprint, scope)` pair ever recorded across the trail. Four
fields, each required on every entry:

- **fingerprint** — the finding's identity (see "Fingerprint identity" below). Half the
  ledger key.
- **scope** — the attempt scope `k` this entry was recorded under, taken from the entry's own
  `**Attempt:** <k>` header. The other half of the ledger key.
- **requirement/finding id** — the identifier the entry names (the numbered requirement, or
  the capability finding's own id), carried for traceability only.
- **outcome** — one of `[FIXED]`, `[FAILED]`, or `[SKIPPED]`, taken verbatim from the entry
  that recorded it. A verify-first reclassification (Phase 5 step 2) is recorded as
  `[SKIPPED]` with its existing reason — same check, now remembered per fingerprint and scope
  instead of only logged for that one run.
- **detail** — the free-text explanation the entry carried alongside its outcome, when it
  carried one: the `- Reason:` line for `[SKIPPED]`, the `- Error:` line for `[FAILED]`.
  Absent for `[FIXED]` (its `- Before:`/`- After:` pair is a diff, not an explanation, and
  Phase 6's ROUTED format has no use for it). Carried so a later routed presentation of the
  same fingerprint in the same scope can show *why*, not only *that* — Journey 2's "routes to
  `## Awaiting user` with that reason" depends on this field.

Unlike the finding ledger, there is no `first-seen` field and no status transition — an
attempt record is a flat fact ("this fingerprint got this outcome in this scope"), not a
lifecycle that reopens or retires. A `(fingerprint, scope)` pair is written at most once
across the trail (Phase 3's routing rule prevents a second attempt in the same scope from
ever reaching Phase 5 again), so there is nothing to fold forward or reopen.

## Fingerprint identity

Two shapes, exactly as `verify-fix/SKILL.md` Phase 2 mints them:

- **Capability finding** — reuses its own `file:section|defect` fingerprint verbatim, exactly
  as it renders in `04_verify.md`.
- **Requirement-list item** — mints `path/to/file:L|R<n>` from its own `Location` plus its
  `04_verify.md` list number. Stable for the life of one loop: `00_reqs.md`/`01_spec.md` are
  never touched mid-loop (Safety Rules), so a requirement's list number cannot shift under it.

## Rebuild algorithm

Run this **on every invocation**, before Phase 3's routing check, entirely from artifacts —
never held in memory across runs:

1. **Gather the trail.** The current, not-yet-rotated `{fix-log-dir}05_verify-fix.md` (if it
   exists), then every entry in `{fix-log-dir}05_verify-fix.history.md` (if it exists) in its
   existing order. `{fix-log-dir}` is the one location `verify-fix/SKILL.md` §"The fix-log
   location" defines — `{task-root}/{task-id}/`, or the sibling of the override path under the
   `<path-to-04_verify.md>` form — the same location Phase 1.5 scans and Phase 7 writes. Order
   doesn't matter here — unlike the finding ledger's fold, there is no `first-seen` to recover
   and no boundary to find, so every entry contributes independently.
2. **Parse each entry.** Read its `**Attempt:** <k>` header (entries written before this
   capability shipped carry no such header — skip them; they predate scoped attempts and
   contribute no ledger rows). For each `[FIXED]`/`[FAILED]`/`[SKIPPED]` line under
   `## Auto-fixed`, read its `- Fingerprint:` line, its requirement/finding id, and — for
   `[SKIPPED]`/`[FAILED]` — its `- Reason:`/`- Error:` line as the entry's `detail`. A
   fingerprint ROUTED in some later round is **not** re-recorded under `## Auto-fixed` that
   round (Phase 3's routing skips Phase 5 for it entirely) — its one ledger row is the
   original entry from whichever earlier-round trail file first attempted it, which the gather
   step (1) already reaches via rotation; `## Awaiting user`'s own routed traceability line
   carries no fingerprint and is never a parse source for this rebuild.
3. **Insert.** For each `(fingerprint, scope)` pair found, insert one ledger entry with that
   scope, outcome, and requirement/finding id. A `(fingerprint, scope)` pair encountered more
   than once (should not occur under normal operation, since Phase 3 routes a second attempt
   away from Phase 5) keeps the **first** one encountered during the gather — never overwrite
   silently; this is a defensive rule for a malformed or hand-edited trail, not an expected
   path.

## Routing rule

Phase 3 checks each blocking item's fingerprint against the rebuilt ledger for the **current**
scope `k` only (Phase 1.5's resolved value) — an entry recorded under a different scope `k'`
never routes the current scope's item; it is simply absent from this scope's lookup, so the
item proceeds through AUTO/ASK/SKIP exactly as if no record existed. This is what makes a new
`--attempt <k+1>` scope retry every still-open fingerprint exactly once: the ledger holds the
old scope's entries, but the lookup for the new scope finds nothing under it.
