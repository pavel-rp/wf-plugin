# postmortem fix direction and rule-based recommendation

Runtime-read reference for `SKILL.md` Phase 3.5 step 8 — obtained via `resolve_content({
workspaceRoot, ... })` (`class: references-template`, `plugin: wf-postmortem`, `skill: postmortem`,
`ref: recommendation.md`) at the start of step 8, never read at boot. This is the full, behavior-
bearing procedure `SKILL.md` points to rather than restates inline, per this repo's skill-body-length
budget; it is followed exactly, not merely consulted for background.

Both halves below are read strictly from **this run's own composed report fields** — the confirmed
factors and hypotheses step 6/7 already produced — never from a session record directly, and never
recomputed against anything outside this report. Nothing here dispatches, invokes, or files any work
item; naming a next command is the entire job. A `--report` follow-up recomputes this by re-running
this same procedure over the accumulated report fields (`continuation.md` Part C) — no new rule, no
new field, just a fresh pass over a larger input.

## Part A: the Fix Direction section and its marker

**When no factor was confirmed this run** (Contributing Factors → Confirmed is empty): Fix Direction
states plainly "No factor confirmed this run — a fix direction follows a confirmed contributing
factor; none exists this run," and its marker is the literal `— (no confirmed factor)` — not
`stated`, and not `resting on an open choice`. This is the only marker value this branch may take,
and it is what makes rule 2 below fire on "no confirmed factor" without a separate check.

**When at least one factor was confirmed this run:** compose one short paragraph naming the concrete
change the confirmed mechanism (its Component and Version, `file:line`) points at — grounded in that
factor's own text, never invented — then mark it:

- **`stated`** — the confirmed mechanism names, or directly implies, exactly one remedy: a single
  file, a single change shape (e.g. "add the missing null check", "correct the off-by-one at
  `file:line`"), with no second reasonable way to address the same mechanism visible in the evidence
  this report holds.
- **`resting on an open choice`** — stating the fix would require picking between two or more
  materially different remedies (e.g. "fix the caller's assumption or loosen the callee's contract —
  either resolves the observed mismatch, and this report's evidence does not by itself say which one
  owns the invariant"), or the confirmed evidence pins down *that* something is wrong without pinning
  down *which* specific change corrects it. Name the choice being deferred — never pick one silently
  on the report's behalf, and never soften this to `stated` because a choice merely feels minor.

Multiple confirmed factors compose one Fix Direction covering all of them; if any one of them rests
on an open choice, the section's overall marker is `resting on an open choice` — a single open choice
among several factors still leaves the overall direction undecided.

Keep this section apart from the Evidence Record: Evidence Record is a record of what was observed,
this section is what to do about it, and the two are never merged into one paragraph.

## Part B: the four routing rules, first match fires

Evaluate in this fixed order, over exactly four inputs — the confirmed-factor count, the hypothesis
count, the Localisation file/contract list (each distinct skill or contract counted once — a skill
plus a contract is two, two files in the same skill is one), and Part A's marker — and nothing else.
Stop at the first rule that matches:

1. **No confirmed factor and no hypothesis** ("not found" — Contributing Factors → Confirmed empty,
   and Hypotheses empty). Recommendation: no route. The report is a terminus.

   **This rule is deliberately narrower than it looks, and the narrowing is stated rather than
   discovered.** A fallback-evidence hypothesis counts here exactly like any other — the spec is
   explicit that a hypothesis fallback evidence supports "counts as any other hypothesis in routing"
   — and the coverage cross-check's trigger (b) enters one for **every** in-scope run that left no
   session record (`coverage-cross-check.md`). Any actively-developed project usually has at least
   one such run, so on a default-scoped hunt Hypotheses is rarely empty and **rule 1 usually does not
   fire even when the described failure genuinely matched nothing**; rule 2 (research) fires instead,
   carrying those hypotheses as its topic. Rule 1 remains reachable — a narrowly scoped hunt, or one
   whose every in-scope run did leave a matching session, still reaches it — but a "not found"
   Summary and a terminus recommendation are **not** the same claim and do not imply each other. The
   Summary is what states "not found"; this rule states only whether there is anywhere left to route.
2. **No confirmed factor, or Part A's marker is `resting on an open choice`.** Recommendation:
   research — `/wf:research`, with this report's Summary and Contributing Factors going in as the
   free-text topic argument. This rule fires even when one or more hypotheses exist (the "only
   hypotheses" case) and even when a factor *was* confirmed but its fix direction could not be stated
   outright.
3. **Two or more confirmed factors, or the Localisation list names files in more than one distinct
   skill or contract.** Recommendation: charter — `/wf:charter`, with this report's Summary and
   Contributing Factors going in as the free-text feature-idea argument. Counting rule: reduce every
   confirmed factor's `file:line` to its owning skill folder or contract file, dedupe, and count the
   distinct set — one skill plus one contract is two; two files inside the same skill is one.
4. **Otherwise** — exactly one confirmed factor, its Localisation within one skill or contract, and
   Part A's marker is `stated`. Recommendation: spec. `/wf:spec` takes only a task id, never this
   report, so the hand-off is two-part: file a work item from this report (a tracker issue when a
   tracker is registered, otherwise a local task), then run `/wf:spec <id>` against it. State both
   halves — naming only `/wf:spec <id>` without the filing step is an incomplete hand-off.

A hypothesis listed beside a confirmed factor stays in the report exactly as composed in step 7 and
never changes which rule fires — only the confirmed-factor count, the Localisation list, and Part A's
marker are load-bearing for rule selection. Rule 1 is the only rule the hypothesis count actually
gates (its presence is what distinguishes "not found" from a hunt that surfaced only hypotheses,
which is rule 2's territory).

**Reproducibility.** Given only the confirmed-factor count, the hypothesis count, the Localisation
file/contract list, and the Fix Direction marker, the fired rule and its hand-off are fully
determined — no other field of the report ever changes which rule fires. This is what makes the
recommendation checkable independently of the prose that explains it.

## Rendering into the report and the Final Output block

`SKILL.md` Phase 4 mirrors the fired rule onto the `POSTMORTEM — written` block's `Next:` line
exactly as the Recommendation section states it:

- Rule 1 → `Next:     none — terminus`
- Rule 2 → `Next:     /wf:research — <the one-line framing from Recommendation>`
- Rule 3 → `Next:     /wf:charter — <the one-line framing from Recommendation>`
- Rule 4 → `Next:     file a work item from this report, then /wf:spec <id>`

Never dispatch, invoke, or pre-fill any of these commands — naming the exact next step is the whole
job; running it, or filing the work item on the spec route, is the maintainer's own act. A `--report`
follow-up restates the fired rule here fresh, over the full accumulated report (`continuation.md` Part
C/D) — mirrored into the Continuation entry when it differs from the rule the prior write fired.
