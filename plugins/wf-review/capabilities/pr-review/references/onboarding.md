# pr-review capability — onboarding & authoring reference

Native-composition detail, the delivery-provider consumption model, the no-requires rationale,
downstream registration, profile notes, and version history for the pr-review capability. **Never
read at phase-fire** — this capability attaches no fragment. This file is for authors.

## What this manifest is

The pr-review capability's manifest (`../manifest.md`) is its canonical description as a wf
`feature` capability. Unlike a `provider` or `adapter` capability, it attaches **no** fragment to
any SDD phase: it fills **no core seam**, and none is fired or required for its skills to run. It
ships two **user-invoked** skills that reach users purely by **native plugin composition** (install
the pack → the `/wf-review:address-pr` and `/wf-review:review-pr` commands are discoverable — no
registry walk, no phase-firing gate). The skills **consume** the active **delivery** provider — they
never own a surface — routing every host interaction through the delivery provider's PR-interaction
operations (`pr-comments-read`, `pr-comment-post`, `checks-read`, `review-thread-resolve`), the
operation set WF-157 bound.

## Skills (native composition)

As a `feature` capability, pr-review ships its skills natively (install the plugin → the
`/wf-review:*` commands are discoverable; native plugin composition handles loading). Documented for
reference:

```
skills:
  - plugins/wf-review/skills/address-pr/   # /wf-review:address-pr — read review comments + CI, verify each claim, address only the valid ones on the PR branch
  - plugins/wf-review/skills/review-pr/    # /wf-review:review-pr — review a PR, post verified findings (summary + file-level)
```

Both skills resolve the **delivery** surface directly (`invocation-runtime.ops.md` §"Direct provider
resolution") for their host interaction. They carry **zero** git/gh/host strings: the concrete tool
binding lives in the delivery provider fragment (`fragments/delivery.ops.md` of whatever capability
owns `surface = delivery`), never in a skill body — a skill names an abstract operation and follows
the resolved fragment in-context. Each treats review-tool output (e.g. Copilot, CodeRabbit) as
**hypothesis**, verifying every claim against the real code before acting or posting. Both optionally
delegate bulk comment/CI distillation to the `wf:context-distiller` subagent so the bulk never enters
their own context.

## Delivery provider — consumed, not owned

pr-review claims **no** `surface`. It reads whatever capability owns `surface = delivery` (e.g.
`git`, via the wf-git pack) at runtime and dispatches its PR-interaction operations there. With
**no** delivery provider registered, both skills **state plainly** that no delivery provider is
active — the contract's write-side degradation (loud, never a silent empty result nor a baked git
fallback), since PR interaction is their entire purpose. This follows the two-mode residual
diagnosis in `capability-registry.ops.md` §"Recorded-root-first resolution with install-manifest
self-heal" ((a) genuinely unconfigured vs (b) registered-but-unrecoverable).

## Requires

**None declared.** pr-review deliberately does **not** `requires: git` (or any delivery provider):
it degrades gracefully when none is registered rather than failing registry validation. Registry
membership of a *delivery* provider is what toggles whether the skills have a live host to route
through — the skills themselves compose natively regardless.

## Downstream registration

**Not required.** Because this capability attaches no fragment and owns no surface, it needs **no**
`## Capabilities` row to be resolved — its skills compose natively the moment the pack is installed.
(A `provider`/`adapter` capability must be registered to be resolved through the registry; a pure
`feature` capability that attaches no fragment need not be.) To route the skills through a live host,
register a **delivery** provider downstream (e.g. install the wf-git pack and run `/wf-git:init`);
that registration is independent of this pack.

## Profile seed template

pr-review ships no `profile-template:` — it has no project-tunable value. Per the contract's seeding
convention, a capability that declares no `profile-template:` seeds nothing (the no-op path).

## Version history

- **WF-161** — initial PR-review feature capability: the `address-pr` and `review-pr` skills,
  composed natively and routed through the delivery provider's PR-interaction operations.
- **WF-230** — lean the manifest: onboarding/authoring narrative relocated here; `manifest.md` now
  carries only the metadata header and the intentionally-empty fragments table.
