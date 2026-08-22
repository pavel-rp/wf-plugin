# Relaying the plan and apply envelopes

Read on the Phase 6 and Phase 8 paths only — `/wf:init` reaches this file
through `resolve_content({ workspaceRoot, class: "references-template", skill:
"init", ref: "envelope-relay.md" })`, never a raw `Read` of a plugin-cache path,
and never at boot. It covers what to **report** from each envelope and how to
branch on it. It never adds, repeats, or conditions the calls themselves — those
stay in the skill body, where the one-mutation rule is stated.

Both sections obey the same rule the whole skill obeys: **relay, never infer.**
Every field below is read out of the envelope as given.

## Contents

- [Phase 6 — the plan envelope](#phase-6--the-plan-envelope)
- [Phase 8 — the apply envelope](#phase-8--the-apply-envelope)
- [Phase 8 — branch on the outcome](#phase-8--branch-on-the-outcome)

---

## Phase 6 — the plan envelope

Relay, recomputing none of it:

- `applicability`, with its `applicabilityBasis` — the explicit enumeration of
  every blocking finding and every blocking question, so that no blocking
  condition is a silent omission.
- `mode` — the dominant lifecycle effect.
- `actions[]` — every action class in one deterministic order, saying which are
  mutating.
- `registryDelta`, `payloads`, `artifacts`, `repairs`, `evidenceSeeds`, and
  `answers.writes[]` — what would change, and what would be retained.
- `findings[]` — with each code and severity.
- `recovery` and `inventory` — on their own channels, as in Phase 2.

## Phase 8 — the apply envelope

Relay, recomputing none of it:

- `status` — `applied`, `rejected`, `rolled-back`, `halted`, or `invalid-root`,
  with its single closed `reason` token on every non-`applied` outcome, reported
  **verbatim** and never translated into a plausible neighbouring class.
- `applied[]` — what changed.
- `deferred[]` — what was deliberately not changed, each with its own reason.
- `rollback` — how far a guarded rollback got.
- `selfCheck`, `refreshed`, and `residue` — where `residue.clean` is the
  observable statement that no journal, backup, or empty backup directory was
  left behind.
- `recovery` — on its own channel, as always, never folded into the delta.
- `upgrade` — `outcome`, `noDrift`, and every `remaining[]` entry with its class.
  A non-empty `remaining[]` denies a fully-upgraded claim; never translate one
  into success.

## Phase 8 — branch on the outcome

| `status` | next | run ends |
|---|---|---|
| `applied` | Phase 9 | per the rest of the run |
| `rejected` (including `apply/plan-stale`, the id check doing its job) | Phase 9 | `partial` |
| `halted` | Phase 9 | `partial` |
| `rolled-back` | Phase 9 | `partial`, adding the rollback disposition |
| `invalid-root` | — | `stopped` |

On every `partial` outcome, relay the reason and say plainly that the workspace
is unchanged except for the scaffold.
