# WF-382 controlled A/B — experiment design

**Kind:** experiment design — **no runtime code.** Not read at skill runtime, and **never
present in the seeded experiment workspace** (see §6 Blinding).
**Designed by:** claude-fable-5
**Task:** WF-382 "Judge the umbrella on a re-measured fleet run" — the C024 terminal verdict.
**Companions:** [fleet-run-token-accounting.md](./fleet-run-token-accounting.md) (method),
[wf-token-leak-inventory.md](./wf-token-leak-inventory.md) (defects),
[charter-intake-token-efficiency.md](./charter-intake-token-efficiency.md) (charter).

---

## 1. Why a controlled A/B instead of a bare re-measurement

WF-382 as written compares a re-measured fleet run against the committed baseline
(`plugins/wf-sandbox-testing/accounting/baseline-reference.json`, $114.55). That baseline
is **unreproducible**: it ran on a different machine (Windows host), a different target
repo (`smart-roadmap`), an unknown Claude Code CLI version, with a host guardrail hook,
and its raw transcripts are gone (`baseline-reference.json` carries a descriptor hash, not
a content hash). Any single re-measured run differs from it in *all* of: plugin version,
workload, environment. A delta across that is uninterpretable.

The controlled design removes every difference except the one under judgment:

- **Arm A (control):** the plugin suite as of the baseline era — before any charter
  optimization landed.
- **Arm B (candidate):** the plugin suite at current `main`.
- **Everything else identical:** same umbrella, same target-repo snapshot, same Docker
  image lineage, same CLI version, same model pin, same fake providers with the same
  scripts, same machine, runs spaced but same day.

Arm A serves double duty: it is the control, *and* its shape (agent count, role mix,
phase-cost distribution) is checked against the historical baseline. If the shapes agree,
the aggregate claim can also be stated against $114.55; if they don't, the charter's
stated fallback fires (criterion 6) and the verdict rests on the A/B plus per-sub-task
deltas — explicitly, not silently.

**Agents in either arm are never told they are being measured.** The run must be a normal
fleet run in a normal-looking repo, or the measurement is of experiment-aware behaviour.

---

## 2. Arms

| | ref | wf version | rationale |
|---|---|---|---|
| **A — control** | `90cf319` (#189, 2026-07-19) | 0.79.0 (wf-audit 0.1.7 era) | The exact version identity the committed $114.55 baseline ran on. Predates the routing wave (#194–#200, WF-376/394–400) and the post-harness wave (#202–#211). |
| **B — candidate** | `main` HEAD at experiment freeze (≥ `a7beeab`, wf 0.86.1) | 0.86.1+ | Everything shipped: routing, WF-374, WF-375, WF-377, WF-378, WF-379; WF-380's "do not collapse" decision (WF-381 canceled). |

The treatment is therefore "everything the charter (plus the routing decomposition)
changed since the baseline version" — which is exactly what the umbrella verdict judges.

- *Alternative considered:* arm A = `554f7c4` (#193, 0.80.0, last pre-charter commit)
  isolates charter-only effects but breaks identity with the committed baseline; #190–#193
  are author-caps scaffolding and resolver scoping, unlikely to move fleet cost. Decision:
  `90cf319`, because baseline identity is worth more than excluding four near-inert commits.
- **All packs install from the arm's marketplace ref** (wf, wf-audit, wf-fake). The suite
  is the treatment, not core alone. wf-fake exists at both refs (landed #177, 07-18).
- The experiment kit itself (harness, runner extensions) is **always used at HEAD**,
  outside both arms — measurement code is not part of the treatment.

---

## 3. Constants (identical in both arms — the controlled part)

| dimension | value |
|---|---|
| Base image | one Dockerfile lineage: `node:20-bookworm-slim` (Debian bookworm, Node 20), Claude Code CLI **pinned to one exact version** (e.g. 2.1.218), auto-update disabled |
| Session model | `--model claude-opus-4-8` on the fleet invocation, both arms. Arm B's internal routing may downshift roles — that *is* treatment; the pin only fixes the top of the tree |
| Permissions | `--dangerously-skip-permissions`, headless `claude -p`, `--output-format stream-json` — matching the existing `runner/run-skill.sh` pattern |
| Hooks | **none in either arm** (decided 2026-07-23). Consequence: WF-377's blocked-call delta is invisible here and arm A runs slightly cheaper than the true baseline shape; WF-377 is judged on its own shipped evidence and the verdict says so |
| Providers | wf-fake owning **both** delivery and tracker, scripted from one shared `fake-scripts.json` (umbrella + two sub-task requirement texts exported verbatim from Linear; checks settle deterministically green) |
| Workspace | the target-repo snapshot at one pinned ref **W** (§4), seeded identically per run: fresh clone, local-only history, no remote, deterministic `_local/` init |
| Registration | each arm runs **its own** `/wf:init` + pack init skills during unmeasured container setup (registry format may differ across 7 versions); the measured session starts at `/wf:fleet` and contains nothing else |
| Isolation | fresh container per run, isolated `CLAUDE_CONFIG_DIR`, no egress except the Anthropic API (extend `runner/no-egress.sh` to an API-allowlist variant) |
| Cache hygiene | runs spaced > 5 min apart (prompt-cache TTL) so no arm warms the other's prefix |
| Auth | `CLAUDE_CODE_OAUTH_TOKEN` passthrough, name-only, per the existing runner/CI pattern; `ANTHROPIC_API_KEY` never set |
| Host | your Docker-capable machine (this sandbox has no docker); both arms on the same host, same day, no other heavy load |

---

## 4. Workload — an umbrella from this project's backlog

Decided 2026-07-23: the umbrella comes from the WF backlog, target repo = this repo
(`wf-plugin`) snapshotted at ref **W**.

**Recommended pair — C021 (WF-405) slice: WF-406 + WF-409.**

| | id | type | complexity | deps |
|---|---|---|---|---|
| Task 1 | WF-406 — mirror the spec phase to the tracker via two slots | feat | M | none (first of its chain) |
| Task 2 | WF-409 — compose cleanup articles into the constitution + finalize sweep | feat | M | none (parallel-capable) |

Two independent M-complexity feats mirrors the baseline's SM-2/SM-3 shape (two
near-equal-cost tasks, parallelizable). A synthetic umbrella issue framing them as a
normal two-child tracker umbrella goes into `fake-scripts.json`; the texts are the real
Linear descriptions, exported once, byte-identical in both arms.

- *Lighter alternative:* WF-411 + WF-412 (S + S, both fix, parallel-capable) — cheaper
  runs but weaker shape-comparability to the baseline; use only if budget forces it.
- **Known caveat — version-file contention.** Any two wf-plugin tasks both bump
  `.claude-plugin/marketplace.json`, so fleet's same-file-contention edge may serialize
  the pair. Identical in both arms, so internally valid; it is a *shape* divergence from
  the baseline to record in the comparability check, not a flaw to fix.
- **Known caveat — prose workload.** The baseline shipped TS code; this umbrella ships
  skill prose. verify/qa shape will differ from the baseline's. This is the main reason
  the aggregate-vs-$114.55 claim may fall to the charter's incomparability fallback while
  the A/B claim stands untouched.
- Ref **W** = the current `main` tip at experiment freeze, which **must predate any
  commit of this design doc or the experiment kit** (§6). Both arms get the same W;
  arm A's 0.79.0 skills operating on a 0.86-era checkout is fine — the checkout is
  workload, the installed plugins are treatment.
- The experiment consumes nothing: arm outputs are evidence, the real WF-406/WF-409
  still ship through the normal pipeline later (or arm B's output is cherry-picked
  manually if it happens to be good — out of scope).

---

## 5. Infrastructure — extend `plugins/wf-sandbox-testing/runner/`

Kit home: `plugins/wf-sandbox-testing/experiments/fleet-ab/` (the pack already owns the
runner and the accounting harness; follow precedent).

```
experiments/fleet-ab/
├── Dockerfile             # FROM the runner base; ARG WF_REF (arm) + ARG WORKLOAD_REF (W)
├── build-arm.sh           # builds fleet-ab:armA / fleet-ab:armB, fingerprints inputs
├── seed-workspace.sh      # clone repo@W, strip remote, deterministic timestamps,
│                          #   scripted init: /wf:init + arm's own pack inits + fake config
├── run-arm.sh             # one measured run: claude -p "/wf:fleet <UMB-1>" …
│                          #   collects CLAUDE_CONFIG_DIR/projects/**, op-log,
│                          #   workspace snapshot, run.json (fingerprints, wall-clock)
├── fake-scripts.json      # umbrella + WF-406/WF-409 texts, green checks, merge scripting
├── analyze.sh             # offline, host-side: fleet-cost.mjs measure per run →
│                          #   compare A vs B → mechanism-assertion table (§7)
└── README.md              # run protocol + retry policy (§8)
```

Setup phase (unmeasured) and measured phase are separate `claude` invocations; only the
fleet session's transcripts feed the harness. `run.json` records both session ids so the
split is auditable.

**Archive raw transcripts immediately after each run** (tar into the experiment's results
dir, content-hashed). The historical baseline died of pruned transcripts; this one must
not. **Everything is git-tracked** (decided 2026-07-23): kit, per-run `run.json`, derived
`measure` JSONs, the verdict, *and* the raw transcript archives — committed under
`experiments/fleet-ab/results/`, never `_local/`. Rationale: the experiment graduates
into a pack skill once proven useful, so the kit and its evidence must live on the pack
spine, reviewable and reproducible from the repo alone. Keep the kit's script/README
shapes pack-conventional so a `SKILL.md` wrapper can be added later without restructuring.

---

## 6. Blinding

The agents must experience a normal fleet run. Concretely:

1. **No experiment vocabulary in anything the experiment injects:** not in the
   umbrella/task texts, the seeded `_local/config.md`, fake scripts' strings, or branch
   names. Banned words in injected content: experiment, baseline, measurement,
   token-efficiency, arm, A/B. Scope precisely: the *workload snapshot's own* historical
   docs contain such words legitimately (they were equally visible in the baseline era)
   and are exempt — a tree-wide grep would fail permanently and police the wrong thing.
2. **W predates the kit.** The workspace snapshot is pinned to a commit before this doc
   or `experiments/fleet-ab/` exist on `main`. Belt-and-braces: `seed-workspace.sh`
   verifies `docs/wf382-*` and `experiments/` are absent from the seeded tree and fails
   loudly if not. (`docs/fleet-run-token-accounting.md` etc. are older repo furniture the
   baseline-era agents also could have seen — W just must not *name this experiment*.)
3. **Measurement is offline.** The harness never runs inside the container during the
   measured session; nothing in the container references it.
4. **The judge is blind too** (§7.3): review artifacts are anonymized before comparison.
5. The container presents as a normal dev box: standard env, no telltale mounts, kit
   scripts live outside the workspace tree.

---

## 7. Measurement & analysis (pre-registered)

### 7.1 Cost

Per run: `node plugins/wf-sandbox-testing/accounting/fleet-cost.mjs measure --session <id>
--root <extracted projects dir>` at HEAD, then `compare`. Report totals + `byPhase` +
`byRole` + `byAgent`, dollars first (charter constraint 3). Wall-clock recorded (cache-TTL
exposure differs with duration; report cache-write share separately).

*Attribution parity caveat:* arm A predates WF-401's sidecar `.meta.json` emission, so its
role bucketing falls back to the regex heuristic while arm B may carry meta. Before
comparing per-role tables, hand-review arm A's agent→role map (51-ish rows, one pass).
Totals are unaffected.

### 7.2 Per-mechanism assertions

n=1 per arm is thin for totals but strong for mechanisms — each shipped sub-task predicts
a binary signature in the transcripts:

| sub-task | assertion in arm B (vs arm A) |
|---|---|
| WF-374 | zero gated-off lens boots; zero per-lens `finding-contract` refetches (tool-call inventory, `tool_use`-id deduped) |
| WF-375 | pr/tf dispatch shape matches the settled decision; caller-side context at those steps bounded as decided |
| WF-376/routing | model mix by role: mechanical roles (index/classify/branch-class) on cheaper tiers; arm A all-opus |
| WF-377 | *(not measurable here — no hooks; judged on its own shipped evidence, stated in the verdict)* |
| WF-378 | max shipper context ≤ the stated ceiling; arm A expected to show unbounded growth (baseline: 422K) |
| WF-379 | zero `wf:index` subagents (arm A baseline: ~10 bookkeeping agents) |

Every green assertion turns the total delta from "one noisy number" into a sum of
attributed mechanisms. A red assertion is a finding in its own right.

### 7.3 Quality — "no worse"

Pre-registered rubric, applied blind:

- Collect per arm, per task: `04_verify.md`, all lens findings, PR body + diff, QA report.
- Anonymize (strip arm-identifying paths/ids, label X/Y, shuffle per-task).
- **Real-defect count:** every lens/verify finding adversarially verified against the
  actual workspace snapshot (is it a real defect?) by fresh agents; count confirmed reals
  per arm. A cheaper arm B with fewer confirmed reals **fails** (charter: regression).
- **Spec conformance:** verify-spec verdicts re-checked against the task specs.
- **PR quality:** does the diff implement the spec, pass the repo's own guards
  (`validate-registry`, lints) run post-hoc, read as mergeable?
- Judges: an agent panel (fresh contexts, both orders) + Pavel as tie-breaker.

### 7.4 Per-sub-task fixture deltas (separate evidence stream)

WF-382 requires each shipped sub-task's before/after over the **WF-373/WF-401
`fleet-two-task` fixture**, reported fixture-relative and never summed. That is a
collation job over each sub-task's shipped evidence — independent of this A/B. Missing
delta ⇒ blocks the verdict (WF-376's is indicative-only per the issue). Collate first;
run the A/B while any gaps are being backfilled.

---

## 8. Run protocol

1. **Freeze:** pin `WF_REF_A=90cf319`, `WF_REF_B=<main tip>`, `W`, CLI version, model id.
   Record all in `run.json`.
2. **Dry-run gate (cheap):** arm A image must complete `/wf:init` + registrations and a
   `/wf:triage` of one task headless — proves 0.79.0-era skills + wf-fake + isolated
   config dir still function before spending a fleet run. Same gate for arm B.
3. **Pilot: one run per arm**, order randomized (coin flip), > 5 min apart, same day.
4. **Decide:** if the delta is large and §7.2 assertions are clean → stop, write verdict.
   If ambiguous → one more interleaved pair (A,B,B,A overall), then stop regardless.
5. **Retry policy:** a run that fails for *infrastructure* reasons (container death, auth,
   fake-script gap) is discarded and re-run, with the failure logged in the verdict's
   provenance. A run that completes expensively or with bad findings is **data, never
   discarded**. No cherry-picking.
6. **Stall policy:** fleet is unattended by design; a run exceeding ~3× baseline
   wall-clock (> 12 h) is killed, archived, and counted as an infrastructure failure with
   its partial transcripts kept.

## 9. Verdict mapping (WF-382 success criteria)

| criterion | evidence |
|---|---|
| total lower than committed baseline, figure stated | arm B total vs $114.55 **iff** arm A's shape validates against the baseline (agent count / role mix / phase distribution within reason); otherwise fallback (below). Arm B vs arm A stated always |
| every shipped sub-task carries its fixture-relative delta | §7.4 collation; missing ⇒ verdict blocked; WF-376 indicative-only |
| WF-381 skipped on "do not collapse" | recorded closed-unmet citing WF-380's decision; does not fail the umbrella |
| findings/PRs no worse | §7.3 blind comparison — arm B vs arm A (primary), noted against baseline narrative (secondary) |
| not-lower reported plainly | verdict template has a literal branch for it |
| incomparability fallback | if arm A ≁ baseline (likely given prose-vs-TS workload): aggregate-vs-$114.55 claim explicitly dropped; umbrella closes on per-sub-task deltas + §7.2 mechanisms + §7.3 quality + the arm A/arm B controlled delta — stated as the *stronger* substitute, per the charter's fallback clause |

## 10. Open items before build

1. Export the WF-406 + WF-409 (and umbrella framing) texts from Linear into
   `fake-scripts.json` — via a cheap subagent, verbatim, then scrub per §6.1.
2. Confirm `90cf319`-era fleet/ship run clean against wf-fake headless (the §8.2 dry-run
   gate is the check; budget one debugging session for arm A archaeology).
3. Freeze W and the CLI version; verify the chosen CLI version is installable pinned.
4. Collate §7.4 fixture-relative deltas from the shipped sub-tasks; list gaps.
5. ~~Decide result-archive location~~ — resolved 2026-07-23: everything git-tracked under
   `experiments/fleet-ab/results/` (see §5), anticipating graduation into a pack skill.
