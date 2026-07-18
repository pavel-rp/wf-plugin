# The scaffolder loop — the shared emit-and-self-lint discipline

**Model:** claude-opus-4-8

The single rule source for every scaffolder in this plugin. It is written over an abstract
**emitted artifact set**, so each scaffolder supplies only two things — its interview questions and
its emission template — and inherits the rest of this procedure unchanged. Reuse it; never fork it.

Runtime-read: behavior-bearing steps, guards, and outcome mappings only.

---

## Stage 1 — Interview, validating each answer before anything is written

Ask the scaffolder's questions one at a time. **Validate every answer the moment it arrives, against
the live rule it is bound to**, before the next question and long before any file exists.

On an answer that cannot produce a valid artifact:

1. State the **rule it violates**, in the rule's own words.
2. State **why this specific answer violates it**.
3. **Re-ask the same question.** Do not silently repair the answer, do not proceed with a
   substitute, and **do not write a file** — a rejected answer produces no emission at all.

Repeat until the answer is valid. An interview that never yields a valid answer ends with no file
written and the violated rule surfaced — that is a clean outcome, not a failure to recover from.

**Never invent an answer the author did not give.** When an answer is needed and absent, ask.

## Stage 2 — Emit complete artifacts, never placeholders

Write the full artifact set from the validated answers.

**The no-placeholder rule is absolute.** No emitted file may contain `TODO`, `FIXME`, `XXX`, a
`<fill this in>` marker, or a section left for the author to complete. Every value comes from an
interview answer or from a rule-derived default the body states explicitly. If a required value is
neither answered nor defaulted, that is a Stage 1 gap — go back and ask, rather than emitting a
placeholder.

Every emitted artifact carries a `**Model:** <current model id>` attribution line, and no emitted
artifact, message, or comment carries an AI-attribution trailer, a "generated with" footer, an emoji,
or a promotional tagline.

## Stage 3 — Self-lint against the same gates CI applies

Run **every applicable check** over the emitted set. Trust only verdict sources the repository's own
gate trusts — the typed validator tools in the bundled resolver runtime, and `glossary-lint.sh`.
Never substitute your own reading of the rules for a check's verdict, and never declare an artifact
clean on a check you did not actually run.

Each typed validator returns the frozen verdict shape
`{ tool, status, target, findings[], ruleSources[], summary }` with three possible statuses. Map each
one explicitly:

| `status` | Meaning | What the loop does |
|---|---|---|
| `pass` | `findings` is empty — the artifact satisfies this check | record the check as clean; continue |
| `fail` | one or more findings, each with `rule`, `severity`, `file`, `line`, `message` | go to Stage 4 |
| `error` | the check could not be run (unreadable rule source, bad target) | **not a pass** — go to Stage 5 |

`error` is never collapsed into either other status. An artifact whose check errored is an artifact
whose conformance is **unknown**, and unknown is never handed back as clean.

The shell lint takes an **explicit file set** — pass exactly the emitted files, since it has no
whole-tree default. A non-zero exit is a finding set; treat a failure to run it at all as `error`.

**Scope honesty.** A check whose scope rules do not match the emitted path skips those files and
passes vacuously. When that happens, say so — report the check as *not applicable to this path*,
never as a clean verdict it did not actually reach.

## Stage 4 — Fix your own findings, then re-run

Findings are the scaffolder's own work to fix, never the author's homework.

For each finding, edit the emitted artifact so the named rule is satisfied — using the finding's
`file`, `line`, and `message` to locate it and the check's `ruleSources` to confirm what the rule
actually requires. Then **re-run the full Stage 3 check set**, not only the check that failed: a fix
can introduce a violation elsewhere.

**Cap the loop at three fix-and-re-run passes.** Bound it so a rule the scaffolder cannot satisfy can
never spin forever. If the set is clean within the cap, go to Stage 6. If any finding survives the
cap, or a fix would require guessing at author intent, go to Stage 5.

Never suppress a finding, never narrow a check's inputs to dodge one, and never edit the rule source
to make a finding disappear.

## Stage 5 — Stop honestly on an unfixable finding

When a finding cannot be fixed within the cap, or a check returned `error`, **stop and surface it**.
Report, per finding: its `rule`, `severity`, `file`, `line`, and `message`, plus the check that
produced it and what was attempted.

Leave the artifact on disk so the author can inspect and finish it, and say plainly that it is
**not clean** and did not pass. Never present it as a delivered result, and never report success
alongside an unresolved finding.

## Stage 6 — Hand back only clean

Reaching this stage means every applicable check returned `pass` on the current bytes of the emitted
set, and the no-placeholder grep came back empty.

Before reporting, run the placeholder grep over the emitted set one final time — it gates the
handback, so it runs against the artifacts as they now stand, after every Stage 4 edit.

Report the emitted paths, each check that ran, and its verdict. The claim being made is narrow and
must be exactly true: *these files, as they stand, pass these named checks.*

## Edge Cases

- **A check's rule source cannot be read:** the verdict is `error`, not `pass` — Stage 5.
- **The emitted path lies outside a check's scope:** report *not applicable*, never clean (Stage 3).
- **A fix satisfies one rule and breaks another:** the full re-run catches it; the cap bounds the
  ping-pong and Stage 5 surfaces it.
- **The author abandons the interview:** nothing was written — report that no artifact was emitted.
- **An artifact already exists at the target path:** stop and ask before overwriting; never
  silently clobber authored work.
