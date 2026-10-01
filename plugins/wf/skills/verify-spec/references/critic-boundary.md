# The critic boundary — critic request and verdict exchange

The declared **critic boundary** is the point in `/wf:verify-spec` §"Confirm candidate blocking
findings" where the critic would be dispatched. Under `--review-boundary <dir>` the verifying agent
never dispatches the critic and never runs it in its own context: it **consumes** a verdict the
caller already recorded for this request identity, or **hands back** with a critic request and
resumes **in place** once the caller has recorded one. A consumed, well-formed verdict is an
**independent** critic run. This is the second user of the generic hand-back
(`invocation-runtime.ops.md` §"Resolver call root", **Caller cannot await children**, rule (b)).

## Contents

- [When the boundary applies](#when-the-boundary-applies)
- [Request identity and exchange](#request-identity-and-exchange)
- [Hand back — the critic request](#hand-back--the-critic-request)
- [Resume in place](#resume-in-place)
- [A fresh invocation](#a-fresh-invocation)
- [Consume — the manifest and the verdict](#consume--the-manifest-and-the-verdict)
- [What a dispatcher records](#what-a-dispatcher-records)

## When the boundary applies

All four hold, or the critic pass runs exactly as it would without the flag:

1. `--review-boundary <dir>` was passed, `<dir>` absolute.
2. The candidate set is non-empty.
3. The run is not a drift-mode re-verify.
4. The `verify:critic` routing call returned no `stop`, no `diagnostic`, and shape `isolated` —
   a routing halt still fail-closes the batch before any hand-back.

Record the edge's compact operational record as `handed back — critic boundary` beside the selected
shape.

## Request identity and exchange

Three halves, all required:

- `<T>` — the audited tree's content identity, as on `**Certified:**` (`certified-commit.ops.md`).
- `<N>` — this run's round.
- `<C>` — the candidate-set digest: the lowercase hex sha256 of the candidates' fingerprints,
  sorted bytewise and joined with one newline, no trailing newline.

The exchange folder is `<dir>/<T>/r<N>/critic/`, beside the lens blocks of the same request. The
verifying agent only **reads** it.

## Hand back — the critic request

No record for this request (§"Consume" says exactly when) → write `04_critic-request.md` in the
task folder (overwriting any earlier one), write **no** `04_verify.md`, rotate nothing, record no
receipt and no index row — so no gate artifact's bytes change across the yield — and end the turn
with the block below as the very last thing output. Keep every audit result of this run in
context: the run is suspended, not ended.

```
# Critic request — {task-id}

**Tree:** <T>
**Commit:** <HEAD SHA>
**Round:** <N>
**Candidates:** <C>
**Workspace:** <absolute workspace root of the verifying agent>
**Execution root:** <the same absolute path — the dispatcher runs the unit from this directory>
**Exchange:** <dir>/<T>/r<N>/critic/
**Requested by:** <model identifier>
**Requested at:** <ISO 8601 timestamp>

## Unit critic

**Agent:** wf:critic
**Unit:** verify:critic

~~~text
<the exact critic-verdict.md §"Dispatch prompt" this agent would have sent, every cited path
workspace-relative>
~~~
```

```
VERIFY — Handed-off

{task-id}: critic boundary reached — <k> candidate(s) requested
Request: <task-folder>/04_critic-request.md
Exchange: <dir>/<T>/r<N>/critic/
Resume: in place — continue this run once the caller records the verdict
Next: /wf:verify-spec {task-id} --review-boundary <dir>   (only if this run's context is lost)
```

Every cited path in the prompt is relative to `**Workspace:**`; an absolute citation is rewritten
relative before the request is written. The critic derives its root from its own working
directory, so a dispatcher that cannot run it from `**Execution root:**` records it failed.

## Resume in place

On the caller's continuation, the same run picks up at its critic step: it validates and consumes
the record (§"Consume") and continues with §"The blocking set" — no requirement, lens, lean-pass or
aggregation step is repeated, and the request file is not read back. A continuation that finds no
matching record fail-closes the batch `not run — hand-back unrecorded`; it never hands back twice.

## A fresh invocation

A run that did not hand back itself (a fresh agent, a lost context, a re-invoked caller) never
restores audit state from `04_critic-request.md` — recovery from it is unproven. It re-audits from
the top and, at the critic step, computes its own `<C>`:

| Exchange and task folder | Outcome |
|---|---|
| Manifest for `<T>`/`<N>`/`<C>` | consume (§"Consume") |
| Manifest or request for `<T>`/`<N>` carrying a different `**Candidates:**` | fail-close, `not run — candidate set changed since the hand-back` |
| Request for `<T>`/`<N>`/`<C>`, no manifest yet | hand back again (§"Hand back"), overwriting the request — the dispatcher's detect-first check keeps the critic to one dispatch per request |
| No manifest and no request for `<T>`/`<N>` | hand back (§"Hand back") |

## Consume — the manifest and the verdict

The record is this request's only when `<dir>/<T>/r<N>/critic/manifest.md` exists and its
`**Tree:**`, `**Round:**` and `**Candidates:**` equal this run's `<T>`, `<N>`, `<C>`.

| Manifest says | File | Batch outcome |
|---|---|---|
| `returned` | `critic.md` readable, a well-formed `CRITIC —` block per `critic-verdict.md` §"Parsing contract" | **ran — independent, via hand-back**: apply each verdict exactly as for a Task return |
| `returned` | missing, unreadable, or malformed | fail-close, `not run — malformed verdict` |
| `failed — <reason>` | — | fail-close, `not run — <reason>` |
| unparseable | — | fail-close, `not run — manifest unreadable` |

A fail-closed batch keeps every candidate blocking (`critic-verdict.md` §"Malformed or failed
dispatch"). The verdict is never re-dispatched or run inline here.

## What a dispatcher records

The caller dispatches the unit as **its own** isolated child — `**Agent:**` token and fenced prompt
verbatim — from `**Execution root:**` as its working directory, then writes into `**Exchange:**`:

- `critic.md` — the child's `CRITIC —` block verbatim, only when it returned one;
- `manifest.md` **last**:

```
# Critic verdict — {task-id}

**Tree:** <T>
**Round:** <N>
**Candidates:** <C>
**Recorded by:** <model identifier>
**Recorded at:** <ISO 8601 timestamp>

| Unit | Agent | Outcome | File |
|------|-------|---------|------|
| critic | wf:critic | returned | critic.md |
```

`Outcome` is `failed — <one-line reason>` (file `—`) when the child errored, returned `NO INPUT`, or
returned no `CRITIC —` block, or when the execution root could not be reached. The three identity
lines are copied verbatim from the request. The dispatcher never writes a verdict of its own.
