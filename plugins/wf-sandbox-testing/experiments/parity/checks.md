# Parity comparator — recorded checks

**Run:** 2026-07-24
**Model:** claude-opus-5[1m]
**Shell:** `GNU bash, version 5.2.21(1)-release (x86_64-pc-linux-gnu)`
**Kit sha (every `run-experiment.sh:NN` citation resolves at this commit):** `c768673`
**Comparator:** [`parity-check.sh`](parity-check.sh) · **contract:** [`normalization.md`](normalization.md)
**Mechanical form:** [`selfcheck.sh`](selfcheck.sh) — re-runs every verdict below, so a later edit
cannot leave these transcripts quietly stale.

A normalization is only trustworthy if it can be shown to do both jobs: **accept** an equivalent capture
and **reject** a real divergence. An ignored-token set broad enough to pass everything would pass a
retrofit that quietly changed an image ref — the exact failure mode this contract exists to prevent.

So both directions are exercised and transcribed verbatim below. Every command was run from the
repository root; `$` lines are the commands as issued, and the block beneath each is the run's combined
output copied verbatim, followed by its exit code. Exactly one placeholder is elided, host-specific and
not load-bearing: **`<abs>`**, this host's checkout path in the derived `(kit root …)` parenthetical —
an ignored class (`normalization.md` §4.4) that differs on every machine. Nothing else is substituted.
The file-path positions are **not** elided: they are exactly the arguments as typed, because the
comparator echoes each argument as given.

**One block below is not a transcript:** Check 4a's message is quoted from the code path, because this
host runs bash 5 and the branch cannot be reached without a bash 3.2 to run under. It is labelled as
such in place, and carries `${BASH_VERSION}` as written in the source rather than an elided capture.

`log()` output goes to stderr alongside the failure lines, matching the kit convention
(`run-experiment.sh:57`) of keeping stdout free for machine-consumed output.

---

## Check 0 — syntax

```
$ bash -n plugins/wf-sandbox-testing/experiments/parity/parity-check.sh
```

No output. **Exit code: 0.**

---

## Check 1 — self-parity (must PASS)

The normalization applied to the captured baseline compared against itself. This is the sanity floor: a
contract that cannot accept the very capture it was written from is broken before it is used.

```
$ bash plugins/wf-sandbox-testing/experiments/parity/parity-check.sh \
    plugins/wf-sandbox-testing/experiments/fleet-ab/baseline/dry-run-baseline.stdout.txt \
    plugins/wf-sandbox-testing/experiments/fleet-ab/baseline/dry-run-baseline.stdout.txt
```

```
parity-check.sh: baseline:  plugins/wf-sandbox-testing/experiments/fleet-ab/baseline/dry-run-baseline.stdout.txt  (kit root <abs>/plugins/wf-sandbox-testing/experiments/fleet-ab)
parity-check.sh: candidate: plugins/wf-sandbox-testing/experiments/fleet-ab/baseline/dry-run-baseline.stdout.txt  (kit root <abs>/plugins/wf-sandbox-testing/experiments/fleet-ab)
parity-check.sh: compared 6 command line(s) across 6 unit(s); 0 out of scope.
parity-check.sh: parity holds — every compared token is identical after normalization.
```

**Exit code: 0 — PASS.**

All six units — `build:both`, `gate:A`, `gate:B`, `pilot:A`, `pilot:B`, `analyze:both` — were compared,
covering all four phases of the command surface. Nothing was scoped out.

---

## Check 2 — negative sensitivity, one mutated compared-class token (must FAIL)

Fixture: [`testdata/mutated-image-ref.stdout.txt`](testdata/mutated-image-ref.stdout.txt) — a byte-for-byte
copy of the committed baseline with **exactly one** compared-class token changed. On the pilot arm-A line,
the image ref `fleet-ab:armA` was changed to `fleet-ab:armB`. Everything else, including whitespace, is
identical:

```
$ diff plugins/wf-sandbox-testing/experiments/fleet-ab/baseline/dry-run-baseline.stdout.txt \
       plugins/wf-sandbox-testing/experiments/parity/testdata/mutated-image-ref.stdout.txt
5c5
<     docker run … results/run-A:/work/run-output fleet-ab:armA --measured-fleet --arm A …
---
>     docker run … results/run-A:/work/run-output fleet-ab:armB --measured-fleet --arm A …
```

The mutation is chosen deliberately: an image ref is §3.4, precisely the hardcoded token a
manifest-driven engine generalizes, and it is *plausible* — `fleet-ab:armB` occurs legitimately elsewhere
in the same capture, so a comparator that merely checked "does this token appear somewhere" would accept it.

```
$ bash plugins/wf-sandbox-testing/experiments/parity/parity-check.sh \
    plugins/wf-sandbox-testing/experiments/fleet-ab/baseline/dry-run-baseline.stdout.txt \
    plugins/wf-sandbox-testing/experiments/parity/testdata/mutated-image-ref.stdout.txt
```

```
parity-check.sh: baseline:  plugins/wf-sandbox-testing/experiments/fleet-ab/baseline/dry-run-baseline.stdout.txt  (kit root <abs>/plugins/wf-sandbox-testing/experiments/fleet-ab)
parity-check.sh: candidate: plugins/wf-sandbox-testing/experiments/parity/testdata/mutated-image-ref.stdout.txt  (kit root <abs>/plugins/wf-sandbox-testing/experiments/fleet-ab)
parity-check.sh: FAIL — unit 'pilot:A': diverging token at position 8 — baseline 'fleet-ab:armA', candidate 'fleet-ab:armB'.
parity-check.sh: compared 6 command line(s) across 6 unit(s); 0 out of scope.
parity-check.sh: parity FAILED — 1 diverging finding(s).
```

**Exit code: 1 — FAIL, as required.**

The comparison **rejected**, and it **named the diverging token**: the unit (`pilot:A`), the position
(8), the baseline value (`fleet-ab:armA`) and the candidate value (`fleet-ab:armB`) — not a diff dump.
The ignored-token set is therefore not broad enough to mask a real divergence in a compared class.

---

## Check 3 — arm-scoping and four ignored classes together (must PASS)

Fixture: [`testdata/extra-arm-r1.stdout.txt`](testdata/extra-arm-r1.stdout.txt) — a synthetic candidate
that differs from the baseline in four of the ignored classes at once, plus one extra arm:

| Difference | Class |
|---|---|
| a third pilot unit for arm `R1` (`results/run-R1`, `fleet-ab:armR1`, `--arm R1`) | arm-scoping, §5 |
| lines in a completely different order (build, pilot B, pilot R1, pilot A, gate B, gate A, analyze) | ignored §4.1 |
| `--gate-skill '/wf:triage WF-406'` single-quoted instead of `\`-escaped | ignored §4.2 |
| no leading indent and no trailing space on any line | ignored §4.3 |
| a different absolute checkout root (`/opt/checkout/…`) | ignored §4.4 |

If any of those four ignored classes were mis-specified, or if arm-scoping did not hold, this fixture
would fail. Three ignored classes are **not** exercised by a committed *fixture*, and saying which is
part of the record: §4.5 (`/tmp` scratch paths) is exercised by `selfcheck.sh` from generated captures
rather than a fixture, since no pre-retrofit capture contains a `/tmp` path; §4.6 (stderr narration) is
structural — the comparator never opens a stderr file at all, so there is nothing to exercise; and §4.7
(blank lines) is exercised by neither, because no committed capture contains a blank line. §4.7's skip
is asserted from the code path alone (`parity-check.sh` `load_side`) — one of exactly two code-path-only
assertions in this file, the other being Check 4a's bash-4 guard. Both are flagged in place rather than
counted with the executed checks.

```
$ bash plugins/wf-sandbox-testing/experiments/parity/parity-check.sh \
    plugins/wf-sandbox-testing/experiments/fleet-ab/baseline/dry-run-baseline.stdout.txt \
    plugins/wf-sandbox-testing/experiments/parity/testdata/extra-arm-r1.stdout.txt
```

```
parity-check.sh: baseline:  plugins/wf-sandbox-testing/experiments/fleet-ab/baseline/dry-run-baseline.stdout.txt  (kit root <abs>/plugins/wf-sandbox-testing/experiments/fleet-ab)
parity-check.sh: candidate: plugins/wf-sandbox-testing/experiments/parity/testdata/extra-arm-r1.stdout.txt  (kit root /opt/checkout/plugins/wf-sandbox-testing/experiments/fleet-ab)
parity-check.sh: out of scope — unit 'pilot:R1' has no baseline counterpart arm 'R1' (arm-scoping rule, normalization.md §5).
parity-check.sh: compared 6 command line(s) across 6 unit(s); 1 out of scope.
parity-check.sh: parity holds — every compared token is identical after normalization.
```

**Exit code: 0 — PASS.**

The two sides declared different kit roots and the comparator reduced each against its own (§2 N2), the
arm-`R1` unit was reported out of scope rather than failed or silently dropped, and all six baseline
units still compared clean through the reordering and requoting.

---

## Check 4 — the guards that stop a false pass (must not silently pass)

Six paths were audited as able to report `parity holds`, or to produce no verdict at all, on input that
is not equivalent. Each is now refused. The three that need a generated capture rather than a committed
fixture are exercised by [`selfcheck.sh`](selfcheck.sh) at the case named beside them, so none of this
rests on a transcript alone.

**4a — a stale bash.** `mapfile` and `declare -A` are bash 4+; under bash 3.2 (still `/bin/bash` on
macOS) they fail non-fatally, and since the script deliberately omits `set -e` the run would otherwise
reach the pass line and exit 0 on a divergent pair. The version is asserted up front:

```
parity-check.sh: ERROR — requires bash 4+ (found ${BASH_VERSION}); refusing to run rather than risk a false pass (normalization.md §6).
```

**Exit code: 2** — a prerequisite error, distinct from both a pass and a parity failure.

**Evidence class — code path, not a run.** Unlike every other block in this file, the two lines above are
quoted from `parity-check.sh` rather than captured from a run: reaching the branch needs a bash 3.2
interpreter this host does not have. The guard's *presence and shape* are asserted; its *behaviour under
an old bash* is not, and `selfcheck.sh` cannot cover it either. This is one of the two code-path-only
assertions in this file (the other is §4.7's blank-line skip, Check 3) and is deliberately not counted
with the executed checks in the summary table.

**4b — a backslash inside double quotes.** Collapsing every `\X` inside `"…"` would make the distinct
argv values `\9c99498` and `9c99498` normalize alike, silently passing a §3.3 divergence. The escape set
is restricted to `$`, `` ` ``, `"` and `\`, which bash itself honours. Verified against a candidate
carrying `--workload-ref "\9c99498"` (`selfcheck.sh` case 9):

```
parity-check.sh: FAIL — unit 'pilot:A': diverging token at position 13 — baseline '9c99498', candidate '\9c99498'.
parity-check.sh: FAIL — unit 'pilot:B': diverging token at position 13 — baseline '9c99498', candidate '\9c99498'.
parity-check.sh: compared 6 command line(s) across 6 unit(s); 0 out of scope.
parity-check.sh: parity FAILED — 2 diverging finding(s).
```

Both pilot arms carry that ref, so the rewrite lands on both lines and the run reports two findings, not
one. The self-check now asserts the finding **count** alongside the token text (`selfcheck.sh:120`) —
matching on the token alone is exactly what let an earlier revision of this file record a one-finding
verdict for a two-finding run.

**Exit code: 1** — correctly rejected.

**4c — an empty comparison.** A run that compared zero command lines and found nothing wrong is not a
pass; the comparator refuses to announce parity over an empty surface (`ERROR — compared 0 command
lines…`, exit 2). But findings **outrank** that refusal: a run that already produced FAIL findings has
already rejected, so it must exit 1 with its verdict line even though those findings left nothing
comparable behind. Verified with a capture whose kit root contains a `:` — which defeats N3's field
split, so every line is unclassifiable (`selfcheck.sh` case 11):

```
parity-check.sh: FAIL — BASE capture holds an unclassifiable command line (normalization.md §6): 'bash' '/opt/od:d/fleet-ab/build-arm.sh' '--both'
…
parity-check.sh: compared 0 command line(s) across 0 unit(s); 0 out of scope.
parity-check.sh: parity FAILED — 4 diverging finding(s).
```

**Exit code: 1**, not 2 — the loudest possible divergence is reported as a parity failure, not
misrouted as a tooling error.

**4d — a surplus or missing *empty* token.** Comparing token values alone let a trailing `''` compare
`""` against `""` and pass, a false PASS on a genuinely different argv. The comparison now gates on
token **presence** as well as value — see Check 5a, which pins it with a committed fixture.

**4e — a unit carrying more than one line.** The multiset pairing that makes §4.1 safe re-packed its
candidate list with an expansion that tests only element 0, so unsetting element 0 wiped the array and
the run aborted under `set -u` with **no verdict line at all** — neither `parity holds` nor
`parity FAILED`. See Check 5b.

**4f — a control sequence in a candidate token.** A candidate is an untrusted file: a token carrying
`ESC[2K CR` was echoed raw and erased the comparator's own FAIL row on the operator's terminal, hiding
the divergence on screen. Control characters are now rendered as a visible `?` — the divergence is
reported as `candidate '?[2K?X'` (`selfcheck.sh` case 12).

Further rejection paths behave as §6 specifies and are all covered by `selfcheck.sh`: a missing unit
gives `FAIL — unit 'analyze:both' is present in the baseline and absent from the candidate
(normalization.md §3.10)`; a duplicated unit gives `FAIL — unit 'gate:A': line count differs —
baseline 1, candidate 2 (normalization.md §3.9)`; a line over the declared 8192-character bound is
refused as an input error; `--help` prints usage and exits 0; a wrong argument count prints usage and
exits 2; and a mistyped flag is now named — `unknown argument '--dry-run'` — rather than being consumed
as a filename.

---

## Check 5 — the two defects that no fixture caught

Checks 1-3 all passed while 4d and 4e were live, which is the useful lesson: both defects sat on paths
no committed fixture reached — a unit carrying two lines, and a token that is empty. Each now has a
fixture, so neither can return silently.

### 5a — a surplus trailing empty token is rejected (must FAIL)

Fixture: [`testdata/surplus-empty-token.stdout.txt`](testdata/surplus-empty-token.stdout.txt) — the
committed baseline with a single `''` appended to the pilot arm-A line and nothing else changed
(`diff` reports one line, `5c5`).

```
$ bash plugins/wf-sandbox-testing/experiments/parity/parity-check.sh \
    plugins/wf-sandbox-testing/experiments/fleet-ab/baseline/dry-run-baseline.stdout.txt \
    plugins/wf-sandbox-testing/experiments/parity/testdata/surplus-empty-token.stdout.txt
```

```
parity-check.sh: baseline:  plugins/wf-sandbox-testing/experiments/fleet-ab/baseline/dry-run-baseline.stdout.txt  (kit root <abs>/plugins/wf-sandbox-testing/experiments/fleet-ab)
parity-check.sh: candidate: plugins/wf-sandbox-testing/experiments/parity/testdata/surplus-empty-token.stdout.txt  (kit root <abs>/plugins/wf-sandbox-testing/experiments/fleet-ab)
parity-check.sh: FAIL — unit 'pilot:A': candidate has a surplus token at position 18 — ''.
parity-check.sh: compared 6 command line(s) across 6 unit(s); 0 out of scope.
parity-check.sh: parity FAILED — 1 diverging finding(s).
```

**Exit code: 1 — FAIL, as required.** Before the fix this same pair reported `parity holds` and exited 0.

### 5b — a unit carrying two lines still reaches a verdict (must PASS)

Fixture: [`testdata/two-line-unit.stdout.txt`](testdata/two-line-unit.stdout.txt) — a four-line capture
whose `pilot:A` unit carries two lines (`--shard 1`, `--shard 2`), compared with itself. Self-comparison
is the shape that triggered the abort: the first occurrence matches candidate element 0, and unsetting
element 0 was what wiped the list.

```
$ bash plugins/wf-sandbox-testing/experiments/parity/parity-check.sh \
    plugins/wf-sandbox-testing/experiments/parity/testdata/two-line-unit.stdout.txt \
    plugins/wf-sandbox-testing/experiments/parity/testdata/two-line-unit.stdout.txt
```

```
parity-check.sh: baseline:  plugins/wf-sandbox-testing/experiments/parity/testdata/two-line-unit.stdout.txt  (kit root /opt/kit/fleet-ab)
parity-check.sh: candidate: plugins/wf-sandbox-testing/experiments/parity/testdata/two-line-unit.stdout.txt  (kit root /opt/kit/fleet-ab)
parity-check.sh: compared 4 command line(s) across 3 unit(s); 0 out of scope.
parity-check.sh: parity holds — every compared token is identical after normalization.
```

**Exit code: 0 — PASS.** Before the fix this aborted with `parity-check.sh: line 230: cand_free[$n]:
unbound variable` and printed no verdict line at all. Note the kit root here is `/opt/kit/fleet-ab`,
declared by the fixture itself — not elided, because the fixture is synthetic rather than host-captured.

### 5c — the same unit reordered, across a different kit root (must PASS)

Fixture: [`testdata/two-line-unit-reordered.stdout.txt`](testdata/two-line-unit-reordered.stdout.txt) —
the same four commands in a different order, with the two `pilot:A` occurrences swapped, under the
unrelated root `/srv/checkout/fleet-ab`. This is what the multiset pairing exists for: §4.1 must ignore
the reordering without discarding either line.

```
$ bash plugins/wf-sandbox-testing/experiments/parity/parity-check.sh \
    plugins/wf-sandbox-testing/experiments/parity/testdata/two-line-unit.stdout.txt \
    plugins/wf-sandbox-testing/experiments/parity/testdata/two-line-unit-reordered.stdout.txt
```

```
parity-check.sh: baseline:  plugins/wf-sandbox-testing/experiments/parity/testdata/two-line-unit.stdout.txt  (kit root /opt/kit/fleet-ab)
parity-check.sh: candidate: plugins/wf-sandbox-testing/experiments/parity/testdata/two-line-unit-reordered.stdout.txt  (kit root /srv/checkout/fleet-ab)
parity-check.sh: compared 4 command line(s) across 3 unit(s); 0 out of scope.
parity-check.sh: parity holds — every compared token is identical after normalization.
```

**Exit code: 0 — PASS.**

---

## Check 6 — the whole record, re-runnable

```
$ bash plugins/wf-sandbox-testing/experiments/parity/selfcheck.sh
```

```
parity selfcheck: PASS
```

**Exit code: 0.**

`selfcheck.sh` re-runs every verdict in this file plus the cases that need a generated capture, and
asserts the exit code and the reported text of each. It was itself checked against a deliberately
reverted comparator: with the 4d presence gate removed it fails with
`selfcheck: surplus empty token — expected exit 1, got 0`, so it is known to be capable of failing
rather than merely observed to pass.

---

## What these checks establish together

| Property | Established by |
|---|---|
| The contract accepts the capture it was written from | Check 1 |
| The ignored set cannot mask a divergence in a compared class | Check 2 — a plausible one-token mutation is rejected **by name** |
| A rejection is actionable, not a diff dump | Check 2's `unit … position … baseline … candidate` line |
| The enumerated ignored classes §4.1-§4.4 really are ignored | Check 3 — all four applied at once still passes |
| §4.5 ignores the random directory *only*, not the staged basename | `selfcheck.sh` case 10 — both directions |
| §4.7 and the 4a bash-4 guard are asserted from the code path alone | stated in Check 3 and Check 4a, neither claimed as fixture-backed |
| An extra arm is out of scope, not a failure and not silence | Check 3's explicit out-of-scope line |
| All four phases are in the comparison | Checks 1 and 3 — 6 units: build, gate A/B, pilot A/B, analyze |
| A degraded, empty, or hostile run refuses rather than passes | Check 4b-4f — each *run* exits 1 or 2, never 0 (4a is code-path evidence only, see its block) |
| A findings-bearing run exits 1 with a verdict, never 2 | Check 4c |
| An empty token is a token | Check 5a |
| A multi-line unit reaches a verdict, ordered or not | Checks 5b and 5c |
| The record above is re-runnable and can fail | Check 6 |

Check 2 is the load-bearing one; Check 5a is the cautionary one. Checks 1, 3 and 5b/5c show the
comparator is not too strict; Checks 2, 4 and 5a show it is not too lax. Checks 1-3 all passed while
two false-pass paths were live, which is why Check 6 exists: prose transcripts record what happened
once, and only the self-check keeps that true after the next edit.
