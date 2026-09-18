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
  flag** and writes the fixed ten-section report. An interactive run with no failure description asks
  exactly one question; a run with no interactive channel stops with a stated reason and writes
  nothing. A run naming no session record — or only records that do not resolve — also stops with a
  stated reason and writes nothing.
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

This is the second of seven sub-tasks under charter C035 ("Postmortem: verified defect reports mined
from prior sessions", umbrella WF-587). This slice reads the sessions the maintainer **names**; it
still **locates** none, and it **confirms** none. Later sub-tasks add:

- Locating sessions behind a replaceable seam, ranked and never silently dropped (a later
  sub-task) — until it lands, `--session` is the only session input, and the maintainer's explicit
  list is the only bound on a hunt.
- Verifying every claimed mechanism against the executed-version skill text and a checked session
  locator (a later sub-task) — until it lands, every mechanism a reader suggests is reported as a
  hypothesis and every count is `reader-counted` at the `unverified` tier, never mechanically
  observed.
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
- `skills/init/SKILL.md` — the compatibility-alias onboarding skill.
- `skills/postmortem/SKILL.md` — the guided skill body.
- `skills/postmortem/references/report-template.md` — the fixed ten-section report template.
- `skills/postmortem/references/redaction.md` — the shared redacting write path's recognized shapes.
