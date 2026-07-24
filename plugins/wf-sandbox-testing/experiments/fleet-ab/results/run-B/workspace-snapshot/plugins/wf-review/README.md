# wf-review — the PR-review feature pack

A standalone marketplace plugin that ships the **`pr-review` capability**: a `feature`-kind
capability providing the PR-review loop as two **user-invoked** skills. It attaches **no**
core seam — it is reachable purely by **native plugin composition** (install the pack → the
commands are discoverable). It routes every host interaction through whatever capability owns
the wf capability-registry's **`delivery`** surface, so it carries **zero** git/gh/host
command strings of its own.

## What ships

| Item | What it is |
|---|---|
| `capabilities/pr-review/manifest.md` | the `pr-review` capability manifest — `kind: feature`, documents the two skills, the delivery operations they consume, and the one `slot` fill it contributes |
| `capabilities/pr-review/fragments/ship-review.md` | the **`ship.review` pre-merge review gate** — the slot fill `/wf:ship` composes between green checks and merge (WF-331, implementing WF-313's five hardening requirements); fires only when this capability is registered |
| `/wf-review:address-pr` | reads a PR's review comments + CI-check failures, **verifies each claim against the actual code**, and addresses only the valid ones on the PR branch, then commits and pushes so a re-review sees the change |
| `/wf-review:review-pr` | reviews a PR for correctness/security/design and posts **verified** findings (a PR-level summary plus file-level, `file:line`-anchored findings) — every finding confirmed against real code before it is posted |
| `/wf-review:init` | one-command self-registration — records this pack's install root and registers the `pr-review` capability, following the sibling packs' self-registering `/init` onboarding pattern |

## The `ship.review` gate (slot contribution)

Beyond its two user-invoked skills, `pr-review` contributes one **`slot` fill** to `/wf:ship`'s
declared `ship.review` composition point (`replace` policy). When the capability is registered,
`/wf:ship` runs the gate between green checks and the merge on every run; with it unregistered,
`/wf:ship` shows no review term at all (CLAUDE.md §2). The gate is **conservative by
construction** — it performs an API read-back at HEAD_SHA (`review-threads-read`), treats a poll
timeout or an unperformed read-back as **unknown** (blocks, never "clean"), surfaces a
zero-files-reviewed review as a distinct **failure** (never "no findings"), and posts a reply on
**every** finding thread before merge, recording each resolution as `fixed in code` or `thread
answered` distinguishably. It mutates no source and never merges — a confirmed unaddressed finding
blocks and routes to `/wf-review:address-pr`. Requirement mapping:
`capabilities/pr-review/references/ship-review.md`.

## The discipline both skills share

Review-tool output — from Copilot, CodeRabbit, or a human — is treated as **hypothesis, never
truth**. Before `address-pr` edits anything, or `review-pr` posts anything, it opens the
actual code the claim concerns and confirms the issue is real. Confirmed issues are acted on;
unconfirmed ones are replied to (address-pr) or dropped (review-pr). Neither writes any
AI-attribution or promotional content into a posted comment or a commit message.

Both optionally delegate bulk comment/CI distillation to the `wf:context-distiller` subagent,
so a large batch of review comments or a failing CI log never enters the skill's own context.

## Routing through the delivery provider

Both skills resolve the **`delivery`** surface directly (`plugins/wf/skills/_contracts/invocation-runtime.ops.md`
§"Direct provider resolution") and dispatch the PR-interaction operations WF-157 bound —
`pr-comments-read`, `pr-comment-post`, `checks-read`, `review-thread-resolve` — plus the
`commit` / `push-upstream` writes `address-pr` uses to land fixes. The concrete tool binding
lives in the delivery provider's fragment, never in a skill body.

## Installing wf-review

Install the pack from the marketplace — that alone is enough for `address-pr` and `review-pr`
to run; they compose natively, with no phase-firing gate. **Registration is still required**,
though: run `/wf-review:init` once after `/wf:init` to register the `pr-review` capability into
the `## Capabilities` registry. Registration is what makes the `ship.review` gate resolve and
fire in `/wf:ship` — without it, the fragment stays inert and `/wf:ship` runs with no review
step. `/wf-review:init` follows the established pack-init pattern
(`wf-git`/`wf-audit`): it calls core's `inspect_pack`/`register_pack` resolver tools with the
stable plugin id `wf-review` — no hand-edited `_local/config.md`, no `${CLAUDE_PLUGIN_ROOT}`
probing. Idempotent — safe to re-run any time.

To give the skills a **live host** to route through, also register a **delivery** provider
downstream — install the wf-git pack and run `/wf-git:init`. With no delivery provider
registered, both skills state plainly that none is active (they never fail silently and never
fall back to a baked git path), since PR interaction is their entire purpose.

See `plugins/wf/skills/_contracts/capability-registry.ops.md` §"The delivery provider surface"
for the full delivery operation set and its degradation rules.
