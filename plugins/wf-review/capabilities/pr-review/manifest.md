# pr-review capability manifest

**Version:** 1.0.0
**Conforms to:** `plugins/wf/skills/_contracts/capability-registry.ops.md` §"Manifest schema v2"
**Capability:** pr-review (a native feature capability; needs **no** `## Capabilities` registry row to function — see references)
**Kind:** feature (ships two user-invoked skills; attaches **no** phase fragment)
**Model:** claude-opus-4-8

---

pr-review ships two **user-invoked** skills (`/wf-review:address-pr`, `/wf-review:review-pr`) that
reach users purely by **native plugin composition** — no registry walk, no phase-firing gate. It
attaches **no** fragment to any SDD phase and owns **no** surface: the skills **consume** the
active **delivery** provider, routing every host interaction through its PR-interaction operations
(`pr-comments-read`, `pr-comment-post`, `checks-read`, `review-thread-resolve`). It declares **no**
`requires:` — it degrades gracefully when no delivery provider is registered.

## Fragments

**None.** This capability attaches no phase fragment — it is a pure native feature, not a seam
contributor. The taxonomy row below is intentionally empty:

| phase | contribution-kind | dispatch | scope |
|-------|-------------------|----------|-------|
| —     | —                 | —        | —     |

Native-composition detail, the delivery-provider consumption model, the no-requires rationale, and
downstream registration: [`references/onboarding.md`](references/onboarding.md) — read by authors,
never at phase-fire.
