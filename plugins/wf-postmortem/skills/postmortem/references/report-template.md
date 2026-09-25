# postmortem report template

Runtime-read only on the write path (Phase 4 of `SKILL.md`) — never read at boot. The verbatim
shape every `{task-root}/PM<NNN>__<slug>/report.md` follows, in this section order.

Summary, Scope, both halves of Contributing Factors, Evidence Record, Measured Effect, Component and
Version, Localisation, and Coverage are **filled from the reader return blocks and the two-sided
confirmation check** this release runs against them. Component and Version, the confirmed half of
Contributing Factors, and Localisation state their own honest "none confirmed this run" reason when
no hypothesis was promoted — that is a per-run outcome, not a per-release gap, since this release
*can* confirm a factor. The two sections that remain a genuine per-release gap — Fix Direction and
Recommendation — state their own reason explicitly, verbatim, rather than being omitted: a reader
must be able to tell "not produced yet" from "produced and empty."

```markdown
# Postmortem — <failure description, one line>

**Model:** <runtime model id>
**Created:** <YYYY-MM-DD HH:MM>

---

## Summary

<One short paragraph: what was found across every session read, stated plainly — or the literal
sentence "Not found — no session read yielded an observation supporting the described failure."
Nothing is inferred beyond what the readers reported, and nothing is softened: a hunt that found
nothing says so.>

## Scope

- **Failure description:** <the resolved description, verbatim, after the redacting write path>
- **Skill:** <resolved skill name | "unscoped">
- **Folder or repository:** <resolved path, verbatim | "not named" | "<name> — unresolved (no matching filesystem path)">
- **Read cap:** <n> (default | override)
- **Session scope:** <"current workspace only" | "<resolved project path>">
- **Session source:** <"named (--session)" | "located (seam)">
- **Window (located runs only):** <the 30-day cutoff, stated regardless of whether it excluded anything | "n/a — named-session run">
- **Named session records (named runs only):** <one line per `--session` value, in the order passed>
  - `<resolved path>` — resolved
  - `<named path>` — unresolved (no matching filesystem path)
- **Located sessions (located runs only):** stated in full in Coverage, below — this section names
  only the scope and window that bounded the locate operation, never a duplicate listing.

## Component and Version

<When at least one factor was confirmed this run: the component (skill/contract/manifest file) and
its resolved version, selected by taking the `mechanically-observed` confirmed factors before the
`independently-verified` ones, and within the same tier the one confirmed first in merge order (one
factor, deterministically, even when several were confirmed) — stated as `<component> at <version>`
(with the "version approximate (date-resolved)" label carried verbatim where that branch resolved
it). When none was confirmed this run: "No factor confirmed this run — component and version
attribution follows a hypothesis's mechanism being checked two-sided against the executed-version
source text and a checked session locator (Contributing Factors, below); none passed both sides this
run.">

## Contributing Factors

**Confirmed factors:** <one entry per hypothesis promoted this run, each stating the mechanism, its
resolved version (with the approximate label where applicable), `file:line`, the checked session
locator, and its tier (`independently-verified` or `mechanically-observed`) — or, when none was
promoted, "none confirmed this run — every mechanism below is checked two-sided before promotion; none
passed both sides.">

- <mechanism, one line> — `<file:line>` at version `<version>` — locator: `<session path>` — tier:
  `<independently-verified | mechanically-observed>`

### Hypotheses

<One entry per mechanism any reader suggested that was not promoted above, merged across sessions.
Each carries a stable **`H<n>`** id, names the session locator(s) that prompted it when it carries
one, states the mechanism in one line, and states **why** it was not promoted — one of: "not checked
— no locator"; "not checked — malformed locator"; "checked — source side failed" (the mechanism text
was not present at the resolved version); "checked — session side failed" (the excerpt did not show
the observation, was not found, or was denied); or "not eligible — version resolved to
`present-day-only`". A promoted mechanism moves to the confirmed half and is not duplicated here;
every reason above still leaves the hypothesis at the `unverified` tier — checking it and not
confirming it is not a defect of this report. A mechanism supported only by `fallback evidence`
(`coverage-cross-check.md`) also lists here, its "why not promoted" naming the gating trigger that
drew it — "fallback evidence only — trigger (a): no factor confirmed from sessions alone" or
"fallback evidence only — trigger (b): matched run left no session record" — and it stays a
Hypothesis regardless of how corroborating that evidence is; confirmation reaches only through the
two-sided check. **Trigger (b)** most often introduces its own new entry here rather than augmenting
an existing one — an unmatched run has no session, so no existing hypothesis is already tied to it —
in which case "suggested from" names the candidate's own task-folder path or delivery-entry id (never
a session locator, since none exists for this candidate) and the mechanism text is drawn from that
candidate's own fallback-sourced artifacts.

**`H<n>` id — minted once, never reused or renumbered.** Assigned the first time an entry is created
(first run, or a later run that introduces a genuinely new mechanism/candidate not already present).
The next id is one past the **highest `H<n>` this report has ever carried**, not one past the count
currently present — the same monotonic-id discipline this repo's own constitution record uses for
`proj.N` clauses (never reused after a hypothesis is promoted or otherwise leaves this list). A
continuation follow-up parsing a prior report (`continuation.md` Part A step 4) reads each entry's
existing `H<n>` id back and carries it forward unchanged; only a newly-introduced entry mints a fresh
one. This id — never the mechanism text, never a merge-order position — is what
`coverage-cross-check.md`'s trigger-(a) draw key uses to stay identical across runs regardless of
merge order.>

- **H<n>** <mechanism, one line> — suggested from `<session locator | task-folder path |
  delivery-entry id | "no locator">` — <reason it was not promoted>

## Evidence Record

<Every observation the readers returned, supporting and disconfirming both, each already redacted by
the reader that produced it. The disconfirming observations are a required half of this section, not
a footnote: a hunt that reports only what confirms is the failure mode the reader contract exists to
prevent.>

**Supporting**

- <what was observed, one line> — locator: `<session path | task-folder path | delivery-entry id>` |
  tier: <reader-observed | run-reported | inferred | mechanically-observed> <[fallback evidence] when
  labelled>

**Disconfirming**

- <what was observed that counts against the described failure> — locator: `<session
  path#subagent:<file> | task-folder path | delivery-entry id>` | tier: <reader-observed | run-reported
  | inferred | mechanically-observed> <[fallback evidence] when labelled>

<When either list is empty, state "- none" rather than dropping the heading — a reader must be able
to tell "nothing found" from "not looked for". A `run-reported` tier marks a statement in which the
run under study claimed its own success or progress; it is quoted as what that run claimed and never
treated as evidence that it happened. An entry may instead carry the **`fallback evidence`** label
alongside its own tier (`inferred` or `mechanically-observed`) — distinct from the `reader-observed`/
`run-reported` tiers above — when it was drawn from a task folder, the fleet scoreboard, a configured
eval-log, or a delivery entry rather than from a session (`coverage-cross-check.md`); it is never
confirming and never raises the confirmed-factor count.>

## Localisation

<When at least one factor was confirmed this run: one line per confirmed factor's `file:line`. When
none was confirmed this run: "No factor confirmed this run — localisation is filled from a confirmed
contributing factor's `file:line`; none exists this run.">

## Measured Effect

<Counts read from the sessions themselves, one group per session. A session's iterations, edits, and
files-touched counts are labelled `mechanically-observed` wherever the locator seam counted them
deterministically, with no model judgment — **whether the session was located or named**, since the
seam's attach-only mode counts a named session's records on exactly the same structural pass; the tier
follows how the count was produced, never how the session was reached. Every other count — findings
per pass, always, and any count the seam did not produce — is labelled `reader-counted` at the
`unverified` tier. No token count and no monetary figure appears here or anywhere in this report.>

- `<session path>` — iterations: <n | not observable> · edits: <n | not observable> · files touched: <n | not observable> · findings per pass: <n | not observable> — each labelled **mechanically-observed** or **reader-counted**, per count, at its own real tier

## Fix Direction

<Composed only from a confirmed contributing factor, above — kept apart from the Evidence Record,
which stays a record of what was observed, never of what to do about it.>

**When at least one factor was confirmed this run:** one short paragraph naming the concrete change
the confirmed mechanism points at, grounded in that factor's own text — followed by:

**Marked:** `stated` (a single remedy follows directly from the confirmed mechanism, with no other
reasonable way to address it visible in this report's own evidence) | `resting on an open choice`
(stating the fix would require picking between two or more materially different remedies, or the
confirmed evidence pins down that something is wrong without pinning down which specific change
corrects it — name the choice being deferred).

**When no factor was confirmed this run:** "No factor confirmed this run — a fix direction follows a
confirmed contributing factor; none exists this run." **Marked:** `— (no confirmed factor)`.

## Coverage

<Every resolved named session record, and every session the locator seam located, each exactly once,
under exactly one verdict. An unresolved `--session` name is not listed here — it appears in Scope
instead, because nothing about it was ever read. This section states the cap in force **on every run,
located or named**, whether or not it excluded anything. On a located run each entry also carries the
date step 0's locator returned for it, and the section additionally states the 30-day window's own
cutoff and labels a hunt session. A named `--session` entry has no locator-supplied date; state
`n/a — named session` there instead of omitting the field.>

- `<session path>` — read · date: <YYYY-MM-DD | n/a — named session> · model: <id> · tier: <requested | host-fallback (<reason>)> <[hunt-session] when labelled>
- `<session path>` — read in part (<reason>) · date: <…> · model: <id> · tier: <…>
- `<session path>` — skipped (budget) · date: <…> · model: not dispatched · tier: n/a <[hunt-session] when labelled>
- `<session path>` — skipped (reader error: <reason>) · date: <…> · model: <id | not dispatched> · tier: <requested | host-fallback (<reason>) | n/a>
- `<session path>` — skipped (access denied) · date: <…> · model: <id | not dispatched> · tier: <requested | host-fallback (<reason>) | n/a>

**Window:** <the 30-day cutoff, stated on every located run | "n/a — named-session run">

**Read cap:** <n> in force (default | override), on every run whether located or named — every ranked
entry beyond it is `skipped (budget)` above, never dropped, retrievable by a later `--report`
follow-up unless it ages out or is removed first (see "sessions this hunt cannot see" below).

**Under-evidenced trigger suppressed (budget):** rendered on **every** hunt, one of three forms
depending on which branch of `coverage-cross-check.md`'s capped-hunt-suppression rule applies this
run:
- **the populated form** — `<n> in-scope session(s) still skipped — read them before drawing fallback
  evidence` — when trigger (a)'s capped-hunt suppression actually applies this run: at least one
  in-scope session is still `skipped (budget)` **and** at least one finding remains under-evidenced,
  naming the count of still-skipped in-scope sessions and stating the same
  follow-up-should-read-first recommendation the suppression rule requires;
- **`none — no in-scope session remains skipped (budget)`** — a located (non-named-session) hunt
  where the suppression condition's first half fails: no in-scope session is `skipped (budget)`, so
  trigger (a) is free to fire on its own merits this run, suppressed by nothing;
- **`n/a — named-session run: no located scope to suppress against`** — an attach-only (`--session`)
  hunt, which has no resolved located scope for the capped-hunt rule to evaluate against at all
  (`coverage-cross-check.md` Part A step 0).

**Sessions this hunt cannot see** (follow-up runs only): <a prior `skipped (budget)` session absent
from this run's fresh locate-mode return, with the reason — "aged out of the 30-day window" or
"removed from the store" — one line per session, or "- none" when every prior `skipped (budget)`
session is still present>

**Runs with no session record** (every hunt, cross-checked against task folders and delivery
history): <one line per in-scope, in-window task folder or delivery entry matched to no session, as
`<task folder path | delivery entry id> — key attempted: <`<task id>` · `<branch>` — both keys tried,
found for both | `<task id>` alone — a task id was found but no branch string was (every delivery
entry, and any task folder with no `**Branch:**` line) | "date only" — the candidate supplied no
identity at all>` plus, when
relevant, the delivery-history reason (`no delivery provider registered`, the read's own failure
reason, or `delivery history is not readable for a named --folder/--repo target`) as its own line —
the same literal set `coverage-cross-check.md` Part A step 2 produces, mirroring `wf:standup`'s own
`no delivery provider registered` wording exactly — or "- none" when every in-scope,
in-window candidate matched a session. **Eval-log and scoreboard source state** (`coverage-cross-check.md`),
each on its own Coverage line whenever that source was consulted this run: `eval log refused —
outside the workspace` | `eval log refused — symlinked` | `eval log unreadable — <reason>` | `eval
log truncated — read <n> of <total> characters` | `scoreboard truncated — read <n> of <total>
characters`. When the enumeration
was narrowed, state the root it ran against — or, on a named-session hunt, `- none — named-session
run: no resolved scope, so no in-scope run could be cross-checked` — so a narrowed cross-check is
never read as an exhaustive one.
Distinct from, and additional to, "sessions this hunt cannot see" above — that list is prior sessions
this run can no longer reach; this one is runs that never had a session to reach. Rendered on every
hunt, whether or not fallback evidence below is drawn.>

## Recommendation

<The rule that fired, evaluated in this fixed order over this report's own fields — the
confirmed-factor count, the hypothesis count, the Localisation file/contract list, and the Fix
Direction marker above — first match wins (full rule text: `recommendation.md`).>

**Rule fired:** <1 | 2 | 3 | 4> — <one line naming the trigger, e.g. "no confirmed factor and no
hypothesis", "two confirmed factors", "localisation names two distinct skills/contracts", "fix
direction resting on an open choice", "one confirmed factor, one skill or contract, fix direction
stated">

<One of, matching the fired rule, verbatim:>

- **Rule 1:** No route recommended — this report is a terminus.
- **Rule 2:** Charter recommended — `/wf:charter` — pass this report's Summary and Contributing
  Factors in as the free-text feature-idea argument. Checked before Rule 3's open-choice clause, so a
  multi-factor or multi-surface case fires this rule even when one factor's fix direction rests on an
  open choice.
- **Rule 3:** Research recommended — `/wf:research` — pass this report's Summary and Contributing
  Factors in as the free-text topic argument.
- **Rule 4:** Spec recommended — file a work item from this report (a tracker issue, or a local task
  when no tracker is registered), then run `/wf:spec <id>` against it — never `/wf:spec` taking this
  report directly.

Every hypothesis listed above stays listed regardless of which rule fired; a hypothesis beside a
confirmed factor never changes the route.

## Continuation

<Present only on a report that has been extended by at least one `--report` follow-up; omitted
entirely from a first-run report. One dated entry per follow-up run, oldest first, appended below the
previous entry — never replacing one. This log is the one section that accumulates rather than being
recomputed, and it is deliberately unbounded: no pruning, consolidation, or entry cap ships in this
release (`continuation.md` Part D states why).>

**<YYYY-MM-DD HH:MM> follow-up:**
- Newly read this run: <one path per session, including any explicit `--session` retry (listed here
  even when it names a session the prior report already marked `read` — its fresh entry replaced the
  prior one), or "none">
- Newly capped this run: <one path per session newly assigned `skipped (budget)` for the first time —
  distinct from a session already `skipped (budget)` before this run, which is not relisted — or "none">
- Requested but not reached this run: <one line per explicit `--session` retry the cap did not reach,
  as `<path> — cap in force (<n>) reached before this retry; prior entry retained` — an already-covered
  session is never demoted to `skipped (budget)` by the cap, so it is never folded into the bullet
  above; or "none">
- Retry failed, prior evidence retained: <one line per dispatched retry that came back
  `skipped (reader error: …)` or `skipped (access denied)` over a prior `read`/`read in part`, as
  `<path> — <failure verdict and reason>` — the prior entry stands and is not overwritten, so this is
  never folded into "Sections changed" below; or "none">
- Moved to "sessions this hunt cannot see": <one path per session with its reason, or "none">
- Fallback evidence drawn this run: <one line per `fallback evidence` entry newly drawn, as
  `<the draw key> — trigger (a) | trigger (b)`, or "none">
- Fallback evidence retired this run: <one line per finding this run's own two-sided check now
  confirms from sessions alone, as `<the draw key> — confirmed from sessions; no further fallback
  evidence drawn` — the existing entries stay, still labelled, superseded by the dated note; or "none">
- Fallback evidence suppressed (duplicate key): <one line per draw the dedup guard discarded, as
  `<the draw key> — already present, nothing drawn`, so a suppressed draw is distinguishable from a
  draw never attempted; or "none">
- Sections changed: <Summary | Contributing Factors | Component and Version | Localisation | Measured
  Effect — named plainly, or "none" when the recompute produced no observable change>
- Recommendation: <"unchanged (rule `<n>` still fires)" | "changed — rule `<old>` → rule `<new>`",
  restating the new rule's hand-off in full when changed>

---

POSTMORTEM — written

Report:   {task-root}/PM<NNN>__<slug>/report.md
Follow-up: <n/a — first run | continuing <prior report path> · <n> newly read · recommendation <unchanged (rule <n>)|changed (rule <old> → <new>)>>
Scope:    description="<resolved, redacted>" · skill=<name|unscoped> · folder/repo=<resolved|not named|<name> — unresolved> · cap=<n> (default|override) · session-scope=<current workspace only|<resolved project path>>
Sessions: <n> named · <r> resolved · <u> unresolved | <n> located
Window:   <30-day cutoff, stated on every located run | n/a — named-session run>
Coverage: <path>=<read|read in part (<reason>)|skipped (budget)|skipped (reader error: <reason>)|skipped (access denied)> [model=<id|not dispatched> tier=<requested|host-fallback (<reason>)|n/a>] [hunt-session] · …
Finding:  <one line — what was found | not found>
Next:     <none — terminus | /wf:research — <framing> | /wf:charter — <framing> | file a work item from this report, then /wf:spec <id>>
```

## Filling rules

- **Verbatim echo, no paraphrase.** Every resolved value in the Scope section is stated exactly as
  resolved (after the redacting write path has run over it) — never summarized, never reworded.
- **State the default, not just the value.** When a value was defaulted rather than named in the
  prompt, say so explicitly (e.g. `"unscoped"`, `"current workspace only"`, `"15 (default)"`) — a
  reader must be able to tell an explicit choice from a default.
- **An unresolved name is reported, not silently dropped.** A named folder, repository, or session
  record that does not resolve to a filesystem path is stated as `"<name> — unresolved (no matching
  filesystem path)"`, and no session-store lookup is attempted for it. An unresolved session record
  appears in Scope only — never in Coverage, which lists what was actually read.
- **A section left unfilled states its own reason.** Component and Version, the confirmed half of
  Contributing Factors, Localisation, and Fix Direction each state "none/no factor confirmed this
  run" when nothing passed the two-sided check — a per-run outcome, since this release can confirm a
  factor. Saying so explicitly is the point: a reader must be able to tell "nothing this run" from
  "produced and empty."
- **Fix Direction is composed only from a confirmed contributing factor**, kept apart from the
  Evidence Record, and marked `stated`, `resting on an open choice`, or — when no factor was confirmed
  this run — `— (no confirmed factor)` — that marker is one of Recommendation's four load-bearing
  inputs. **Recommendation states the rule that fired and the
  hand-off**, computed strictly from the confirmed-factor count, the hypothesis count, the
  Localisation file/contract list (each distinct skill or contract counted once), and the Fix
  Direction marker — reproducible from those four alone, first match wins, and mirrored onto the
  Final Output block's `Next:` line. Nothing here is dispatched, invoked, or filed by this skill.
- **Evidence Record quotes are already redacted** when they arrive — each reader applied the shared
  shape rules before its block left isolation — and the write path applies them again as the disk
  backstop. Quote short excerpts only; never a region of a record.
- **Both evidence halves are mandatory.** Supporting and disconfirming each get their heading, and an
  empty one reads `- none`. Dropping the disconfirming half would hide exactly the evidence the
  reader contract goes out of its way to collect.
- **A count is labelled `mechanically-observed` only when the locator seam produced it with no model
  judgment.** Every other count — findings per pass, always — is `reader-counted` at `unverified`; a
  reader-counted figure is never presented as mechanically observed. No token or monetary figure
  appears anywhere in the report.
- **A mechanism is promoted only through the two-sided check.** A reader's suggestion becomes a
  confirmed factor only when the source-side text at its resolved executed version and the
  session-side excerpt at its locator both verify (or both verify mechanically, at an exact
  `file:line` and an exact locator) — never on one side alone, and never when the version resolves
  only to `present-day-only` text. Everything else stays a hypothesis at the `unverified` tier.
- **Coverage carries each resolved-or-located record exactly once** under one of the five verdicts
  (`read`, `read in part`, `skipped (budget)`, `skipped (reader error)`, `skipped (access denied)`),
  with the model that reader ran on, whether that was the requested cheaper tier or the host-tier
  fallback (with its reason), plus **the cap in force on every run, located or named** — and, on a
  located run only, the 30-day window's own cutoff and a hunt-session label where one applies. A
  windowed session appears once, not once per window. On a follow-up, "sessions this hunt cannot see"
  and the Continuation entry are additive — neither ever removes a session from Coverage.
- **A "not found" report is a complete report.** Summary says so plainly, and Scope and Coverage are
  filled exactly as they would be for a hunt that found something. No match is ever fabricated to
  avoid an empty Summary.
- **The coverage cross-check runs on every hunt; fallback evidence is gated.** "Runs with no session
  record" is always populated (or "- none"), whether or not any fallback evidence is drawn. Fallback
  evidence is drawn only on trigger (a) — a finding's Confirmed is empty and no in-scope session
  remains `skipped (budget)` — or trigger (b) — the cross-check names an in-scope, in-window candidate
  matched to no session, filed against that candidate itself: most often as its own new Hypotheses
  entry, since no hypothesis is ordinarily tied to a run nobody read a session for, though it may
  instead be filed as corroborating/disconfirming material alongside an existing hypothesis when the
  drawn text plausibly describes that same mechanism (`coverage-cross-check.md` case (i)). While any
  in-scope session is `skipped (budget)` and at least one finding remains under-evidenced, trigger (a)
  is suppressed and Coverage's own **"Under-evidenced trigger suppressed (budget)"** line states the
  still-skipped count and that a follow-up should read those sessions before fallback evidence is
  drawn — the renderable statement of that fact, filled whenever the suppression condition holds and
  "- none"/"- n/a" otherwise; trigger (b) still fires regardless (full rules:
  `coverage-cross-check.md`, mirrored here so the two documents cannot drift).
- **The final-output block is part of the file**, not just chat output — a downstream reader of the
  report file sees the same `POSTMORTEM — written` block this skill prints to chat.
