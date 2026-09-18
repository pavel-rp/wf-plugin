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
- **Session scope:** <"current workspace only" | "current workspace plus <named project>">
- **Named session records:** <one line per `--session` value, in the order passed>
  - `<resolved path>` — resolved
  - `<named path>` — unresolved (no matching filesystem path)

## Component and Version

<When at least one factor was confirmed this run: the component (skill/contract/manifest file) and
its resolved version — from the confirmed factor with the strongest tier when more than one exists —
stated as `<component> at <version>` (with the "version approximate (date-resolved)" label carried
verbatim where that branch resolved it). When none was confirmed this run: "No factor confirmed this
run — component and version attribution follows a hypothesis's mechanism being checked two-sided
against the executed-version source text and a checked session locator (Contributing Factors, below);
none passed both sides this run.">

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
Each states the mechanism in one line and names the session locator(s) that prompted it. A promoted
mechanism moves to the confirmed half and is not duplicated here; a hypothesis that failed either
side of the check, or resolved only to `present-day-only` text, stays exactly here at the
`unverified` tier — checking it and not confirming it is not a defect of this report.>

- <mechanism, one line> — suggested from `<locator>`

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

<Counts read from the sessions themselves, one group per session. Every count in this release is
labelled `reader-counted` and carries the `unverified` tier, because a reader counted it by reading
rather than a deterministic counter — the mechanically-observed tier arrives with the locator seam in
a later charter sub-task. No token count and no monetary figure appears here or anywhere in this
report.>

- `<session path>` — iterations: <n | not observable> · edits: <n | not observable> · files touched: <n | not observable> · findings per pass: <n | not observable> — all **reader-counted**, tier **unverified**

## Fix Direction

Not yet produced — fix direction follows from a confirmed contributing factor (arrives with a later
charter sub-task).

## Coverage

<Every resolved named session record, each exactly once, under exactly one verdict. An unresolved
name is not listed here — it appears in Scope instead, because nothing about it was ever read.>

- `<session path>` — read · model: <id> · tier: <requested | host-fallback (<reason>)>
- `<session path>` — read in part (<reason>) · model: <id> · tier: <…>
- `<session path>` — skipped (reader error: <reason>) · model: <id | not dispatched> · tier: <requested | host-fallback (<reason>) | n/a>
- `<session path>` — skipped (access denied) · model: <id | not dispatched> · tier: <requested | host-fallback (<reason>) | n/a>

**Not covered by this release:** locating sessions by scope, the 30-day retention window, the
located-set count, and the per-run read cap — each arrives with a later charter sub-task. This hunt
covered exactly the records named on the command line.

## Recommendation

Not yet produced — the rule-based next-step recommendation is computed from confirmed-factor and
hypothesis counts, neither of which exists yet (arrives with a later charter sub-task).

---

POSTMORTEM — written

Report:   {task-root}/PM<NNN>__<slug>/report.md
Scope:    description="<resolved, redacted>" · skill=<name|unscoped> · folder/repo=<resolved|not named|<name> — unresolved> · cap=<override|default, not yet enforced> · session-scope=<current workspace only|current workspace plus <project>>
Sessions: <n> named · <r> resolved · <u> unresolved
Coverage: <path>=<read|read in part (<reason>)|skipped (reader error: <reason>)|skipped (access denied)> [model=<id> tier=<requested|host-fallback (<reason>)>] · …
Finding:  <one line — what was found | not found>
Next:     none — terminus
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
  Contributing Factors, and Localisation state "none confirmed this run" when no hypothesis passed
  the two-sided check this run — a per-run outcome, since this release can confirm a factor. Fix
  Direction and Recommendation state which later charter sub-task fills them (SUB-5) — a genuine
  per-release gap, not a per-run one. Either way, saying so explicitly is the point: a reader must be
  able to tell "not produced yet" from "produced and empty."
- **Evidence Record quotes are already redacted** when they arrive — each reader applied the shared
  shape rules before its block left isolation — and the write path applies them again as the disk
  backstop. Quote short excerpts only; never a region of a record.
- **Both evidence halves are mandatory.** Supporting and disconfirming each get their heading, and an
  empty one reads `- none`. Dropping the disconfirming half would hide exactly the evidence the
  reader contract goes out of its way to collect.
- **Every count is labelled `reader-counted` at the `unverified` tier.** No count in this release was
  produced deterministically, so none may be presented as mechanically observed. No token or monetary
  figure appears anywhere in the report.
- **A mechanism is promoted only through the two-sided check.** A reader's suggestion becomes a
  confirmed factor only when the source-side text at its resolved executed version and the
  session-side excerpt at its locator both verify (or both verify mechanically, at an exact
  `file:line` and an exact locator) — never on one side alone, and never when the version resolves
  only to `present-day-only` text. Everything else stays a hypothesis at the `unverified` tier.
- **Coverage carries each resolved record exactly once** under one of the four verdicts, with the
  model that reader ran on and whether that was the requested cheaper tier or the host-tier fallback
  (with its reason). A windowed session appears once, not once per window.
- **A "not found" report is a complete report.** Summary says so plainly, and Scope and Coverage are
  filled exactly as they would be for a hunt that found something. No match is ever fabricated to
  avoid an empty Summary.
- **The final-output block is part of the file**, not just chat output — a downstream reader of the
  report file sees the same `POSTMORTEM — written` block this skill prints to chat.
