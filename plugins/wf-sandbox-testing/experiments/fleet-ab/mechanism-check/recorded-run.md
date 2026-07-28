# fleet-ab mechanism regression check — recorded run

**Recorded:** 2026-07-28
**Model:** claude-opus-5[1m]
**Checked by:** [`../mechanism-check.sh`](../mechanism-check.sh) over
[`../../engine/mechanism-signals.cli.mjs`](../../engine/mechanism-signals.cli.mjs)
(the CLI entry; [`mechanism-signals.mjs`](../../engine/mechanism-signals.mjs) is import-pure and
self-executes nothing)

**Re-recorded (WF-423)** against the corrected evaluator — one presence predicate, tri-state
`{status, count, basis}` results, whole-path `--out` canonicalization, and a `NOT-MEASURED` row that
cannot render as a `MATCH`. **Re-recorded twice more on review**, as each remaining site that
asserted a negative observation over a partial basis stopped doing so: first the per-arm counts, the
dispatch-presence verdict and the deltas (24 checks → 14), then the summed duplicate count, which
read only the id dimension and so sailed through a basis narrowed on the record-type dimension
(14 → 12). No observed value changed at any point.

The declared C024 mechanism signals in [`../experiment.json`](../experiment.json), evaluated over the
committed per-arm run archives and compared against the committed transcript inventory. **Read-only
over both**: nothing under `results/` was written, and `git status --porcelain` over
`experiments/fleet-ab/results/` was empty before and after.

## Where the evidence lives

The run archives and the inventory that seeds this check were committed on
`chore/WF-382-fleet-ab-measurement` (`3970c1d`) and **were not carried into `main` by that
umbrella's merge** (`c768673`, PR #213, which shipped the kit but not the archives). They are
therefore not resolvable from a `main` checkout, and this check takes their location as arguments
rather than assuming one.

That commit is pinned by the annotated tag **`wf382-oracle`**, pushed to `origin`, and the rows below
cite the tag rather than the branch: a topic branch is deletable, and reaping it would make this
recorded PASS unverifiable. The tag is the durable ref; `chore/WF-382-fleet-ab-measurement` is only
where the work happened.

| Input | Committed at |
|---|---|
| `run-A/transcript.jsonl` · `run-B/transcript.jsonl` | `wf382-oracle:plugins/wf-sandbox-testing/experiments/fleet-ab/results/run-{A,B}/` |
| `transcript-inventory.json` (the oracle) | `wf382-oracle:plugins/wf-sandbox-testing/experiments/fleet-ab/results/` |

Materialize them into a scratch directory (`git show` each blob into `_local/scratch/`; a `git
archive` of the same three paths works equally), then:

```
bash plugins/wf-sandbox-testing/experiments/fleet-ab/mechanism-check.sh \
  --run-a <scratch>/run-A \
  --run-b <scratch>/run-B \
  --inventory <scratch>/transcript-inventory.json \
  --out _local/scratch/fleet-ab-mechanism-check
```

## Result

**12 checks, all matching — 0 mismatches.** Fourteen bindings are reported **SKIP**, and the change
from the original recording of 24/24 is the point of this run rather than a regression: twelve of
those fourteen were previously asserted over evidence that could not carry the assertion.

Three kinds of SKIP appear:

- **Eight negative observations over a partial basis.** `count: 0`, `presence: "absent"` and a
  summed duplicate count of `0` all say "this did not happen", which holds only when every record
  excluded from the basis is one that *could* have been the thing claimed absent. On this data the
  basis is 29 of 38 dispatch records in arm A and 38 of 40 in arm B. **The verdicts were in fact
  sound** — the mute records are `task_type: "local_bash"` task starts, which structurally never
  carry `subagent_type` — but nothing in the evaluator knows that; it just drops them. So the honest
  report is a stated narrowing, not a green check.
- **Four deltas with a narrowed endpoint.** A count over a partial basis is still a valid *lower
  bound*, so a positive one stays interpretable — but a *difference* of two lower bounds is bounded
  in neither direction, whatever its sign. These are skipped whether or not the delta is zero.
- **Two declared signals outside the oracle** — the committed inventory carries no counterpart
  field, so the check claims nothing about them. (One, `wf376_dispatch_model_tier`, is also the
  not-measured signal below; SKIP is a statement about the *oracle*, not about whether the signal
  evaluated.) These two are unchanged from the previous recording.

**No observed value moved, and nothing diverged from the committed inventory.** Every value that is
still checked reproduces its committed counterpart exactly, and the twelve now-skipped bindings had
the same observed values as before — they were right, they were simply not *established* by this
evidence. That distinction is the whole subject of this task: a number can be correct and still be a
false green if the check that blessed it never looked at whether the evidence supported it.

**What would restore the twelve checks** is making the basis genuinely complete rather than relaxing
the rule — letting a manifest declare which record shapes are structurally exempt from a dimension,
so `local_bash` task starts stop counting as records that were "asked and did not answer". That is a
schema change to the frozen predicate vocabulary and is deliberately not made here.

WF-423's spec predicted that fixing the presence predicate would flip `wf374_audit_lens_boots` and
`wf374_gated_off_lens_boots` from a committed `0` to not-measured, on the theory that their zero was
itself an artifact of the defect. **It is not** — `audit_lens_boots` was never zero at all (10 and
15), and `gated_off_lens_boots` is a genuine zero over a real basis. It is now reported as a
narrowing rather than a match, which is a statement about what this evidence *establishes*, not a
claim that the number changed. The narrow-and-report resolution the spec's Open Question turned on
is therefore exercised on real data after all, where the earlier recording found it moot.

Reproduced verbatim below, with one substitution: the two provenance lines carry absolute paths, so
the run-local prefixes are shown as `<scratch>` (the materialized archive root) and `<out>` (the
`--out` directory). Every other line is byte-for-byte as emitted.

```
=== mechanism regression check — declared signals vs the committed transcript inventory ===

oracle:   <scratch>/transcript-inventory.json
observed: <out>/mechanism-signals.json

MATCH  arm A wf374_audit_lens_boots: observed=10 committed=10
SKIP   arm A wf374_gated_off_lens_boots: observed 0 over incomplete evidence (derived from the 29 of 38 candidate record(s) carrying "subagent_type" — the other 9 could not answer this signal, so a zero count is not evidence of absence) — absence of evidence, not evidence of absence
MATCH  arm A wf374_finding_contract_refetches: observed=0 committed=0
MATCH  arm A wf375_pr_dispatch: observed=1 committed=1
SKIP   arm A wf375_tf_dispatch: observed 0 over incomplete evidence (derived from the 29 of 38 system/task_started record(s) carrying "subagent_type" — the other 9 could not answer this signal, so "absent" is not evidence of absence) — absence of evidence, not evidence of absence
MATCH  arm A wf375_taskoutput_timeouts: observed=1 committed=1
MATCH  arm A wf375_taskoutput_successes: observed=0 committed=0
SKIP   arm A duplicate PR/TF dispatches: observed 0 over incomplete evidence (wf375_pr_dispatch: derived from the 29 of 38 system/task_started record(s) carrying "subagent_type" — the other 9 could not answer this signal, so "absent" is not evidence of absence; wf375_tf_dispatch: derived from the 29 of 38 system/task_started record(s) carrying "subagent_type" — the other 9 could not answer this signal, so "absent" is not evidence of absence) — absence of evidence, not evidence of absence
SKIP   arm A finalize dispatch presence: observed "absent" over incomplete evidence (derived from the 29 of 38 system/task_started record(s) carrying "subagent_type" — the other 9 could not answer this signal, so "absent" is not evidence of absence) — absence of evidence, not evidence of absence
MATCH  arm B wf374_audit_lens_boots: observed=15 committed=15
SKIP   arm B wf374_gated_off_lens_boots: observed 0 over incomplete evidence (derived from the 38 of 40 candidate record(s) carrying "subagent_type" — the other 2 could not answer this signal, so a zero count is not evidence of absence) — absence of evidence, not evidence of absence
MATCH  arm B wf374_finding_contract_refetches: observed=0 committed=0
MATCH  arm B wf375_pr_dispatch: observed=2 committed=2
SKIP   arm B wf375_tf_dispatch: observed 0 over incomplete evidence (derived from the 38 of 40 system/task_started record(s) carrying "subagent_type" — the other 2 could not answer this signal, so "absent" is not evidence of absence) — absence of evidence, not evidence of absence
MATCH  arm B wf375_taskoutput_timeouts: observed=6 committed=6
MATCH  arm B wf375_taskoutput_successes: observed=1 committed=1
SKIP   arm B duplicate PR/TF dispatches: observed 0 over incomplete evidence (wf375_pr_dispatch: derived from the 38 of 40 system/task_started record(s) carrying "subagent_type" — the other 2 could not answer this signal, so "absent" is not evidence of absence; wf375_tf_dispatch: derived from the 38 of 40 system/task_started record(s) carrying "subagent_type" — the other 2 could not answer this signal, so "absent" is not evidence of absence) — absence of evidence, not evidence of absence
SKIP   arm B finalize dispatch presence: observed "absent" over incomplete evidence (derived from the 38 of 40 system/task_started record(s) carrying "subagent_type" — the other 2 could not answer this signal, so "absent" is not evidence of absence) — absence of evidence, not evidence of absence
SKIP   delta wf374_audit_lens_boots: computed over incomplete evidence (a difference of two lower bounds is not itself a bound — arm A: derived from the 29 of 38 candidate record(s) carrying "subagent_type" — the other 9 could not answer this signal, so a zero count is not evidence of absence; arm B: derived from the 38 of 40 candidate record(s) carrying "subagent_type" — the other 2 could not answer this signal, so a zero count is not evidence of absence)
SKIP   delta wf374_gated_off_lens_boots: computed over incomplete evidence (a difference of two lower bounds is not itself a bound — arm A: derived from the 29 of 38 candidate record(s) carrying "subagent_type" — the other 9 could not answer this signal, so a zero count is not evidence of absence; arm B: derived from the 38 of 40 candidate record(s) carrying "subagent_type" — the other 2 could not answer this signal, so a zero count is not evidence of absence)
MATCH  delta wf374_finding_contract_refetches (B - A): observed=0 committed=0
SKIP   delta wf375_pr_dispatch: computed over incomplete evidence (a difference of two lower bounds is not itself a bound — arm A: derived from the 29 of 38 system/task_started record(s) carrying "subagent_type" — the other 9 could not answer this signal, so "absent" is not evidence of absence; arm B: derived from the 38 of 40 system/task_started record(s) carrying "subagent_type" — the other 2 could not answer this signal, so "absent" is not evidence of absence)
SKIP   delta wf375_tf_dispatch: computed over incomplete evidence (a difference of two lower bounds is not itself a bound — arm A: derived from the 29 of 38 system/task_started record(s) carrying "subagent_type" — the other 9 could not answer this signal, so "absent" is not evidence of absence; arm B: derived from the 38 of 40 system/task_started record(s) carrying "subagent_type" — the other 2 could not answer this signal, so "absent" is not evidence of absence)
MATCH  delta wf375_taskoutput_timeouts (B - A): observed=5 committed=5
SKIP   wf379_index_dispatch: declared, but the committed inventory carries no counterpart field — outside this check's oracle
SKIP   wf376_dispatch_model_tier: declared, but the committed inventory carries no counterpart field — outside this check's oracle

NARROWED — committed inventory content this vocabulary does not claim to reproduce:
  - arms.<arm>.wf374.verdict / arms.<arm>.wf375.verdict
      editorial roll-up prose the inventory author wrote; no frozen predicate emits a verdict label
  - arms.<arm>.wf375.caller_context_bounded
      editorial roll-up boolean inferred from the retrieval records; the vocabulary emits the counts, not the inference
  - arms.<arm>.wf375.tf_shape
      prose naming the finalize path; its mechanical content (no separate finalize dispatch record) is checked as dispatch presence WHEN the evidence can carry that assertion — read the finalize dispatch presence row, which states MATCH or SKIP for every arm
  - arms.<arm>.*.pointers
      line pointers into the stream; the vocabulary counts records, it does not emit line numbers

NOT MEASURED in this run (reported, never invented):
  - wf376_dispatch_model_tier / arm A: field "model" is absent, null or empty on every candidate record — the field dimension is absent, so a zero count would not be evidence of absence
  - wf376_dispatch_model_tier / arm B: field "model" is absent, null or empty on every candidate record — the field dimension is absent, so a zero count would not be evidence of absence

DEGRADED INPUT: none — every record stream parsed in full.

RESULT: PASS — every checked value reproduces the committed inventory (12 checks).
```

## The stated narrowing

Per the contingency this experiment's spec pins, the check **explicitly does not claim** the four
per-group verdict strings, the caller-context boolean, or the line pointers. Those are editorial
roll-ups their author wrote while reading the stream — no frozen predicate emits them, and a check
that pretended to reproduce them would be a widened claim.

Of the counts, deltas, and dispatch-shape labels the committed inventory carries for the WF-374/
WF-375 signal set, the check reproduces **every one the evidence establishes** — and states, per
binding, each one it does not. It no longer claims the whole set: an earlier wording here said it
reproduced *every* count, delta, and label, which was true of what the check *printed* and false of
what the evidence *supported*, because twelve of those bindings rested on a zero taken over a
partial basis. The per-binding SKIP rows are that claim narrowed to its evidence, in the same
narrow-and-report form this section already applies to the editorial content.

## Old §7.2 rows deliberately left undeclared

| Row | Why it is not a declared signal |
|---|---|
| WF-378 (ship-orchestrator context ceiling) | Needs a numeric max over cost-model rows and a project-constant ceiling — neither is a transcript-record predicate, and the frozen vocabulary carries no threshold slot. |
| WF-377 (hook-based deferral) | Already "not measurable here" pre-retrofit: neither arm ran hooks. That is a protocol fact about the experiment, not a question the run data was asked. |
| WF-376 (routing model tier) | **Declared**, as `wf376_dispatch_model_tier`, and it lands on the honest not-measured path above: the dispatch records carry no model field, so a zero would be absence of evidence, not evidence of absence. |

Declaring a signal the vocabulary cannot express — so that it would silently answer a different
question — would be worse than leaving it out and saying so.
