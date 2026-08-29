# Obligation inventory — the 1:1 map across the core-article compression

The compression of the nine core articles into ID'd, one-rule-per-article form is gated by this
artifact, not by the byte budget. Every **normative obligation** — anything a run could be judged
non-conformant against — carried by the pre-compression articles appears exactly once in the
compressed set. **30 in, 30 out, none lost, none invented.**

Authoring reference, read when the articles are rewritten. Never read at runtime.

## Contents

- [Method](#method) — what counts as an obligation
- [The map](#the-map) — 30 rows, pre → post
- [What was removed](#what-was-removed) — the non-obligation text the compression cut
- [Measurements](#measurements) — before, after, and the budget reconciliation

## Method

An **obligation** is a clause a run can be judged non-conformant against. Rationale
("*because a one-shot refactor fails silently*"), restatement, anticipatory rebuttal
("*not a nicety*"), and cross-references between articles are **not** obligations: removing them
changes no verdict. Each pre-compression obligation gets a stable key `O<article>.<n>`; the map
below names the compressed article that carries it.

The two articles that could not reach the ~60-word target without dropping an obligation are
named here with their counts, per [`clause-style.md`](clause-style.md) §The budget:

| Article | Obligations | Words |
|---|---|---|
| `core.2` | **12** | ~85 |
| `core.9` | **4** | ~78 |

Every other article is at or under the target.

## The map

### Article 1 → `core.1` (2 obligations)

| Key | Obligation | Carried by |
|---|---|---|
| O1.1 | A derived artifact (plan, task list) never overrides the spec | `core.1` |
| O1.2 | Conformance is judged against the spec | `core.1` |

### Article 2 → `core.2` (12 obligations — WF-492's amendment is O2.3–O2.12)

| Key | Obligation | Carried by |
|---|---|---|
| O2.1 | Every phase produces an artifact that feeds the next | `core.2` |
| O2.2 | Nothing advances past an unapproved gate | `core.2` |
| O2.3 | A gate is approved by a human, or — in an unattended run — by a recorded self-approval | `core.2` |
| O2.4 | That self-approval is a machine-checkable record the resolver issues into its declared run-evidence class | `core.2` ("resolver-issued run-evidence record") |
| O2.5 | It names the gate it clears | `core.2` ("naming the gate") |
| O2.6 | It binds by digest the artifact it approves | `core.2` ("binding the approved artifact by digest") |
| O2.7 | It is filed before the next phase begins | `core.2` ("filed before the next phase") |
| O2.8 | It is valid only within the run that requested it | `core.2` ("valid only in its requesting run") |
| O2.9 | It is requested by the agent it authorises and never written by it | `core.2` ("requested by but never written by the agent it authorises") |
| O2.10 | Unattended mode is not the requesting agent's to assert; where it cannot be established independently of the agent, the gate is not satisfied | `core.2` ("where the run's unattended mode is established independently of the agent" — the approval path is available only under that condition) |
| O2.11 | An approval that is absent, unmatched, unverifiable, filed for another run, or whose approved artifact has since changed leaves the gate unapproved | `core.2` ("Absent, unmatched, unverifiable, foreign-run, or digest-stale, the gate is unapproved") |
| O2.12 | On an unapproved gate the run halts at that gate and is reported unproven | `core.2` ("the run halts there and is reported unproven") |

### Article 3 → `core.3` (4 obligations)

| Key | Obligation | Carried by |
|---|---|---|
| O3.1 | Nothing writes outside `_local/` except the designated source-mutating skills | `core.3` |
| O3.2 | …and except the declared committed lifecycle artifacts the resolver runtime owns under `.wf/` | `core.3` |
| O3.3 | An artifact is admitted there only when both resolver-managed **and** of a declared class | `core.3` |
| O3.4 | Every other component reads `.wf/` through the resolver and writes only inside `_local/` | `core.3` |

### Article 4 → `core.4` (1 obligation)

| Key | Obligation | Carried by |
|---|---|---|
| O4.1 | Every artifact carries a `**Model:** <id>` line (or a verb-shaped variant) naming its producing model | `core.4` |

### Article 5 → `core.5` (1 obligation)

| Key | Obligation | Carried by |
|---|---|---|
| O5.1 | Commit messages and PR descriptions carry no `Co-Authored-By` trailer, "generated with" footer, emoji, or promotional tagline | `core.5` |

### Article 6 → `core.6` (3 obligations)

| Key | Obligation | Carried by |
|---|---|---|
| O6.1 | All work happens on a feature branch (`feat/…`, `fix/…`, `chore/…`) | `core.6` |
| O6.2 | Pushing to `main` is forbidden regardless of registered capabilities | `core.6` ("whatever is registered") |
| O6.3 | In bare-core mode a branch gate skips with a stated reason rather than silently permitting a `main` commit | `core.6` |

### Article 7 → `core.7` (1 obligation)

| Key | Obligation | Carried by |
|---|---|---|
| O7.1 | Project-specific values are read from `_local/config.md`, never hardcoded into a skill | `core.7` |

### Article 8 → `core.8` (2 obligations)

| Key | Obligation | Carried by |
|---|---|---|
| O8.1 | Every core extension point ships a lean default and runs inert when no capability is registered | `core.8` |
| O8.2 | Core never names or hard-depends on a specific capability | `core.8` |

### Article 9 → `core.9` (4 obligations)

| Key | Obligation | Carried by |
|---|---|---|
| O9.1 | Working, temporary and scratch files route to `_local/scratch/` — never the repo root, a system temp directory, or anywhere alongside tracked files | `core.9` |
| O9.2 | **(a)** A scratch file is deleted by its consumer as that consumer's own last act, in the same run that consumed it, never deferred to a later sweep | `core.9` (a) |
| O9.3 | **(b)** Every run-scoped coordination file (state, handoff, ledger, lock, marker) is deleted by the skill that ends the run, as part of ending it, on success or failure | `core.9` (b) |
| O9.4 | The finalize sweep is a backstop, not a substitute — it excuses neither (a) nor (b) | `core.9` |

**Total: 30 obligations in, 30 out.**

## What was removed

Non-obligation text only. Removing any of it changes no conformance verdict:

| Removed | From | Class |
|---|---|---|
| "An unattended run does not skip the gate — it satisfies the gate with evidence, or it stops." | Article 2 | restatement of O2.2 + O2.12 |
| "That home is not a general writable one" | Article 3 | rationale framing for O3.3 |
| "This holds even in bare-core mode, where…" (the framing, not the rule) | Article 6 | connective; O6.3 kept |
| "This *complements* the write-scope article above: that one bounds where writes may land; this one routes every throwaway…" | Article 9 | cross-reference |
| "Placement alone does not discharge the article: every scratch file also carries a lifecycle, and the two deletion obligations below are **separate, and both mandatory**." | Article 9 | anticipatory rebuttal; both obligations kept as (a)/(b) |
| "It is never deferred to a later sweep, never postponed to the end of the chain, and never left for another skill to notice." | Article 9 (a) | triple restatement; the single "never deferring to a later sweep" is kept |
| "…and neither obligation may be skipped, deferred, or weakened on the grounds that the sweep will catch it." | Article 9 | restatement of O9.4; "excuses neither" is kept |
| Per-article sub-headings ("Per-consumer immediate deletion", "Breadcrumb deletion by the run-ending skill") | Article 9 | labels, not rules |

## Measurements

Measured over `CORE_ARTICLES_BODY`'s non-empty entries, joined with newlines.

| | rendered lines | bytes | words |
|---|---|---|---|
| **Before** (post-WF-492) | 12 | **4,050** | 637 |
| **After** (compressed, ID'd) | 9 | **≤ 2,200** | ≤ 350 |

### Budget reconciliation

The originating brief targets `≤ ~1.2 KB` against a stated `3,338`-byte body. That figure is the
**pre-WF-492** mass: `4,050 − 1,028 (amended article 2) + 316 (its pre-amendment form) = 3,338`.
The amendment added ~712 net bytes of pure obligation — twelve of the thirty rows above sit in
that one article — and the inventory outranks the byte budget by this contract's own rule.

The acceptance figure is therefore restated against the real baseline: **≤ 2.2 KB, ≤ 55% of the
4,050-byte body**, with all 30 obligations intact. Reaching 1.2 KB would require dropping
obligations from `core.2`, which is precisely what this artifact exists to prevent.
