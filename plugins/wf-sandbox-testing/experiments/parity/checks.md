# Parity comparator — recorded checks

**Run:** 2026-07-24
**Model:** claude-opus-5[1m]
**Shell:** `GNU bash, version 5.2.21(1)-release (x86_64-pc-linux-gnu)`
**Comparator:** [`parity-check.sh`](parity-check.sh) · **contract:** [`normalization.md`](normalization.md)

A normalization is only trustworthy if it can be shown to do both jobs: **accept** an equivalent capture
and **reject** a real divergence. An ignored-token set broad enough to pass everything would pass a
retrofit that quietly changed an image ref — the exact failure mode this contract exists to prevent.

So both directions are exercised and transcribed verbatim below. Every command was run from the
repository root; `$` lines are the commands as issued, and the block beneath each is the run's combined
output copied verbatim, followed by its exit code. The only elision is `<abs>` standing in for this
host's checkout path in the derived `(kit root …)` parenthetical — an ignored class
(`normalization.md` §4.4) that differs on every machine. The file-path positions are **not** elided:
they are exactly the arguments as typed, because the comparator echoes each argument as given.

`note()` output goes to stderr alongside the failure lines, matching the kit convention
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
would fail. §4.5 (`/tmp` scratch paths) and §4.6 (stderr narration) are **not** exercised by any committed
fixture: §4.5 is declared ahead of the engine that will need it (the baseline contains no `/tmp` path),
and §4.6 is structural — the comparator never opens a stderr file at all.

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

Three paths were audited as able to report `parity holds` on input that is not equivalent. Each is now
refused rather than accepted.

**4a — a stale bash.** `mapfile` and `declare -A` are bash 4+; under bash 3.2 (still `/bin/bash` on
macOS) they fail non-fatally, and since the script deliberately omits `set -e` the run would otherwise
reach the pass line and exit 0 on a divergent pair. The version is now asserted up front:

```
parity-check.sh: ERROR — requires bash 4+ (found <version>); refusing to run rather than risk a false pass.
```

**Exit code: 2** — an input error, distinct from both a pass and a parity failure.

**4b — a backslash inside double quotes.** Collapsing every `\X` inside `"…"` would make the distinct
argv values `\9c99498` and `9c99498` normalize alike, silently passing a §3.3 divergence. The escape set
is now restricted to `$`, `` ` ``, `"` and `\`, which bash itself honours. Verified against a candidate
carrying `--workload-ref "\9c99498"`:

```
parity-check.sh: FAIL — unit 'pilot:A': diverging token at position 13 — baseline '9c99498', candidate '\9c99498'.
parity-check.sh: parity FAILED — 1 diverging finding(s).
```

**Exit code: 1** — correctly rejected.

**4c — an empty comparison.** A run that compared zero command lines is not a pass. The comparator now
refuses to announce parity over an empty surface:

```
parity-check.sh: ERROR — compared 0 command lines; refusing to report parity over an empty surface.
```

**Exit code: 2.**

Two further rejection paths were exercised while auditing and behave as §6 specifies: a missing unit
gives `FAIL — unit 'analyze:both' is present in the baseline and absent from the candidate
(normalization.md §3.10)`, and a duplicated unit gives `FAIL — unit 'gate:A': line count differs —
baseline 1, candidate 2 (normalization.md §3.9)`. `parity-check.sh --help` prints usage and exits 0;
invoking it with the wrong number of arguments prints usage and exits 2.

---

## What these checks establish together

| Property | Established by |
|---|---|
| The contract accepts the capture it was written from | Check 1 |
| The ignored set cannot mask a divergence in a compared class | Check 2 — a plausible one-token mutation is rejected **by name** |
| A rejection is actionable, not a diff dump | Check 2's `unit … position … baseline … candidate` line |
| The enumerated ignored classes §4.1-§4.4 really are ignored | Check 3 — all four applied at once still passes |
| An extra arm is out of scope, not a failure and not silence | Check 3's explicit out-of-scope line |
| All four phases are in the comparison | Checks 1 and 3 — 6 units: build, gate A/B, pilot A/B, analyze |
| A degraded or empty run refuses rather than passes | Check 4a/4b/4c — each exits 1 or 2, never 0 |

Check 2 is the load-bearing one. Checks 1 and 3 show the comparator is not too strict; Checks 2 and 4
show it is not too lax, and a normalization that cannot reject is worth nothing to the retrofit it is
meant to verify.
