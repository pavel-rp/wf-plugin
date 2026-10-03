# Certified commit — ops

**Version:** 1.0.0
**Model:** claude-opus-5-5

The runtime doc every **guarded push path** follows before a pushed head is taken past verification.
Obtained via `resolve_content({ workspaceRoot, ... })` (`class: contract`, `ref: certified-commit.ops.md`),
never a raw `Read`. It complements artifact-digest gate freshness and run evidence; it replaces neither
and adds no gate token.

**Reference:** rationale and evidence live in the paired `certified-commit` reference doc — never read at boot.

**Contents:** certification record · effective binding · drift ledger · change kinds · the drift check ·
drift-mode audit · scenarios.

## Certification record

`/wf:verify-spec` writes one header line into every `04_verify.md`:

- **PASS** → `**Certified:** commit <A>, tree <T>` — `A` is the audited HEAD commit; `T` is the **content
  identity of the audited tree**: HEAD's tree when the audit read `HEAD`, and the identity the audited
  working tree would receive if committed as-is (change-set files included) when the audit read the working
  tree (round ≥2). Committing exactly the audited content therefore yields a head whose tree is `T`.
- **FAIL / PARTIAL** → `**Certified:** none — verdict <FAIL | PARTIAL>`.

Tree identity is gathered by outcome against the local working tree, like the report's other commit
coordinates (no delivery operation covers it). A **legacy** PASS report with no `**Certified:**` line binds
to its `**Commit:**` tree only when its `**Tree:**` reads `clean`; otherwise it is `unbound`.

## Effective binding

The binding a check compares against. Start from the latest `04_verify.md`'s certification, then walk
`04_drift.md` rows recorded after its `**Audited at:**`, oldest first: each `carry-forward` row whose
`From` equals the current binding advances it to that row's `To`. The result is `(commit, tree)`, or
`unbound` (no PASS certification). A re-verify rebinds by writing a fresh `04_verify.md`, never by a row.

## Drift ledger

`{task-root}/{task-id}/04_drift.md` — append-only, one row per resolved drift event, never rewritten:

```
# {task-id} — Drift ledger

| # | From | To | Kind | Resolution | Path | Recorded by | At |
|---|---|---|---|---|---|---|---|
| 1 | `<commit>` / `<tree>` | `<commit>` / `<tree>` | `<base-sync \| version-bump \| code>` | `<carry-forward \| re-verify PASS \| re-verify FAIL \| re-verify PARTIAL>` | `<guarded path>` | <model id> | <ISO 8601> |
```

The writer creates the file with this header on its first row. `Path` names the component that recorded
the row: the guarded push path for a `carry-forward` row (e.g. `pr`), `verify-spec` for a `re-verify` row.
A **drift event** is the pair (`From` tree, `To` tree).

## Change kinds

Classify the drift diff between the binding's tree and the head's tree. Closed set, first match wins:

1. **`base-sync`** — carry-forward. The branch's own diff against its base at the head is identical to its
   diff against its base at the binding: only the base moved underneath it.
2. **`version-bump`** — carry-forward. `coreConfig.versionDeclaration` is configured and every changed path is
   that declaration. Never applies when it is unconfigured.
3. **`code`** — everything else. Needs a re-verify.

## The drift check

Inputs: the task folder and the head about to be taken past verification (commit `B`, tree `T_B`). Returns
exactly one outcome; `refuse` carries a reason. Fail closed: an unreadable report, ledger, or tree identity is
`refuse` (`unreadable`), never a pass.

1. No `04_verify.md` → **`inert`** (verification never ran on this task; the path proceeds unchanged).
2. Effective binding is `unbound` → **`refuse`**: reason `reverified-fail` when the latest report carries a
   `**Drift re-verify:**` line (that event's one re-verify ran and did not PASS), else `uncertified` (the
   latest verdict is not PASS). Neither re-runs anything.
3. `T_B` equals the binding's tree → **`bound`**.
4. Classify the drift. `base-sync` or `version-bump` → append a `carry-forward` row (`From` binding, `To` `B`
   / `T_B`, the kind) and return **`carried`**.
5. `code` → **`reverify`**: the caller invokes `/wf:verify-spec {task-id}` **exactly once** through the Skill
   tool, then re-runs this check once without re-entering step 5 — `bound` → proceed; any other result →
   `refuse` (`reverified-fail`).

**One re-verify per drift event.** The re-verify rewrites `04_verify.md` either way: a PASS certifies `T_B`
(step 3 now holds), a non-PASS leaves the task `unbound` (step 2 now refuses). No state reaches step 5 twice
for the same (`From`, `To`) pair. A new head is a new event with its own single re-verify,
so the total never exceeds the number of drift events.

A `refuse` stops the guarded path before its guarded action, stating the outcome, reason, `From`, and `To`.

## Drift-mode audit

`/wf:verify-spec` enters drift mode when the effective binding is bound and its tree differs from the tree
this audit reads. The drift diff is binding-tree → audited tree; its `file:section` list is `drift_sections`.

- **Requirement items.** An item whose prior evidence and location cite no file in the drift diff is
  **carried**: its verdict and evidence are copied from the certified report, suffixed `(carried from <A>)`.
  Only the remaining items are re-audited.
- **Findings.** A fresh finding whose cited lines all lie outside the drift diff is a **drift residual**: it
  renders under `## Accepted warnings` tagged `drift: residual (unchanged since <A>)`, ledger status `warn`,
  disposition `accepted`, and never enters the critic or the blocking set. Findings with a cited line inside
  the drift diff follow the normal blocking rules.
- **Header.** `**Drift re-verify:** <A>..<B> (<kind>)` beneath `**Certified:**`.
- **Ledger row.** After writing the report, append the `re-verify <verdict>` row for the event.

A drift re-verify is round 1 of a new loop (the prior PASS is the loop boundary), so it never runs a second
round of its own: a non-PASS result is a stop for the calling path, not a verify-fix trigger inside it.

## Scenarios

| Given | Check returns | Ledger after |
|---|---|---|
| PASS at A; head tree equals `T` (the audited content committed as-is) | `bound` | unchanged |
| PASS at A; push to B only moved the base | `carried` | `A→B base-sync carry-forward` |
| PASS at A; push to B edits code | `reverify` → re-verify PASS → `bound` | `A→B code re-verify PASS`; `04_verify.md` certifies B |
| as above, re-verify raises findings only on code unchanged since A | `bound` | residuals under `## Accepted warnings`; no second round |
| as above, re-verify FAILs on drift code | `refuse` (`reverified-fail`) | `A→B code re-verify FAIL` |
| same or later head re-checked after that FAIL | `refuse` (`reverified-fail`), no re-verify | unchanged |
| certified at B; second push to C edits code | `reverify` scoped B..C | `B→C code re-verify <verdict>` |
| latest verdict FAIL, head pushed | `refuse` (`uncertified`) | unchanged |
| no `04_verify.md` | `inert` | unchanged |
