# C040 SP1 — how audit lenses run for unattended shippers

**Decision:** **A — orchestrator-run lenses at a declared review boundary.**
**Basis:** full measurement of both variants (not the time-box fallback).
**Tracker item:** WF-835 (charter C040, OUT-5). Consumer: WF-836 builds the chosen path.
**Model:** claude-opus-5-5

## Time box

| | UTC instant |
|---|---|
| Start (first measured run started) | `2026-09-27T16:46:42Z` |
| End (last measured run ended) | `2026-09-27T16:48:42Z` |

Both variants were measured inside the 1-day time box, so the time-box fallback (charter
assumption 12) did not apply. No measurement below is missing, estimated or extrapolated.

## Why this spike exists

An unattended shipper must not wait on background children, and completion notices from a
child's own children are unreliable on the host, so every shipper in the C040 fleet run reported
its five audit lenses as `0/5 completed, 5 inline` under WF-833's lens count. SP1 asks which of
two supported paths actually gets the lenses completed for an unattended item: **A**, where the
orchestrator itself dispatches the lenses once the shipper reaches a declared review boundary, or
**B**, where the shipper writes a lens-request file and waits, bounded, for result files that a
separately started lens runner writes. Nested dispatch that relies on a grandchild's completion
notice was deliberately not a candidate.

## Measurements

"Completed" follows WF-833 (`verify-template.md` §"Lens count"): `<e>` is the five enabled
`wf-audit` lens rows; `<c>` counts lenses whose own isolated dispatch returned a well-formed
`AUDIT-<LENS> — clean|findings` block; `<i>` counts lens rubrics a session ran in its own context
instead of dispatching. A **stall** is a hard timeout (exit 124) or a bounded wait that expired
before its condition held.

| Measurement | Variant A — orchestrator-run lenses | Variant B — shipper file-handoff wait |
|---|---|---|
| Completed lens count | `5/5 completed, 0 inline` | `5/5 completed, 0 inline` |
| Stalls | 0 (orchestrator exit 0; no timeout) | 0 (shipper exit 0, runner exit 0; shipper wait `WAIT-EXIT 0`, runner request wait satisfied) |
| Wall-clock | 49 s harness (`16:46:42Z`–`16:47:31Z`); session `duration_ms` 45618 | 57 s harness (`16:47:45Z`–`16:48:42Z`); shipper `duration_ms` 52296, runner `duration_ms` 44769 |
| Host version | `claude --version` → `2.1.283 (Claude Code)`; session self-reported wf `0.169.0` | `claude --version` → `2.1.283 (Claude Code)`; both sessions self-reported wf `0.169.0` |
| Session mode | one fresh headless `-p` orchestrator session (`--model opus`, stream-json, permissions bypassed, plain working copy, no worktree); shipper = its first-level foreground `general-purpose` child; the five lenses = its own first-level foreground `wf-audit:*-auditor` children dispatched in one message | two fresh headless `-p` sessions (`--model opus`, same flags) started by one harness invocation and sharing one working copy: a shipper session (no subagents; one foreground bounded `timeout 420` poll) and a lens-runner session (one foreground bounded `timeout 300` poll, then the five lenses as its own first-level foreground children, results written to `.lens/results/<lens>.md`) |

Both variants ran against the same item: a scratch git repository with no remote, seed tree
`725f5ed7a20d3428b9003deedfe98a2c9dc2d534`, and the same prescribed change (add `subtract(a, b)`
to `calc.js`), which produced the identical post-change tree
`09571c3a68020f38dc2876a5e55e9c8f56aa5df8` in both runs. Each session loaded the working copies of
the `wf` and `wf-audit` plugins via `--plugin-dir`, with the installed marketplace copies disabled
through `--settings`, under subscription login (no API key in the environment), and each ran
under a hard `timeout 560`. The measured shipper is a reduced headless shipper: it applies the
change, commits locally, and stops at the review boundary. It does not run the full ceremony,
because the variable under test is the lens path, not the build chain.

## Decision and rationale

The decision rule fixed in the spec before measuring: a variant *qualifies* when it reaches
`5/5 completed, 0 inline` with 0 stalls. Exactly one qualifies → adopt it; both qualify → adopt
**A**; neither qualifies → `neither`.

Both variants qualified, so the rule adopts **A**. The measurements separate the two by little
(49 s against 57 s, both complete), so the choice rests on what each path costs the shipper:

- **A keeps every wait out of the shipper.** The shipper returns at the review boundary and the
  orchestrator, which already waits on its own children, dispatches the lenses as its own direct
  children. No lens is a grandchild of the orchestrator, so nothing depends on the unreliable
  nested completion notice.
- **B puts a polling wait inside the shipper.** It worked here, but it reintroduces exactly the
  kind of shipper-side wait the no-waiting rule forbids, and it needs a second long-lived session
  whose start-up the shipper cannot see. A lens runner that never starts would surface only as an
  expired wait.

WF-836 should build A: a declared review boundary at which the shipper hands back, plus an
orchestrator step that dispatches the enabled lens rows as its own children and records their
blocks against the item, so the item's `**Lenses:**` count reflects them.

## Limits of this result

- One run per variant, on one host version (`2.1.283`), in headless `-p` sessions. Re-check on host
  upgrade; WF-833's lens-coverage figure on a real fleet run is the regression detector.
- The lens dispatches in both runs were foreground and returned; the log also carries
  `task_started`/`task_notification` system events for them. A host that makes child dispatch
  background-only would change A and B alike and needs re-measuring.
- The item was trivial (a clean change: all ten lens blocks were `clean`), and it is the only diff
  size measured. How lens run time, and the relative wall-clock cost of A and B, vary with diff size
  is **unmeasured**: both variants run the same five lens dispatches, but their fixed hand-back and
  polling overheads differ, so the 49 s against 57 s gap above is not shown to hold for larger
  changes. Re-check on a representative, non-trivial item before generalizing the relative cost.
- Harness defect, recorded rather than hidden: the B shipper's own `OBSERVED <n>/5` self-count
  tested each result file's first line for `AUDIT-`, and every file opens with a code fence, so it
  printed `OBSERVED 0/5`. The completed count above is read from the result files' content
  (`^AUDIT-<LENS> — (clean|findings)` matched once in each of the five files), per the WF-833
  definition, not from that self-count.

## Appendix — commands, digests, excerpts

**Command shape (per session):** `timeout 560 claude -p --model opus --output-format stream-json
--verbose --permission-mode bypassPermissions --settings <scratch>/settings.json --plugin-dir
<repo>/plugins/wf --plugin-dir <repo>/plugins/wf-audit "<prompt>"`, run from the item's working
copy. A: one orchestrator session. B: the runner session started in the background of the harness
script, the shipper session in its foreground, then `wait` on the runner, all inside one harness
invocation.

**Captured logs (sha256):**

| Log | sha256 | bytes |
|---|---|---|
| A `orchestrator.jsonl` | `4419c4d5a9e04c251d92dffd213841c2d644be6b027b0906b4cde4fa954a8d7c` | 192779 |
| A `meta.txt` | `6606acb616ce62bcfc049edf0cd817a614cf99f301160b0c84c26ef378b6bf9b` | — |
| B `shipper.jsonl` | `998630ebafb2658d650b9683081d7b34c70638f974b913c9d3640e83f87f8512` | 85914 |
| B `runner.jsonl` | `f9c1a32f2e5f6540096d11f6949bb3967e08fb46107624dbfaf3b995fe98db84` | 193935 |
| B `meta.txt` | `45945e9987552fde00a6a3cf516b8bd7e00644d3044688ff4246a73de9c7d4ec` | — |
| every session's stderr | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` (empty) | 0 |

**Variant A excerpts** (orchestrator log and harness `meta.txt`):

```
host: 2.1.283 (Claude Code)
start_utc: 2026-09-27T16:46:42Z
orchestrator_exit: 0
end_utc: 2026-09-27T16:47:31Z
WF-VERSION: 0.169.0
REVIEW-BOUNDARY reached 8ea3a83bd04c8bfa552b83b284c1f0d66ee8f869
DISPATCH Agent subagent=wf-audit:correctness-auditor background=False returned=True -> AUDIT-CORRECTNESS — clean
DISPATCH Agent subagent=wf-audit:security-auditor background=False returned=True -> AUDIT-SECURITY — clean
DISPATCH Agent subagent=wf-audit:convention-auditor background=False returned=True -> AUDIT-CONVENTION — clean
DISPATCH Agent subagent=wf-audit:consistency-auditor background=False returned=True -> AUDIT-CONSISTENCY — clean
DISPATCH Agent subagent=wf-audit:operational-auditor background=False returned=True -> AUDIT-OPERATIONAL — clean
LENSES-DONE
RESULT-EVENT: subtype=success is_error=False duration_ms=45618 num_turns=10
```

**Variant B excerpts** (shipper log, runner log, harness `meta.txt`):

```
host: 2.1.283 (Claude Code)
start_utc: 2026-09-27T16:47:45Z
shipper_exit: 0
runner_exit: 0
end_utc: 2026-09-27T16:48:42Z
result_files: consistency.md convention.md correctness.md operational.md security.md
[shipper] WF-VERSION: 0.169.0
[shipper] REVIEW-BOUNDARY reached 1d79242744ba198b1571d36c2f836b40c7e675f6
[shipper] WAIT-EXIT 0
[shipper] WAIT-RESULT: satisfied
[shipper] RESULT-EVENT: subtype=success is_error=False duration_ms=52296 num_turns=7
[runner]  WF-VERSION: 0.169.0
[runner]  REQUEST-SEEN
[runner]  DISPATCH Agent subagent=wf-audit:<each of the five> background=False returned=True -> AUDIT-<LENS> — clean
[runner]  RUNNER-DONE
[runner]  RESULT-EVENT: subtype=success is_error=False duration_ms=44769 num_turns=16
```

The `DISPATCH …` and `RESULT-EVENT …` lines are condensed from the output of the scratch log
parser run over the captured stream-json logs above (the `->` text is the first block line of the
returned lens report); the other lines are verbatim from the logs and `meta.txt`. The harness and prompts lived under the gitignored scratch area
and were deleted when the spike ended; the captured logs and the parser were kept with the task's
local (gitignored) artifacts, so each digest above can be re-checked against them.
