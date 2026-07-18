# GLOSSARY — canonical authoring vocabulary

Authoring-scope only. This file is **never read at `/wf:*` runtime**; it exists so a
deterministic lint can fail a PR whose authored prose drifts from the vocabulary already
in live use in this repository.

## Contents

- [Parse contract](#parse-contract)
- [Admission gate](#admission-gate)
- [Scope tokens](#scope-tokens)
- [Self-exemption](#self-exemption)
- [Entries](#entries)
- [Leading-word conformance](#leading-word-conformance)

## Parse contract

The lint parses this file directly. No rule is transcribed anywhere else.

The format is **line-oriented**: every machine-read line is `key: value`, one per line,
no continuations, no nesting, no tables. Plain `grep`/`awk` is sufficient; no YAML, JSON,
or markdown-AST parser is required.

An entry starts at a line matching exactly `^### term: ` and ends at the next such line
(or at the next `^## `). Within an entry each field matches `^<key>: ` at column 1. Field
order is fixed and every field is mandatory:

| Field | Meaning |
|---|---|
| `### term:` | the canonical term — the form authors must use |
| `definition:` | one line, no line breaks |
| `avoid:` | comma-separated forbidden alternatives, or `none` when the entry bans a construction rather than a synonym |
| `pattern:` | a single POSIX ERE matching a violation; this is what the lint feeds to `grep -Ein` |
| `applies-to:` | comma-separated scope tokens (see below); the entry fires only on files matching a listed scope |
| `check:` | the lint check id consuming this entry — `avoid-term` or `leading-word` |
| `evidence:` | `path — quoted snippet`, pointing at consistent live use or at the observed confusion |

Reference extraction, in full:

```bash
awk -F': ' '/^### term: /{t=$2} /^pattern: /{print t "\t" substr($0,10)}' GLOSSARY.md
```

Entry count, in full:

```bash
grep -c '^### term: ' GLOSSARY.md
```

## Admission gate

**A term is admitted only if a deterministic check can fail on its violation.** Every
entry carries a `pattern:` a grep can fire on and a `check:` naming the lint check that
consumes it. A term that cannot be violation-tested is a preference, not a rule, and is
absent from this file. A short, hard glossary beats a broad, soft one.

Entries are **extracted, not invented**: each carries an `evidence:` pointer to consistent
live use in this repository or to a real observed confusion. An entry without evidence is
rejected at review.

## Scope tokens

`applies-to:` values, matched against the path of the file being linted:

| Token | Matches |
|---|---|
| `skill-body` | `plugins/*/skills/**/SKILL.md` |
| `reference` | `plugins/*/skills/**/references/*.md` |
| `contract` | `plugins/wf/skills/_contracts/*.md` |
| `capability` | `plugins/*/capabilities/**/*.md` — manifests and fragments |
| `agent` | `plugins/*/agents/*.md` |
| `frontmatter` | the YAML frontmatter block of any of the above |

Scoping is the false-positive guard. A forbidden term *mentioned* rather than *used* is
the instruction-vs-prose problem `out4-skill-read-guard.sh` had to solve for skill reads;
here it is handled by narrowing each entry to the scopes where the term is load-bearing,
and by patterns written to match the used form rather than the bare word.

## Self-exemption

This file, and any `*-fixtures/` folder under `_contracts/`, are **off the lint surface**.
GLOSSARY.md necessarily quotes every forbidden form it bans, so linting it would fire on
every entry. The exclusion is structural, not a suppression list.

## Entries

### term: capability
definition: A unit of stack, domain, or project knowledge that attaches to the SDD spine through the registry — the noun core iterates.
avoid: cap, caps
pattern: (^|[^a-zA-Z-])caps?([^a-zA-Z-]|$)
applies-to: skill-body, reference, contract, capability, agent
check: avoid-term
evidence: plugins/wf/skills/_contracts/capability-registry.contract.md — names the concept "capability" throughout; the clipped form never appears as a prose noun

### term: pack
definition: A published plugin shipping one or more capabilities — the distribution unit, not the knowledge unit.
avoid: capability pack
pattern: capability[ -]packs?
applies-to: skill-body, reference, contract, capability, agent
check: avoid-term
evidence: plugins/wf/skills/_contracts/pack-onboarding.contract.md — "pack" is the standing term for an installed plugin; a pack contains a capability, so "capability pack" collapses two distinct units

### term: subagent
definition: An agent file under a plugin's agents/ folder, invoked through the Task tool as subagent_type.
avoid: sub-agent, sub agent
pattern: sub[- ]agents?([^a-zA-Z-]|$)
applies-to: skill-body, reference, contract, capability, agent
check: avoid-term
evidence: plugins/wf/agents/ — every agent file and the skills dispatching them use the closed spelling "subagent"

## Leading-word conformance

Pending — recorded from evidence in the same file, per the evidence-defined rule.
