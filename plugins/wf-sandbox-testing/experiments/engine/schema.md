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
| `record_match` | `record` (optional `{type, subtype}`), `match[]` (optional) | **Record-type + field-match counting.** Counts records of the declared type (every record when `record` is omitted) that satisfy **every** `match` clause. |
| `dispatch_shape` | `subagent_type` (required) | **Dispatch-shape presence.** Counts the stream's dispatch records naming that subagent type, and reports presence (`present`/`absent`) plus `duplicates` — dispatch records re-issued against a task id already dispatched. |

A `match` clause is `{ field, op, value }`. `field` is a dot path into the record, or `""` for the
whole record serialized (the "raw occurrence" reading). `op` is one of `equals`, `prefix`,
`contains` — the operator set is closed exactly like the kind set. `value` is one literal, or a
non-empty array of literals meaning **any of**.

The dispatch-record convention (`system`/`task_started` carrying `subagent_type` and `task_id`) is
**engine** knowledge about the transcript format, not experiment knowledge, so it never appears in
a manifest.

### "Not measured" is a first-class result

A declared signal the run data cannot answer is reported **`not measured`, with a stated reason** —
never omitted from the table, never given an invented number. Exactly three conditions produce it,
each drawing the honest line between *a real zero* and *absence of evidence*:

1. the arm has no record stream (`transcript.jsonl` absent or unreadable under its run dir);
2. `record_match` declares a `record` type the stream carries **no instance of** — the record
   dimension is absent, so `0` would read as evidence of absence;
3. `record_match` declares a `match` clause whose `field` is absent from **every** candidate
   record — the field dimension is absent, same reasoning. (`field: ""` never triggers this: the
   whole record is always present.)

A declared pairwise delta over a signal not measured in either endpoint is likewise reported as
not measured, carrying the endpoint's reason.

Unparseable lines in a stream are counted into the emitted provenance (`malformed_lines`) rather
than silently shrinking a count.

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
  vocabulary does not name, is missing `id`/`kind`/`description`, duplicates an `id`, or names a
  predicate `kind` or match `op` outside the frozen sets above;
- **`blinding.vocabulary` is absent, is not an array, or is empty.**
- `blinding.forbidden_paths` is absent, is not an array, or carries an absolute / tree-escaping entry.

The blinding case is called out because its failure mode is the dangerous one. The pre-retrofit
gate held its banned-word pattern as a hardcoded constant; an empty pattern would match every line
and turn a fail-closed gate into a gate that rejects everything or, depending on the grep, nothing.
Validation refuses an empty vocabulary at load time — before any image is built and before any
spend — rather than letting a degenerate pattern reach the gate.

Validation runs on the host, at load, for every phase including `--dry-run`.

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
