# Experiment engine — open follow-ups

**Raised by:** the first end-to-end run attempt of the `cost-program-ab` kit on a fresh WSL host
**Fixed under:** `feat/experiment-build-secret-seam` (six defects, see the branch commit)
**Status:** both items below are UNRESOLVED design questions, deliberately left out of that branch

The branch made the engine *runnable*. These two items are what it could not settle without a
decision, and both will recur on the next kit.

---

## 1. The blinding vocabulary collides with the product's own `baseline` domain term

### Problem

The engine's blinding vocabulary and the `wf` plugin's own vocabulary overlap on **baseline**. The
gate scans *injected* content, which includes the `_local/config.md` that `/wf:init` generates — so
any kit that seeds `/wf:init` is blocked by the system under test emitting its own normal output.

`plugins/wf/skills/init/references/config-template.md` carries four occurrences, all belonging to a
single config key:

| # | Text | Line |
|---|---|---|
| 1 | `**QA Baseline Ignore**` (table row) | 45 |
| 2 | `**QA Baseline Ignore**` (description) | 49 |
| 3 | `**Baseline health**` suite | 49 |
| 4 | won't fail a `baseline check` | 49 |

Identical at `554f7c4`, `ff2eb70`, and `3b9f00b` — stable, not drift.

### Stopgap already shipped

`blinding.exempt_literals`, added to `engine/manifest.sh` (schema + validation) and
`engine/seed-workspace.sh` (the gate). `cost-program-ab` declares:

```json
"exempt_literals": ["QA Baseline Ignore", "Baseline health", "baseline check"]
```

Deliberately narrow:

- **exact literals only**, never patterns;
- **blanked, not deleted**, before matching, so a reported violation's line number still points at
  the real line;
- the validator **refuses any literal that contains no vocabulary word** — an exemption matching
  nothing banned is a typo that silently weakens the gate, so it fails loudly instead.

Verified still caught after exemption: bare `baseline`, `BASELINE`, `baseline arm`, a genuine leak
sharing a line with an exempted string, and every other vocabulary word.

### Why it still needs a decision

The stopgap is per-kit and enumerative. Every future kit seeding `/wf:init` must rediscover and
re-declare the same three literals, and any edit to the config template silently re-breaks the gate
at **seed** time — after the images are built, i.e. at the most expensive possible moment.

| Option | Trade-off |
|---|---|
| **1. Drop `baseline`/`baselines` from the default vocabulary** | Cheapest, loses least. The genuinely revealing words are `arm`, `treatment`, `control`, `A/B`, and the kit name. `baseline` is the only one the product uses as a domain term. |
| **2. Scope exemptions to a path** rather than literals | Template edits stop re-breaking the gate; coarser, so it can hide a real leak inside that path. |
| **3. Rename the product's config key** (e.g. "QA Health Ignore") | Removes the collision at source, but that is a breaking config-key change made for a blinding concern — backwards. |
| **4. Keep enumerating literals** | No new work now; recurring maintenance cost and a sharp failure mode. |

**Recommendation:** (1), with (2) as fallback if `baseline` is judged genuinely revealing.

### Note on validity

This does **not** affect any comparison already run. The exemption set is identical across all arms,
so it cannot skew one arm relative to another.

---

## 2. The pinned CLI version is never validated against the kit

### Problem

`cost-program-ab` pins `cli_version: 2.1.218` and the Dockerfile describes that pin as a
deliberately fingerprinted input — "an upgrade is a deliberate re-fingerprint event, never a silent
behavior change". In practice the kit had clearly been authored against an **older** CLI and never
exercised end to end at the pinned version. Three of the six defects on the fix branch were pure
version drift:

| Defect | Symptom at 2.1.218 | On the measured path? |
|---|---|---|
| Container runs as root | CLI refuses `--dangerously-skip-permissions` | no — died at seed |
| `--verbose` missing | `-p --output-format stream-json` refused outright; plain-text error where the harness expects stream-json | **yes** — `run-arm.sh` |
| `grep \| head` SIGPIPE | fatal 141 under `set -o pipefail`; a seed that had *already succeeded* reported as failed | reachable on both |

The `--verbose` one is the serious result: **all three pilot arms would have failed**, and it was
only caught because the gate exists and was run first.

### Why it needs a decision

Nothing forces re-validation when the pin moves. The fingerprint records *which* version was used,
but records equally happily a version the kit has never worked against. The pin currently documents
an intention, not a verified fact.

Options worth weighing:

- a **cheap offline conformance check** per pinned CLI — assert the exact flag combination the
  harness issues is accepted, without spending anything (an unauthenticated invocation reaching the
  auth error is sufficient proof, and is how all three defects above were confirmed);
- make `build.sh` **fail closed** when the pinned version has no recorded conformance pass;
- treat the gate as the conformance check and simply **document** that a pin change mandates a full
  gate across every arm before any spend.

**Recommendation:** the offline conformance check — it is seconds, costs nothing, and would have
caught all three defects before the first image was ever built.
