---
name: new-experiment
description: Scaffolds a runnable experiment definition for the sandbox experiment engine by interviewing the author for every manifest slot — arms and their frozen refs, the held-constant values, the directional pairwise comparisons, the declared mechanism signals, and the required blinding vocabulary — then emitting a finished manifest, the kit files its commands depend on, and an engine-derived runbook, and self-linting the set before handing anything back. Use when the user wants to create, scaffold, generate, or start a new experiment, experiment manifest, or experiment kit, rather than an explanation of the manifest schema.
allowed-tools: [Read, Write, Edit, Glob, Grep, Bash, AskUserQuestion]
---

# /wf-sandbox-testing:new-experiment — interview in, runnable experiment kit out

Turns a hypothesis into a finished experiment kit for the shared experiment engine: a manifest the
engine loads clean, the kit-root files the engine's emitted commands depend on, and a runbook the
engine itself derived. It emits **finished files, never a template** — no `TODO` survives to the
author, and nothing is handed back with a check still open.

It emits definitions and derives documents. It never builds an image, never starts a container,
never runs a measured phase, and never spends.

**Model:** claude-opus-5[1m]

---

## Prerequisites

- The shared engine must be present at `plugins/wf-sandbox-testing/experiments/engine/` — this skill
  scaffolds *for* that engine and self-lints by invoking it. If it is absent, stop and say so; a kit
  that cannot be validated is never emitted.
- `node` and `git` must be on `PATH`: the engine's manifest reader is Node, and the frozen-ref check
  is `git rev-parse`. If either is missing, stop before the interview rather than emitting an
  unchecked kit.

## Command Syntax

```
/wf-sandbox-testing:new-experiment [<name>]
```

| Argument | Required | Description |
|---|---|---|
| `<name>` | NO | The experiment's slug. It names both the kit folder and the manifest's `name` slot. Validated on arrival exactly like a typed answer; an invalid one is explained against its rule and re-asked, never repaired. |

### Zero-argument default

A bare invocation runs the full interview from question 1 — the intended path. The argument is a
shortcut that pre-answers question 1 and nothing else.

## Safety Rules (NON-NEGOTIABLE)

**Allowed:**

- Read and glob any file in the workspace, to detect the engine, an existing kit of the same name,
  and the worked example the kit-root files are shaped after.
- Write files **only** under `plugins/wf-sandbox-testing/experiments/<name>/`, with exactly one
  carve-out: the runbook-parity check (Phase 3, check 3) writes **one** scratch file under
  `_local/scratch/` and deletes it as its last act. That is the repository's sanctioned scratch
  location; nothing else is ever written there, and nothing written there survives the check.
- Run `experiments/engine/run-experiment.sh` with **only** `--dry-run` or `--runbook`, and source
  `experiments/engine/manifest.sh` to call `manifest_load`.
- Run `git rev-parse --verify --quiet` to check that an answered ref is a real, frozen commit.

**Forbidden:**

- Write or edit anything outside the new kit folder — no engine file, no `schema.md`, no registry
  row, no version manifest, no other kit. In particular, **never write under any `results/`
  directory**: those trees are measured evidence, not scaffolder output.
- Run the `build`, `gate`, `pilot`, or `analyze` phases for real; pass `--spend` outside a
  `--dry-run`; build an image; or start a container. Spend is the author's decision, taken later,
  from the runbook.
- Add, rename, or widen a manifest slot. The schema's slot set is closed and frozen; a slot that
  appears to be missing is reported as a finding and the run stops.
- Offer a mechanism-signal predicate kind other than the two frozen ones, or claim the engine
  evaluates a declared signal.
- Emit a file containing `TODO`, `FIXME`, `XXX`, or any fill-me-in marker; hand back a kit carrying
  an open finding; or report a check as clean without having run it.
- Write an AI-attribution trailer, a "generated with" footer, an emoji, or a promotional tagline
  into any emitted file.
- Overwrite an existing kit folder without asking first.

---

## Phase 1 — Interview, validating each answer before anything is written

Ask the questions below one at a time, in order, and **validate every answer the moment it arrives**
against the rule it is bound to — before the next question, and long before any file exists.

On an answer that cannot produce a valid kit: state the rule it violates in the rule's own words,
state why this specific answer violates it, and **re-ask the same question**. Never silently repair
an answer, never substitute a default for a rejected one, and **write no file** — a rejected answer
produces no emission at all. Never invent an answer the author did not give.

An interview that never yields a valid answer ends with **no file written** and the violated rule
surfaced. That is a clean outcome, reported as `Stopped`.

| # | Question | The answer must satisfy |
|---|---|---|
| 1 | **Name** — the experiment's slug | Lowercase letters, digits, and hyphens only; non-empty; not `engine` or `parity` (those folders are the engine's own siblings, not kits); and not already a folder under `plugins/wf-sandbox-testing/experiments/` unless the author confirms an overwrite. It becomes both the kit folder name and the manifest's `name`. |
| 2 | **Arms** — the ordered rows the experiment compares | At least two. Each row is a label and a ref. A label is non-empty, contains only `[A-Za-z0-9]`, and is unique **case-insensitively** across arms — consumers lowercase it to compose `--run-<label>` and `--wf-ref-<label>`, so `A` and `a` would silently collide. Each ref must be **frozen and explicit** (see the refusal below). **Declaration order is significant** and is preserved exactly as answered: it drives the analysis flag order and the build enumeration. |
| 3 | **Constants** — the ten values held identical across every arm | `image_repo`, `workload_ref`, `cli_version`, `umbrella_id`, `gate_skill`, `fake_scripts`, `measured_skill`, and `model` are each a non-empty string. `packs` is a string that **may be empty**, and empty means the flag is *absent* from every emitted command, never present-and-empty. `gap_seconds` is a non-negative **number**, not a string. `fake_scripts` is relative to the kit folder and may not escape it — no leading `/`, no `..` segment. `workload_ref` is a ref and is held to the same frozen-ref rule as an arm ref. |
| 4 | **Comparisons** — the pairwise deltas the analysis computes | At least one. Each carries `base` and `against`, both naming a declared arm, and the two must differ. The direction is explicit and is stated back to the author: a comparison reports **against minus base**. |
| 5 | **Mechanism signals** — the reserved declarations | Zero or more. Each names one of exactly **two** frozen predicate kinds — `record_match` or `dispatch_shape` — and no third kind is offered or accepted. Each also carries a short id and a one-line description. State plainly, here and in the final report, that the engine validates only that this slot is *present and an array*: it never reads an element, never interprets one, and never emits one. A declared signal is a declaration for a later analysis, not something this kit evaluates. |
| 6 | **Blinding vocabulary** — the words that must never leak | **Required. At least one non-empty word.** See the refusal below. |
| 7 | **Forbidden paths** — the presence half of the blinding gate | Zero or more glob patterns, each relative to a seeded workload tree: no leading `/`, no `..` segment. Empty is a valid answer and is accepted as given. |
| 8 | **Scripted-response file** — how `constants.fake_scripts` is satisfied | Two answers. **Default:** the skill emits a starter `fake-scripts.json` into the kit — a real, valid, engine-shaped scripted-response document, not a placeholder — and `constants.fake_scripts` names it. **Alternative:** the author supplies the filename, and the skill validates that the named file already exists inside the kit folder before emitting anything else, re-asking when it does not. |

### Refusal 1 — the blinding vocabulary is required and cannot be skipped

A skipped, blank, or empty-list answer to question 6 **re-asks**. No default is substituted, no word
is inferred from any other answer, and **no file is written** until the answer holds at least one
non-empty word.

State the reason when re-asking: an empty vocabulary degenerates the blinding gate's pattern, turning
a fail-closed gate into one that matches everything or nothing. The engine's own loader refuses an
empty vocabulary before any image is built — this question exists so the author is never surprised by
that refusal after the fact.

If the author abandons the interview here, **zero files exist** under the target kit folder and the
run reports `Stopped`, naming this question as the one left unanswered.

### Refusal 2 — a moving ref is refused; a frozen explicit sha is demanded

A ref answered as `HEAD`, a branch name, `main`, a tag, or any other moving pointer is **rejected**.
Explain why: a moving ref produces an image that does not match its declared treatment, so the
comparison the experiment exists to make is void, and the manifest records a treatment nobody can
reproduce later.

Demand the explicit sha the moving ref currently points at. **Substitute no default and resolve no
ref on the author's behalf** — the frozen value is the author's declaration, not this skill's guess.

Apply the two rules **in order**, the first as a hard precondition on the second:

1. **Shape gate, applied first.** The answer must match `^[0-9a-f]{7,40}$`. An answer that fails this
   is rejected here and re-asked — it is **never** passed to the resolver below. This ordering is the
   point of the gate: `main`, `HEAD`, and a tag all resolve perfectly well, so resolvability alone
   would accept exactly the moving refs this refusal exists to reject.
2. **Existence check, only on a shape-gate pass.** The gated value must resolve in this checkout:

   ```bash
   git rev-parse --verify --quiet -- '<ref>^{commit}'
   ```

   Single-quote the argument so the brace suffix reaches `git` unexpanded, and keep the `--` guard so
   a value that survived the shape gate is never read as an option. Check **one** ref per invocation
   — `--verify` accepts a single argument and silently misbehaves when given more.

Applied uniformly to **every** declared arm, the baseline included, and to `constants.workload_ref`:
a moving baseline voids a comparison exactly as thoroughly as a moving candidate.

---

## Phase 2 — Emit complete files, never placeholders

Write the full set from the validated answers, into
`plugins/wf-sandbox-testing/experiments/<name>/`:

| File | What it is |
|---|---|
| `experiment.json` | The manifest — exactly the frozen slots, in the shapes the loader validates, with no invented key. |
| `build-arm.sh` | The kit's build entry point: a short dispatch shim that resolves its own directory and `exec`s the engine's `build.sh` with `--manifest "$SCRIPT_DIR/experiment.json"` and the caller's arguments. |
| `analyze.sh` | The same shim shape against the engine's `analyze.sh`. |
| `Dockerfile` | The kit's arm-buildable image, derived from the established kit-image lineage: the kit path and image name are substituted, the `cli_version` constant is carried into the CLI-version build argument, and any lineage comment block naming another kit's refs or commands is replaced by a pointer to this kit's derived runbook — a stale sha copied forward would document a build this kit never issues. It is required, not optional: the runbook's own build command resolves this path. |
| `fake-scripts.json` | The starter scripted-response document — only when question 8 took the default answer. |
| `runbooks/experiment.md` | **Obtained from the engine**, never authored here (see below). |

**The no-placeholder rule is absolute.** No emitted file may contain `TODO`, `FIXME`, `XXX`, a
`<fill this in>` marker, or a section left for the author to complete. Every value comes from a
validated answer or from a rule-derived default this body states explicitly. A value that is neither
answered nor defaulted is a Phase 1 gap — go back and ask.

**Every skill-authored file that can carry prose carries a `**Model:** <current model id>`
attribution line** — in the `Dockerfile` header comment, in the starter `fake-scripts.json`'s
`_comment` field, and in any other emitted document with somewhere to put one. The single exemption
is `runbooks/experiment.md`: the engine derives it and stamps its own `**Derived by:**` attribution,
and this skill may not post-edit it (see below), so the rule is satisfied there by the engine's line,
not by one added here. No emitted file carries an AI-attribution trailer, a "generated with" footer,
an emoji, or a promotional tagline.

### The runbook is machine-derived, never authored

The engine composes every command it emits in one place, and its runbook derivation calls those same
composers — so a derived runbook cannot document a command the engine would not issue. Obtain the
document by invoking the engine with the emitted manifest and the runbook flag:

```bash
bash plugins/wf-sandbox-testing/experiments/engine/run-experiment.sh \
  --manifest plugins/wf-sandbox-testing/experiments/<name>/experiment.json --runbook
```

With no path argument it writes `<kit>/runbooks/<manifest-basename>.md` — for the default
`experiment.json`, that is `runbooks/experiment.md`. **Never hand-write the runbook and never
post-edit it.** If it needs to say something different, the manifest is what changes.

---

## Phase 3 — Self-lint against the same gates the repository applies

Run **every applicable check** over the emitted set, on every pass. Never substitute your own reading
of a rule for a check's verdict, and never declare a file clean on a check you did not run.

1. **The manifest loads.** Source `experiments/engine/manifest.sh` and call `manifest_load` on the
   emitted manifest. It must exit 0 with no `manifest.sh: ERROR` line on stderr. Every rejection the
   loader emits names the offending slot — route that name straight back to the question that
   produced it.
2. **The dry run succeeds.** Run every phase against the emitted manifest with `--dry-run`, and
   acknowledge the billed phase so it is reachable:

   ```bash
   bash plugins/wf-sandbox-testing/experiments/engine/run-experiment.sh \
     --manifest plugins/wf-sandbox-testing/experiments/<name>/experiment.json all --dry-run --spend
   ```

   The acknowledgement flag is required only because the engine refuses the billed phase without it;
   under `--dry-run` the interactive confirm, the prerequisite checks, the image checks, and the
   inter-arm wait are all skipped, so this command is offline, needs no container runtime, and costs
   nothing. It must exit 0 and emit one build line, one gate line per declared arm, one pilot line
   per declared arm, and one analysis line.
3. **The runbook is the engine's own.** Re-derive it to a scratch path under `_local/scratch/` with
   the runbook flag and an explicit output path, then `diff` that against the emitted
   `runbooks/experiment.md`. The diff must be **empty** — this is the check that proves the document
   came from the engine rather than from this skill. Delete the scratch file once the check has run.
4. **Runbook and dry run agree.** Every fenced command in the runbook, with its `$ROOT` anchor
   expanded to the repository root, must appear in the dry run's output, and every command the dry
   run emits must appear in the runbook. Compare **per phase as a set, never as a sequence**: the
   runbook lists arms in declaration order while the gate and measured phases shuffle arm order at
   emit time. That shuffle is a protocol requirement, not a divergence.
5. **No placeholders.** Grep every emitted file for `TODO`, `FIXME`, `XXX`, and any unsubstituted
   fill-me-in token. Zero hits.
6. **Every declared path resolves.** `build-arm.sh`, `analyze.sh`, `Dockerfile`, and the file
   `constants.fake_scripts` names all exist inside the kit folder.

A check that cannot run at all is **not a pass** — its verdict is `error`, and an artifact whose
conformance is unknown is never handed back as clean. Go to Phase 5.

**Scope honesty.** A check whose scope does not match an emitted path skips that file and passes
vacuously. When that happens, say so — report it as *not applicable to this path*, never as a clean
verdict it did not actually reach.

---

## Phase 4 — Fix your own findings, then re-run

Findings are this skill's own work to fix, never the author's homework.

For each finding, edit the emitted file so the named rule is satisfied, then **re-run the full
Phase 3 check set** — not only the check that failed, because a fix can break something else.

**Cap the loop at three fix-and-re-run passes.** If the set is clean within the cap, hand back. If
any finding survives it, or a fix would require guessing at author intent, go to Phase 5.

Never suppress a finding, never narrow a check's inputs to dodge one, and never edit an engine file
to make a finding disappear. If a finding can only be cleared by changing the schema or the engine,
that is out of scope by construction: report it as a finding against the schema and stop.

---

## Phase 5 — Stop honestly, or hand back only clean

**Stop honestly** when a finding survives the cap or a check returned `error`. Report, per finding:
the check that produced it, the file, and the message, plus what was attempted. Leave the files on
disk so the author can inspect them, and say plainly that the kit is **not clean**. Never present it
as delivered, and never report success alongside an unresolved finding.

**Hand back clean** only when every applicable check returned a clean verdict on the current bytes of
the emitted set. Re-run the placeholder grep one final time first, so it gates the handback against
the files as they now stand, after every Phase 4 edit. The claim being made is narrow and must be
exactly true: *these files, as they stand, pass these named checks.*

Nothing has been built, run, or spent. The next move — running the build and gate phases on the
author's own container host, and only then deciding on the billed phase — is the author's.

---

## Edge Cases

- **The engine folder is absent:** stop before the interview. A kit that cannot be validated against
  the engine it targets is never emitted.
- **`node` or `git` is unavailable:** stop before the interview — the manifest reader and the
  frozen-ref check both need them, and an unchecked kit is never handed back.
- **The kit folder already exists:** stop and ask before overwriting. Authored work is never silently
  clobbered.
- **The blinding vocabulary is skipped:** re-ask; never default it. If the author abandons the
  interview there, no file was written — report `Stopped` naming that question.
- **An arm ref is a branch, a tag, or `HEAD`:** refuse it, explain that a moving ref voids the
  comparison, and demand the frozen explicit sha. Never resolve it on the author's behalf.
- **Only one arm is offered:** re-ask. An experiment compares arms, and every comparison needs two
  distinct declared endpoints, so a one-arm manifest can never load.
- **A comparison names an undeclared arm, or an arm against itself:** re-ask, naming the declared
  arms.
- **An interview answer needs a manifest slot the schema does not name:** stop and report it as a
  finding against the schema. It is never patched in here, and no key outside the frozen set is ever
  written — the loader rejects an unknown key rather than ignoring it, so a silent invention would
  fail later and louder.
- **A check has no target for this kit:** report it *not applicable*, never clean.
- **A finding survives the fix cap:** stop and surface it; the files stay on disk, reported plainly
  as not clean.
- **The author abandons the interview at any point:** nothing was written — report that no file was
  emitted.

---

```
NEW-EXPERIMENT — <Delivered | Stopped>

Experiment: <name>
Kit:        plugins/wf-sandbox-testing/experiments/<name>/
Manifest:   plugins/wf-sandbox-testing/experiments/<name>/experiment.json
Runbook:    plugins/wf-sandbox-testing/experiments/<name>/runbooks/experiment.md
Arms:       <n> (<label>=<ref>, ...)
Signals:    <n> declared — validated present, never read by the current engine
Checks:     manifest-load <verdict> · dry-run <verdict> · runbook-derivation <verdict> · runbook-parity <verdict> · no-placeholders <verdict> · paths-resolve <verdict>
Fixes:      <n> finding(s) fixed across <n> pass(es)
Next:       review the runbook, then run its build and gate phases on your own container host — the measured phase is billed and stays your decision
```

The `Checks:` field carries **one token per Phase 3 check, in Phase 3's own order** — all six, always,
so a check can never be silently omitted from the report. Each `<verdict>` is one of `pass`, `fail`,
`error` (the check could not run — never collapsed into `pass`), or `not applicable` (the check had no
target on this kit, per the scope-honesty rule).

`Delivered` — every emitted file is on disk and every applicable check returned a clean verdict.
`Stopped` — a required question yielded no valid answer, or a finding survived the fix cap; the
reason and any open finding are named above the block.

**The final-output block must always be the very last thing output to chat.**
