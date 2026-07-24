# The findings loop — turning an observed failure into an assertion

**Model:** claude-opus-4-8

How the corpus grows. This is the procedure the maintainer follows when a new failure is observed:
it becomes a corpus **assertion authored before or with its fix**, never speculative upfront
coverage. Authoring/reference documentation — **no skill reads this file at runtime.**

## Table of contents

- [The one rule: retrofit-first](#the-one-rule-retrofit-first)
- [Step 1 — Capture the observation with provenance](#step-1--capture-the-observation-with-provenance)
- [Step 2 — Choose the item shape](#step-2--choose-the-item-shape)
- [Step 3 — Where the assertion lives](#step-3--where-the-assertion-lives)
- [Step 4 — How the assertion is fingerprinted](#step-4--how-the-assertion-is-fingerprinted)
- [Step 5 — Which tier it joins](#step-5--which-tier-it-joins)
- [Step 6 — Register it and prove it turns red](#step-6--register-it-and-prove-it-turns-red)
- [Worked reference example — the review-gate item](#worked-reference-example--the-review-gate-item)
- [Conformance of the shipped corpus](#conformance-of-the-shipped-corpus)

## The one rule: retrofit-first

**Assertions are born from observations, never from speculation.** A corpus item exists only because
a real failure was seen — a `WF-203` watch-list comment, a named charter watch-list line, a bug
filed against a shipped run. You do not add coverage for a failure mode nobody has hit. This keeps the
corpus small, every item defensible, and a future PR gate trustworthy (it fails only on regressions
of things that actually broke once).

The retrofit is authored **before or with the fix**: the assertion that would have caught the failure
lands in the same change as (or ahead of) the fix, so the fix is proven to close it and the corpus
never drifts from reality.

## Step 1 — Capture the observation with provenance

Write down, for the observation:

- **What broke** — the concrete wrong behaviour (e.g. "the shipper merged while claiming no review
  landed").
- **A resolvable provenance link** — a `WF-<n>` issue/comment or a `C0<n>` charter watch-list line.
  Every corpus item carries one; `corpus/run.sh`'s provenance audit **fails the suite** if any shipped
  item lacks a resolvable link. An observation with no provenance link is not yet a corpus item.

If the observation is not a hermetic behavioural seam a `wf:*` invocation exercises (e.g. it is a
SessionStart-hook property, or a static reference-integrity defect in prose), **do not force a
speculative proxy scenario**. Record it as an explicit deferral with its provenance and a pointer to
its real coverage, exactly as `corpus/manifest.md`'s coverage ledger records the C015 and `/wf:tc`
deferrals. Zero silently dropped.

## Step 2 — Choose the item shape

Every item judges the runner's **structural** outputs — the terminal `NAME — status` block, the
resulting workspace file set, and the invoked contract-op set — over N runs. **No item exact-matches
transcript prose.** Pick one of two shapes:

| Shape | Primitive | Use when |
|-------|-----------|----------|
| **comparison item** | `assert/compare.sh` + a pinned-build **baseline** arm | the assertion is "current behaviour must stay EQUIVALENT to a recorded baseline" (e.g. the empty-slot invariant: an unfilled slot must match the pre-slot baseline per structural family under a variance ceiling) |
| **assertion item** | `assert/tiers.sh` + an `expect.json` | the assertion is a set of declared per-family expectations (required/forbidden terminal status, required ops, required/forbidden file globs) judged variance-aware |

If the failure is "behaviour changed from a known-good point", it is a comparison item; if it is
"these specific structural facts must hold", it is an assertion item.

## Step 3 — Where the assertion lives

A corpus item is a folder under `corpus/items/<name>/`:

```
corpus/items/<name>/
  item.md              the item spec: the invariant, its provenance, the structural signals, and the canned-vs-real disclosure
  expect.json          (assertion items) the per-family expectations + min_pass_rate thresholds
  fake-scripts.json    (scripted scenarios) the real wf-fake scripts.json the run drives
  runs-current/        the green run set — one run-output dir per run (transcript.jsonl + run.json + workspace-snapshot/)
  seeded-breakage/     a run set that MUST turn red — the failure re-introduced, proving the item catches it
  baseline/            (comparison items only) the recorded pinned pre-slot baseline arm (arm.json + N fingerprinted runs)
```

The scripts a scenario drives live **beside the item** (`fake-scripts.json`), not in a shared pool —
each item is self-contained and order-independent. Register the item in `corpus/manifest.md`'s Items
table with its provenance cell (Step 6).

## Step 4 — How the assertion is fingerprinted

Each run-output dir carries a `run.json` whose `fingerprints` block pins the three inputs the runner
hashed for that run (`runner/fingerprint.sh`):

```json
"fingerprints": { "fixture": "<sha256>", "plugin_build": "<sha256>", "cli_version": "<string>" }
```

- **`fixture`** — a SHA-256 over the fixture `project/` tree's **content only** (entries sorted
  `LC_ALL=C`; `.git` churn, the run-output dir, the op log, and `run.json` excluded), so a
  byte-identical fixture always fingerprints identically and any fixture edit is a deliberate
  re-fingerprint event.
- **`plugin_build`** — the same content hash over the installed plugin build under test. A
  **comparison item's** baseline arm records the **pinned earlier** `plugin_build` it was captured
  against (`baseline/arm.json`), which is exactly what lets `compare.sh` compare a current build
  against a pinned pre-change build.
- **`cli_version`** — the `claude --version` string, so CLI drift is a deliberate re-fingerprint
  event, never a silent behaviour change.

When you record a new item's run set, its `run.json` fingerprints come from the runner. For a canned
run set (no container available), shape the `run.json` exactly like the runner's output and record the
fingerprints of the inputs you used; the assertion machinery reads them identically.

## Step 5 — Which tier it joins

Every item declares a tier in its `item.md`:

- **SMOKE (default, preferred)** — the item judges purely **structural** signatures (op set, terminal
  shape, file set) with a cheap model and few runs. Every corpus item to date is SMOKE, because
  structural/deterministic assertions are what keep a future PR gate trustworthy. A new item should be
  SMOKE unless it genuinely cannot be judged structurally.
- **STATISTICAL** — the full N-run protocol, schedulable into idle windows, for an item whose signal
  is only visible across variance (a drift-vs-regression judgement that needs many runs). Reserve it
  for items a single cheap run cannot settle.

The per-tier model and run count are a settings key (`assert/tiers.settings.json`), resolved
override > default — placing an item in a tier never hard-codes a model.

## Step 6 — Register it and prove it turns red

1. Add a row to `corpus/manifest.md`'s **Items** table: the item name, kind, tier, scenario, and its
   **resolvable provenance link**. If the item subsumes or defers a watch-list line, record that in
   the **Subsumption record** / **coverage ledger** with provenance — never silently.
2. Ship a **`seeded-breakage/`** run set that re-introduces the failure and, judged against the same
   `expect.json` (or compared against the same baseline), turns **red** — naming the offending family.
   An item that cannot turn red asserts nothing.
3. Confirm `corpus/run.sh` stays green end to end: the provenance audit passes (your item has a link),
   the declared-slot enumeration still holds, the green run set passes, and the seeded breakage is
   caught.

## Worked reference example — the review-gate item

The `corpus/items/review-gate/` item is the reference walk-through of this procedure:

1. **Observation + provenance (Step 1).** WF-313: on the `/fleet NEU-889` run a shipper merged while
   23 of 25 review findings were unanswered and several never seen — it merged while effectively
   claiming no review landed. Provenance link: **WF-313**, and **C016 (WF-343) OUT-6(d)** names the
   five requirements. Recorded in `item.md`'s Provenance section and the manifest Items row.
2. **Shape (Step 2).** An **assertion item** — the failure is a set of structural facts that must hold
   (a read-back at HEAD before any "no review" claim, a reply on every finding thread, zero-files
   reviewed treated as a distinct FAILURE, resolve-vs-reply distinguishable), so it uses `expect.json`
   + `assert/tiers.sh`, driven hermetically against `fake-scripts.json`.
3. **Location (Step 3).** Everything under `corpus/items/review-gate/`: `item.md`, `expect.json`,
   `fake-scripts.json`, `runs-current/`, `seeded-breakage/`.
4. **Fingerprints (Step 4).** Each run's `run.json` pins the fixture, plugin build, and CLI version;
   the run bytes are canned (no container) but shaped exactly like the runner's tree and regenerable
   by `runner/run-skill.sh`.
5. **Tier (Step 5).** SMOKE — the five requirements map to `ops_invoked` + `terminal_block` signals
   (`review-threads-read`, `checks-read`, `pr-comments-read`, `review-thread-reply`,
   `review-thread-resolve`; terminal `SHIP — Blocked`), all structural.
6. **Registration + red (Step 6).** Manifest Items row #2 with the WF-313 link; `seeded-breakage/`
   records a shipper that merges straight to `pr-merge` ending `SHIP — Merged` and turns red, naming
   `terminal_block` and `ops_invoked`. `corpus/run.sh` runs it green.

Invocation: `assert/tiers.sh smoke --scenario corpus/items/review-gate` gives `Verdict: PASS`.

## Conformance of the shipped corpus

The procedure describes reality, not aspiration: every item already in `corpus/manifest.md` (shipped
by WF-347/WF-348) follows the six steps above. Auditing each against this doc's rules:

| Item | Provenance link (Step 1) | Shape (Step 2) | Location (Step 3) | Fingerprinted (Step 4) | Tier (Step 5) | Turns red (Step 6) | Conforms |
|------|--------------------------|----------------|-------------------|------------------------|---------------|--------------------|----------|
| 1 empty-slot `ship.review` | WF-203 2026-07-17 item 1; C014 (WF-322); C016 OUT-6(a) | comparison (per declared slot) | `items/empty-slot-ship-review/` | `run.json` fixture/plugin/CLI; pinned baseline arm in `baseline/arm.json` | SMOKE | `seeded-breakage/` slot-fill diverges | yes |
| 2 review-gate five requirements | WF-313; C016 OUT-6(d) | assertion (`expect.json`) | `items/review-gate/` | `run.json` fingerprints; canned, regenerable | SMOKE | `seeded-breakage/` merges then red | yes |
| 3 contribution survival across rewording | WF-203 2026-07-17 item 2; C014 (WF-322); C016 OUT-6 | assertion (`expect.json`) | `items/contribution-survival/` | `run.json` fingerprints | SMOKE | `seeded-breakage/` marker dropped then red | yes |
| 4 drift on model swap | WF-203 2026-07-17 item 3; C014 (WF-322); C016 OUT-6 | assertion (`expect.json`) | `items/model-swap-drift/` | `run.json` fingerprints (two model arms) | SMOKE | `seeded-breakage/` drift skips merge then red | yes |
| 5 orphaned overrides at upgrade | WF-203 2026-07-17 item 4; C014 (WF-322); C016 OUT-6 | assertion (`expect.json`) | `items/orphaned-override/` | `run.json` fingerprints | SMOKE | `seeded-breakage/` override removed then red | yes |

All five carry a resolvable provenance link, are one of the two documented shapes, live at
`corpus/items/<name>/`, pin their inputs via `run.json` fingerprints, sit in the SMOKE tier on purely
structural signals, and ship a `seeded-breakage/` set that turns red. The manifest's coverage ledger
additionally records the C014-1 **subsumption** (into item 1) and the C015 / `/wf:tc` **deferrals**
with provenance — the "record a non-scenario observation as an explicit deferral" path of Step 1 in
practice. Zero unprovenanced, zero silently dropped.
