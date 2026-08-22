# pr-review capability manifest

**Version:** 1.2.0
**Conforms to:** `plugins/wf/skills/_contracts/capability-registry.ops.md` §"Manifest schema v2"
**Capability:** pr-review (a native feature capability; **registration is required** — see references)
**Kind:** feature (ships two user-invoked skills; contributes one `slot` fill)
**Model:** claude-opus-4-8

---

pr-review ships two **user-invoked** skills (`/wf-review:address-pr`, `/wf-review:review-pr`) that
reach users purely by **native plugin composition** — no registry walk, no phase-firing gate, for
those two skills alone. It owns **no** provider surface: the skills **consume** the active
**delivery** provider, routing every host interaction through its PR-interaction operations
(`pr-comments-read`, `pr-comment-post`, `checks-read`, `review-thread-resolve`). It declares **no**
`requires:` — it degrades gracefully when no delivery provider is registered.

Beyond those two skills it contributes **one `slot` fill** — the `ship.review` pre-merge review
gate (WF-331), targeting `/wf:ship`'s declared `ship.review` composition point (`replace` policy).
The gate composes via the **registry**, so it fires only once this capability is registered; with
it unregistered, `/wf:ship` shows no review term at all (CLAUDE.md §2). The fill still names only
abstract `delivery` operations (`review-threads-read`, `pr-comments-read`, `review-thread-reply`)
— no concrete host tool.

**Registration in the `## Capabilities` registry is required** — run `/wf-review:init` once after
`/wf:init`. The `ship.review` fill fires only through a registered row; `/wf-review:init` is a
compatibility alias that seeds this pack into the canonical `/wf:init` lifecycle, whose apply is
idempotent and refreshes the snapshot so the `slot` row resolves.

## Fragments

One `slot` fill targeting the `ship.review` skill point — its phase cell is `—` (a slot targets a
per-skill composition point, not an SDD phase), scope `ship.review replace` (single owner).

| phase | contribution-kind | dispatch                        | scope               |
|-------|-------------------|---------------------------------|---------------------|
| —     | slot              | `inline: fragments/ship-review.md` | ship.review replace |

The gate's requirement mapping and the incident it answers: [`references/ship-review.md`](references/ship-review.md).
Native-composition detail, the delivery-provider consumption model, the no-requires rationale, and
downstream registration: [`references/onboarding.md`](references/onboarding.md) — both read by
authors, never at phase-fire.
