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
| `capabilities/pr-review/manifest.md` | the `pr-review` capability manifest — `kind: feature`, no phase fragment, documents the two skills and the delivery operations they consume |
| `/wf-review:address-pr` | reads a PR's review comments + CI-check failures, **verifies each claim against the actual code**, and addresses only the valid ones on the PR branch, then commits and pushes so a re-review sees the change |
| `/wf-review:review-pr` | reviews a PR for correctness/security/design and posts **verified** findings (a PR-level summary plus file-level, `file:line`-anchored findings) — every finding confirmed against real code before it is posted |

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

Install the pack from the marketplace — that is all its **skills** need; they compose
natively, with **no** `## Capabilities` registry row and **no** init step of their own. (Unlike
a provider/adapter pack, `pr-review` attaches no fragment and owns no surface, so it need not
be registered to be reached.)

To give the skills a **live host** to route through, register a **delivery** provider
downstream — install the wf-git pack and run `/wf-git:init`. With no delivery provider
registered, both skills state plainly that none is active (they never fail silently and never
fall back to a baked git path), since PR interaction is their entire purpose.

See `plugins/wf/skills/_contracts/capability-registry.ops.md` §"The delivery provider surface"
for the full delivery operation set and its degradation rules.
