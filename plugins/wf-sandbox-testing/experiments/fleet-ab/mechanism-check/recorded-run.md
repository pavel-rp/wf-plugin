# fleet-ab mechanism regression check — recorded run

**Recorded:** 2026-07-25
**Model:** claude-opus-5[1m]
**Checked by:** [`../mechanism-check.sh`](../mechanism-check.sh) over
[`../../engine/mechanism-signals.mjs`](../../engine/mechanism-signals.mjs)

The declared C024 mechanism signals in [`../experiment.json`](../experiment.json), evaluated over the
committed per-arm run archives and compared against the committed transcript inventory. **Read-only
over both**: nothing under `results/` was written, and `git status --porcelain` over
`experiments/fleet-ab/results/` was empty before and after.

## Where the evidence lives

The run archives and the inventory that seeds this check were committed on
`chore/WF-382-fleet-ab-measurement` (`3970c1d`) and **were not carried into `main` by that
umbrella's merge** (`c768673`, PR #213, which shipped the kit but not the archives). They are
therefore not resolvable from a `main` checkout, and this check takes their location as arguments
rather than assuming one:

| Input | Committed at |
|---|---|
| `run-A/transcript.jsonl` · `run-B/transcript.jsonl` | `chore/WF-382-fleet-ab-measurement:plugins/wf-sandbox-testing/experiments/fleet-ab/results/run-{A,B}/` |
| `transcript-inventory.json` (the oracle) | `chore/WF-382-fleet-ab-measurement:plugins/wf-sandbox-testing/experiments/fleet-ab/results/` |

Materialize them into a scratch directory (`git archive` into `_local/scratch/`), then:

```
bash plugins/wf-sandbox-testing/experiments/fleet-ab/mechanism-check.sh \
  --run-a <scratch>/results/run-A \
  --run-b <scratch>/results/run-B \
  --inventory <scratch>/results/transcript-inventory.json \
  --out _local/scratch/fleet-ab-mechanism-check
```

## Result

24 checks, all matching. One declared signal is reported **not measured**, with its reason — the
honest-non-measurement path exercised on real data rather than asserted. Two declared signals are
reported **SKIP** — the committed inventory carries no counterpart field for either, so they sit
outside this check's oracle and it claims nothing about them. (One of the two,
`wf376_dispatch_model_tier`, is also the not-measured signal above; SKIP is a statement about the
*oracle*, not about whether the signal evaluated.)

Reproduced verbatim below, with one substitution: the two provenance lines carry absolute paths, so
the run-local prefixes are shown as `<scratch>` (the materialized archive root) and `<out>` (the
`--out` directory). Every other line is byte-for-byte as emitted.

```
=== mechanism regression check — declared signals vs the committed transcript inventory ===

oracle:   <scratch>/results/transcript-inventory.json
observed: <out>/mechanism-signals.json

MATCH  arm A wf374_audit_lens_boots: observed=10 committed=10
MATCH  arm A wf374_gated_off_lens_boots: observed=0 committed=0
MATCH  arm A wf374_finding_contract_refetches: observed=0 committed=0
MATCH  arm A wf375_pr_dispatch: observed=1 committed=1
MATCH  arm A wf375_tf_dispatch: observed=0 committed=0
MATCH  arm A wf375_taskoutput_timeouts: observed=1 committed=1
MATCH  arm A wf375_taskoutput_successes: observed=0 committed=0
MATCH  arm A duplicate PR/TF dispatches: observed=0 committed=0
MATCH  arm A finalize dispatch presence: observed="absent" committed="absent"
MATCH  arm B wf374_audit_lens_boots: observed=15 committed=15
MATCH  arm B wf374_gated_off_lens_boots: observed=0 committed=0
MATCH  arm B wf374_finding_contract_refetches: observed=0 committed=0
MATCH  arm B wf375_pr_dispatch: observed=2 committed=2
MATCH  arm B wf375_tf_dispatch: observed=0 committed=0
MATCH  arm B wf375_taskoutput_timeouts: observed=6 committed=6
MATCH  arm B wf375_taskoutput_successes: observed=1 committed=1
MATCH  arm B duplicate PR/TF dispatches: observed=0 committed=0
MATCH  arm B finalize dispatch presence: observed="absent" committed="absent"
MATCH  delta wf374_audit_lens_boots (B - A): observed=5 committed=5
MATCH  delta wf374_gated_off_lens_boots (B - A): observed=0 committed=0
MATCH  delta wf374_finding_contract_refetches (B - A): observed=0 committed=0
MATCH  delta wf375_pr_dispatch (B - A): observed=1 committed=1
MATCH  delta wf375_tf_dispatch (B - A): observed=0 committed=0
MATCH  delta wf375_taskoutput_timeouts (B - A): observed=5 committed=5
SKIP   wf379_index_dispatch: declared, but the committed inventory carries no counterpart field — outside this check's oracle
SKIP   wf376_dispatch_model_tier: declared, but the committed inventory carries no counterpart field — outside this check's oracle

NARROWED — committed inventory content this vocabulary does not claim to reproduce:
  - arms.<arm>.wf374.verdict / arms.<arm>.wf375.verdict
      editorial roll-up prose the inventory author wrote; no frozen predicate emits a verdict label
  - arms.<arm>.wf375.caller_context_bounded
      editorial roll-up boolean inferred from the retrieval records; the vocabulary emits the counts, not the inference
  - arms.<arm>.wf375.tf_shape
      prose naming the finalize path; its mechanical content (no separate finalize dispatch record) IS checked, as dispatch presence
  - arms.<arm>.*.pointers
      line pointers into the stream; the vocabulary counts records, it does not emit line numbers

NOT MEASURED in this run (reported, never invented):
  - wf376_dispatch_model_tier / arm A: field "model" is absent from every candidate record — the field dimension is absent, so a zero count would not be evidence of absence
  - wf376_dispatch_model_tier / arm B: field "model" is absent from every candidate record — the field dimension is absent, so a zero count would not be evidence of absence

RESULT: PASS — every checked value reproduces the committed inventory (24 checks).
```

## The stated narrowing

Per the contingency this experiment's spec pins: the check reproduces **every count, delta, and
dispatch-shape label** the committed inventory carries for the WF-374/WF-375 signal set, and
**explicitly does not claim** the four per-group verdict strings, the caller-context boolean, or the
line pointers. Those are editorial roll-ups their author wrote while reading the stream — no frozen
predicate emits them, and a check that pretended to reproduce them would be a widened claim.

## Old §7.2 rows deliberately left undeclared

| Row | Why it is not a declared signal |
|---|---|
| WF-378 (ship-orchestrator context ceiling) | Needs a numeric max over cost-model rows and a project-constant ceiling — neither is a transcript-record predicate, and the frozen vocabulary carries no threshold slot. |
| WF-377 (hook-based deferral) | Already "not measurable here" pre-retrofit: neither arm ran hooks. That is a protocol fact about the experiment, not a question the run data was asked. |
| WF-376 (routing model tier) | **Declared**, as `wf376_dispatch_model_tier`, and it lands on the honest not-measured path above: the dispatch records carry no model field, so a zero would be absence of evidence, not evidence of absence. |

Declaring a signal the vocabulary cannot express — so that it would silently answer a different
question — would be worse than leaving it out and saying so.
