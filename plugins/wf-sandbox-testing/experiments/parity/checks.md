# Parity comparator — recorded checks

**Run:** 2026-07-24
**Model:** claude-opus-5[1m]
**Shell:** `GNU bash, version 5.2.21(1)-release (x86_64-pc-linux-gnu)`
**Comparator:** [`parity-check.sh`](parity-check.sh) · **contract:** [`normalization.md`](normalization.md)

A normalization is only trustworthy if it can be shown to do both jobs: **accept** an equivalent capture
and **reject** a real divergence. An ignored-token set broad enough to pass everything would pass a
retrofit that quietly changed an image ref — the exact failure mode this contract exists to prevent.

So both directions are exercised and transcribed verbatim below. Every command was run from the
repository root with `<kit>` = `plugins/wf-sandbox-testing/experiments/fleet-ab` and
`<parity>` = `plugins/wf-sandbox-testing/experiments/parity`; the absolute paths in the output are this
host's checkout, which is itself an ignored class (`normalization.md` §4.4) and is elided as `<abs>`
below purely for width.

---

## Check 0 — syntax

```
$ bash -n plugins/wf-sandbox-testing/experiments/parity/parity-check.sh
$ echo $?
0
```

No output, exit 0.

---

## Check 1 — self-parity (must PASS)

The normalization applied to the captured baseline compared against itself. This is the sanity floor: a
contract that cannot accept the very capture it was written from is broken before it is used.

```
$ bash <parity>/parity-check.sh \
    <kit>/baseline/dry-run-baseline.stdout.txt \
    <kit>/baseline/dry-run-baseline.stdout.txt
```

Output, verbatim:

```
parity-check.sh: baseline:  <abs>/<kit>/baseline/dry-run-baseline.stdout.txt  (kit root <abs>/<kit>)
parity-check.sh: candidate: <abs>/<kit>/baseline/dry-run-baseline.stdout.txt  (kit root <abs>/<kit>)
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
$ diff <kit>/baseline/dry-run-baseline.stdout.txt <parity>/testdata/mutated-image-ref.stdout.txt
5c5
<     docker run … results/run-A:/work/run-output fleet-ab:armA --measured-fleet --arm A …
---
>     docker run … results/run-A:/work/run-output fleet-ab:armB --measured-fleet --arm A …
```

The mutation is chosen deliberately: an image ref is §3.4, precisely the hardcoded token a
manifest-driven engine generalizes, and it is *plausible* — `fleet-ab:armB` occurs legitimately elsewhere
in the same capture, so a comparator that merely checked "does this token appear somewhere" would accept it.

```
$ bash <parity>/parity-check.sh \
    <kit>/baseline/dry-run-baseline.stdout.txt \
    <parity>/testdata/mutated-image-ref.stdout.txt
```

Output, verbatim:

```
parity-check.sh: baseline:  <abs>/<kit>/baseline/dry-run-baseline.stdout.txt  (kit root <abs>/<kit>)
parity-check.sh: candidate: <abs>/<parity>/testdata/mutated-image-ref.stdout.txt  (kit root <abs>/<kit>)
parity-check.sh: FAIL — unit 'pilot:A': diverging token at position 8 — baseline 'fleet-ab:armA', candidate 'fleet-ab:armB'.
parity-check.sh: compared 6 command line(s) across 6 unit(s); 0 out of scope.
parity-check.sh: parity FAILED — 1 diverging finding(s).
```

**Exit code: 1 — FAIL, as required.**

The comparison **rejected**, and it **named the diverging token**: the unit (`pilot:A`), the position
(8), the baseline value (`fleet-ab:armA`) and the candidate value (`fleet-ab:armB`) — not a diff dump.
The ignored-token set is therefore not broad enough to mask a real divergence in a compared class.

---

## Check 3 — arm-scoping and the ignored classes together (must PASS)

Fixture: [`testdata/extra-arm-r1.stdout.txt`](testdata/extra-arm-r1.stdout.txt) — a synthetic candidate
that differs from the baseline in **every ignored class at once**, plus one extra arm:

| Difference | Class |
|---|---|
| a third pilot unit for arm `R1` (`results/run-R1`, `fleet-ab:armR1`, `--arm R1`) | arm-scoping, §5 |
| lines in a completely different order (build, pilot B, pilot R1, pilot A, gate B, gate A, analyze) | ignored §4.1 |
| `--gate-skill '/wf:triage WF-406'` single-quoted instead of `\`-escaped | ignored §4.2 |
| no leading indent and no trailing space on any line | ignored §4.3 |
| a different absolute checkout root (`/opt/checkout/…`) | ignored §4.4 |

If any ignored class were mis-specified, or if arm-scoping did not hold, this fixture would fail.

```
$ bash <parity>/parity-check.sh \
    <kit>/baseline/dry-run-baseline.stdout.txt \
    <parity>/testdata/extra-arm-r1.stdout.txt
```

Output, verbatim:

```
parity-check.sh: baseline:  <abs>/<kit>/baseline/dry-run-baseline.stdout.txt  (kit root <abs>/<kit>)
parity-check.sh: candidate: <abs>/<parity>/testdata/extra-arm-r1.stdout.txt  (kit root /opt/checkout/plugins/wf-sandbox-testing/experiments/fleet-ab)
parity-check.sh: out of scope — unit 'pilot:R1' has no baseline counterpart arm 'R1' (arm-scoping rule, normalization.md §5).
parity-check.sh: compared 6 command line(s) across 6 unit(s); 1 out of scope.
parity-check.sh: parity holds — every compared token is identical after normalization.
```

**Exit code: 0 — PASS.**

The two sides declared different kit roots and the comparator reduced each against its own (§2 N2), the
arm-`R1` unit was reported out of scope rather than failed or silently dropped, and all six baseline
units still compared clean through the reordering and requoting.

---

## What these three checks establish together

| Property | Established by |
|---|---|
| The contract accepts the capture it was written from | Check 1 |
| The ignored set cannot mask a divergence in a compared class | Check 2 — a plausible one-token mutation is rejected **by name** |
| A rejection is actionable, not a diff dump | Check 2's `unit … position … baseline … candidate` line |
| The enumerated ignored classes really are ignored | Check 3 — all four applied at once still passes |
| An extra arm is out of scope, not a failure and not silence | Check 3's explicit out-of-scope line |
| All four phases are in the comparison | Checks 1 and 3 — 6 units: build, gate A/B, pilot A/B, analyze |

Check 2 is the load-bearing one. Checks 1 and 3 show the comparator is not too strict; only Check 2 shows
it is not too lax, and a normalization that cannot reject is worth nothing to the retrofit it is meant to
verify.
