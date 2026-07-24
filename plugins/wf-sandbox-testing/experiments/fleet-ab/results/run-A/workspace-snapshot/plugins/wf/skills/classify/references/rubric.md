# classify rubric — subagent execution

The complete rubric the `wf:classify` **subagent** runs. It is the single source of truth for the type buckets, decision rules, confidence anchors, and output shape. The subagent (`agents/classify.md`) boots from **this file alone** — it reads no other file as part of its boot, so a spawn no longer eagerly loads the full caller-facing `skills/classify/SKILL.md`. The host LLM running `/wf:classify` directly does **not** read this file; it stops at the skill's Phase 2 and delegates here.

## Contents

- [Inputs](#inputs)
- [Type buckets](#type-buckets)
- [Decision rules](#decision-rules--apply-in-order-first-match-wins)
- [Confidence anchors](#confidence-anchors)
- [Edge cases](#edge-cases)
- [Final Output](#final-output)

## Inputs

The subagent is invoked with one of:

- A path to a markdown/text file — read it before classifying.
- Raw requirement text inline — classify directly.

If a path is passed but the file is missing, emit the `CLASSIFY — Error` variant of the Final Output block with `Reason: input file not found at <path>`. Do **not** emit a `CLASSIFY — Complete` block with a placeholder type — the `Type` field is contractually one of the seven buckets and downstream consumers parse it strictly.

Strip any metadata block from the input (YAML frontmatter, `**Type:**`, `**Complexity:**`, `**Created:**`, etc.) so a prior classification label doesn't bias the rubric. Classify against title + description + acceptance criteria only.

## Type buckets

Pick exactly one:

| Type | Meaning |
| --- | --- |
| `feat` | New functionality the system didn't have. Default when nothing else fits. |
| `fix` | Corrects broken behavior in shipped code. |
| `chore` | Maintenance: tooling, dependency bumps, config, non-code housekeeping. |
| `refactor` | Internal code restructure with no behavior change. |
| `migration` | Schema/data/platform migration: DB schema changes, data backfills, framework version bumps that require migration steps. |
| `docs` | Documentation only — README, comments, design docs. No runtime code change. |
| `hotfix` | Urgent production fix — explicitly tagged as production-critical or "urgent prod". Otherwise treat as `fix`. |

## Decision rules — apply in order, first match wins

1. **Explicit type in title.** If the title or description explicitly names a type tag (`[Refactor] …`, `Migration:`, `Hotfix:`, `Chore:`, `Docs:`), use it.
2. **Urgent production fix** → `hotfix`. Signals: "urgent prod", "production outage", "emergency fix", "P0", "live site broken".
3. **Schema/data/version migration** → `migration`. Signals: "migration", "migrate", "schema change", "alter table", "backfill", "upgrade framework to N", "upgrade ORM", "rename column".
4. **Fix broken behavior** → `fix`. Signals: "fix", "bug", "broken", "error", "crash", "fails to", "wrong output", "regression".
5. **Internal restructure, no behavior change** → `refactor`. Signals: "refactor", "restructure", "extract", "rename method", "consolidate", "no behavior change", "cleanup".
6. **Docs only** → `docs`. Signals: "documentation", "README", "comments", "design doc", "ADR", "wiki update".
7. **Maintenance/tooling/dependency** → `chore`. Signals: "chore", "tooling", "dependency", "bump", "upgrade packages", "CI config", ".gitignore".
8. **Otherwise** → `feat`.

**Ordering matters.** Rule 3 (migration) beats rule 4 (fix) — "migrate the broken table schema" is fundamentally a migration. Rule 2 (hotfix) beats rule 4 (fix) — urgency upgrades the bucket.

## Confidence anchors

Don't self-report a vibe. Use these criteria:

- **high** — exactly one bucket clearly fits; no plausible second.
- **medium** — primary bucket fits but a second is defensible (e.g., "refactor that also fixes a small bug", "migration triggered by a production hotfix"). Pick the dominant bucket; record the alternative.
- **low** — no clear keyword anchor in any bucket; OR contradictory signals (e.g., "hotfix the docs migration"); OR input is < 1 sentence of meaningful description.

When confidence is `medium` or `low`, the host may surface the alternative to the user. When `high`, the host proceeds silently.

## Edge cases

- **Empty/placeholder description:** return `Type: feat, Confidence: low, Reason: no substantive description; defaulted to feat.`
- **Multiple type tags in title** (`[Fix][Refactor]`): pick the first; set `Confidence: medium`; place the other in `Alternative`.
- **Title contradicts description** (title says "fix typo", description describes a new endpoint): trust the description; flag the contradiction in `Reason`.
- **Non-English description:** classify on whatever signals are translatable (entity names, type tags). If untranslatable, `Confidence: low`.

## Final Output

Return ONLY the Final Output block — no prose before or after; the rubric reasoning stays in your isolated context.

Success:

```
CLASSIFY — Complete

Type: <feat | fix | chore | refactor | migration | docs | hotfix>
Confidence: <high | medium | low>
Alternative: <type | —>
Reason: <one sentence — what evidence in the input drove the decision>
```

Error (input unreadable, no substantive content, or other unrecoverable condition):

```
CLASSIFY — Error

Reason: <one sentence — what went wrong>
```

**The final output block must always be the very last thing emitted.** Downstream skills grep for `CLASSIFY — Complete` to locate the verdict and `CLASSIFY — Error` to detect failure.
