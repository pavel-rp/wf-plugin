# Dry-run parity normalization

**Written:** 2026-07-24
**Model:** claude-opus-5[1m]
**Baseline it is written against:** [`../fleet-ab/baseline/dry-run-baseline.stdout.txt`](../fleet-ab/baseline/dry-run-baseline.stdout.txt)
**Executable form:** [`parity-check.sh`](parity-check.sh) · **recorded verdicts:** [`checks.md`](checks.md)

A retrofit that replaces an experiment's shell scripts with a manifest-driven engine claims
**command-sequence equivalence**: the engine's `--dry-run` emits the same commands the scripts did.
"The same" is the whole difficulty. Compare raw bytes and the check fails on a random arm shuffle, a
different checkout path, or a different bash's quoting. Normalize too eagerly and the check silently
accepts a wrong image ref — which is precisely the token the generalization is meant to be careful with.

This file draws that line **enumeratively**. Every class below is stated as either **compared** or
**ignored**, with a concrete example from the committed baseline. There is no third bucket and no
judgment call at comparison time: a class not listed here does not exist as far as parity is concerned,
and encountering an unclassifiable line is a **failure**, never a silent pass.

**The contract is the classification; `parity-check.sh` is its transcription.** If the two ever
disagree, this file is wrong or the script is wrong — they are changed together, never independently.

---

## 1. Surface: what is compared at all

Parity compares **stdout only**.

The kit's orchestrator prints its command lines to stdout (`run-experiment.sh:142`, `:160`, `:204`) and
its human narration to stderr via `log()` (`:57`). Only stdout carries commands, so only stdout is the
parity surface. The committed `dry-run-baseline.stderr.txt` is evidence of how the capture was produced;
it is **not** an input to the comparison.

Each stdout line is one command. Every line is self-identifying — its executable basename or its
`results/{gate,run}-{A,B}` mount target names both the phase and the arm — so no line's meaning depends
on its position in the file. That property is what makes the ignored-ordering rule (§4.1) safe.

---

## 2. Normalization pipeline

Applied to every stdout line of **both** sides, in this order, before anything is compared.

| # | Step | Effect |
|---|---|---|
| N1 | **Tokenize.** Split the line on whitespace runs that are unquoted and unescaped. A backslash escapes the next character; a single-quoted run is literal to its closing quote; a double-quoted run honours the backslash. Whitespace outside any quote separates tokens; an *explicitly quoted* empty token (`''`) is kept as an empty token, while whitespace-only gaps are dropped. | Absorbs the 4-space indent, the trailing space, any inter-token whitespace, and the escaping/quoting *style* while keeping the *value*. `--gate-skill /wf:triage\ WF-406` and `--gate-skill '/wf:triage WF-406'` both yield the two tokens `--gate-skill` and `/wf:triage WF-406`. |
| N2 | **Derive the side's kit root.** The unique token ending in `/build-arm.sh` names it: the kit root is that token minus the `/build-arm.sh` suffix. A side with no such token is rejected (§6). | Each side declares its own root from its own output; no host path is ever hardcoded into the comparator. |
| N3 | **Reduce path fields.** Within each token, split on `:` into fields. A field equal to the kit root becomes `<kit>`; a field beginning with the kit root plus `/` has that prefix replaced by `<kit>/`; a field beginning with `/tmp/` becomes `<tmp>`. All other fields are left byte-for-byte alone. Fields are rejoined with `:`. | `/abs/…/fleet-ab/results/gate-A:/work/run-output` becomes `<kit>/results/gate-A:/work/run-output`. `fleet-ab:armA` round-trips unchanged (neither field is a path). `/wf:triage WF-406` round-trips unchanged. |
| N4 | **Key by unit.** Each normalized line is assigned a `phase:arm` unit key from its own content: a `<kit>/build-arm.sh` token gives `build:both`; a `<kit>/analyze.sh` token gives `analyze:both`; a path field `<kit>/results/gate-<ARM>` gives `gate:<ARM>`; `<kit>/results/run-<ARM>` gives `pilot:<ARM>`. A line matching none is unclassifiable and rejected (§6). | Comparison is unit-against-unit rather than line-N-against-line-N, which is the mechanism that makes ordering irrelevant without discarding any content. |

The result of the pipeline is, per side, a map from unit key to an ordered token list (plus a count of
how many lines carried that key). Everything in §3 is compared on that map; everything in §4 was
dissolved by the pipeline before the map existed.

---

## 3. Compared classes

A difference in any of these **fails** parity and is reported by name.

- **3.1 — Executable path suffix below the kit root.** The `<kit>/`-relative path of the command being
  invoked. *Example:* `<kit>/build-arm.sh` (line 1), `<kit>/analyze.sh` (line 6). An engine invoking
  `<kit>/build.sh` diverges; an engine invoking the same script from a different absolute checkout does
  not (§4.4).
- **3.2 — Every flag.** Each `--…` token, byte-for-byte. *Example:* `--both`, `--measured-fleet`,
  `--workload-ref`, `--gate-skill`, `--umbrella-id`, `--run-a`, `--run-b`, and the `docker run` flags
  `--rm`, `-e`, `-v`.
- **3.3 — Every flag value.** The token following each flag. *Example:* `--wf-ref-a 90cf319`,
  `--wf-ref-b c768673`, `--workload-ref 9c99498`, `--cli-version 2.1.218`, `--umbrella-id WF-405`,
  `--fake-scripts fake-scripts.json`, `--gate-skill /wf:triage WF-406` (compared as one token, including
  its embedded space).
- **3.4 — Image ref.** *Example:* `fleet-ab:armA` (lines 2, 5), `fleet-ab:armB` (lines 3, 4). This is
  exactly the hardcoding a manifest-driven engine generalizes, so it is compared as a whole token: a
  changed repository *or* a changed `arm` suffix is a divergence.
- **3.5 — Mount target, both halves.** *Example:* `<kit>/results/gate-A:/work/run-output`. The host half
  is compared as its `<kit>`-relative suffix (`results/gate-A`); the container half (`/work/run-output`)
  is compared literally, because it is a fixed contract with the container, not a host artefact.
- **3.6 — Arm identity.** The `--arm` flag's value. *Example:* `--arm A` on lines 2 and 5, `--arm B` on
  lines 3 and 4. An engine that mounts `results/run-A` but passes `--arm B` diverges even though both
  tokens exist somewhere in the baseline.
- **3.7 — Flag presence and absence.** A flag present on one side and absent on the other is a
  divergence, in either direction. *Example:* `--packs` is **absent** from every baseline `docker run`
  line because `PACKS` is empty and `run-experiment.sh:140` appends the flag only when it is non-empty.
  An engine emitting `--packs ''` therefore fails parity — correctly, because it is not the same command.
- **3.8 — Token order within a line.** Tokens are compared positionally within their unit. *Example:*
  `--arm A --workload-ref 9c99498` and `--workload-ref 9c99498 --arm A` are not parity-equal. Ordering
  is ignored *between* lines (§4.1), never *within* one.
- **3.9 — Line count per phase and arm.** The number of lines carrying a given unit key. *Example:* the
  baseline has exactly one `gate:A` line; an engine emitting two, or none, diverges.
- **3.10 — Unit set.** Every baseline unit must be present on the other side: `build:both`, `gate:A`,
  `gate:B`, `pilot:A`, `pilot:B`, `analyze:both`. A missing unit is a divergence — this is what makes
  the comparison span all four phases rather than whichever the engine happened to emit.

### 3.11 — The recorded invocation parameters

The values recorded in
[`../fleet-ab/baseline/capture.md`](../fleet-ab/baseline/capture.md) — `--workload-ref`, `--wf-ref-a`,
`--wf-ref-b`, `--cli-version`, `--umbrella-id`, `--gate-skill`, and `--fake-scripts` — are **compared**
tokens under §3.3, never ignored. They are refs, ids, versions and skill strings: the very classes that carry the
hardcoding being generalized, so ignoring them would hollow the check out entirely.

They are compared honestly only if both sides were given the same inputs. Therefore:

> **Both sides of a parity comparison must be produced with the invocation parameter values recorded in
> `capture.md`, and a retrofit manifest must declare those values verbatim as its experiment constants
> and arm `wf_ref`s.**

A parity run where the two sides used different parameter values is not a failed comparison — it is an
invalid one, and its result means nothing.

**`--gap-seconds` is recorded-only.** Its value (`330`) is recorded in `capture.md` and belongs in the
manifest, but it never reaches stdout — it appears only in stderr narration (`run-experiment.sh:183`,
`:187`) and in a `sleep` that dry-run skips (`:188`). It is therefore outside the compared surface, and
saying so explicitly is the point: it is not an oversight and not an ignored *token*, it simply has no
representation on the surface parity examines.

---

## 4. Ignored classes

Each of these is dissolved by §2 before comparison. They are listed exhaustively — nothing else is
ignored.

- **4.1 — Line ordering.** *Why:* `coin_order()` (`run-experiment.sh:131`) randomizes arm order with
  `$((RANDOM % 2))`, independently for gate (`:171`) and pilot (`:182`), so the captured baseline records
  one of four equally valid orderings — this capture happens to hold gate A,B and pilot B,A. *Mechanism:*
  N4 keys each line by its own `phase:arm`, so a line is compared against its counterpart regardless of
  where either sits in its file; where one unit legitimately carries several lines, identical
  occurrences are paired off as an unordered multiset before any positional report. *Not weakened:*
  line count per unit (§3.9) and token order within a line (§3.8) both remain compared, so "ordering is
  ignored" costs nothing but the shuffle.
- **4.2 — Token quoting form.** *Why:* `printf '%q'` escaping is bash-version dependent, and a retrofit
  engine need not emit its argv through `%q` at all; the baseline was produced by GNU bash 5.2.21.
  *Example:* the baseline's `--gate-skill /wf:triage\ WF-406` versus a single-quoted
  `--gate-skill '/wf:triage WF-406'` carry the same argument. *Mechanism:* N1 understands backslash,
  single-quote and double-quote forms alike, so the *value* survives and only the style is discarded.
  *Not weakened:* the style is discarded, never the content — an explicitly quoted empty token (`''`)
  survives as an empty token, so the `--packs ''` divergence in §3.7 remains detectable.
- **4.3 — Leading indent and inter-token whitespace.** *Why:* the orchestrator prints a fixed four-space
  indent and a trailing space (`printf '    '` then `printf '%q '` per token, `:142`). *Example:* the
  four leading spaces on every baseline line, and the trailing space before each newline. *Mechanism:*
  N1 drops empty tokens, so runs of whitespace collapse and edge whitespace vanishes.
- **4.4 — Absolute root prefixes.** *Why:* `SCRIPT_DIR`/`RESULTS_DIR` (`:17-18`) embed whatever absolute
  path the kit happens to sit at, which differs per host and per checkout. *Example:* the baseline's
  `/workspace/wf-plugin/.claude/worktrees/agent-ab49b270496cb1339/plugins/wf-sandbox-testing/experiments/fleet-ab`
  prefix. *Mechanism:* N2/N3 reduce it to `<kit>`, keeping the suffix below it, which is the part that
  carries meaning. *Not weakened:* only the side's own declared kit root is stripped — an unrelated
  absolute path such as the container-side `/work/run-output` is untouched and stays compared (§3.5).
- **4.5 — `/tmp` scratch paths.** *Why:* a manifest-driven engine may stage a rendered manifest or a
  scratch workspace through a temp directory whose name is per-run random. *Example:* none — the baseline
  contains no `/tmp` path at all; this class is declared ahead of the engine so its use of scratch space
  is not mistaken for a divergence. *Mechanism:* N3 reduces any path field under `/tmp/` to `<tmp>`.
  *Bounded deliberately:* only fields **beginning** `/tmp/`; a `/tmp` substring elsewhere in a token is
  not touched.
- **4.6 — stderr narration.** *Why:* `log()` output is human progress commentary, not a command. It also
  carries genuinely uncomparable content (the coin-flip announcement, the gap countdown). *Example:*
  `run-experiment.sh: PILOT — coin-flipped arm order: B A (330s gap between arms)`. *Mechanism:* §1 — the
  comparator reads stdout captures only and never opens the stderr file.
- **4.7 — Blank and whitespace-only lines.** *Why:* a line with no tokens carries no command, and a
  capture may legitimately pick up a trailing newline or a separator. *Example:* the trailing newline
  ending `dry-run-baseline.stdout.txt`. *Mechanism:* such lines are dropped before tokenizing.
  *Bounded deliberately:* this is the *only* line a side may drop. A line with any non-whitespace
  content is either classified (§2 N4) or fails (§6) — never skipped, which is what §6's
  unclassifiable-line rule guarantees.

**No other class is ignored.** In particular the comparator has no notion of "cosmetic" beyond this list:
it does not normalize case, does not sort tokens within a line, does not treat any flag as optional, and
does not skip a line it cannot classify.

---

## 5. Arm-scoping rule

> **Parity compares only the baseline's arm set — A and B. A unit on the other side whose arm has no
> baseline counterpart is outside parity by definition: it is reported as out-of-scope and cannot cause
> either a pass or a failure.**

The baseline is a two-arm experiment. A retrofit engine's manifest may legitimately declare additional
arms — a rung variant, an added model, a third configuration — that no pre-retrofit capture could contain.
Failing parity for such an arm would make the check unpassable; silently comparing it against nothing
would make it meaningless. So it is scoped out explicitly.

The rule is deliberately narrow, and its two halves matter equally:

- **Extra arm — out of scope.** A `pilot:R1` unit on the candidate side, where the baseline has only
  `pilot:A` and `pilot:B`, is listed as out-of-scope and ignored.
- **Extra *unit* for an in-scope arm — a divergence.** A second `pilot:A` line, or a `gate:A` line the
  baseline lacks, is **not** covered by this rule. Arm-scoping excuses unseen *arms*, never unseen
  commands for an arm parity does cover (§3.9, §3.10).
- **Missing baseline unit — always a divergence.** Scoping never subtracts from the baseline side. Every
  one of the six baseline units must be matched.

---

## 6. Rejection behaviour

The comparator is required to be able to reject; these are the conditions under which it does.

| Condition | Result |
|---|---|
| A compared token differs (§3.1-3.8) | **FAIL**, naming the unit, the token position, and both values |
| Token count differs within a unit | **FAIL**, naming the unit and the surplus/missing token |
| Line count for a unit differs (§3.9) | **FAIL**, naming the unit and both counts |
| A baseline unit is absent from the candidate (§3.10) | **FAIL**, naming the unit |
| A candidate unit's arm is not in the baseline's arm set (§5) | **out of scope** — reported, not a failure |
| A candidate unit is an extra unit for an in-scope arm | **FAIL**, naming the unit |
| A side has no `build-arm.sh` token, so N2 cannot derive its kit root | **FAIL** — an underivable kit root means the build phase is missing, which is itself a divergence |
| A line cannot be classified by N4 | **FAIL**, quoting the line — never skipped |
| Fewer than two input files, or an unreadable file | **usage error**, distinct from a parity failure |

A failure names the diverging token rather than dumping a diff, so the reader learns *which* ref, flag,
mount, or arm drifted.

Exit codes: `0` parity holds · `1` parity fails · `2` usage or input error.

That the comparator genuinely rejects is not asserted here — it is demonstrated, and recorded verbatim,
in [`checks.md`](checks.md): the normalization passes against the baseline compared with itself, and
fails against a fixture differing from the baseline in exactly one compared-class token.

---

## 7. Known limits, stated rather than hidden

- **ANSI-C quoting.** `printf '%q'` falls back to `$'…'` for control characters. The baseline surface
  contains none, so N1 handles backslash, single-quote and double-quote forms only; a `$'…'` token would
  be compared with its `$` and escape sequences intact rather than decoded. Should an engine ever emit
  one, the rule to extend is N1 — not the ignored list.
- **Shell expansions are not evaluated.** N1 recovers a token's literal text, it does not run a shell:
  a `$VAR` or a command substitution left unexpanded in a printed line is compared as the literal text
  it is. For a dry-run surface — which prints already-expanded commands — that is the honest reading.
- **Positional token comparison** (§3.8) means a reordered but semantically identical command line fails.
  That is the intended strictness: the claim being verified is *command-sequence* equivalence, and a
  reordered argv is not the same printed command.
- **One capture, not N.** The baseline records one of four valid arm orderings (§4.1). Because ordering
  is ignored via unit keying, capturing more runs would add no information.
