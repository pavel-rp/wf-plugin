# wf-postmortem — session-mining postmortem pack

A Claude Code plugin that turns a maintainer's prose failure report into an explicit, echoed hunt
scope and then reads the prior agent sessions in scope — named explicitly, or located automatically
behind one replaceable seam — each in its own isolated reader agent — toward a verified defect report
mined from those sessions.

Authoring/reference documentation. **No skill reads this file at runtime.**

## What the pack ships

- **The `postmortem` capability** — a presence-only `feature` capability with an empty `## Fragments`
  table: no phase fragment, no provider surface. Registering it changes no `wf:*` phase behaviour;
  it exists so registry validation acknowledges the pack and a project can record the skill as
  active, exactly as the `sandbox-testing` capability registered ahead of its own first
  contribution fragment.
- **`/wf-postmortem:postmortem`** — the guided skill. Reads `_local/config.md` first (stops toward
  `/wf:init` when absent), resolves a required failure description plus optional skill / folder or
  repository / read-cap override, echoes every resolved value and every applied default into a
  report's Scope section, then **reads every session record in scope, up to a per-run read cap**
  (default 15, overridable with `--cap`) — named explicitly with the repeatable `--session` flag, or,
  when none is named, **located automatically** under the resolved scope (skill / folder or repository
  / current-workspace default, within the host's 30-day retention window) behind one replaceable seam
  — and writes the fixed report template. Every located session is ranked (scope-match specificity,
  then recency, hunt sessions always last) and none is silently dropped; every session beyond the cap
  is listed `skipped (budget)`, retrievable by a later `--report <path>` follow-up that reads those
  sessions and extends the same report file in place — one hunt, one report, however many runs it
  takes. A session's iterations, edits, and files-touched counts are `mechanically-observed` wherever
  the seam counts them deterministically. Every reader-suggested mechanism carrying a locator is then
  **checked two-sided** — against the audited pack's own skill/contract/manifest text at the run's
  resolved executed version, and against a bounded, redacted excerpt fetched fresh at the locator
  through an interim, isolated fetcher agent, dispatched after the host itself resolves and validates
  the locator to a real path — and promoted to a confirmed contributing factor only when both sides
  verify (or verify mechanically on both, at an exact `file:line` and an exact locator). An interactive
  run with no failure description asks exactly one question; a run with no interactive channel stops
  with a stated reason and writes nothing. A run naming only `--session` records that fail to resolve
  also stops with a stated reason and writes nothing — never falling back to locating. A locator that
  meets an unreadable store or an unrecognized record shape fails loudly the same way.
- **`session-reader`** — the pack's isolated reader agent, dispatched once per named session (or once
  per ordered window of a record too large for one reader) on a model tier cheaper than the skill's
  own, falling back to the host's tier and **saying so** when the host is already lowest or the
  dispatch edge cannot honour a selector. It treats every record as untrusted data, never
  instructions; hunts evidence **against** the described failure as deliberately as evidence for it;
  redacts every quoted excerpt before its block leaves isolation; and reports the model it actually
  ran on. Raw session content never reaches the skill's own context — only these compact blocks do,
  and the skill composes the report's Summary, Evidence Record, Measured Effect, Coverage and
  Hypotheses from them alone. A hunt that matches nothing says "not found" rather than inventing one.
- **`locator`** — the pack's isolated locate/rank/count agent, dispatched exactly once per run. It
  owns all host-specific knowledge of where sessions live, how subagent records attach, and the
  30-day retention window, behind one replaceable seam (`references/locator.md`); it reads only
  structural record facts, never message content, fails loudly on an unreadable store or an
  unrecognized record shape, and ranks the surviving set (scope-match specificity, then recency, hunt
  sessions always last) without ever silently dropping one.
- **`/wf-postmortem:init`** — a one-command compatibility alias into the canonical `/wf:init`
  lifecycle, seeding `wf-postmortem` into the selection round.

## What this slice deliberately excludes

This is the sixth of seven sub-tasks under charter C035 ("Postmortem: verified defect reports mined
from prior sessions", umbrella WF-587). This slice bounds each hunt with a per-run read cap (default
15, overridable with `--cap`), lists every ranked session beyond it `skipped (budget)`, and lets a
`--report <path>` follow-up continue a capped hunt — reading those skipped sessions and extending the
same report file in place, with a dated Continuation entry. One later sub-task remains:

- Naming sessions a hunt cannot see because a run left no session record at all, and fallback evidence
  drawn from task folders and delivery history when a finding is under-evidenced from sessions alone
  (the coverage cross-check, a later sub-task).

## Install and register

Install the pack, then run `/wf:init` (or the compatibility alias `/wf-postmortem:init`) to add
`postmortem` to the project's `## Capabilities` registry. An installed-but-unregistered pack
contributes nothing and every core phase behaves exactly as before.

## Files

- `capabilities/postmortem/manifest.md` — the presence-only capability manifest.
- `agents/session-reader.md` — the isolated per-session reader agent (no `tools:` field, no pinned
  model; the model comes from the dispatch and the block reports what it ran on).
- `agents/locator.md` — the isolated locate/rank/count dispatch agent (no `tools:` field, no pinned
  model). Names no host-specific record path or field of its own — it obtains
  `references/locator.md` at the start of every dispatch and follows it exactly.
- `agents/excerpt-fetcher.md` — the interim, provisional isolated agent that fetches and redacts one
  bounded excerpt at a host-resolved path — the session-side re-read a confirmed hypothesis's locator
  needs, distinct from the `locator` agent's own locate/rank/count job.
- `skills/init/SKILL.md` — the compatibility-alias onboarding skill.
- `skills/postmortem/SKILL.md` — the guided skill body.
- `skills/postmortem/references/report-template.md` — the fixed report template, including the
  per-run read cap, the `skipped (budget)` verdict, and the follow-up Continuation section.
- `skills/postmortem/references/continuation.md` — the `--report <path>` follow-up procedure: prior
  report validation and path confinement, the retry-set construction, the cap application, the merge
  with the prior accumulated state, the recompute, the Continuation log entry, and the pre-overwrite
  re-verification (Part E) that re-runs the confinement check immediately before the write.
- `skills/postmortem/references/redaction.md` — the shared redacting write path's recognized shapes.
- `skills/postmortem/references/locator.md` — **the one seam**: every piece of host-specific
  knowledge of the session-record store, its layout, its structural fields, and the 30-day window,
  plus the ranking, hunt-session-detection, and deterministic-counting rules — named nowhere else in
  the pack.
- `skills/postmortem/references/excerpt-fetcher.md` — the locator grammar and the host-side
  parse-and-validate gate that resolves a locator to a real path before dispatching the fetcher agent.
- `skills/postmortem/references/version-resolution.md` — the runtime-read executed-version
  resolution and two-sided confirmation procedure the skill body points to.
