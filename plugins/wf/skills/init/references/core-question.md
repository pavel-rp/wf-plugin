# Core's own setup question

The one setup question core owns itself — the **standup status default**, held in the
`Standup Statuses` table row of `_local/config.md`'s `## Standup` section. (`## Standup` is the section
heading; the value lives in the row beneath it.) Read on the Phase 5 ask path only; never at boot.

Every pack question reaches Phase 5 through `answers.unresolved[]`, relayed from `plan_install`. Core's
question belongs to no pack, so it never appears there and is asked directly — but in the **same single
batch** as the relayed ones, so the run still puts every question to the user exactly once.

## Contents

- [When to ask it](#when-to-ask-it) — the resolved/unresolved rule
- [How to phrase it](#how-to-phrase-it) — the domain-free wording constraint
- [What a skip persists](#what-a-skip-persists) — the three states
- [Persisting the answer](#persisting-the-answer) — the scaffold write

## When to ask it

Ask it **only while unresolved**.

- **Resolved** — the row holds an answered value, **or** the explicit `<skipped>` marker. Do not re-ask
  it and do not rewrite the row.
- **Unresolved** — the row is absent, or holds the never-asked `<none>`.

This is what keeps the skill re-runnable in both directions: a settled workspace re-running it sees no
churn, while a workspace initialized before the question existed picks it up as a delta in the same
single confirmation, with every existing registration preserved.

## How to phrase it

Ask for the default tracker workflow statuses to enumerate open work items for, comma-separated, most
active first. Name **no** stack, domain, or project noun: concrete status names are tracker-specific and
belong to whichever pack supplies them, never to core.

Offer declining as a first-class, pre-filled choice, so accepting the decline costs one keystroke rather
than an invented value.

## What a skip persists

Three states stay distinguishable, because later consumers branch on the distinction:

| State | Row value | Meaning |
|---|---|---|
| never asked | absent, or `<none>` | nobody has put the question to the user yet |
| skipped | `<skipped>` | the user was asked and explicitly declined |
| answered | the status list | a real configured value |

Collapsing skipped into never-asked destroys the distinction and re-asks the question on every later
run; collapsing it into answered reports a decline as configuration.

## Persisting the answer

Write the collected value into the `Standup Statuses` row of `_local/config.md` — the answer when one was
given, the literal `<skipped>` when the user declined. **Never write `<none>` here**; that is the
never-asked state. When the question was not asked because it was already resolved, write nothing.

This is a **scaffold write under `_local/`**, the same authority Phase 3 writes that file under. It is
**not** a lifecycle mutation: it touches no ledger, no registry row, and no enablement, and it leaves
`apply_install` the run's single lifecycle write.
