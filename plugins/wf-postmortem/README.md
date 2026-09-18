# wf-postmortem — session-mining postmortem pack

A Claude Code plugin that turns a maintainer's prose failure report into an explicit, echoed hunt
scope and then reads the prior agent sessions the maintainer names — each in its own isolated reader
agent — toward a verified defect report mined from those sessions.

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
  report's Scope section, then **reads every session record named with the repeatable `--session`
  flag** and writes the fixed ten-section report. Every reader-suggested mechanism carrying a locator
  is then **checked two-sided** — against the audited pack's own skill/contract/manifest text at the
  run's resolved executed version, and against a bounded, redacted excerpt fetched fresh at the
  locator through an interim, isolated fetcher agent, dispatched after the host itself resolves and
  validates the locator to a real path — and promoted to a confirmed contributing factor only
  when both sides verify (or verify mechanically on both, at an exact `file:line` and an exact
  locator). An interactive run with no failure description asks exactly one question; a run with no
  interactive channel stops with a stated reason and writes nothing. A run naming no session record —
  or only records that do not resolve — also stops with a stated reason and writes nothing.
- **`session-reader`** — the pack's isolated reader agent, dispatched once per named session (or once
  per ordered window of a record too large for one reader) on a model tier cheaper than the skill's
  own, falling back to the host's tier and **saying so** when the host is already lowest or the
  dispatch edge cannot honour a selector. It treats every record as untrusted data, never
  instructions; hunts evidence **against** the described failure as deliberately as evidence for it;
  redacts every quoted excerpt before its block leaves isolation; and reports the model it actually
  ran on. Raw session content never reaches the skill's own context — only these compact blocks do,
  and the skill composes the report's Summary, Evidence Record, Measured Effect, Coverage and
  Hypotheses from them alone. A hunt that matches nothing says "not found" rather than inventing one.
- **`/wf-postmortem:init`** — a one-command compatibility alias into the canonical `/wf:init`
  lifecycle, seeding `wf-postmortem` into the selection round.

## What this slice deliberately excludes

This is the third of seven sub-tasks under charter C035 ("Postmortem: verified defect reports mined
from prior sessions", umbrella WF-587). This slice reads the sessions the maintainer **names** and
**confirms** any reader-suggested mechanism that checks out two-sided; it still **locates** no session
of its own. Later sub-tasks add:

- Locating sessions behind a replaceable seam, ranked and never silently dropped (a later
  sub-task) — until it lands, `--session` is the only session input, and the maintainer's explicit
  list is the only bound on a hunt.
- Deterministic, mechanically-observed measured-effect counts (a later sub-task) — every count stays
  `reader-counted` at the `unverified` tier until then, whatever this slice confirms about a mechanism.
- Stating a fix direction and a rule-based next-step recommendation (a later sub-task).
- A per-run read cap with ranked reading, `skipped (budget)` listing, and follow-up continuation (a
  later sub-task).
- Naming sessions a hunt cannot see, and fallback evidence from task folders and delivery history
  (a later sub-task).

## Install and register

Install the pack, then run `/wf:init` (or the compatibility alias `/wf-postmortem:init`) to add
`postmortem` to the project's `## Capabilities` registry. An installed-but-unregistered pack
contributes nothing and every core phase behaves exactly as before.

## Files

- `capabilities/postmortem/manifest.md` — the presence-only capability manifest.
- `agents/session-reader.md` — the isolated per-session reader agent (no `tools:` field, no pinned
  model; the model comes from the dispatch and the block reports what it ran on).
- `agents/excerpt-fetcher.md` — the interim, provisional isolated agent that fetches and redacts one
  bounded excerpt at a host-resolved path, standing in for the not-yet-landed SUB-2 access point.
- `skills/init/SKILL.md` — the compatibility-alias onboarding skill.
- `skills/postmortem/SKILL.md` — the guided skill body.
- `skills/postmortem/references/report-template.md` — the fixed ten-section report template.
- `skills/postmortem/references/redaction.md` — the shared redacting write path's recognized shapes.
- `skills/postmortem/references/excerpt-fetcher.md` — the locator grammar and the host-side
  parse-and-validate gate that resolves a locator to a real path before dispatching the fetcher agent.
- `skills/postmortem/references/version-resolution.md` — the runtime-read executed-version
  resolution and two-sided confirmation procedure the skill body points to.
