# wf-postmortem — session-mining postmortem pack

A Claude Code plugin that turns a maintainer's prose failure report into an explicit, echoed hunt
scope and a fixed-shape report skeleton — the first step toward a verified defect report mined from
prior agent sessions.

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
  report's Scope section, and writes the fixed ten-section report template with every section this
  slice cannot fill marked "not yet produced." An interactive run with no failure description asks
  exactly one question; a run with no interactive channel stops with a stated reason and writes
  nothing.
- **`/wf-postmortem:init`** — a one-command compatibility alias into the canonical `/wf:init`
  lifecycle, seeding `wf-postmortem` into the selection round.

## What this slice deliberately excludes

This is the first of seven sub-tasks under charter C035 ("Postmortem: verified defect reports mined
from prior sessions", umbrella WF-587). This slice resolves scope only — it locates and reads no
session record. Later sub-tasks add:

- Locating sessions behind a replaceable seam, ranked and never silently dropped (a later
  sub-task).
- Reading each located session in an isolated reader on a cheaper model (a later sub-task).
- Verifying every claimed mechanism against the executed-version skill text and a checked session
  locator (a later sub-task).
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
- `skills/init/SKILL.md` — the compatibility-alias onboarding skill.
- `skills/postmortem/SKILL.md` — the guided skill body.
- `skills/postmortem/references/report-template.md` — the fixed ten-section report template.
- `skills/postmortem/references/redaction.md` — the shared redacting write path's recognized shapes.
