# postmortem coverage cross-check and gated fallback evidence

Runtime-read reference for `SKILL.md` Phase 3.5 step 7.5 — obtained via `resolve_content({
workspaceRoot, ... })` (`class: references-template`, `plugin: wf-postmortem`, `skill: postmortem`,
`ref: coverage-cross-check.md`) at the start of step 7.5, never read at boot. This is the full,
behavior-bearing procedure `SKILL.md` points to rather than restates inline, per this repo's
skill-body-length budget; it is followed exactly, not merely consulted for background.

Two separable jobs sit in this one step, deliberately kept apart: **(A)** an always-run cross-check
that draws no evidence of its own, and **(B)** a trigger-gated draw of corroborating — never
confirming — evidence from sources outside a session record. Running (A) unconditionally on every
hunt, whether or not (B) ever fires, is the point: a report's coverage statement should say what it
could not see even when every finding it holds is already well evidenced.

## Part A: the coverage cross-check (always runs, draws no evidence)

**0. Fix the enumeration root — both sides must describe the same project.** The located session set
is scoped to whichever project the hunt named: the current workspace by default, or a named
`--folder`/`--repo` target's own session store (`locator.md` §3). Part A's candidates must come from
that **same** project, never from the current workspace while the sessions came from another one — a
cross-project comparison would flood "Runs with no session record" with this project's own unrelated
runs and hide the named target's real gaps. So:

- **No `--folder`/`--repo` named** (the ordinary case) — the enumeration root is the current
  `workspaceRoot`; steps 1 and 2 run in full.
- **A `--folder`/`--repo` target was named and resolved** (`SKILL.md` Phase 1) — the enumeration root
  is that resolved absolute path. Step 1 enumerates `{task-root}` **under that path**, not under
  `workspaceRoot`. Step 2's delivery read cannot follow: `resolve_provider` resolves the delivery
  surface for the invocation's own `workspaceRoot` and takes no other root, so delivery history for a
  named target is not readable from here. Take step 2's degrade-to-empty branch, with `delivery
  history is not readable for a named --folder/--repo target` as its stated Coverage reason. Step 1
  still runs, so the cross-check still runs — it is narrowed, never skipped, and Coverage says which
  root it ran against.
- **Attach-only mode** (one or more `--session` values resolved, `locator.md` §7) — Part A still runs,
  as it does on every hunt; what it finds is the empty set, by construction rather than by exception.
  A named-session hunt is an explicit list of records, not a resolved scope, so there is no in-scope
  run population to enumerate: the candidate set is empty, every step below therefore yields nothing,
  and Part A states that as its own coverage fact — `- none — named-session run: no resolved scope,
  so no in-scope run could be cross-checked`. This is the same shape as any other empty result, and
  it is stated rather than omitted for exactly the reason the whole subsection exists: a reader must
  be able to tell "nothing unmatched" from "nothing looked at". Trigger (b) consequently has no
  candidate to fire on; trigger (a) is unaffected and evaluated normally.

**1. Enumerate candidate task folders.** `Glob` `{task-root}`'s immediate child directories under the
step-0 enumeration root,
excluding `_archive/`, this pack's own `PM<digits>__.../` report folders, and any other folder that
fails the same task-id-shape test `wf:standup` Phase 4 applies (a tracker-shaped id or the local
`T<NNN>` scheme — any folder carrying a 3+-digit run). Take each surviving folder's id from its own
name and its date from its most-recently-modified artifact's mtime (`00_reqs.md`/`01_spec.md`/
`02_plan.md`/`04_verify.md`/`06_qa.md`/`07_qa-report.md`/`index.md` — whichever exists and is
newest). Take its **branch string**, when it has one, from the first `**Branch:**` line any of those
same artifacts carries, read as the literal value on that line with surrounding backticks stripped —
the line `wf:verify-spec` and `wf:verify-fix` already write into their own reports. A folder whose
artifacts carry no such line simply has no branch string; that is ordinary, never an error, and the
id comparison still runs for it. A folder outside the hunt's resolved scope or the 30-day window is
not a candidate at all — it never reaches matching (below) and never appears in "Runs with no session
record."

**2. Enumerate delivery history.** Resolve the `delivery` surface once (`resolve_provider({
workspaceRoot, surface: "delivery" })`) and invoke its `activity-read` operation, windowed to at
least 30 days, for both commits and pull requests — mirroring `wf:standup` Phase 2's own
degrade-to-empty discipline exactly: `state: unconfigured`/`unrecoverable`, or a mid-run read
failure, is never a stop. On either outcome, proceed over task folders alone and state in Coverage
that delivery history was unreachable, with the reason (`no delivery provider registered`, the read's
own failure reason, or step 0's `delivery history is not readable for a named --folder/--repo
target`). Take each returned entry's id from its commit subject or PR title's first 3+-digit run —
the same extraction convention `plugins/wf/skills/spec/SKILL.md`'s Validation section already uses
for id matching elsewhere in this codebase — **and its date from the entry's own timestamp** (a
commit's `timestamp`, a pull request's `updated-at`; both are already in `activity-read`'s return
shape, `plugins/wf/skills/standup/SKILL.md:56`). The date is captured for **every** entry, including
one whose text yields no id: without it an id-less entry could never match any session under any
tier and would always land in "Runs with no session record" even when it plainly correlates by date.

**3. Match.** For a candidate (a task folder or a delivery entry) and a session (from Phase 3.5's
located/read set, each now carrying the locator's `Branch:` fact per `locator.md` §8) — this pack's
data contract carries no session-side task-id field (`agents/session-reader.md`'s Output block has
none), so every comparison below runs through the branch fact, the one identity `locator.md` §1/§8
actually surfaces:

- **`mechanically-observed`** — the candidate's extracted id equals the first 3+-digit run of the
  session's `Branch:` value, **or** the candidate's own extracted branch string and the session's
  `Branch:` value are identical (case-sensitive, exact). Either equality is sufficient. **Which of
  the two is even attempted depends on the candidate kind, and this is stated rather than left
  implicit:** a task folder supplies both an id and — when step 1 found one — a branch string, so both
  comparisons run for it; a delivery entry supplies an id and a date only, because `activity-read`'s
  return shape carries no branch field at all (`plugins/wf/skills/standup/SKILL.md:56`), so only the
  id comparison ever runs for one. A comparison whose input one side does not supply is simply not
  attempted — never scored as a failed comparison, which would wrongly bar the `inferred` tier below.
- **`inferred`** — only when **neither** comparison above could be attempted (the session's `Branch:`
  is `none observed`, or the candidate supplied neither an id nor a branch string of its own), a
  same-calendar-day match between the candidate's date and the session's own date is the sole
  fallback. Never applied when either comparison could have been attempted on both sides, even if it
  found no match — a failed identity comparison is a genuine non-match, not grounds to fall back to
  dates.

A candidate matching **any** session under either tier is covered — it contributes nothing further
to this step. A candidate matching **no** session is unmatched.

**4. Extend Coverage with "Runs with no session record."** List every unmatched, in-scope, in-window
candidate — task folder or delivery entry — under a new Coverage subsection distinct from, and
additional to, the existing "Sessions this hunt cannot see" list (the read-cap/aged-out list this
pack's earlier read-cap slice introduced). Each entry states the key attempted — the candidate's own
extracted task id, compared against each located session's `Branch:` fact, or `date only` when the
candidate had no extractable id and only the date tier was available — and, when relevant, the
delivery-history reason from step 2 as its own line. When step 0 narrowed the enumeration (a named
`--folder`/`--repo` target, or attach-only mode), the subsection states which root it ran against, or
its `n/a` reason, so a reader never mistakes a narrowed cross-check for an exhaustive one. This
subsection renders even when empty (`- none`) and even when Part B never fires — it is a coverage
fact, not a symptom of a thin finding.

This cross-check **draws no evidence, promotes no factor, and confirms nothing** — it only names
which in-scope runs have no matching session. Everything past this point belongs to Part B.

## Part B: gate and draw fallback evidence

**Trigger (a) — under-evidenced finding.** A given finding (one mechanism/hypothesis this hunt is
weighing) has Contributing Factors → Confirmed empty for it, **and** no in-scope session remains
`skipped (budget)` (Phase 3.5 step 2.5's cap-split verdict). The budget clause is deliberate: while a
capped hunt still has in-scope sessions it has not yet read, the honest remedy is reading them, not
reaching for a weaker source — see the capped-hunt rule below. Sourcing (below) draws corroborating
material for the mechanism this existing hypothesis already names.

**Trigger (b) — no-session-record run.** Part A names an in-scope, in-window task folder or delivery
entry that carries no matching session — by construction, since no session was ever read for it, no
existing hypothesis in this report is already tied to it (a hypothesis's only provenance is a session
locator or "no locator"; nothing ties one to an unread run). Trigger (b) therefore does not attach to
a pre-existing finding — it draws fallback evidence **about that specific unmatched candidate** and
either (i) files it as corroborating/disconfirming material alongside an existing hypothesis when the
drawn text plausibly describes the same mechanism that hypothesis already names, or (ii), the ordinary
case, enters it as its **own** new Hypotheses entry — mechanism described from the fallback text,
"suggested from" the candidate's own path (task folder or delivery entry, not a session locator),
"why not promoted": "fallback evidence only — trigger (b): matched run left no session record". This
reading is exactly Success Criterion 4's own wording: evidence *for that run*, drawn independently of
whether some other finding in the report is confirmed — never evidence manufactured for a finding the
cross-check has no way to have already produced. Trigger (b) fires once per unmatched candidate,
regardless of budget state — a run that left no session behind will never be helped by reading more
sessions, so the capped-hunt suppression below does not apply to it.

**Capped-hunt suppression.** While **any** in-scope session for this hunt remains `skipped (budget)`,
trigger (a) does not fire for any finding — state in Recommendation/Summary that a follow-up should
read those sessions first, and draw no fallback evidence on trigger (a) alone this run. Trigger (b)
is never suppressed by budget state.

**Sourcing, when a trigger fires.** Draw additional Evidence Record / Contributing Factors →
Hypotheses entries from:

- the matched (trigger (a): the task folder that matches the hypothesis's own session locator under
  Part A step 3's own rule, applied unchanged — never a looser one improvised here; trigger (b): the
  unmatched candidate itself) task folder's own artifacts — read directly in this skill's own context
  (Safety Rules Allowed; neither a session nor a subagent record);
- `_local/fleet/scoreboard.md`, when present;
- a project-configured eval-log path, read only when `_local/config.md` names one under this
  project's own `postmortem` config section (e.g. an `**Eval Log Path:**` line) — absent today in
  every project this pack ships against, so this source contributes nothing until a project adds
  that key; never an error, never a placeholder path. **When the key is present but the path cannot
  be read** (it does not exist, has moved, or the read is denied), that is not a stop either and not
  the same silence as an absent key: this source contributes nothing and Coverage states
  `eval log unreadable — <the reason>` on its own line, so a project that configured the key learns
  its configuration is stale instead of reading a quietly thinner report;
- the matched delivery entry's own commit/PR text, when Part A matched one.

Redact every value pulled from any of these sources through the existing redacting write path
(`redaction.md`) exactly as a reader's or fetcher's own return block is redacted, then neutralize
markdown structure in it exactly as `SKILL.md` Phase 4 step 2 neutralizes every other composed field,
before it reaches Evidence Record/Hypotheses or disk. The same two-stage write path also covers the
"Runs with no session record" Coverage line's own text (Part A step 4) — its leading identifier is
mechanically extracted from the same untrusted candidate sources, not authored, but the write path
draws no distinction. Label each fallback-evidence entry **`fallback evidence`**, tiered `inferred` by
default, or `mechanically-observed` only when the source itself is a deterministic count (e.g. a
`04_verify.md` file's own recorded PASS/FAIL tally) rather than free text.

**What fallback evidence never does.** It never confirms a factor and never raises the
confirmed-factor count Phase 3.5 step 8's routing rules read — that count changes only through the
two-sided check (`version-resolution.md`). A mechanism a fallback-evidence entry supports is entered
under Contributing Factors → Hypotheses, stating the gating trigger ((a) or (b)) as its own "why not
promoted," and stays there even when it is the only support a finding has. It **may** still change
which of step 8's four routing rules fires, since the hypothesis count is one of that rule's four
inputs — fallback-evidence-supported hypotheses count exactly like any other hypothesis for routing,
even though they can never become a confirmed factor themselves.

## Follow-up behaviour

On a `--report <path>` follow-up, this whole step reruns fresh over the freshly re-located scope
(`continuation.md` Part B already re-locates before this step runs): Part A's enumeration, matching,
and "Runs with no session record" list are all rewritten from scratch — never patched incrementally.
Fallback evidence already written into a prior run's report is **kept**, still labelled `fallback
evidence`, and is never re-drawn or duplicated for a finding this run's own two-sided check now
confirms from sessions alone. The first run a finding is confirmed that way, append a dated note
beside its existing fallback-evidence entries (in the Continuation entry `continuation.md` Part D
composes) recording that the finding is now confirmed and no further fallback evidence is drawn for
it. No fallback evidence is ever deleted or unlabelled — the note supersedes it in the reader's
attention, not in the record.

**Every fallback-evidence draw is deduplicated across follow-ups before it is written — the one
exemption to "rewritten from scratch" above, and it covers both triggers and all three dispositions.**
Part A's own enumeration and matching are still recomputed fresh every run — that is never skipped,
and "Runs with no session record" is re-listed in full every run regardless of what follows, because
that list is a coverage fact and not a symptom of a draw. What is deduplicated is only the **written
fallback-evidence entry**. Before writing any such entry, compute its **draw key** and check whether
the report already carries a `fallback evidence` entry with that same key, compared exactly as
strings:

| Disposition | Draw key |
|---|---|
| Trigger (b), case (ii) — a new Hypotheses entry for an unmatched candidate | that candidate's own path/id, as its "suggested from" states it |
| Trigger (b), case (i) — corroborating/disconfirming material filed against an **existing** hypothesis | that candidate's own path/id, as the Evidence Record line's `locator:` states it, paired with that hypothesis's own mechanism line |
| Trigger (a) — corroborating material for a hypothesis that stays unconfirmed | that hypothesis's own mechanism line, paired with the source the material was drawn from (task-folder path, `_local/fleet/scoreboard.md`, the configured eval-log path, or the delivery-entry id) |

**Already present** → keep the existing entry unchanged and draw nothing further for that key this
run. **Not present** → draw it fresh, exactly as on a first run. Without this, a candidate that stays
unmatched, or a hypothesis that never gets confirmed, accumulates a duplicate entry from the same
deterministic sources on every unrelated follow-up — the identical hazard for all three dispositions,
so the guard is stated once over all three rather than for whichever one was noticed first. This
honors the "one hunt, one report" constraint the same way Part C's upsert already does for
session-sourced entries. A dedup hit is silent: it is neither a finding nor a coverage entry, because
the entry it would have duplicated is already in the report saying the same thing.
