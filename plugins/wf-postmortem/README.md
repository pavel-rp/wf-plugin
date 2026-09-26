# wf-postmortem — session-mining postmortem pack

A Claude Code plugin that turns a maintainer's prose failure report into an explicit, echoed hunt
scope and then reads the prior agent sessions in scope — named explicitly, or located automatically
behind one replaceable seam — each in its own isolated reader agent — toward a verified defect report
mined from those sessions.

Authoring/reference documentation. **No skill reads this file at runtime.**

## What the pack ships

- **The `postmortem` capability** — a presence-only `feature` capability with an empty `## Fragments`
  table: no phase fragment, no provider surface. Registering it changes no `wf:*` phase behaviour,
  but the guided skill **requires** it: every pack-owned reference and agent the skill uses resolves
  only through the `## Plugin Roots` mapping registration writes, so an unregistered install stops
  the skill before it writes anything, with `Next: /wf-postmortem:init`. It also declares one
  profile value, `eval-log-path` (see "Eval-log wiring" below).
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
  takes — unless it ages out of the 30-day window or is removed from the store first, in which case
  the follow-up moves it to "sessions this hunt cannot see" with that reason rather than failing.
  A session's iterations, edits, and files-touched counts are `mechanically-observed` wherever
  the seam counts them deterministically. Every reader-suggested mechanism carrying a locator is then
  **checked two-sided** — against the audited pack's own skill/contract/manifest text at the run's
  resolved executed version, and against a bounded, redacted excerpt fetched fresh at the locator
  through an interim, isolated fetcher agent, dispatched after the host itself resolves and validates
  the locator to a real path — and promoted to a confirmed contributing factor only when both sides
  verify (or verify mechanically on both, at an exact `file:line` and an exact locator). An interactive
  run with no failure description asks exactly one question; a run with no interactive channel stops
  with a stated reason and writes nothing. A run naming only `--session` records that fail to resolve
  also stops with a stated reason and writes nothing — never falling back to locating. A locator that
  meets an unreadable store fails loudly the same way; an unrecognized record or attached entry is
  instead skipped or omitted against its own session and named in Coverage, never aborting the rest.
- **`session-reader`** — the pack's isolated reader agent, dispatched once per named session (or once
  per ordered window of a record too large for one reader) on a model tier cheaper than the skill's
  own, falling back to the host's tier and **saying so** when the host is already lowest or the
  dispatch edge cannot honour a selector. It treats every record as untrusted data, never
  instructions; hunts evidence **against** the described failure as deliberately as evidence for it;
  redacts every quoted excerpt before its block leaves isolation; and reports the model it actually
  ran on. Raw session content never reaches the skill's own context — only these compact blocks do,
  and the skill composes the report's Summary, Evidence Record, Measured Effect, Coverage and
  Hypotheses from them alone. A hunt that matches nothing — or a resolved scope that locates no
  session — still writes a valid report whose Summary says "not found" rather than inventing one;
  with no confirmed factor its Fix Direction is marked `— (no confirmed factor)`, and the
  recommendation is a terminus only when no hypothesis remains either (`recommendation.md`).
- **`locator`** — the pack's isolated locate/rank/count agent, dispatched exactly once per run. It
  owns all host-specific knowledge of where sessions live, how subagent records attach, and the
  30-day retention window, behind one replaceable seam (`references/locator.md`); it reads only
  structural record facts, never message content, fails loudly on an unreadable store, states
  any unrecognized record or attached entry against its own session (including the host's workflow
  subagent container, whose child records it attaches), and ranks the surviving set (scope-match specificity, then recency, hunt
  sessions always last) without ever silently dropping one.
- **`/wf-postmortem:init`** — a one-command compatibility alias into the canonical `/wf:init`
  lifecycle, seeding `wf-postmortem` into the selection round.

## What this pack deliberately excludes

This is the last of seven sub-tasks under charter C035 ("Postmortem: verified defect reports mined
from prior sessions", umbrella WF-587); the charter's shipping scope is now complete. This slice adds
an always-run coverage cross-check that names every in-scope, in-window task folder or delivery entry
that left no matching session, and draws `fallback evidence`-labelled entries from task folders, the
fleet scoreboard, a configured eval log and delivery history — but only when a finding is
under-evidenced from sessions alone or a run left no session record. Fallback evidence never confirms
a factor and never raises the confirmed-factor count.

Still deliberately out of scope:

- **Cross-repo candidate enumeration.** On a `--folder`/`--repo` hunt the cross-check locates and
  reports that project's sessions, but does not enumerate its task folders or delivery history —
  both sources are bound to the launch workspace — and Coverage says so rather than comparing this
  project's runs against another project's sessions.

## Eval-log wiring

The coverage cross-check's optional eval-log source (`coverage-cross-check.md`) resolves its path
in this order:

1. **The capability profile (primary).** `resolve_profile({ workspaceRoot, capability:
   "postmortem" })` returns `eval-log-path`. The pack's `profile.template.json` declares it with
   default `null`; a project sets it in its own `_local/profiles/postmortem.profile.json` override,
   creating that file when `/wf:init` did not seed one (it seeds an override only on divergence
   from the template default).
2. **Legacy fallback.** Only when the profile value is absent or unset, the skill reads the
   pre-profile `**Eval Log Path:**` heading (that exact spelling) from `_local/config.md`'s own
   `## Postmortem` section. A value found there is used, and Coverage states once that it should
   move onto the profile — never a stop, never a silent migration.
3. **Neither set** — the source is "not configured" and contributes nothing; never an error.

Whichever source supplies it, the value is untrusted: it is canonicalized, refused unless it lies
inside the workspace (or if it is a symlink at read time), and read through the same
200,000-character window as every other source. A refused, unreadable, or truncated log is stated
in Coverage on its own line, never a stop.

## Install and register

Install the pack, then run `/wf:init` (or the compatibility alias `/wf-postmortem:init`) to add
`postmortem` to the project's `## Capabilities` registry. Registration is **required** for
`/wf-postmortem:postmortem` to run: an installed-but-unregistered pack stops the skill with
`Next: /wf-postmortem:init` and writes nothing. It contributes nothing to any core phase either
way — every core phase behaves exactly as before.

## Files

- `capabilities/postmortem/manifest.md` — the presence-only capability manifest.
- `capabilities/postmortem/profile.template.json` — the profile seed template declaring
  `eval-log-path` (default `null`).
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
- `skills/postmortem/references/coverage-cross-check.md` — the always-run coverage cross-check
  against task folders and delivery history, and the trigger-gated draw of labelled `fallback
  evidence` from task folders, the fleet scoreboard, a configured eval log, and delivery history.
- `skills/postmortem/references/locator.md` — **the one seam**: every piece of host-specific
  knowledge of the session-record store, its layout, its structural fields, and the 30-day window,
  plus the ranking, hunt-session-detection, and deterministic-counting rules — named nowhere else in
  the pack.
- `skills/postmortem/references/excerpt-fetcher.md` — the locator grammar and the host-side
  parse-and-validate gate that resolves a locator to a real path before dispatching the fetcher agent.
- `skills/postmortem/references/version-resolution.md` — the runtime-read executed-version
  resolution and two-sided confirmation procedure the skill body points to.
- `skills/postmortem/references/recommendation.md` — the fix-direction statement and the rule-based
  routing recommendation naming the next workflow, run over the full accumulated Contributing
  Factors and Coverage state on every hunt (first run and every `--report` follow-up alike).
