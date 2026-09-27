# Certified commit — contract & rationale

**Version:** 1.0.0 (WF-818)
**Model:** claude-opus-5-5

The paired reference for `certified-commit.ops.md`. **Never read at runtime** — the ops doc carries
every behavior-bearing clause; this file carries why each clause exists and what evidence drove it.
Its headings mirror the ops doc's, section for section.

## Why a certified commit

A `/wf:verify-spec` PASS was bound to the report's own bytes (the artifact digest a gate approval seals),
never to the code it audited. `04_verify.md` recorded `**Commit:**`, but nothing downstream compared it
against the head a pull request was opened from. Any commit pushed between the final PASS and PR creation
reached review unaudited.

The WF-754 spike (SP-R2) reconstructed 23 post-PASS review comments and attributed each to the push path
that introduced the flagged line. **Pre-PR drift accounts for 8 of 23 (35%)**, across PRs 276, 316, 326
and 334: manual residual fixes after the last verify round, a verify-fix that skipped its re-audit round,
and last-minute hardening pushed seconds before PR open. The other two paths — CI remediation (6/23) and
review-address fixes (9/23) — are WF-819 and WF-820, which reuse this contract unchanged.

The mechanism complements, never replaces, gate freshness and run evidence: it adds no gate token and no
run-evidence kind, and never changes a gate approval's digest check.

## Certification record

Round ≥2 audits the working tree because `verify-fix` never commits between rounds. The commit that later
carries that audited content is created by `/wf:pr`'s own commit step — after the PASS. Binding to the
audited HEAD commit alone would call every such commit drift and force a pointless re-verify of exactly
the audited bytes. Binding to the content identity of the audited tree makes "commit exactly what was
audited" a `bound` outcome, and makes any byte of difference visible. The commit is still recorded so a
ledger row can name both ends of a drift event in the terms a reader navigates by.

A non-PASS report records `none` rather than omitting the line, so an absent line unambiguously means a
report older than this contract. A legacy PASS report can only be trusted when its tree was clean,
because its `**Commit:**` then identifies the audited content exactly.

## Effective binding

A carry-forward must move the binding, or the next check would compare against the pre-carry tree and
re-flag the same drift. Rewriting `04_verify.md` for a carry-forward would forge an audit that never ran,
so the carry lives in the ledger and the binding is derived by walking it. A re-verify, by contrast, is a
real audit, so it rebinds by writing its own report.

## Drift ledger

Every resolved drift event needs a durable, reviewable record naming both ends and how it was resolved —
the success criteria require a carry-forward record naming A, B and the kind. An append-only file in the
task folder keeps that record inside the write scope of every caller (core.3), survives a context reset,
and never rewrites history a reviewer may already have read.

## Change kinds

A carry-forward must be decidable mechanically, without judgment, or it becomes a bypass.

- **`base-sync`** — syncing onto the latest base before merge is routine, and the branch's own change is
  byte-identical afterwards. Re-auditing it re-audits nothing new.
- **`version-bump`** — every release bumps a version declaration after verification. It is only
  mechanically decidable when the project names that declaration, so it keys on the configured
  `Version Declaration` and never guesses a path. Projects without one pay a re-verify scoped to the bump
  — cheap, and correct.

Everything else is `code`. A wider set (docs-only, comments-only, test-only) was rejected: each needs a
judgment about what the project considers auditable, and a wrong call silently re-opens the gap.

## The drift check

**One outcome, closed set.** Callers branch on a token, not on prose, so each guarded path handles every
case the same way and a guard can pin the set.

**One re-verify per drift event.** Pre-PR pushes are made by a human (or a shipper acting for one), so their
count is bounded by the pushes themselves. Allowing a second re-verify of the same event would let a flaky
or variance-prone audit loop forever under an unattended driver. The bound is structural rather than
counted: the re-verify always rewrites `04_verify.md`, so the next check either finds the head bound (PASS)
or the task unbound (non-PASS) and never reaches the re-verify step again for that pair.

**Fail closed.** An unreadable report, ledger, or tree identity cannot prove the head is the certified one.
Proceeding would make the guard's absence indistinguishable from its success.

**`uncertified`** also covers the shape PR 334 showed: a verify loop that ended on FAIL, followed by a fix
push and a PR. With no PASS there is nothing to carry forward from, so the path refuses rather than opening
a PR over an unaudited fix.

**`inert`** keeps tasks that never ran verification (the fast path) exactly as before: the contract guards
drift from a certified verdict, not the absence of one.

## Drift-mode audit

A re-verify of a small drift re-reads the whole change, and a model audit is not deterministic: it can
raise fresh findings on code the certified PASS already covered (the run-to-run variance case). Treating
those as blocking would turn every drift into a full new loop and let variance, not the drift, decide the
outcome. So a finding whose every cited line lies outside the drift diff is recorded — never dropped — as
an accepted `drift: residual` warning, and requirement items whose evidence the drift did not touch carry
their certified verdict forward. Only the drifted code can block. A non-PASS re-verify is a stop for the
calling path, reported with its reason, never an automatic verify-fix round inside it.

## Scenarios

The table is the acceptance surface WF-818's criteria name: carry-forward, a single re-verify, a second
drift after rebind, the variance case, and refusal without either record. Each row is derivable from the
drift-check steps alone, so a change to the steps that breaks a row is a contract change, not a wording
fix.

## Reuse by other guarded paths

A caller adopts the contract by running the ops doc's drift check immediately before its guarded action
(opening a PR, merging after a remediation push, resolving review threads after a fix push), acting on the
outcome, and naming itself in the `Path` column of any row it writes. Nothing in the ops doc names a
specific caller's phase or flag.
