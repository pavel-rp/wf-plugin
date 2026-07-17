# pr-review capability manifest

**Version:** 1.1.0
**Conforms to:** `plugins/wf/skills/_contracts/capability-registry.ops.md` §"Manifest schema v2"
**Capability:** pr-review (a native feature capability; **registration is required** — see references)
**Kind:** feature (ships two user-invoked skills; attaches **no** phase fragment yet)
**Model:** claude-opus-4-8

---

pr-review ships two **user-invoked** skills (`/wf-review:address-pr`, `/wf-review:review-pr`) that
reach users purely by **native plugin composition** — no registry walk, no phase-firing gate, for
those two skills alone. It attaches **no** fragment to any SDD phase yet and owns **no** surface:
the skills **consume** the active **delivery** provider, routing every host interaction through its
PR-interaction operations (`pr-comments-read`, `pr-comment-post`, `checks-read`,
`review-thread-resolve`). It declares **no** `requires:` — it degrades gracefully when no delivery
provider is registered.

**Registration in the `## Capabilities` registry is required** — run `/wf-review:init` once after
`/wf:init`. A forthcoming contribution (the `ship.review` gate) presupposes a registration path;
without one, that fragment could never fire once added. Registering now (via `/wf-review:init`,
self-registering through the resolver's `inspect_pack`/`register_pack` tools) makes `pr-review` a
resolvable capability ahead of that fragment landing.

## Fragments

**None yet.** This capability attaches no phase fragment today — the taxonomy row below is
intentionally empty. A later sub-task adds the `ship.review` contribution and its `slot` row.

| phase | contribution-kind | dispatch | scope |
|-------|-------------------|----------|-------|
| —     | —                 | —        | —     |

Native-composition detail, the delivery-provider consumption model, the no-requires rationale, and
downstream registration: [`references/onboarding.md`](references/onboarding.md) — read by authors,
never at phase-fire.
