---
name: add-term
description: Adds one term to the repository's canonical authoring glossary together with the full parse-contract entry that makes it enforceable — reading the required-field set from the glossary itself, refusing to write a documentation-only term, and proving the new entry by running the glossary lint on a seeded violation and confirming its self-test is green. Use when admitting a new authoring term, or when a term was proposed without the lint entry that enforces it.
allowed-tools: [Read, Write, Edit, Glob, Grep, Bash]
---

# /wf-core-authoring:add-term — land a term and its lint entry in one change

The authoring glossary is only a rule because a deterministic lint can fail on its violation.
A term added as prose alone — a definition with no `pattern:`, no `applies-to:`, no `check:` —
is a preference wearing a rule's clothes: it reads like policy and nothing enforces it.

This skill closes that gap by construction. It collects a term **together with** its complete
parse-contract entry, declines to write anything when the entry is incomplete, and hands back
only after the live lint has been observed firing on a seeded violation of the new term.

**The same-change rule:** a term and the lint entry that enforces it land in the same change.
This skill states that rule in its own output and refuses to produce a half of it.

## Contents

- [Command Syntax](#command-syntax)
- [Safety Rules (NON-NEGOTIABLE)](#safety-rules-non-negotiable)
- [Phase 1: Locate the glossary and read its parse contract](#phase-1-locate-the-glossary-and-read-its-parse-contract)
- [Phase 2: Interview for the whole entry](#phase-2-interview-for-the-whole-entry)
- [Phase 3: Refuse an incomplete entry](#phase-3-refuse-an-incomplete-entry)
- [Phase 4: Write the entry](#phase-4-write-the-entry)
- [Phase 5: Prove it with the lint](#phase-5-prove-it-with-the-lint)
- [Phase 6: Hand back, or stop honestly](#phase-6-hand-back-or-stop-honestly)
- [Edge Cases](#edge-cases)
- [Final Output](#final-output)

---

## Command Syntax

```
/wf-core-authoring:add-term [<term>]
```

| Argument | Required | Description |
|---|---|---|
| `<term>` | NO | The canonical term the entry admits — the form authors must use. Omitted, the interview asks for it. |

**Zero-argument default:** run the interview from the top, starting with the term.

---

## Safety Rules (NON-NEGOTIABLE)

**Allowed:**

- Read any file in the repository (`Read`, `Glob`, `Grep`).
- Append exactly one entry to the resolved glossary file — the single write this skill makes.
- Create, and then delete, one temporary seeded-violation file used only to prove the entry
  fires; it lives under the repository's scratch area and never beside tracked files.
- Run the glossary lint, located by role, as a read-only check.

**Forbidden:**

- **Transcribe the parse contract.** The required-field set is read from the glossary's own
  parse-contract section on every run. A field list restated in this body would silently
  desynchronize the moment that contract changes.
- **Hardcode a path to the glossary lint.** The lint is named by role and located at run time;
  a fixed path breaks the moment the lint is relocated to its owning pack.
- Write an entry missing any mandatory field, or write a term whose violation no `pattern:`
  can fire on — a term that cannot be violation-tested is a preference, not a rule.
- Write anywhere other than the one glossary entry and the temporary proof file. In
  particular: no edit to an existing entry, no edit to the parse contract, no edit to the
  lint, no edit to a manifest, no edit to a CI script.
- Edit, relax, or work around the lint to make a new entry pass — a red result is fixed in the
  entry.
- Leave the temporary proof file behind, or leave the tree dirty on any exit path.
- Write AI attribution — a `Co-Authored-By` trailer, a "generated with" footer, an emoji, or a
  promotional tagline — into the entry or anywhere else.

---

## Phase 1: Locate the glossary and read its parse contract

1. **Resolve the glossary by role.** It is the authored-vocabulary file the lint parses: locate
   it by globbing for a file named `GLOSSARY.md` that carries both a `## Parse contract`
   heading and at least one `^### term: ` entry. Exactly one such file is the normal case; use
   it. Zero, or more than one, is a stop condition (see Edge Cases) — never substitute a
   remembered path.
2. **Read the required-field set from that file's parse contract.** The contract states which
   fields are mandatory and in what fixed order. Take the field set from it verbatim on this
   run; do not reconcile it against any list held in this body, because there is none.
3. **Read the scope tokens and the admission gate** from the same file — the `applies-to:`
   vocabulary an entry may use, and the rule that a term is admitted only when a deterministic
   check can fail on its violation.
4. **Check for a collision.** If an entry for this term already exists, **ask first** —
   rewriting an existing entry is out of this skill's scope. Stop unless the caller confirms
   they mean to add a distinct term.

## Phase 2: Interview for the whole entry

Ask for every field the parse contract named in Phase 1 — not a subset, and not just the
definition. For each, state what the contract requires of it, and ask them together where the
caller has already supplied part of the answer.

Two fields carry the admission gate and are asked with their evidence:

- the **violation pattern** — the caller must be able to state a concrete line of prose the
  pattern would fire on. If they cannot, the term fails the admission gate and this skill
  stops rather than admitting an unenforceable rule.
- the **evidence pointer** — consistent live use in this repository, or a real observed
  confusion. Entries are extracted, not invented; an entry without evidence is rejected at
  review, so it is rejected here.

An unanswered question is asked again, never filled in from a guess.

## Phase 3: Refuse an incomplete entry

Before writing anything, check the collected answers against the Phase-1 field set.

If any field is missing, **write nothing**. Name every missing field back to the caller,
restate the same-change rule, and stop with the `stopped` terminal block. A definition on its
own is a documentation-only term, and this skill does not treat one as done — that refusal is
the whole reason the surface exists.

The caller may re-invoke with the missing answers; nothing partial is left behind.

## Phase 4: Write the entry

Append the entry to the glossary's entries section, in the exact line-oriented shape the parse
contract defines: the term heading followed by each mandatory field as `key: value`, one per
line, in the contract's fixed order, with no continuations, nesting, tables, or fenced blocks.

Write the entry and nothing else — the file's surrounding prose, its existing entries, and its
parse contract are untouched.

## Phase 5: Prove it with the lint

1. **Locate the lint by role.** It is the repository's glossary vocabulary lint — the
   executable that parses the glossary directly and reports a per-file verdict under the
   report prefix `GLOSSARY-LINT`. Find it by searching the repository's shell scripts for a
   **non-comment** line emitting that lint's own pass report (the prefixed `PASS` line): the
   lint is the script that *emits* that report, so the phrase appears in its output, not
   merely in a comment. A caller — a CI entry point describing what it invokes — is excluded
   by that non-comment condition. Exactly one script survives it, and that script is the lint.
   Zero survivors, or more than one, is a stop condition (see Edge Cases). Record the resolved
   path in the terminal block; **never** assume a path, because the lint's home moves.
2. **Prove the entry fires.** Write a temporary file under the repository scratch area, at a
   path matching one of the scopes the new entry's `applies-to:` names, containing a line the
   entry's pattern matches. Run the lint against exactly that file. The expected result is a
   **failure** naming the offending term — the entry is only enforceable if the lint fails on
   its violation. A clean result here means the pattern does not fire, and the entry is not
   yet a rule: report it as unproven.
3. **Confirm the self-test.** Run the lint's `--selftest`. It must be green — the new entry
   must not have broken the glossary's own parse or the lint's fixture assertions. A malformed
   entry surfaces here as a loud parse failure rather than a silent skip.
4. **Clean up.** Delete the temporary proof file. Confirm the only remaining change is the one
   glossary entry.
5. **On a red self-test or a non-firing pattern, fix the entry** and repeat from step 2, at
   most twice. Fix the entry only — never the lint, never the parse contract.

## Phase 6: Hand back, or stop honestly

Hand back `added` only when the entry is written, the lint was observed **failing** on the
seeded violation, `--selftest` is green, and the temporary file is gone.

If the entry is still unproven after the bounded retries, **do not claim success**. Leave the
entry on disk so the author can see it, delete the temporary file, and stop with the findings
verbatim, the resolved lint path, and the glossary path. Say plainly that the term is present
but not yet enforceable, and that the change is therefore not done.

---

## Edge Cases

- **No glossary found** (no `GLOSSARY.md` carrying a parse contract and at least one entry):
  stop — this skill does not invent a vocabulary file or its contract.
- **More than one candidate glossary:** stop and name each. Guessing which is authoritative
  would put the entry where no lint reads it.
- **Lint not found by role** (no shell script emits the lint's pass report outside a comment):
  stop, naming what was searched for. The entry stays on disk and is reported **unverified** —
  never reported proven, and never verified against a guessed path.
- **More than one candidate lint survives the search:** stop and name each.
- **The term already has an entry:** ask before proceeding; without confirmation, stop.
  Rewriting an existing entry is out of scope.
- **The caller supplies only a definition:** Phase 3 refuses — nothing is written, every
  missing field is named, and the same-change rule is restated.
- **The caller cannot state a line the pattern would fire on:** the term fails the admission
  gate; stop without writing. A preference no check can fail on stays out of the glossary.
- **The seeded violation does not make the lint fire:** the entry is present but unenforceable;
  after the bounded retries, report `unproven` rather than `added`.
- **`--selftest` goes red after the entry lands:** the entry is malformed or its pattern
  collides with a fixture assertion; fix the entry within the bounded retries, then report the
  findings verbatim if it is still red. Never edit the lint or its fixtures to get green.
- **The temporary proof file cannot be deleted:** stop and name it explicitly, so no seeded
  violation is ever left in the tree.

---

## Final Output

```
ADD-TERM — <added | stopped>

Term:     <the canonical term>
Glossary: <absolute path to the glossary the entry landed in>
Fields:   <the required-field set read from the parse contract, or the ones still missing>
Lint:     <resolved path of the glossary lint, or "not found">
Proof:    <fires on the seeded violation · --selftest green | the findings | unverified — reason>

Next:  review the entry, then commit it with the change that motivated it — a term and the lint entry that enforces it land together.
```

**The final output block must always be the very last thing output to chat.**
