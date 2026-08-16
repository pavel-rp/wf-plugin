# `new-skill.constraints` — why the fill says what it says

Rationale for `fragments/new-skill-constraints.md`, the `core-authoring` capability's fill for the
`new-skill.constraints` composition point. **Read by authors and reviewers, never at slot-fire** —
the fragment is the runtime document, and this file carries everything the fragment deliberately
leaves out.

**Model:** claude-opus-5[1m]

---

## The problem the fill answers

`/wf-author-caps:new-skill` scaffolds a conforming `SKILL.md` against the authoring conventions the
toolkit teaches. Those conventions are pack-authoring conventions: they are true everywhere the
marketplace is installed, and they are deliberately silent about the extra rules that only hold in
the repository that authors the `wf` core plugin.

A skill scaffolded in this repository therefore came out plausible and still failed the repository's
own gates on first validation — core purity, the body budget, the terminal `Next:` line, the release
bump. Each failure was hand-patched after the fact, which is exactly the loop the composition point
exists to close.

The fix is the one the mechanism already offers: `wf-author-caps` declared the point, and this
capability fills it. **One** invocation path — `/wf-author-caps:new-skill` — now emits a
core-compliant skill here and the plain scaffolder's output everywhere else, because the fill
composes only through a registered capability row.

## Why cited, not restated

Every rule in the fill points at the section of `CLAUDE.md` that owns it rather than reproducing its
text. Three reasons:

1. **`runtime-docs-are-bounded`.** The fragment is read mid-run, at the slot marker. A restatement
   would double its length with content the reader can obtain at its source.
2. **One home per rule.** A copy drifts. `CLAUDE.md` §1, §5, §6, §8, and §9 are the live text; a
   second copy inside a capability fragment would silently disagree with them after the next edit,
   and the fragment's copy is the one nobody would think to update.
3. **The fill is about *application*, not about *teaching*.** What the fragment adds over the rule
   is the checkable evidence each constraint must produce — a grep hit count, a line count, the
   literal last two lines, a named bump. That is the part no other document carries.

## The constraint-to-section mapping

| Constraint | Owning section | What the fill adds |
|---|---|---|
| C1 core purity | `CLAUDE.md` §1 (the rule + litmus test), §9 (the post-edit grep is part of "done") | scopes it to a `plugins/wf/` target; requires the grep to be run and its hit count reported; requires *not applicable* for a pack target |
| C2 body budget | `CLAUDE.md` §5 | requires the emitted line count as evidence; states plainly that no gate measures it, so the verdict is inspection |
| C3 terminal `Next:` | `CLAUDE.md` §6 | pins the **last line** specifically, and requires the literal last two lines as evidence |
| C4 attribution / no promotion | `CLAUDE.md` §6 (`**Model:**`), §8 (no AI attribution) | makes both a checked condition of the emission rather than a convention |
| C5 version pair | `CLAUDE.md` §8 | resolves the conflict with the scaffolder's write scope: **name** the bump, never apply it |

## Why C5 reports instead of writes

`new-skill`'s interface declaration forbids writing anything outside the target skill folder — "no
manifest, no registry row, no version manifest, no existing skill body". A slot fill authorizes
exactly the constraints its body names, and a fill that told the scaffolder to edit
`plugin.json` would be asking it to violate its own safety rules.

The success criterion is satisfied without that: the scaffold's output block **names** the bump the
maintainer must make. The maintainer applies it in the same change that lands the skill, which is
where a release decision belongs anyway.

## Why exactly these two added checks

The scaffolder's own Stage 3 set is `validate_skill_interface` plus `glossary-lint.sh`. Reading
`references/scaffolder-loop.md` Stage 3 as `origin/main` ships it confirms the loop already trusts
only the verdict sources the repository's gate trusts:

> Run **every applicable check** over the emitted set. Trust only verdict sources the repository's
> own gate trusts — the typed validator tools in the bundled resolver runtime, and
> `glossary-lint.sh`.

It maps `pass` / `fail` / `error` explicitly, refuses to collapse `error` into a pass, and carries a
scope-honesty rule that forbids reporting an out-of-scope check as clean. Nothing about that needed
rewiring, and nothing in `wf-author-caps` was touched to reach it. The loop consumes whatever check
set the slot content names, so a core-only rule that wants a validator the base set does not reach
names it **inside the fill**.

Two rules here want one:

- **`validate_references`** is the deterministic form of the `declared-paths-resolve` article. An
  emitted core body that instructs invocation of a sibling command or names a
  `${CLAUDE_PLUGIN_ROOT}` path gets those references resolved against the real tree, under `REF-1`
  and `REF-2`. Its instruction-versus-prose classifier is derived at call time from
  `out4-skill-read-guard.sh`, so a prose citation never turns red.
- **`out4-skill-read-guard.sh`** is the deterministic form of the `sibling-skills-are-invoked`
  article. It is a shell guard rather than a typed tool, and it has no single-file mode — it scans
  skill bodies and agent files across every pack. That is why the fill states its target set rather
  than passing the emitted path: the emitted file is inside that set, so a read-instruction in it
  turns the guard red.

Neither is a re-derivation. The fill names them and consumes their verdicts; it copies no pattern
and asserts nothing either one asserts.

## What the fill deliberately does not do

- **It builds no composition machinery.** The point, the marker pair, the merge policy, and the
  resolver's `append` composition all already exist. This is a fragments row and a body.
- **It changes nothing under `plugins/wf-author-caps/`.** That was the whole point of the exercise:
  a pack contribution fills a declared slot without touching the declaring pack.
- **It adds no fixtures check.** The contribution is prose composed by the resolver; the gates that
  actually bind it — registry validation, manifest validation, the slot-marker lint, and the
  glossary lint — already run in CI and already reach it. A new shell check would have nothing left
  to assert.
- **It claims no unregistered-emission proof.** With the capability unregistered the point resolves
  `unfilled` and the scaffolder runs its inline default, which is the mechanism's own guarantee; the
  post-fill inertness proof is owned by its own sub-task.
