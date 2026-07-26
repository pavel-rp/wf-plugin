# Experiment manifest schema — v1

**Written:** 2026-07-24
**Model:** claude-opus-5[1m]
**Consumed by:** [`manifest.sh`](manifest.sh) (load + validate + accessors), and through it every
other engine script in this folder.

An **experiment manifest** is a single JSON file that declares every structural fact of one
experiment: how many arms it has and what distinguishes them, the constants held identical across
those arms, which pairwise comparisons its analysis computes, which mechanism signals its analysis
evaluates over the arms' transcript records, and the vocabulary its blinding gate refuses to let
leak.

The engine scripts beside this file carry **no** arm label, image tag, output directory, umbrella
id, or mechanism literal. Everything experiment-specific enters through a manifest, so adding an
arm is a data edit and never a script edit.

The manifest also fixes the **kit root**: it is `dirname(<manifest path>)`. Every emitted path,
mount, and output directory is derived from that, so an experiment folder is relocatable and the
engine never needs to know where it sits.

## Selecting one — and how the selection travels

`experiment.json` in the kit root is the **default**: every consuming surface resolves it with no
selector at all. A sibling manifest — a rung-added variant, a second experiment in the same
folder — is selected with `--manifest <path>`, and the orchestrator then *forwards* that selection
to each surface that would otherwise resolve the default:

- host-side scripts get `--manifest <path>` appended (last wins over any pinned default);
- the container gets `WF_EXPERIMENT_MANIFEST=<bare name>`, resolved in-container against the
  image's baked experiment dir — a host path would be meaningless across that boundary.

Both are emitted **only for a non-default manifest**, so a kit's manifest of record keeps a command
surface byte-identical to whatever baseline it is compared against.

---

## The v1 slot set, frozen

v1 is deliberately frozen at exactly the slots the ref-ladder needs. Every slot below is either
**validated and read** or **validated present and never read** — there is no third state, and a
key the schema does not name is rejected rather than ignored.

| Slot | Required | Status | Meaning |
|---|---|---|---|
| `name` | yes | validated, read | The experiment's identifier. Narration only; never reaches a compared command line. |
| `arms[]` | yes, ≥2 | validated, read | Ordered arm rows. An experiment compares arms, and every declared compare needs two distinct declared endpoints, so one arm is rejected — naming `arms`, not `compares`. **Declaration order is significant** — see below. |
| `arms[].label` | yes | validated, read | The arm's identity token. Non-empty, unique **case-insensitively** across arms (consumers lowercase it to compose `--run-<label>` / `--wf-ref-<label>`, so `A` and `a` would collide), and restricted to `[A-Za-z0-9]` so it can compose an image tag and a directory name without quoting. |
| `arms[].wf_ref` | yes | validated, read | The arm's treatment: which ref of the plugin source that arm's image installs. **The sole per-arm axis in v1.** |
| `constants{}` | yes | validated, read | The values held identical across every arm. Keys below. |
| `compares[]` | yes, ≥1 | validated, read | The pairwise comparisons the analysis computes. |
| `compares[].base` | yes | validated, read | The arm the comparison is measured *from*. Must name a declared arm. |
| `compares[].against` | yes | validated, read | The arm the comparison is measured *to*. Must name a declared arm, and must differ from `base`. |
| `mechanism_signals[]` | yes (may be empty) | validated, read | The named predicates over transcript records the analysis evaluates. Frozen vocabulary — see below. An empty array is fully inert: analyze emits an empty mechanism table, never a special case. |
| `blinding.vocabulary[]` | yes, **non-empty** | validated, read | The words the blinding gate refuses to find in anything the experiment injects. |
| `blinding.forbidden_paths[]` | yes (may be empty) | validated, read | Glob patterns, relative to a seeded workload tree, that must **not** exist there — the presence half of the gate (e.g. the experiment's own design doc or kit folder, which must post-date the workload ref). Each entry is relative and may not escape the tree. |

### `constants{}`

| Key | Required | Reaches a compared command line? |
|---|---|---|
| `image_repo` | yes | yes — composes the image ref as `<image_repo>:arm<label>` |
| `workload_ref` | yes | yes — every measured `docker run` line |
| `cli_version` | yes | yes — the build line |
| `umbrella_id` | yes | yes — the measured-run lines |
| `gate_skill` | yes | yes — the gate lines |
| `fake_scripts` | yes | yes — every measured `docker run` line. Contained to the experiment folder: no absolute path, no `..` segment (it is copied into the seeded workspace and archived into the mounted results dir). |
| `measured_skill` | yes | **no.** The skill the billed run invokes. Composed in-container as `<measured_skill> <umbrella_id>`; only the umbrella id reaches the host-emitted line. |
| `model` | yes | **no.** The model pin the measured run uses, held identical across arms. In-container only. |
| `packs` | yes (may be empty) | **only when non-empty.** An empty value means the flag is *absent* from every emitted line, not present-and-empty. This distinction is load-bearing: a present-but-empty flag is a different command, and when the flag is absent the in-container default applies. |
| `gap_seconds` | yes | **no.** The inter-arm wait. It appears in narration and in a `sleep` the dry run skips, so it never reaches the emitted command surface. Declared here because it is a real protocol parameter, and recorded rather than compared. |

### `mechanism_signals[]` — the frozen predicate vocabulary

A **mechanism signal** is a named predicate over one arm's transcript records. Declaring one is a
data edit; the engine carries no signal name, record literal, or assertion.

Every element is an object with `id` (unique, `[A-Za-z0-9][A-Za-z0-9_.-]*`), `kind`, and a
non-empty `description` (the emitted row's human reading — required, never decorative), plus the
slots its kind names. **The kind set is frozen at exactly two** — the kinds one real experiment's
committed evidence already uses. A manifest naming any other kind is rejected **by name** at load,
for every phase including `--dry-run`, rather than guessed at:

| Kind | Slots | Meaning |
|---|---|---|
| `record_match` | `record` (optional; when present, `type` required and `subtype` optional), `match[]` (optional; each clause requires `field` and `op`) — **at least one of `record`/`match` is required** | **Record-type + field-match counting.** Counts records of the declared type (every record when `record` is omitted) that satisfy **every** `match` clause. |
| `dispatch_shape` | `subagent_type` (required) | **Dispatch-shape presence.** Counts the stream's dispatch records naming that subagent type, and reports presence (`present`/`absent`) plus `duplicates` — dispatch records re-issued against a task id already dispatched. |

`record` and `match` are individually optional but **not jointly omittable**: a `record_match`
declaring neither would count every record in the stream, which is not a signal, and is rejected at
load. `duplicates` is derived only from dispatch records that actually carry the id field — when
none of the matching dispatches carries it, `duplicates` is reported as not measured (with its own
reason) rather than as a count, while `count` and `presence` stay measurable.

A `match` clause is `{ field, op, value }`. `field` is a dot path into the record, or `""` for the
whole record serialized (the "raw occurrence" reading). `op` is one of `equals`, `prefix`,
`contains` — the operator set is closed exactly like the kind set. `value` is one literal, or a
non-empty array of literals meaning **any of**.

The dispatch-record convention (`system`/`task_started` carrying `subagent_type` and `task_id`) is
**engine** knowledge about the transcript format, not experiment knowledge, so it never appears in
a manifest.

### The result shape: `{ status, count, basis }`

Every signal result is **tri-state and carries its own evidence base**:

| Field | Kind | Meaning |
|---|---|---|
| `status` | both | `measured` or `not_measured`. |
| `basis` | both | How many records could answer this signal **at all** — records carrying every field it reads with a *usable* value (see the two-level rule below). `0` on a `not_measured` result. |
| `count` | both | The measurement. Present only when `status` is `measured`. |
| `reason` | both | Why the signal could not be answered. Present only when `status` is `not_measured`. |
| `candidates` | `record_match` | The candidate pool the basis was drawn from — records of the declared `record` type (every record when `record` is omitted). |
| `dispatches` | `dispatch_shape` | The same denominator for the other kind: every dispatch record in the stream. **The two kinds deliberately keep distinct names** — a `record_match` candidate is manifest-scoped (it depends on the declared `record` type) while a dispatch pool is engine-scoped (fixed by the transcript convention), so one shared key would imply a comparability the two do not have. |
| `presence` | `dispatch_shape` | `present` or `absent` — whether any dispatch names the declared `subagent_type`. |
| `duplicates` | `dispatch_shape` | Dispatch records re-issued against an id already dispatched, or `null` when the id dimension is absent. |
| `duplicates_reason` | `dispatch_shape` | Present when `duplicates` is `null` or only partially derived; states which. |
| `stream_malformed_lines` | both | Unparseable lines in the source stream, carried onto every result taken from it. |

`basis` is what makes `count` interpretable: a `0` over a basis of 40 is a real zero, while a `0`
over a basis of 0 is no measurement at all. **`basis === 0` yields `not_measured` mechanically**, in
one derivation shared by both predicate kinds — not through a guard each evaluation path has to
remember to write. Three successive rounds of this evaluator shipped a forgotten or divergent guard;
a derivation cannot be forgotten.

Presence is **two-level**, and every basis reads the second level rather than the first:

| Level | Predicate | Question it answers |
|---|---|---|
| `isPresent` | `v !== undefined && v !== null` | Is there a value here? |
| `isUsable` | `isPresent(v) && v !== ""` | Is there a value here that could answer the question? |
| `nonEmptyString` | `isUsable(v) && typeof v === "string"` | …and is it string-typed, where the comparison requires that? |

Each level is **defined in terms of the one below it**, so the chain cannot fork. Every *basis* — the
`record_match` field guard, the dispatch-type guard, the dispatch-id set — reads `isUsable`; the
clause matcher reads `isPresent` for the comparison itself.

Both distinctions were learned the same way. The two guards first disagreed on `null`: the field
guard tested `!== undefined` while the clause matcher rejected `null`, so a field explicitly `null`
on every candidate record passed the guard, matched nothing, and emitted `{status:"measured",
count:0}` — a confident zero produced by measuring nothing, which the regression check rendered as a
`MATCH` against a committed `0`. Collapsing them onto one predicate fixed that and introduced the
next: the **empty string** is present, so it re-entered every basis. Three dispatch records carrying
`task_id: ""` collapsed onto one `Set` entry and emitted `duplicates: 2` — an invented divergence
the check rendered as a `MISMATCH` and a `RESULT: FAIL`. A value that cannot equal, prefix, or
contain any declared literal is not an answer, so it does not count toward a basis.

Consumers must render a `not_measured` row as **its own kind** — never a match and never a
divergence. `mechanism-check.sh` emits `MATCH` only from a `measured` row and gives a not-measured
one a `NOT-MEASURED` line stating what the inventory commits and that this run can neither confirm
nor refute it.

### "Not measured" is a first-class result

A declared signal the run data cannot answer is reported **`not measured`, with a stated reason** —
never omitted from the table, never given an invented number. Six conditions produce it, each
drawing the honest line between *a real zero* and *absence of evidence*:

1. the arm has no record stream (`transcript.jsonl` absent or unreadable under its run dir);
2. the candidate set is **empty** — either `record_match` declares a `record` type the stream
   carries no instance of, or it declares no `record` at all and the stream carries no records at
   all. Either way the record dimension is absent, so `0` would read as evidence of absence;
3. `record_match`'s **basis is 0** — no candidate record carries every `field` it reads, non-null.
   That covers a field absent from every candidate record, a field explicitly `null` on every one of
   them, and the case where each field appears somewhere but never all on the same record. (`field:
   ""` never narrows the basis: the whole record is always present.)
4. `dispatch_shape` over a stream carrying **no dispatch record at all** — the dispatch dimension is
   absent, so neither presence nor a count would be evidence;
5. `dispatch_shape` over dispatch records **none of which carries `subagent_type`** — the
   dispatch-*type* dimension is absent, exactly as in condition 3. Without this guard a stream that
   was never asked the question would report `count: 0, presence: "absent"`, and a consumer asserting
   on `presence` would read a green result out of an unanswered one;
6. `dispatch_shape`'s `duplicates` alone, when matching dispatches exist but **none carries the id
   field** — the id dimension is absent. `count` and `presence` remain measured; only `duplicates`
   degrades, carrying its own reason. A *partially* derived `duplicates` (some matching dispatches
   carry the id, some do not) stays a count but carries a reason stating the fraction it came from.

A declared pairwise delta is likewise reported as not measured rather than dropped, in two cases:
the signal is not measured in either endpoint (the delta carries that endpoint's reason), or one of
the compare's declared arms **was not supplied to this evaluation** at all. A declared comparison
never disappears from the artifact without a stated reason.

Unparseable lines in a stream are counted into the emitted provenance (`malformed_lines`) and
carried onto **every** signal result taken from that stream (`stream_malformed_lines`), rather than
silently shrinking a count or being visible only in the arm header.

The reader accepts **both** parseable transcript shapes the run-output contract admits — a
whole-file JSON array, or JSON-lines. Reading only one of them would report a contractually valid
transcript as "the record dimension is absent", blaming the data for a limitation of the reader.

**What is deliberately *not* expressible.** The vocabulary carries no expectation, threshold, or
pass/fail slot: analyze emits counts, presence, and provenance, and the verdict writer reads them.
A mechanism assertion that needs a different substrate — cost-model aggregation, a numeric ceiling
— is **not** declared as a signal that would silently answer the wrong question; it stays out until
a real consumer justifies the kind.

### Why arm declaration order is significant

Two engine behaviours read it directly:

1. The analysis line emits one `--run-<lowercased label>` per arm **in declaration order**. A
   comparator that compares token order within a line will see a reordered manifest as a different
   command.
2. The build phase enumerates arms in declaration order, and so does every derived runbook.

The **gate and measured phases shuffle** arm order at run time, which is a protocol requirement,
not a manifest one — it changes the order independently emitted lines are issued in, never the
content of any one line.

### Forward compatibility

`wf_ref` is the only per-arm axis in v1. A later version may add further per-arm keys; when it
does, a v1 manifest must keep validating unchanged. That is why an arm row is an object rather
than a bare string, and why `constants` is a map rather than a positional list.

---

## Validation — every rejection is loud and named

`manifest.sh` refuses to proceed, naming the offending slot, on any of:

- the file is absent, unreadable, or not parseable JSON;
- **any object carries a key this schema does not name** — the v1 slot set is closed, at the
  manifest root and inside `arms[]`, `constants`, `compares[]`, and `blinding`. A key is never
  silently ignored: an author adding e.g. `arms[].model` is told the slot does not exist rather
  than getting a no-op that reads as a working per-arm axis;
- `arms` is absent, not an array, or declares fewer than two arms;
- an arm label is absent, empty, duplicated (case-insensitively), or carries a character outside `[A-Za-z0-9]`;
- an arm is missing `wf_ref`, or its `wf_ref` is empty;
- `constants` is absent or is missing any required key above;
- `constants.fake_scripts` is absolute or carries a `..` segment;
- `compares` is absent, not an array, or empty;
- a compare names an arm that is not declared, or compares an arm with itself;
- `mechanism_signals` is absent or is not an array; an element is not an object, carries a key the
  vocabulary does not name, is missing `id`/`kind`/`description`, duplicates an `id`, names a
  predicate `kind` or match `op` outside the frozen sets above, declares a `record_match` carrying
  **neither** `record` nor `match`, declares a `record` without a non-empty `type`, declares a
  `match` clause missing `field` or `op`, declares a `dispatch_shape` missing `subagent_type`, or
  declares a match `value` that is neither a non-empty literal nor a non-empty array of them;
- **`blinding.vocabulary` is absent, is not an array, or is empty.**
- `blinding.forbidden_paths` is absent, is not an array, or carries an absolute / tree-escaping entry.

The blinding case is called out because its failure mode is the dangerous one. The pre-retrofit
gate held its banned-word pattern as a hardcoded constant; an empty pattern would match every line
and turn a fail-closed gate into a gate that rejects everything or, depending on the grep, nothing.
Validation refuses an empty vocabulary at load time — before any image is built and before any
spend — rather than letting a degenerate pattern reach the gate.

Validation runs on the host, at load, for every phase including `--dry-run`.

### Exit codes, and where the operand guard reaches

| Code | Meaning |
|---|---|
| `0` | Success. |
| `1` | A real divergence — the MISMATCH verdict. Reserved for "the evidence disagreed with the oracle". |
| `2` | Usage or input error: a missing/empty operand, an unreadable path, a refused `--out`, a rejected manifest. Every such exit self-names (`<script>: ERROR — …`). |

The `1`-vs-`2` split is the point: `"${2:?}"` exits **1** with no prefix, so a caller reading the
status was told "the evidence diverged" when an argument was simply missing.

A **missing** operand was only half the class. A **malformed** one — a value whose first character
is `-` — was eaten as an option by an unguarded `dirname`/`basename`, which printed its own
`invalid option` (naming the utility, never the script) and failed out as exit **1**, the same
impersonation by a different door. Every such call now passes `--`. On the Node side the CLI's
`catch` was narrowed to `SignalError`, so every other throw — an unwritable `--out`, a refused
exclusive create, a permissions error — reached Node's default handler: a raw stack and exit 1. It
now catches unconditionally, names the tool, and exits 2. The invariant is not "these inputs are
handled" but **exit 1 means one thing only**, and nothing else may reach it.

Two corollaries, each of which was a live hole after the first pass at the rule:

- **Every utility in a resolution chain needs `--`, not just the first.** With `dirname` guarded
  but `cd` not, an operand like `-L/escaped` yields the parent `-L`, which `cd` reads as its own
  option — and `cd` with no operand goes to `$HOME`. Resolution then "succeeded" against a
  directory the caller never named and the run reported `RESULT: PASS` at exit 0 over the wrong
  tree. Guarding one utility only moves the door.
- **Parseable is not usable.** `null`, `3`, `"text"`, and `[]` are all valid JSON documents, so
  `JSON.parse` returns without throwing and the first property access downstream threw an uncaught
  `TypeError` — exit 1 again. Both inputs are shape-checked where they are read.

`analyze.sh` is the other script on this path, and the suite covers its usage-error contract for
the same reason: an uncovered script is where this class kept coming back. That coverage is
deliberately scoped to the exit vocabulary — the measurement body needs a full arm fixture and is
out of the suite's scope, stated here rather than left to look like coverage.

### The oracle is protected against this kit's own tooling

`results/` is simultaneously the regression oracle and untouchable committed output, so
`mechanism-check.sh` refuses an `--out` that resolves inside it. Three properties hold that refusal
up; each replaced an enumeration of input spellings that a further spelling then walked past.

- **Both operands are canonicalized, by one resolver.** Resolving the caller's `--out` while
  building the protected path raw compares two different kinds of string: if `results/` (or any
  component above it) is a symlink, the resolved `--out` lands on the physical target, the prefix
  never matches, and the guard silently stops guarding. The asymmetry was the defect, not any
  particular input — so there is one `canonicalize_path` and no unresolved side.
- **Containment is re-asserted after `mkdir -p`,** against the directory that now exists rather
  than the path that was decided on.
- **Output files are created, never followed.** Canonicalizing `--out` constrains the *directory*
  and says nothing about the file paths inside it: a `mechanism-signals.json` planted there as a
  link into `results/` sends the write through every check above, because it creates no new name —
  it rewrites a committed one. Both the evaluator (`writeNoFollow`) and the reporter unlink any
  existing entry (the link itself, not its target) and then create exclusively with `wx`.

The suite's `results/` assertion is a **content** fingerprint — path, kind, and a `cksum` of each
file's bytes — for the same reason: a name listing cannot see an in-place overwrite, which is
precisely the damage a followed link does.

**Scoping decision, stated so the asymmetry is not read as drift.** The `die_usage`/`need_operand`
hardening covers the three scripts on the *measurement* path — `mechanism-check.sh`, `analyze.sh`,
and `mechanism-signals.cli.mjs` — because only those three return a verdict a caller branches on, so
only there can a dropped operand be misread as a measurement. The remaining engine scripts
(`build.sh`, `run-arm.sh`, `run-experiment.sh`, `seed-workspace.sh`, `runner/run-skill.sh`,
`ci/smoke-gate.sh`) still use `"${2:?}"`: they are orchestration entry points whose non-zero exit is
never interpreted as a divergence, so the collision that motivated the guard does not exist there.
Extending it remains a legitimate consistency improvement; it is deliberately not a correctness fix.

`selfcheck.sh` (beside the evaluator, named for the pack's own suite convention) is the regression
suite for all of the above — every rejection listed here, every not-measured condition, the CLI
entry gate, the arm-flag handling, and the emitted-path stability. It synthesizes its own fixtures
under a temp dir, spends nothing, writes nothing outside that temp dir, and exits non-zero on any
regression, ending on a named `wf-sandbox-testing mechanism-signal selfcheck: PASS`/`FAIL` line so a
red run leaves a greppable verdict rather than only a counter. It does *read* the `fleet-ab` kit —
the containment cases need a real protected directory to aim at, so they read that kit's
`mechanism-check.sh` and `experiment.json` and fingerprint its `results/` before and after,
asserting it unchanged. Run it after any change to the vocabulary or the evaluator.

---

## Example

Illustrative only — the normative content is the table above, not these values.

```json
{
  "name": "example",
  "arms": [
    { "label": "A", "wf_ref": "0000000" },
    { "label": "B", "wf_ref": "1111111" }
  ],
  "constants": {
    "image_repo": "example",
    "workload_ref": "2222222",
    "cli_version": "0.0.0",
    "umbrella_id": "EX-1",
    "gate_skill": "/wf:example-gate EX-2",
    "fake_scripts": "fake-scripts.json",
    "measured_skill": "/wf:example",
    "model": "example-model",
    "packs": "",
    "gap_seconds": 330
  },
  "compares": [
    { "base": "A", "against": "B" }
  ],
  "mechanism_signals": [
    {
      "id": "example_lens_boots",
      "kind": "record_match",
      "description": "example lens boots",
      "record": { "type": "system", "subtype": "task_started" },
      "match": [{ "field": "subagent_type", "op": "prefix", "value": "example:" }]
    },
    {
      "id": "example_finalize_dispatch",
      "kind": "dispatch_shape",
      "description": "example finalize child dispatches",
      "subagent_type": "example:finalize"
    }
  ],
  "blinding": {
    "vocabulary": ["one", "two"],
    "forbidden_paths": ["docs/example-*"]
  }
}
```

A `compares` entry is directional and the direction is explicit: `{ "base": "A", "against": "B" }`
reports **against minus base** — the delta's sign convention is pinned by the manifest, not by the
order the analysis happens to read files in.
