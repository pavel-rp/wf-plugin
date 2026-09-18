# postmortem report template

Runtime-read only on the write path (Phase 4 of `SKILL.md`) — never read at boot. The verbatim
shape every `{task-root}/PM<NNN>__<slug>/report.md` follows, in this section order.

Summary, Scope, the Hypotheses half of Contributing Factors, Evidence Record, Measured Effect and
Coverage are **filled from the reader return blocks** this release collects. The four that remain —
Component and Version, Localisation, Fix Direction, Recommendation — state their own reason
explicitly, verbatim, rather than being omitted: a reader must be able to tell "not produced yet"
from "produced and empty."

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

Not yet produced — component and version attribution needs a checked session locator and executed-version
resolution against skill/contract/manifest text (arrives with a later charter sub-task).

## Contributing Factors

**Confirmed factors:** none — this release confirms no mechanism. Confirming a factor needs two-sided
verification against the executed-version source text and a checked session locator, which arrives
with a later charter sub-task. Every mechanism below is a hypothesis, never a confirmed factor.

### Hypotheses

<One entry per mechanism any reader suggested, merged across sessions. Each states the mechanism in
one line and names the session locator(s) that prompted it. A hypothesis is never promoted here, and
the absence of confirmed factors above is not a defect of this report — it is this release's honest
limit.>

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

Not yet produced — file-level localisation needs a confirmed contributing factor (arrives with a
later charter sub-task).

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
- `<session path>` — skipped (reader error: <reason>)
- `<session path>` — skipped (access denied)

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
Coverage: <path>=<read|read in part (<reason>)|skipped (reader error)|skipped (access denied)> [model=<id> tier=<requested|host-fallback (<reason>)>] · …
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
- **Every non-filled section states its own reason** for not being filled yet, naming which later
  charter sub-task fills it — this is not boilerplate, it is the honest gap the charter's staged
  delivery produces. Four sections remain unfilled in this release: Component and Version,
  Localisation, Fix Direction, and Recommendation.
- **Evidence Record quotes are already redacted** when they arrive — each reader applied the shared
  shape rules before its block left isolation — and the write path applies them again as the disk
  backstop. Quote short excerpts only; never a region of a record.
- **Both evidence halves are mandatory.** Supporting and disconfirming each get their heading, and an
  empty one reads `- none`. Dropping the disconfirming half would hide exactly the evidence the
  reader contract goes out of its way to collect.
- **Every count is labelled `reader-counted` at the `unverified` tier.** No count in this release was
  produced deterministically, so none may be presented as mechanically observed. No token or monetary
  figure appears anywhere in the report.
- **Every mechanism is a hypothesis.** This release confirms nothing; a reader's suggestion never
  appears as a confirmed factor.
- **Coverage carries each resolved record exactly once** under one of the four verdicts, with the
  model that reader ran on and whether that was the requested cheaper tier or the host-tier fallback
  (with its reason). A windowed session appears once, not once per window.
- **A "not found" report is a complete report.** Summary says so plainly, and Scope and Coverage are
  filled exactly as they would be for a hunt that found something. No match is ever fabricated to
  avoid an empty Summary.
- **The final-output block is part of the file**, not just chat output — a downstream reader of the
  report file sees the same `POSTMORTEM — written` block this skill prints to chat.
