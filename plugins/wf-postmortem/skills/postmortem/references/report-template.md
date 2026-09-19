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
- **Read cap:** <override value, if named | "default, not yet enforced">
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
Each states the mechanism in one line, names the session locator(s) that prompted it when it carries
one, and states **why** it was not promoted — one of: "not checked — no locator"; "not checked —
malformed locator"; "checked — source side failed" (the mechanism text was not present at the
resolved version); "checked — session side failed" (the excerpt did not show the observation, was not
found, or was denied); or "not eligible — version resolved to `present-day-only`". A promoted
mechanism moves to the confirmed half and is not duplicated here; every reason above still leaves the
hypothesis at the `unverified` tier — checking it and not confirming it is not a defect of this
report.>

- <mechanism, one line> — suggested from `<locator | "no locator">` — <reason it was not promoted>

## Evidence Record

<Every observation the readers returned, supporting and disconfirming both, each already redacted by
the reader that produced it. The disconfirming observations are a required half of this section, not
a footnote: a hunt that reports only what confirms is the failure mode the reader contract exists to
prevent.>

**Supporting**

- <what was observed, one line> — locator: `<session path>` | tier: <reader-observed | run-reported>

**Disconfirming**

- <what was observed that counts against the described failure> — locator: `<session path>#subagent:<file>` | tier: <reader-observed | run-reported>

<When either list is empty, state "- none" rather than dropping the heading — a reader must be able
to tell "nothing found" from "not looked for". A `run-reported` tier marks a statement in which the
run under study claimed its own success or progress; it is quoted as what that run claimed and never
treated as evidence that it happened.>

## Localisation

<When at least one factor was confirmed this run: one line per confirmed factor's `file:line`. When
none was confirmed this run: "No factor confirmed this run — localisation is filled from a confirmed
contributing factor's `file:line`; none exists this run.">

## Measured Effect

<Counts read from the sessions themselves, one group per session. A located session's iterations,
edits, and files-touched counts are labelled `mechanically-observed` wherever the locator seam counted
them deterministically, with no model judgment; every other count — findings per pass, always, and any
count for a named session or one the seam could not produce — is labelled `reader-counted` at the
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
instead, because nothing about it was ever read. On a located run, this section also states the
30-day window's own cutoff — whether or not it excluded anything — and labels a hunt session.>

- `<session path>` — read · model: <id> · tier: <requested | host-fallback (<reason>)> <[hunt session] when labelled>
- `<session path>` — read in part (<reason>) · model: <id> · tier: <…>
- `<session path>` — skipped (reader error: <reason>) · model: <id | not dispatched> · tier: <requested | host-fallback (<reason>) | n/a>
- `<session path>` — skipped (access denied) · model: <id | not dispatched> · tier: <requested | host-fallback (<reason>) | n/a>

**Window:** <the 30-day cutoff, stated on every located run | "n/a — named-session run">

**Not covered by this release:** the per-run read cap and `skipped (budget)` listing, follow-up
continuation, and the coverage cross-check against task folders and delivery history — each arrives
with a later charter sub-task. Until then, every located session is read, in ranked order, with no cap.

## Recommendation

<The rule that fired, evaluated in this fixed order over this report's own fields — the
confirmed-factor count, the hypothesis count, the Localisation file/contract list, and the Fix
Direction marker above — first match wins (full rule text: `recommendation.md`).>

**Rule fired:** <1 | 2 | 3 | 4> — <one line naming the trigger, e.g. "no confirmed factor and no
hypothesis", "fix direction resting on an open choice", "two confirmed factors", "localisation names
two distinct skills/contracts", "one confirmed factor, one skill or contract, fix direction stated">

<One of, matching the fired rule, verbatim:>

- **Rule 1:** No route recommended — this report is a terminus.
- **Rule 2:** Research recommended — `/wf:research` — pass this report's Summary and Contributing
  Factors in as the free-text topic argument.
- **Rule 3:** Charter recommended — `/wf:charter` — pass this report's Summary and Contributing
  Factors in as the free-text feature-idea argument.
- **Rule 4:** Spec recommended — file a work item from this report (a tracker issue, or a local task
  when no tracker is registered), then run `/wf:spec <id>` against it — never `/wf:spec` taking this
  report directly.

Every hypothesis listed above stays listed regardless of which rule fired; a hypothesis beside a
confirmed factor never changes the route.

---

POSTMORTEM — written

Report:   {task-root}/PM<NNN>__<slug>/report.md
Scope:    description="<resolved, redacted>" · skill=<name|unscoped> · folder/repo=<resolved|not named|<name> — unresolved> · cap=<override|default, not yet enforced> · session-scope=<current workspace only|<resolved project path>>
Sessions: <n> named · <r> resolved · <u> unresolved | <n> located
Window:   <30-day cutoff, stated on every located run | n/a — named-session run>
Coverage: <path>=<read|read in part (<reason>)|skipped (reader error: <reason>)|skipped (access denied)> [model=<id|not dispatched> tier=<requested|host-fallback (<reason>)|n/a>] [hunt-session] · …
Finding:  <one line — what was found | not found>
Next:     <none — terminus | /wf:research — <framing> | /wf:charter — <framing> | file a work item from this report, then /wf:spec <id>>
```

## Filling rules

- **Verbatim echo, no paraphrase.** Every resolved value in the Scope section is stated exactly as
  resolved (after the redacting write path has run over it) — never summarized, never reworded.
- **State the default, not just the value.** When a value was defaulted rather than named in the
  prompt, say so explicitly (e.g. `"unscoped"`, `"current workspace only"`, `"default, not yet
  enforced"`) — a reader must be able to tell an explicit choice from a default.
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
  Evidence Record, and marked `stated` or `resting on an open choice` — that marker is one of
  Recommendation's four load-bearing inputs. **Recommendation states the rule that fired and the
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
- **Coverage carries each resolved-or-located record exactly once** under one of the four verdicts,
  with the model that reader ran on, whether that was the requested cheaper tier or the host-tier
  fallback (with its reason), and — on a located run — the 30-day window's own cutoff and a
  hunt-session label where one applies. A windowed session appears once, not once per window.
- **A "not found" report is a complete report.** Summary says so plainly, and Scope and Coverage are
  filled exactly as they would be for a hunt that found something. No match is ever fabricated to
  avoid an empty Summary.
- **The final-output block is part of the file**, not just chat output — a downstream reader of the
  report file sees the same `POSTMORTEM — written` block this skill prints to chat.
