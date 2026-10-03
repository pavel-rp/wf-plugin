# The review boundary — lens request and lens-block exchange

The declared **review boundary** is the point in `/wf:verify-spec` §"Fire the `verify` phase"
where the enabled `subagent:` rows of the `verify`/`finding` contribution would be dispatched. A
caller that owns lens dispatch for this run passes `--review-boundary <dir>`; the verifying agent
then never dispatches those rows itself and never runs their rubrics in its own context. It either
**consumes** blocks the caller already recorded for this run's request identity — the audited tree
`<T>` **and** the round `<N>` (§"The exchange folder"), so a same-tree block from another round is
never reused — or **hands back** with a lens request. Core names no capability, lens, or agent here:
every row comes from the resolved registry.

## Contents

- [When the boundary applies](#when-the-boundary-applies)
- [The exchange folder](#the-exchange-folder)
- [Hand back — the lens request](#hand-back--the-lens-request)
- [Consume — the manifest and the blocks](#consume--the-manifest-and-the-blocks)
- [What a dispatcher records](#what-a-dispatcher-records)

## When the boundary applies

All three hold, or the run proceeds exactly as it would without the flag:

1. `--review-boundary <dir>` was passed, `<dir>` absolute.
2. At least one `verify`/`finding` row with a `subagent:` dispatch is **enabled** after the
   contributor gate. `inline:` rows never cross the boundary — they are followed in-context as
   always. An empty registry, or every subagent row gated off, means no boundary work at all and a
   `0/0`-style count exactly as today.
3. The run is not a drift-mode re-verify (`certified-commit.ops.md` §"Drift-mode audit"); a drift
   re-verify dispatches its rows in-agent as always.

Each enabled subagent row is identified by its **role** — the final colon-delimited slug of its
dispatch token, the same derivation the routing call already uses — and its `unitIds` entry
`verify:<source-capability>:<role>`.

## The exchange folder

`<dir>/<T>/r<N>/` — the **request identity**, two halves:

- `<T>` is the content identity of the audited tree — the value this run would write on its
  `**Certified:**` line (`certified-commit.ops.md` §"Certification record"). It keeps a block
  recorded for one tree from ever being consumed for another: a changed tree has no folder yet, so
  it hands back again.
- `<N>` is this run's round — the value it writes on the request's `**Round:**` line, a run of
  decimal digits. The request and its prompts are round-sensitive (the Round context block at
  `N >= 2`), so a later round on an **unchanged** tree must never consume an earlier round's blocks;
  it looks under its own `r<N>/`, finds no record, and hands back again.

The verifying agent only **reads** the exchange folder; it never writes there.

## Hand back — the lens request

No manifest for this request (§"Consume — the manifest and the blocks" names exactly when) → the
verifying agent writes the request into its own task folder as
`04_lens-request.md` (overwriting any earlier one), writes **no** `04_verify.md`, rotates nothing,
records no receipt, and ends with the `VERIFY — Handed-off` block. The request carries everything a
dispatcher needs and nothing it must infer:

```
# Lens request — {task-id}

**Tree:** <T>
**Commit:** <HEAD SHA>
**Round:** <N>
**Workspace:** <absolute workspace root of the verifying agent>
**Exchange:** <dir>/<T>/r<N>/
**Requested by:** <model identifier>
**Requested at:** <ISO 8601 timestamp>

## Row <role>

**Capability:** <source capability>
**Agent:** <the row's subagent dispatch token, verbatim>
**Unit:** verify:<source-capability>:<role>

~~~text
<the exact dispatch prompt this agent would have sent the row's Agent>
~~~
```

The run then ends with this block as the very last thing output (in place of `VERIFY — <verdict>`):

```
VERIFY — Handed-off

{task-id}: review boundary reached — <e> lens row(s) requested
Request: <task-folder>/04_lens-request.md
Exchange: <dir>/<T>/r<N>/
Next: /wf:verify-spec {task-id} --review-boundary <dir>   (after the caller records the requested blocks)
```

One `## Row` section per enabled subagent row, in registry order. The prompt is assembled exactly
as §"Fire the `verify` phase" assembles it — the artifact under audit, the Round context block at
`N >= 2`, and the inlined finding contract, under the same reviewer-prompt allowlist — plus one
leading line naming `**Workspace:**` as the absolute root every relative path in the prompt resolves
against, because the dispatcher runs in a different workspace.

## Consume — the manifest and the blocks

**Validate the binding first.** The manifest is this request's record only when
`<dir>/<T>/r<N>/manifest.md` is present **and** its `**Tree:**` equals this run's `<T>` **and** its
`**Round:**` equals this run's `<N>`. Every other case is **no record for this request** — the agent
hands back with a fresh request (§"Hand back — the lens request") and no block in that folder counts
as completed:

| Case | Outcome |
|---|---|
| Same tree, different round — only an earlier round's folder or manifest exists | no record → hand back |
| Changed tree — no folder under the new `<T>` | no record → hand back |
| Manifest present, `**Tree:**` or `**Round:**` missing or not equal to this run's value | no record → hand back |
| Manifest present, `**Tree:**` and `**Round:**` both match | consume, per the table below |

A mismatch is never counted as a row `not completed`: stale blocks carry no claim about this
request, so the honest outcome is to ask again, not to report a gap the current request never had.

Consume a matching manifest: for each enabled subagent row, find the manifest row with the same
role:

| Manifest says | File | Row counts as |
|---|---|---|
| `returned` | readable, and its block is well-formed against the generic finding contract | **completed** — the block is that row's return, validated and aggregated exactly like an Agent return |
| `returned` | missing, unreadable, or malformed | expected, not completed — reason `block unreadable` / `malformed block` |
| `failed — <reason>` | — | expected, not completed — reason as recorded |
| no row for this role | — | expected, not completed — reason `not in manifest` |

A matching manifest whose row table cannot be parsed makes every enabled subagent row `not completed — manifest
unreadable`. A row that did not complete gets a Coverage `Incomplete` entry naming its role and
reason, and its role in the `**Lenses:**` suffix (`verify-template.md` §"Lens count"). It is
**never** re-dispatched and **never** run inline: the boundary exists so its rubric is applied by an
independent child or not at all, and an honest gap beats a self-review counted as a lens.

A manifest role that matches no enabled row is ignored (the gate or registry changed since the
request); the count is always over **this** run's enabled rows.

## What a dispatcher records

The caller that passed the flag dispatches every `## Row` of the request as **its own** isolated
child, with the row's `**Agent:**` token and prompt verbatim, then writes into the request's
`**Exchange:**` folder `<dir>/<T>/r<N>/`:

- one `<role>.md` per row whose child returned, holding the returned block verbatim;
- `manifest.md` **last**, so its presence means the record is complete:

```
# Lens blocks — {task-id}

**Tree:** <T>
**Round:** <N>
**Recorded by:** <model identifier>
**Recorded at:** <ISO 8601 timestamp>

| Role | Agent | Outcome | File |
|------|-------|---------|------|
| <role> | <agent token> | returned | <role>.md |
| <role> | <agent token> | failed — <one-line reason> | — |
```

`**Tree:**` and `**Round:**` are copied verbatim from the request — they are the binding the consume
step validates, so a manifest without both is never consumed.

A child that errors, stalls out, or returns no well-formed `AUDIT-<LENS> — clean|findings` block is
recorded `failed — <reason>`; the dispatcher never substitutes its own reading of the rubric.
