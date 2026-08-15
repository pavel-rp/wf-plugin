---
name: new-contract
description: Scaffolds a matched pair of core contract documents — a bounded runtime-ops half and its paired reference half — into the core contracts folder, then proves the pair green under the repository's contract-shape guard and the typed resolver validators before handing it back. Use when adding a new core contract, or when an existing contract must be re-cut into the two-half shape.
allowed-tools: [Read, Write, Glob, Grep, Bash]
---

# /wf-core-authoring:new-contract — Scaffold a contract pair that is green on first run

Core contracts are authored in two halves: a bounded `<name>.ops.md` read at runtime, and a
`<name>.contract.md` reference half read only by authors. Hand-cut pairs drift — an ops half over
budget, a heading with no counterpart, a bare contract pointer, a cross-link that does not resolve —
and the author learns it from a red gate at pull-request time.

This skill emits both halves together, shaped so the contract-shape guard has nothing to complain
about, runs that guard and the typed validators against what it just wrote, and hands back only a
clean pair.

## Contents

- [Command Syntax](#command-syntax)
- [Safety Rules (NON-NEGOTIABLE)](#safety-rules-non-negotiable)
- [Phase 1: Resolve the target folder and the name](#phase-1-resolve-the-target-folder-and-the-name)
- [Phase 2: Interview](#phase-2-interview)
- [Phase 3: Emit both halves](#phase-3-emit-both-halves)
- [Phase 4: Verify what was emitted](#phase-4-verify-what-was-emitted)
- [Phase 5: Hand back, or stop honestly](#phase-5-hand-back-or-stop-honestly)
- [Edge Cases](#edge-cases)
- [Final Output](#final-output)

---

## Command Syntax

```
/wf-core-authoring:new-contract [<name>]
```

| Argument | Required | Description |
|---|---|---|
| `<name>` | NO | The contract's base name — lowercase letters, digits, and hyphens; it names both halves. Omitted, the interview asks for it. |

**Zero-argument default:** run the interview from the top, starting with the name.

---

## Safety Rules (NON-NEGOTIABLE)

**Allowed:**

- Read any file in the repository (`Read`, `Glob`, `Grep`).
- Write the two halves of exactly one contract pair into the resolved contracts folder.
- Run the contract-shape guard, located by role, as a read-only check.
- Call the typed resolver validators (`validate_references`, `validate_manifest`,
  `validate_registry`) — the in-session surfaces that already own those checks.

**Forbidden:**

- **Hardcode a path to the contract-shape guard.** The guard is named by role and its executable is
  located at run time; a fixed path breaks the moment the guard is relocated.
- **Re-derive a check that already exists** as the guard or as a typed validator. Restating a
  validator's logic in this body is a defect: invoke the validator and report what it returned.
- Edit, move, relax, or work around the guard, a validator, or any CI script — a red result is
  fixed in the emitted pair.
- Write anywhere other than the two emitted halves. In particular: no edit to an existing contract,
  no edit to a manifest, no edit to a CI script.
- Emit one half without the other, or hand back a pair the guard has not passed.
- Write AI attribution — a `Co-Authored-By` trailer, a "generated with" footer, an emoji, or a
  promotional tagline — into either half.

---

## Phase 1: Resolve the target folder and the name

1. **Resolve the contracts folder.** It is the folder that already holds the repository's contract
   pairs — locate it by globbing for `**/*.contract.md` and taking the folder those pairs share.
   Exactly one such folder is the normal case; use it. If more than one folder holds pairs, or the
   caller named a different destination, **ask first** before emitting anywhere but the folder the
   existing pairs share.
2. **Validate the name.** Lowercase letters, digits, and hyphens only; no leading or trailing
   hyphen, no path separator, no `.md` suffix. Reject anything else and re-ask.
3. **Check for collisions.** If either `<name>.ops.md` or `<name>.contract.md` already exists in
   that folder, **ask first** — overwriting a half of an existing pair is never silent. Stop unless
   the caller confirms.

## Phase 2: Interview

Ask for, and do not guess:

1. **Title** — the contract's human title.
2. **Purpose** — one paragraph: what this contract governs at runtime, and who follows it.
3. **Runtime sections** — the ordered `## ` sections the ops half needs, by name. Two or more is
   typical; one is valid.
4. **Edge cases** — the stop conditions a runtime reader must recognise.

Ask them together where the caller has already supplied part of the answer. An unanswered question
is asked again, never filled in from a guess: the emitted pair is a contract, and inventing its
content is worse than pausing for one more answer.

## Phase 3: Emit both halves

Read the emission rule set and the two half-templates from `references/contract-emission.md` — the
single source for both. Do not restate a template here and do not compose one from memory.

Fill the templates from the interview answers and write **both** files in the same run:
`<name>.ops.md` and `<name>.contract.md`, into the folder resolved in Phase 1. Carry the runtime
model id into each half's `**Model:**` line; write `unknown` rather than guessing it.

**Both halves or neither.** If either write fails, delete whichever half landed and stop with the
failure — a half-emitted pair is a scaffolder defect, not a partial success.

## Phase 4: Verify what was emitted

1. **Locate the contract-shape guard by role.** It is the repository's executable ops/reference
   drift guard — the one enforcing the four-check set *ops line budget · ops-to-reference heading
   parity · cross-link anchor resolution · contract-pointer ban*. Find it by searching the
   repository's shell scripts for a **non-comment** line naming the phrase `contract-pointer ban`:
   the guard is the script that *reports* that check, so the phrase appears in its emitted output,
   not merely in a comment. A callers-and-comments match — a CI entry point describing what it
   invokes — is excluded by that non-comment condition. Exactly one script survives it, and that
   script is the guard. Zero survivors, or more than one, is a stop condition (see Edge Cases) —
   never substitute a remembered path.
2. **Run it** with `Bash`, and read its report for the emitted pair. Record the resolved path.
3. **Run the typed validators** over what changed: `validate_references` for the emitted set, and
   `validate_manifest` / `validate_registry` if the caller pairs this run with a manifest edit.
   Report what each returned; do not re-implement any of their checks.
4. **On a finding, fix the emitted pair** against the rule set and re-run the guard. Repeat at most
   twice. Fix the pair only — never the guard, never a validator.

## Phase 5: Hand back, or stop honestly

Hand back only when the guard reports the pair clean and the validators pass: report the two
absolute paths, the guard's resolved path, and the four checks green.

If the pair is still red after the bounded retries, **do not claim success**. Leave both halves on
disk so the author can see them, and stop with the findings verbatim, the resolved guard path, and
the two paths. A red pair reported honestly is a usable result; a green claim over a red pair is not.

---

## Edge Cases

- **No contracts folder found** (no `*.contract.md` anywhere): stop — the repository has no contract
  pair to sit beside, and this skill does not invent a home for one.
- **Guard not found by role** (no shell script reports the contract-pointer ban outside a comment):
  stop, naming what was searched for. The pair stays on disk unverified and is reported as
  unverified — never reported green, and never verified against a guessed path.
- **More than one candidate guard survives the search:** stop and name each. Guessing which one is
  authoritative would make a green report meaningless.
- **Either half already exists:** ask before overwriting; without confirmation, stop.
- **The caller names a folder that is not the shared contracts folder:** ask first, then honour the
  answer.
- **A write fails partway:** delete the half that landed and stop — never hand back one half.
- **Still red after the bounded retries:** stop with the findings and both paths, as Phase 5 states.
- **The resolver runtime is unavailable** (no typed validator reachable): run the guard anyway,
  report the validators as unrun, and say so — do not hand-roll a validator's check as a substitute.

---

## Final Output

```
NEW-CONTRACT — <scaffolded | stopped>

Name:   <name>
Ops:    <absolute path to the emitted ops half>
Ref:    <absolute path to the emitted reference half>
Guard:  <resolved path of the contract-shape guard, or "not found">
Checks: <four checks green | the findings, one per line | unverified — reason>

Next:  review both halves, then commit them together.
```

**The final output block must always be the very last thing output to chat.**
