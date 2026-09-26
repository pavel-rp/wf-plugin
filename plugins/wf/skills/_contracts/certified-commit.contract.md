# Certified commit — contract and rationale

**Version:** 1.0.0 (WF-818)
**Model:** claude-opus-5-5

The paired reference for `certified-commit.ops.md`. **Never read at runtime** — the ops doc carries
every behavior-bearing clause; this file carries why each clause exists and what evidence drove it.

## The gap it closes

A `/wf:verify-spec` PASS was bound to the report's own bytes (the artifact digest a gate approval seals),
never to the code it audited. `04_verify.md` recorded `**Commit:**`, but nothing downstream compared it
against the head a pull request was opened from. Any commit pushed between the final PASS and PR creation
reached review unaudited.

The WF-754 spike (SP-R2) reconstructed 23 post-PASS review comments and
attributed each to the push path that introduced the flagged line. **Pre-PR drift accounts for 8 of 23
(35%)**, across PRs 276, 316, 326 and 334: manual residual fixes after the last verify round, a verify-fix
that skipped its re-audit round, and last-minute hardening pushed seconds before PR open. The other two
paths — CI remediation (6/23) and review-address fixes (9/23) — are WF-819 and WF-820, which reuse this
contract unchanged.

## Why a tree identity, not only a commit

Round ≥2 audits the working tree because `verify-fix` never commits between rounds. The commit that later
carries that audited content is created by `/wf:pr`'s own commit step — after the PASS. Binding to the
audited HEAD commit alone would call every such commit drift and force a pointless re-verify of exactly
the audited bytes. Binding to the content identity of the audited tree makes "commit exactly what was
audited" a `bound` outcome, and makes any byte of difference visible. The commit is still recorded so a
ledger row can name both ends of a drift event in the terms a reader navigates by.

## Why these carry-forward kinds, and only these

A carry-forward must be decidable mechanically, without judgment, or it becomes a bypass.

- **`base-sync`** — syncing onto the latest base before merge is routine, and the branch's own change is
  byte-identical afterwards. Re-auditing it re-audits nothing new.
- **`version-bump`** — every release bumps a version declaration after verification. It is only
  mechanically decidable when the project names that declaration, so it keys on the configured
  `Version Declaration` and never guesses a path. Projects without one pay a re-verify scoped to the bump
  — cheap, and correct.

Everything else is `code`. A wider set (docs-only, comments-only, test-only) was rejected: each needs a
judgment about what the project considers auditable, and a wrong call silently re-opens the gap.

## Why one re-verify per drift event

Pre-PR pushes are made by a human (or a shipper acting for one), so their count is bounded by the pushes
themselves. Allowing a second re-verify of the same event would let a flaky or variance-prone audit loop
forever under an unattended driver. The ops doc makes the bound structural rather than counted: the
re-verify always rewrites `04_verify.md`, so the next check either finds the head bound (PASS) or the task
unbound (non-PASS) and never reaches the re-verify step again for that pair.

## Why drift residuals, not a second round

A re-verify of a small drift re-reads the whole change, and a model audit is not deterministic: it can
raise fresh findings on code the certified PASS already covered (the run-to-run variance case). Treating
those as blocking would turn every drift into a full new loop and let variance, not the drift, decide the
outcome. So a finding whose every cited line lies outside the drift diff is recorded — never dropped — as
an accepted `drift: residual` warning, and requirement items whose evidence the drift did not touch carry
their certified verdict forward. Only the drifted code can block. A non-PASS re-verify is a stop for the
calling path, reported with its reason, never an automatic verify-fix round inside it.

## Why fail closed

An unreadable report, ledger, or tree identity cannot prove the head is the certified one. Proceeding would
make the guard's absence indistinguishable from its success, so each of those states refuses.

## What it does not do

It adds no gate token and no run-evidence kind, and it never changes a gate approval's digest check. A run
that clears every gate still has its PASS bound to a tree; a head that drifts from that tree is caught here,
at the guarded path, not by re-reading gate records.

## Reuse by other guarded paths

A caller adopts the contract by running the ops doc's drift check immediately before its guarded action
(opening a PR, merging after a remediation push, resolving review threads after a fix push), acting on the
outcome, and naming itself in the `Path` column of any row it writes. Nothing in the ops doc names a
specific caller's phase or flag.
