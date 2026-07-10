# wf-angular:test-page — bootstrap (first run)

Check for `_page-tests/harness.ts` and the git-exclude entry before scaffolding.

## 1. Harness file

If `{test-host-root}/{sandbox-host-folder}/_page-tests/harness.ts` is missing (the `{test-host-root}` and `{sandbox-host-folder}` slots from the `angular` profile — see SKILL.md "Stack profile"), create the folder and write the harness. See the harness reference (linked from SKILL.md) for the API surface and output format; keep it framework-free — no imports beyond `@angular/core` types (and those are type-only — the runner doesn't need DI).

## 2. Git exclude

Append this line to `.git/info/exclude` if not already present:

```
{test-host-root}/{sandbox-host-folder}/_page-tests/
```

Use `.git/info/exclude` (local-only, per-clone) — not `.gitignore` (committed). Rationale: this matches how `_local/` is excluded for the sibling `/wf-node-ts:test-node` skill. Each dev opts in on their own machine.

## 3. Sanity check

Run:

```
git check-ignore -v {test-host-root}/{sandbox-host-folder}/_page-tests/harness.ts
```

It should return a line citing `.git/info/exclude`. If it doesn't, the exclude didn't take effect; tell the user before writing any test files.
