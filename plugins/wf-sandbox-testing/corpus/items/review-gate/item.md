# Corpus item 2 — the review-gate five requirements (WF-313)

**Model:** claude-opus-4-8
**Kind:** assertion (`expect.json` vs wf-fake scripted threads) · **Tier:** SMOKE
**Scenario:** a shipper reaching the review gate, driven hermetically against `fake-scripts.json`

## Provenance

**WF-313** — "Harden the review gate: a shipper must not merge while claiming no review
landed." On the `/fleet NEU-889` run (2026-07-16), Copilot posted 25 inline findings; 23 were
never answered and several never seen, yet the fleet reported the PRs as
reviewed-or-review-unavailable and merged. **C016 (WF-343) charter OUT-6(d)** names the five
requirements this scenario exercises.

## The five requirements → op-log evidence

The scenario runs hermetically against wf-fake (locked decision 2: no real delivery host).
The op log (`workspace-snapshot/_local/fake/op-log.jsonl`) records at least one scripted path
per requirement:

| # | WF-313 requirement | Scripted path in the op log |
|---|--------------------|-----------------------------|
| 1 | No "no review" claim without a read-back at `HEAD_SHA`. | `review-threads-read` with `args.head-sha` set and a `read-performed: true` response — the merge-blocking claim is made only after a performed read at HEAD. |
| 2 | A poll timeout means **unknown**, never **clean**. | The first `review-threads-read` returns `read-performed: false` (the reviewer poll has not landed) and the first `checks-read` returns `PENDING`; neither is treated as "no findings" — the shipper re-reads, and an unresolved poll resolves to unknown, never clean. |
| 3 | Zero-files-reviewed is a **distinct FAILURE state**, never a pass. | `pr-comments-read` returns a reviewer entry with `files-reviewed: 0` ("wasn't able to review any files"); the shipper surfaces it as a failure and does not merge. |
| 4 | A **reply on every finding thread** before merge. | A `review-thread-reply` op for **each** unresolved thread (`T1`, `T2`) recorded before any merge is attempted. |
| 5 | "**Fixed in code**" distinguishable from "**thread answered**". | `T1` gets both a `review-thread-reply` **and** a `review-thread-resolve` (fixed in code); `T2` gets a `review-thread-reply` only (answered, not resolved) — the two states are distinguishable in the op log. |

Because requirement 3 fires (a zero-files-reviewed reviewer state), the gate **holds**: the
shipper does not merge and ends `SHIP — Blocked` — a shipper must not merge while a review did
not actually happen. That is the gate working, so the green scenario's terminal block is
`Blocked`, and **no** `pr-merge` op appears.

## The assertion (`expect.json`)

Structural over the op log and terminal block — never a transcript exact-match:

- `terminal_block`: name `SHIP`, `status_ere` `^Blocked$` (the gate correctly held).
- `ops_invoked.required_ops`: the five-requirement ops — `review-threads-read`, `checks-read`,
  `pr-comments-read`, `review-thread-reply`, `review-thread-resolve` — all present.
- `files_touched`: the op log is present; nothing under `src/` is written (`ship` is a dispatcher).

## Seeded breakage

`seeded-breakage/runs` records a shipper that **merges while claiming no review landed** — the
exact WF-313 defect: no `review-threads-read` at `HEAD_SHA`, no replies, straight to
`pr-merge`, ending `SHIP — Merged`. Judged against the same `expect.json` it turns **red**,
naming `terminal_block` (status `Merged`, not `Blocked`) and `ops_invoked` (missing the
read-back, the zero-files read, and every reply) — i.e. requirements 1, 3, 4, and 5 unmet.

## Canned-vs-real disclosure

Same as item 1: real containerized runs need Docker + `CLAUDE_CODE_OAUTH_TOKEN`, unavailable
here. These run sets are **canned artifacts shaped exactly like the WF-345 runner's output
tree**; `fake-scripts.json` is the real wf-fake scripts file the scenario would drive, and
`runner/run-skill.sh` regenerates the run bytes from a live container when one is available.
The assertion machinery (`assert/tiers.sh`) is identical either way.

## Invocation

```
assert/tiers.sh smoke --scenario corpus/items/review-gate
# → Verdict: PASS   (terminal_block Blocked, all five requirement ops present)
```
