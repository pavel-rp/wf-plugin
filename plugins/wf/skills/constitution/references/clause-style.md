# Clause style — the contract every recorded article conforms to

The written form `/wf:constitution` holds every article to, whatever its provenance. Read on the
**intake** path (normalizing free text into a clause) and on the **compose** path (rendering the
record); never at boot.

The record is **machine-edited**. Hand-editing it bypasses provenance, precedence, id continuity
and this contract — which is why free text after the command is the supported way in, and why the
articles below all share one shape.

## Contents

- [The id scheme](#the-id-scheme) — `<provenance>.<n>`
- [The article form](#the-article-form) — one rule per article
- [The budget](#the-budget) — words, bytes, and what may never be cut
- [Normalizing free text](#normalizing-free-text) — text in, clause out
- [Duplicate and contradiction](#duplicate-and-contradiction)

## The id scheme

Every article renders with an explicit id of the form `<provenance>.<n>`:

| Provenance | Id | Minted by |
|---|---|---|
| core | `core.1` … `core.9` | this skill's own article set — fixed, not minted per project |
| capability | `<capability-name>.1` … | the composer, numbering each capability's declared articles from 1 in the order its manifest declares them |
| project | `proj.1` … | clause intake, one per accepted clause |

**`proj.N` ids are monotonic and never reused.** The next id is one past the highest `proj.N` the
record has *ever* carried, not one past the highest currently present — dropping `proj.2` does not
free `proj.2`. A reused id would silently re-point every reference that named the old clause.

`core.*` and `<capability>.*` ids are **stable identifiers, not edit targets**. They are not minted
per project and they are re-rendered from their source on every re-composition, so an intake that
"amended" one would be overwritten on the next run. Overriding one is done by **adding a project
clause** that names the id it overrides — which is also what makes the override visible, since
project clauses outrank capability articles and are the only place a project's own intent lives.

## The article form

One line, one rule:

```
- **<id> — <Title>.** <the rule, as an obligation>
```

- **One rule per article.** Two obligations that can be violated independently are two articles —
  except where they are inseparable halves of one rule, which are then lettered `(a)` / `(b)`
  inside the single article that binds them.
- **One unwrapped line.** The composer reproduces a record byte-for-byte only when each article is
  a single line; a wrapped article is a diff on every re-run.
- **Obligation, not description.** "Nothing writes outside `_local/`", not "writes are generally
  scoped".
- **Title is a handle, not a summary.** Short enough to cite, e.g. *Write scope*, *Scratch
  discipline*.
- **No stack, domain, or project noun** — in the title, the rule, or this contract.

## The budget

**Target: ≤ ~60 words per article.** Two things may push past it, and only two: an article whose
obligation count genuinely does not fit (currently `core.2` and `core.9`, each ≤ ~85 words). Every
such article is named, with its obligation count, in
[`obligation-inventory.md`](obligation-inventory.md).

**What is cut, always:**

- **Rationale** — *why* the rule exists. That belongs in a paired reference, or nowhere.
- **Restatement** — the same obligation said twice for emphasis.
- **Anticipatory rebuttal** — "this is deliberate, not an oversight", "not a nicety", and the like.
- **Cross-references between articles** — "this complements the article above".

**What is never cut:**

> A **normative obligation** — anything a run could be judged non-conformant against. Losing one is
> a defect, not a rounding error; the byte budget yields to the obligation inventory, never the
> other way round.

Before and after any rewrite of the core articles, the inventory is rebuilt and diffed: every
obligation maps 1:1, none lost, none invented.

## Normalizing free text

Free text after the command is normalized into one clause before anything is shown or written:

1. **One rule.** Text carrying two independent obligations is split into two clauses, each minted
   its own id, and both are echoed together.
2. **Imperative, present tense, third person.** "Internal ids are never exposed in a response",
   not "we should try not to expose internal ids".
3. **A kebab-case key** derived from the rule's subject, used as the article's handle:
   `no-internal-ids-in-responses`.
4. **Rationale stripped.** A trailing "because…" or "so that…" is dropped, not recorded.
5. **The user's own terms are kept.** Normalization fixes *form*, never *meaning* — a clause whose
   meaning cannot be preserved under this contract is reported back rather than reshaped.

The normalized clause renders as `- **proj.<n> — <key>:** <rule>`, matching the capability form so
one contract governs the whole record.

**Nothing is written before the normalized clause and its minted id are echoed and approved.** The
echo is the only place the user sees what will be recorded in their name.

## Duplicate and contradiction

Both checks run against **every** article in the record — core, capability, and project alike —
before the echo:

- **Duplicate.** The rule is already an obligation of an existing article. Report the covering id;
  write nothing. A second copy of a rule is a second thing to keep in sync.
- **Contradiction.** The rule cannot hold at the same time as an existing article. Name the
  conflicting id in the echo, state the conflict, and proceed only on explicit confirmation — then
  record it as a project clause that **overrides** the named id. A core or capability article is
  never edited to resolve a conflict; precedence resolves it.
