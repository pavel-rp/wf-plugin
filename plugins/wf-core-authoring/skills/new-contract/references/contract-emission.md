# Contract emission — the rule set and the two half-templates

The single rule source `/wf-core-authoring:new-contract` emits from. Read on the write path only,
once per run, after the interview has produced its answers. The skill body restates none of it:
emitting a second template anywhere else is a defect, not a convenience.

**Model:** claude-opus-5[1m]

## Contents

- [The shape rules](#the-shape-rules) — what the contract-shape guard accepts, stated as emission obligations
- [Substitutions](#substitutions) — interview answer to template slot
- [Template: the ops half](#template-the-ops-half) — `<name>.ops.md`
- [Template: the reference half](#template-the-reference-half) — `<name>.contract.md`
- [After emitting](#after-emitting) — what to hand to the verification step

---

## The shape rules

The contract-shape guard enforces four checks over a contract pair. Each is stated below as an
**emission obligation** — something the templates satisfy structurally — never as a re-implementation
of the check. The guard remains the authority; the emitter's job is to leave it nothing to complain
about on the first run.

1. **Ops line budget.** The ops half stays within the budget the guard applies to the contracts
   folder — **150 lines** today. Emit within it. When the author's sections would overflow, move the
   overflow to the reference half rather than trimming a behaviour-bearing clause; a runtime-ops doc
   carries only behavior-bearing content, and rationale belongs in the half that is never read at
   boot.

2. **Heading parity, ops to reference.** Every `## ` heading of the ops half must exist in the
   reference half as a heading of any level, matched on **exact whole-line text** after the hash
   prefix is stripped. Emit the reference half's heading set as a **superset** of the ops half's:
   for every `## X` written into `<name>.ops.md`, write a heading whose text is character-for-
   character `X` into `<name>.contract.md`. Backticks, punctuation, capitalisation, and spacing are
   all part of the match — copy the heading text, never retype it. Headings inside fenced code
   blocks are not headings; the guard skips fences and so does this rule.

3. **Cross-link anchors.** Every markdown link of the shape `](<file>.md#<anchor>)` written into
   either half must name a file that exists **in the same folder** and carry an anchor that slugs to
   a real heading in it. The slug is GitHub-style: lowercase, drop everything outside `a-z0-9 -`,
   spaces become hyphens, runs of hyphens collapse. Both templates below ship exactly one such link
   each, pointing at a heading the other template guarantees; any further cross-link the author adds
   must name a heading that already exists in the target.

4. **Contract-pointer ban.** In the ops half the token `contract.md` may appear **only** on a line
   that also contains the phrase `never read at boot`. A runtime-ops doc must never instruct a full-
   contract read. The ops template carries exactly one such line, pre-labelled; add no other mention
   of the token anywhere in that half — not in prose, not in a link, not in a comment. The reference
   half is unconstrained here.

**Both halves or neither.** Heading parity has nothing to compare against when one half is missing,
so a pair is emitted as a unit. If either write fails, remove whichever half landed and report the
failure — a half-emitted pair is a scaffolder defect, not a partial success.

**No AI attribution.** Neither half carries a `Co-Authored-By` trailer, a "generated with" footer,
an emoji, or a promotional tagline. Both carry a `**Model:** <runtime model id>` attribution line.

---

## Substitutions

| Slot | Filled from |
|---|---|
| `<name>` | The contract's filesystem-safe base name — lowercase letters, digits, hyphens. Names both files. |
| `<Title>` | The contract's human title, in the author's own words. |
| `<purpose>` | One paragraph: what this contract governs, and who follows it at runtime. |
| `<Section N>` | Each ordered runtime section the author named, in the order given. |
| `<section body>` | The behaviour-bearing procedure for that section — the ops half. |
| `<section rationale>` | Why that section reads the way it does, and what it rejected — the reference half. |
| `<edge case>` | Each stop condition the author named. |
| `<model id>` | The runtime model identifier. |

---

## Template: the ops half

Emitted verbatim to `<name>.ops.md`, with substitutions applied. Keep the `## Contents` section: a
TOC is mandatory once a runtime-read doc passes 100 lines, and emitting it unconditionally means the
emitted pair never needs a second pass to acquire one.

```markdown
# <Title> — runtime ops

<purpose>

**Version:** 1.0.0
**Model:** <model id>

**Reference:** rationale, history, and worked examples live in the paired
[`<name>.contract.md`](<name>.contract.md#rationale) — never read at boot.

## Contents

- [<Section 1>](#<slug of Section 1>)
- [<Section 2>](#<slug of Section 2>)
- [Edge cases](#edge-cases)

## <Section 1>

<section body>

## <Section 2>

<section body>

## Edge cases

- **<edge case>** — <what the reader does instead, and what is never done>
```

---

## Template: the reference half

Emitted verbatim to `<name>.contract.md`, with substitutions applied. Its heading set is the ops
half's plus `Rationale`; that superset is what makes heading parity hold by construction.

```markdown
# <Title> — contract & rationale

<purpose>

**Model:** <model id>

**Runtime half:** the bounded procedure a runtime reader follows lives in
[`<name>.ops.md`](<name>.ops.md#contents). This half is read by authors and reviewers.

## Rationale

<why this contract exists, what it replaced, and which alternatives were rejected>

## Contents

- [Rationale](#rationale)
- [<Section 1>](#<slug of Section 1>)
- [<Section 2>](#<slug of Section 2>)
- [Edge cases](#edge-cases)

## <Section 1>

<section rationale>

## <Section 2>

<section rationale>

## Edge cases

<why each stop condition is a stop condition, and what a caller must not do instead>
```

---

## After emitting

Hand the verification step the two absolute paths and nothing else. It locates the contract-shape
guard by role, runs it, and runs the typed resolver validators; the emitter neither runs a check of
its own nor predicts a verdict. A finding at that point is fixed against the rules above and the
guard re-run — never suppressed, and never worked around by editing the guard.
