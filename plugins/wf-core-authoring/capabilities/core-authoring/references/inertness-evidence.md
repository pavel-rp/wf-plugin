# Inertness evidence — what an unregistered `core-authoring` contributes

**Version:** 1.0.0 (WF-371 — the C023 charter's closing evidence for OUT-9)
**Measured:** 2026-08-16
**Measured by:** claude-opus-5[1m]
**Tree under measurement:** the C023 final tree — all six blocking sub-tasks (WF-362, WF-364, WF-365, WF-366, WF-368, WF-370) merged.

Author-facing. Never read at runtime, by any skill, at any phase — it carries no runtime budget
obligation and nothing dispatches it.

This records the measurement behind the `capabilities-ship-inert` article: *a capability contributes
nothing until it is registered; an unregistered project's behavior is unchanged and no capability
term surfaces.* The claim the capability's own manifest and README make in prose is here made a
recorded reading, taken against the charter's final tree.

---

## The criterion

**Identical apart from the composed-run provenance header** — the `**Composed:**` and `**Registry:**`
lines a composed artifact carries, and the equivalent render-timestamp field a resolver snapshot
carries.

The task's title says "byte-identical". The charter body says **contributes**, and the body governs.
Byte-identity of files is unsatisfiable by construction: a composed constitution records when it was
composed and from which registry, so two runs differ in those lines no matter what is registered.
Chasing byte-identity would have forced either a false claim or a weakened one. What is compared
instead is every **registration-governed** surface, and the one field that did differ is named
explicitly below rather than rounded away.

## What registration governs, and what it does not

Registration gates a pack's **contributions**: fragments, slot fills, and constitution articles. It
does **not** gate a pack's slash commands. Both exclusions below are load-bearing — the proof would
claim something registration does not govern without them.

### Excluded: bare skill presence

`capability-registry.ops.md` states that `skills:` is "documentation only; native plugin composition
loads them". This checkout demonstrates it directly: `wf-ado`, `wf-audit`, `wf-browser-qa`, `wf-fake`
and `wf-review` are all unregistered here, and every one of their skills still loads and is
invokable. A skill-shaped deliverable of this capability is therefore **visibly present** in the
unregistered fixture by design.

So what is compared is whether a skill **contributes** — reaches a phase, fills a slot, injects an
article — never whether it is **present**. All four `/wf-core-authoring:*` commands load in the
fixture arm and none of them contributes anything, which is the correct and intended behaviour.

### Excluded: the migrated lint scripts

The nine scripts under this capability's fixtures folder are **this repository's own CI scripts**,
invoked by path from `ci.yml` and from the pack fixtures runner regardless of registration. Their
non-execution in an end-user project follows from that project having neither this repository's CI
nor the pack — not from registration. Including them would make the inertness proof claim something
registration does not govern. Their absence from an end-user project's tooling is an observation,
never OUT-9 evidence.

**This exclusion does not dissolve the SUB-9 dependency.** SUB-9 (WF-370) is a *tree* edge, not a
content edge: it was the last sub-task to land, and this is the charter's closing evidence. A proof
taken before the tree stopped moving is not a closing proof, whether or not the thing SUB-9 moved is
itself in the comparison set.

## The three manifest row shapes, each with its basis

Everything this capability ships falls into one of three shapes, and each is covered:

| # | Shape | Instances | The manifest's stated basis |
|---|---|---|---|
| 1 | A `skills:` entry contributing **no** fragments row | 4 — `init`, `new-contract`, `add-term`, `preview-edit` | Each maps to no phase in the `spec → plan → tasks → implement → verify → qa` spine, so it has no legal `phase` / `contribution-kind` pair. It is a maintainer-invoked tool, not a contribution any phase fires. |
| 2 | A fragments `slot` row whose **phase cell is empty** | 1 — `new-skill.constraints append` | A `slot` targets a per-skill composition **point**, not an SDD phase, so it needs no phase at all and its phase cell is an em-dash. This is why the row is legal where shape 1 was not. |
| 3 | **No manifest row at all** | 9 — the fixture lint scripts | A lint script is neither a skill (`skills:` records a `skills/<name>/` folder the pack ships) nor a fragment (it is reached only by a CI runner). Registration gates none of them, which is correct: they gate this repository, not a downstream project. |

Shape 2 is the one that needed a **post-fill** re-check. SUB-4's earlier proof established that a
*declared-but-empty* slot is inert. WF-368 then shipped a real `append` fill for that point, so the
point is no longer merely declared — and the question "does it stay inert here?" became a different
question. That is the question SC-1 below answers.

## The three arms

The comparison shape is the one the sandbox-testing corpus established: a fixture arm that must stay
inert, a control arm that must diverge, and a return to the fixture arm. The control exists because
of that corpus's anti-vacuity rule — *a lint that scans a real tree and finds nothing is
indistinguishable from a lint that is broken*. Without Arm B, "nothing surfaced" is equally
consistent with a detector that can never observe anything.

**How the "pack was never installed" arm is realised.** Every registration-governed surface is
reached *only* through the capability's registry row, so an absent row presents the resolver the same
input state as an absent pack. That equivalence is not asserted — Arm B measures that each surface
does move when the row is present, and Arm C measures that removing it restores the fixture exactly.

### Arm A — pack installed and enabled, capability unregistered

Registry rows: `git`, `linear`, `author-caps`. No `core-authoring` row. The plugin is installed:

```json
{"pluginId":"wf-core-authoring","installed":true,"enabled":true,"version":"0.8.0","valid":true,"issues":[]}
```

Four readings:

1. **The slot** — `resolve_content({class: "slot", skill: "new-skill", point: "constraints"})`:

   ```json
   {"status":"unfilled","refClass":"slot","skillPoint":"new-skill.constraints","reaction":"continue",
    "message":"no contribution or override for slot `new-skill.constraints`."}
   ```

   The `recovery` string directs the host skill to "Execute the skill's inline-default region exactly
   as written (the no-improvisation rule)". `/wf-author-caps:new-skill` therefore runs its own inline
   default — "No additional constraint applies" — and its emitted instructions are unchanged.

2. **Composition** — `preview_composition({})` over every phase: 14 fragments from 3 capabilities.
   Owners: `git` 1, `linear` 8, `author-caps` 5. **Zero entries owned by `core-authoring`**, and no
   entry whose scope names `new-skill.constraints`.

3. **Registry validation** — `validate_registry({})`: `pass`, 0 findings, "3 capability row(s), 3
   manifest(s) checked". The capability's manifest is not among the `ruleSources`; it is never read.

4. **Articles** — a grep of the composed constitution for all ten `article:` keys this capability
   declares returns **0 hits** (exit 1). The record carries `**Registry:** git, linear, author-caps`
   and a `### author-caps` subsection; there is no `### core-authoring` subsection. The distilled
   authoring-vocabulary article does not appear in the injected session context, because that record
   is what the session-start path injects.

### Arm B — the registered control (every surface must move)

One row added, pointing at this worktree's own capability folder rather than the installed cache —
repo-relative on purpose, because the cache held an older version and the control has to bind to the
tree under measurement:

```
| core-authoring | plugins/wf-core-authoring/capabilities/core-authoring |
```

| Surface | Arm A | Arm B |
|---|---|---|
| Slot `new-skill.constraints` | `unfilled` | `composed`, policy `append`, 6885 bytes, `parts[0].source` = `core-authoring` from the worktree path |
| Composition | 14 fragments / 3 capabilities | 15 / 4 — a new `order: 14` entry, `contributionKind: slot`, `scope: new-skill.constraints append` |
| Articles | capability absent from the resolved registry | capability present, `articles[]` carrying exactly its ten declared keys |
| Registry validation | 3 rows, 3 manifests | 4 rows, 4 manifests; `ruleSources` gains the capability manifest |

Every surface moved. The Arm A readings are a measurement, not a blind detector.

### Arm C — unregistered again (must match Arm A)

The row removed. All four readings return to Arm A:

- The slot JSON is **character-for-character** Arm A's, including the `recovery` and `message` strings.
- All 14 composition entries match Arm A field for field, and the summary line is identical.
- Registry validation matches, including its `ruleSources` list — the worktree manifest is gone again.
- The article-key grep stays at 0 hits.

**The single residual difference, recorded rather than rounded away:** `preview_composition`'s
`renderedFrom.generatedAt` field differs between the two arms — it is the snapshot's own render
timestamp. That is the same run-provenance class as a composed artifact's `**Composed:**` and
`**Registry:**` lines, and is exactly what the criterion carves out. No other field in any of the
four readings differs.

## Verdict against the criterion

With `core-authoring` unregistered and its plugin installed and enabled, the pack **contributes
nothing**: no fragment fires, no slot is filled, no article injects, and no authoring term of this
capability surfaces in any core phase. Every registration-governed surface is identical to a checkout
where the pack was never installed, apart from the composed-run provenance header. The divergence
Arm B produced is attributable entirely to the presence of one registry row.

## What was and was not run

Stated plainly, because a proof that quietly overstates its coverage is worse than an honest partial:

- **Run:** `inspect_pack`, `resolve_content` (`class: slot`), `preview_composition`,
  `validate_registry`, `resolve_registry`, and `resolve_refresh` across all three arms; the
  article-key grep over the composed constitution; the repository verify command; and this
  capability's own fixture suite.
- **Not run — the article surface at the composed-artifact level in the control arm.** The
  constitution was not recomposed while Arm B was registered. The article divergence in Arm B is
  therefore measured at `resolve_registry` — the source `/wf:constitution` composes from — while the
  fixture arm's absence is measured at the emitted record itself. The criterion that matters for
  OUT-9 concerns the fixture arm, and that one is measured at the artifact.
- **Not run — the `audit` capability's five verify lenses.** They are unregistered in this checkout
  and are subagent-dispatched. They did not run, and are recorded as **not run** — never as clean.
- **Not run — independent review.** No review provider is registered in this checkout, so no
  independent review of this change was performed.

## If a diff is ever found here

A behavioral diff found by re-taking this measurement is a defect in the sub-task that introduced the
surface, and is **filed and fixed there** — never patched into this evidence file, and never
accommodated by weakening the criterion above. `capabilities-ship-inert` is the article this
measurement exists to hold; a proof edited until it passes proves nothing.

## Re-taking the measurement

No new machinery is involved — every reading above comes from a resolver query the runtime already
exposes. Register the capability to reproduce Arm B, refresh the resolver snapshot, re-take the four
readings, then remove the row and refresh again for Arm C. The registry lives in `_local/config.md`,
which is gitignored, so a fresh worktree already starts in the Arm A state.
