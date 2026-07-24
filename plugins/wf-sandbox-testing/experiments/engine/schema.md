# Experiment manifest schema — v1

**Written:** 2026-07-24
**Model:** claude-opus-5[1m]
**Consumed by:** [`manifest.sh`](manifest.sh) (load + validate + accessors), and through it every
other engine script in this folder.

An **experiment manifest** is a single JSON file that declares every structural fact of one
experiment: how many arms it has and what distinguishes them, the constants held identical across
those arms, which pairwise comparisons its analysis computes, which mechanism signals it reserves
for later evaluation, and the vocabulary its blinding gate refuses to let leak.

The engine scripts beside this file carry **no** arm label, image tag, output directory, umbrella
id, or mechanism literal. Everything experiment-specific enters through a manifest, so adding an
arm is a data edit and never a script edit.

The manifest also fixes the **kit root**: it is `dirname(<manifest path>)`. Every emitted path,
mount, and output directory is derived from that, so an experiment folder is relocatable and the
engine never needs to know where it sits.

---

## The v1 slot set, frozen

v1 is deliberately frozen at exactly the slots the ref-ladder needs. Every slot below is either
**validated and read** or **validated present and never read** — there is no third state, and a
key the schema does not name is rejected rather than ignored.

| Slot | Required | Status | Meaning |
|---|---|---|---|
| `name` | yes | validated, read | The experiment's identifier. Narration only; never reaches a compared command line. |
| `arms[]` | yes, ≥1 | validated, read | Ordered arm rows. **Declaration order is significant** — see below. |
| `arms[].label` | yes | validated, read | The arm's identity token. Non-empty, unique across arms, and restricted to `[A-Za-z0-9]` so it can compose an image tag and a directory name without quoting. |
| `arms[].wf_ref` | yes | validated, read | The arm's treatment: which ref of the plugin source that arm's image installs. **The sole per-arm axis in v1.** |
| `constants{}` | yes | validated, read | The values held identical across every arm. Keys below. |
| `compares[]` | yes, ≥1 | validated, read | The pairwise comparisons the analysis computes. |
| `compares[].base` | yes | validated, read | The arm the comparison is measured *from*. Must name a declared arm. |
| `compares[].against` | yes | validated, read | The arm the comparison is measured *to*. Must name a declared arm, and must differ from `base`. |
| `mechanism_signals[]` | yes (may be empty) | **validated present, never read** | **Reserved.** The engine checks the key exists and is an array. It never reads an element, never interprets one, and never emits one. Evaluating these is a separate, later change. |
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
| `fake_scripts` | yes | yes — every measured `docker run` line |
| `measured_skill` | yes | **no.** The skill the billed run invokes. Composed in-container as `<measured_skill> <umbrella_id>`; only the umbrella id reaches the host-emitted line. |
| `model` | yes | **no.** The model pin the measured run uses, held identical across arms. In-container only. |
| `packs` | yes (may be empty) | **only when non-empty.** An empty value means the flag is *absent* from every emitted line, not present-and-empty. This distinction is load-bearing: a present-but-empty flag is a different command, and when the flag is absent the in-container default applies. |
| `gap_seconds` | yes | **no.** The inter-arm wait. It appears in narration and in a `sleep` the dry run skips, so it never reaches the emitted command surface. Declared here because it is a real protocol parameter, and recorded rather than compared. |

### Why arm declaration order is significant

Two engine behaviours read it directly:

1. The analysis line emits one `--run-<lowercased label>` per arm **in declaration order**. A
   comparator that compares token order within a line will see a reordered manifest as a different
   command.
2. Build and gate phases enumerate arms in declaration order.

Arm order *between* independently emitted lines is separately randomized at run time (the measured
phase coin-flips), which is a protocol requirement, not a manifest one.

### Forward compatibility

`wf_ref` is the only per-arm axis in v1. A later version may add further per-arm keys; when it
does, a v1 manifest must keep validating unchanged. That is why an arm row is an object rather
than a bare string, and why `constants` is a map rather than a positional list.

---

## Validation — every rejection is loud and named

`manifest.sh` refuses to proceed, naming the offending slot, on any of:

- the file is absent, unreadable, or not parseable JSON;
- `arms` is absent, not an array, or empty;
- an arm label is absent, empty, duplicated, or carries a character outside `[A-Za-z0-9]`;
- an arm is missing `wf_ref`, or its `wf_ref` is empty;
- `constants` is absent or is missing any required key above;
- `compares` is absent, not an array, or empty;
- a compare names an arm that is not declared, or compares an arm with itself;
- `mechanism_signals` is absent or is not an array (its *contents* are never inspected);
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
  "mechanism_signals": [],
  "blinding": {
    "vocabulary": ["one", "two"],
    "forbidden_paths": ["docs/example-*"]
  }
}
```

A `compares` entry is directional and the direction is explicit: `{ "base": "A", "against": "B" }`
reports **against minus base** — the delta's sign convention is pinned by the manifest, not by the
order the analysis happens to read files in.
