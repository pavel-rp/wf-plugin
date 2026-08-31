# pr-review capability manifest

**Version:** 1.3.0
**Conforms to:** `plugins/wf/skills/_contracts/capability-registry.ops.md` §"Manifest schema v2"
**Capability:** pr-review (a native feature capability; **registration is required** — see references)
**Kind:** feature (ships three user-invoked skills; contributes two `slot` fills)
**Model:** claude-opus-4-8

---

pr-review ships three **user-invoked** skills (`/wf-review:address-pr`, `/wf-review:review-pr`,
`/wf-review:sweep-pr`) that reach users purely by **native plugin composition** — no registry walk,
no phase-firing gate, for those three skills alone. It owns **no** provider surface: the skills
**consume** the active **delivery** provider, routing every host interaction through its
PR-interaction operations (`pr-comments-read`, `pr-comment-post`, `checks-read`,
`review-thread-resolve`, `review-threads-read`), and file through the active **tracker** provider's
`create_child` when one is registered. It declares **no** `requires:` — it degrades gracefully when
no delivery provider is registered.

Beyond those three skills it contributes **two `slot` fills**, each `replace`:

- The `ship.review` **pre-merge review gate** (WF-331), targeting `/wf:ship`'s declared `ship.review`
  composition point. It names only abstract `delivery` operations (`review-threads-read`,
  `pr-comments-read`, `review-thread-reply`) — no concrete host tool.
- The `fleet.closeout-review` **post-merge review sweep** (WF-522), targeting `/wf:fleet`'s declared
  `fleet.closeout-review` composition point at Closeout. It catches the sibling gap the pre-merge
  gate cannot: a verdict that lands *after* the capped polls and the merge. Its body is the **same**
  procedure `/wf-review:sweep-pr` follows for a single pull request, so the two call sites cannot
  drift apart.

Both compose via the **registry**, so each fires only once this capability is registered; with it
unregistered, `/wf:ship` and `/wf:fleet` show no review term at all (CLAUDE.md §2).

**Registration in the `## Capabilities` registry is required** — run `/wf-review:init` once after
`/wf:init`. The `ship.review` fill fires only through a registered row; `/wf-review:init` is a
compatibility alias that seeds this pack into the canonical `/wf:init` lifecycle, whose apply is
idempotent and refreshes the snapshot so the `slot` row resolves.

## Fragments

Two `slot` fills, each targeting a skill point — a slot's phase cell is `—` (it targets a per-skill
composition point, not an SDD phase), and each scope is single-owner `replace`.

| phase | contribution-kind | dispatch                            | scope                    |
|-------|-------------------|-------------------------------------|--------------------------|
| —     | slot              | `inline: fragments/ship-review.md`     | ship.review replace      |
| —     | slot              | `inline: fragments/closeout-review.md` | fleet.closeout-review replace |

The gate's requirement mapping and the incident it answers: [`references/ship-review.md`](references/ship-review.md).
The sweep's post-merge reachability analysis and the incident it answers: [`references/closeout-review.md`](references/closeout-review.md).
Native-composition detail, the delivery-provider consumption model, the no-requires rationale, and
downstream registration: [`references/onboarding.md`](references/onboarding.md) — both read by
authors, never at phase-fire.
