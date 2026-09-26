# authoring-rules-fixtures

Seeded corpus for `../check-authoring-rules.sh --selftest`. Each top-level folder is one case,
holding files at the repository-relative paths the rules classify on (`plugins/<pack>/...`). The
selftest copies the corpus to a temporary directory, pads every file carrying a
`<!-- pad-to: N -->` marker to exactly N lines, lints each case, and asserts the exact set of rule
ids it fires.

| Case | Expected | Reproduces |
|------|----------|------------|
| `clean` | none | conforming agent, references with and without a TOC, a padded `*-rationale.md`, a core file, a balanced fence, a table with an escaped pipe and a short row |
| `agent-no-frontmatter` | `AR-AGENT` | PR 370 — an authoring rationale placed at `agents/locator-rationale.md` |
| `toc-missing` | `AR-TOC` | PR 370 — `references/continuation.md` at 150 lines and `agents/locator.md` at 149 lines with no `## Contents` |
| `over-budget` | `AR-BUDGET` | PR 331 — `references/coverage-cross-check.md` at 302 runtime-read lines |
| `core-noun` | `AR-CORE` | a core skill body naming a stack noun; the same noun in a pack file and in a core `*-fixtures/` folder stays silent |
| `unbalanced-fence` | `AR-FENCE` | a fence opened and never closed |
| `table-pipe` | `AR-TABLE` | an unescaped pipe inside a table cell |

This folder name ends in `-fixtures`, so every live scan in this suite skips it.
