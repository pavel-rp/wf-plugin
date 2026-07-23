# GLOSSARY — canonical authoring vocabulary

Authoring-scope only. This file is **never read at `/wf:*` runtime**; it exists so a
deterministic lint can fail a pull request whose authored prose drifts from the vocabulary
already in live use in this repository.

## Contents

- [Parse contract](#parse-contract)
- [Admission gate](#admission-gate)
- [Scope tokens](#scope-tokens)
- [Self-exemption](#self-exemption)
- [Entries](#entries)
- [Leading-word conformance](#leading-word-conformance)
- [Rejected candidates](#rejected-candidates)

## Parse contract

The lint parses this file directly. No rule is transcribed anywhere else.

The format is **line-oriented**: every machine-read line is `key: value`, one per line —
no continuations, no nesting, no tables, no fenced blocks. Plain `grep`/`awk` is
sufficient; no YAML, JSON, or markdown-AST parser is required.

An entry starts at a line matching `^### term: ` and ends at the next such line, or at the
next `^## `. Within an entry each field matches `^<key>: ` at column 1. Field order is
fixed and every field is mandatory — a missing field is a malformed entry and the lint
must fail on it rather than skip it:

| Field | Meaning |
|---|---|
| `### term:` | the canonical term — the form authors must use |
| `definition:` | one line, no line breaks |
| `avoid:` | comma-separated forbidden alternatives, or `none` when the entry bans a construction rather than a synonym |
| `pattern:` | a single POSIX ERE matching a violation; this is what the lint feeds to `grep -En` |
| `except:` | a single POSIX ERE; a line matching it is exempt even when `pattern:` fires. `none` when the entry needs no exemption |
| `applies-to:` | comma-separated scope tokens (see below); the entry fires only on files matching a listed scope |
| `check:` | the lint check id consuming this entry — `avoid-term` or `leading-word` |
| `evidence:` | `path — quoted snippet`, pointing at consistent live use or at the observed confusion that admitted the entry |

Reference extraction of the rule set, in full:

```bash
awk -F': ' '/^### term: /{t=$2} /^pattern: /{print t "\t" substr($0,10)}' GLOSSARY.md
```

Entry count, in full:

```bash
grep -c '^### term: ' GLOSSARY.md
```

Patterns are written case-sensitively and are matched case-sensitively. Where a term drifts
in capitalisation as well as spelling, the pattern spells out the variants.

## Admission gate

**A term is admitted only if a deterministic check can fail on its violation.** Every entry
carries a `pattern:` a grep can fire on and a `check:` naming the lint check that consumes
it. A term that cannot be violation-tested is a preference, not a rule, and is absent from
this file. A short, hard glossary beats a broad, soft one — see
[Rejected candidates](#rejected-candidates) for terms that failed this gate and why.

Entries are **extracted, not invented**: each carries an `evidence:` pointer to consistent
live use in this repository or to a real observed confusion. An entry without evidence is
rejected at review.

Every pattern below was run against the current tree at authoring time and returns **zero
hits** outside this file. The glossary therefore admits no rule the repository already
violates wholesale, which is what keeps the on-touch severity model cheap.

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

Scoping is the false-positive guard. A forbidden term *mentioned* rather than *used* is the
instruction-versus-prose problem `out4-skill-read-guard.sh` had to solve for skill reads.
Here it is handled three ways: `applies-to:` narrows each entry to the scopes where the term
is load-bearing, `pattern:` is written to match the **used** form rather than the bare word,
and `except:` carves out the known legitimate matches by name.

## Self-exemption

This file, and any `*-fixtures/` folder under `_contracts/`, are **off the lint surface**.
GLOSSARY.md necessarily quotes every forbidden form it bans, so linting it would fire on
every entry; the fixture folders exist to be linted deliberately through the self-test. The
exclusion is structural, not a suppression list.

## Entries

### term: capability
definition: A unit of stack, domain, or project knowledge that attaches to the SDD spine through the registry — the noun core iterates.
avoid: cap, caps
pattern: caps? (manifest|registry|fragment|kind|slot|row|pack|path|name)
except: none
applies-to: skill-body, reference, contract, capability, agent
check: avoid-term
evidence: plugins/wf/skills/_contracts/capability-registry.contract.md — spells "capability" throughout, never the clipped form; the observed confusion is the fixtures folder literally named `caps/` (plugins/wf/skills/_contracts/registry-fixtures/caps/), which trains the abbreviation into compound nouns

### term: subagent
definition: An agent file under a plugin's agents/ folder, invoked through the Task tool as subagent_type.
avoid: sub-agent, sub agent
pattern: [Ss]ub[- ][Aa]gents?([^a-zA-Z-]|$)
except: none
applies-to: skill-body, reference, contract, capability, agent
check: avoid-term
evidence: plugins/wf/agents/branch.md — "the implementation lives entirely in the `wf:branch` subagent"; the closed spelling is used in every agent file, with no hyphenated occurrence in the tree

### term: subagent_type is plugin-qualified
definition: A subagent_type value names the owning plugin and the agent, `<plugin>:<agent>`; a bare agent name resolves only by accident of install order.
avoid: none
pattern: subagent_type: [a-z0-9_-]+([^a-z0-9:_-]|$)
except: subagent_type: (general-purpose|Explore|Plan|statusline-setup)
applies-to: skill-body, reference, contract, capability, agent
check: avoid-term
evidence: plugins/wf/skills/branch/SKILL.md — "`subagent_type: wf:branch`"; plugins/wf-angular/agents/qa-host.md — "`subagent_type: wf-angular:qa-host`". Every plugin-owned dispatch in the tree is qualified; the only unqualified values are the runtime built-ins the `except:` names

### term: slash-command namespace
definition: The `wf:` namespace comes from the plugin name, so a skill's frontmatter `name` is bare; re-prefixing it yields the doubled command `/wf:wf-<name>`.
avoid: none
pattern: /wf(-[a-z0-9-]+)?:wf-
except: none
applies-to: skill-body, reference, contract, capability, agent, frontmatter
check: avoid-term
evidence: CLAUDE.md §7 — "Bare name, no `wf`/`wf-` prefix (the `wf:` namespace comes from the plugin name; prefixing yields `/wf:wf-spec`)"; every skill folder in plugins/*/skills/ carries a bare name, so the doubled form appears nowhere in the tree

### term: no AI attribution
definition: No artifact, commit message, or published comment a skill writes carries an AI-attribution trailer, footer, or promotional tagline.
avoid: none
pattern: ^(Co-Authored-By:|🤖|Generated with \[Claude Code\])
except: none
applies-to: skill-body, reference, contract, capability, agent
check: avoid-term
evidence: plugins/wf/agents/commit.md — "Never write any AI attribution into the commit message — no `Co-Authored-By`, no \"generated with\" footer, no emoji tagline"; plugins/wf/agents/pr.md and plugins/wf/skills/constitution/SKILL.md carry the same ban. The pattern is anchored at column 1 so the ban prose, which quotes the trailer inline, never fires

## Leading-word conformance

**Landing: empty. No leading-word position proved violation-testable.** This section records
the evidence that decided it, as the charter's evidence-defined rule requires.

Two positions were examined:

- **Headings.** Skill bodies mix `## Phase 1 — Read the config`, `## Step 3 — Return the
  phase's Final Output block`, `## Edge Cases`, and bare noun headings such as `## Templates`
  and `## Safety Rules` in the same file. `## Edge Cases` is the one heading the repository
  fixes exactly, and it is already enforced by convention review rather than by leading word.
  No verb-first heading rule survives contact with the noun headings, so any check would fire
  on conformant prose.
- **Imperative step openers.** Numbered procedure steps do cluster on a small verb set —
  `Read`, `Run`, `Invoke`, `Emit`, `Write`, `Stop` — but a large minority open with a bold
  label (`**Round cap:** ...`), a conditional (`If the file is absent ...`), or a noun phrase.
  Enforcing the verb set would fail those legitimately, and enumerating the allowed openers
  broadly enough to pass them leaves a check that can no longer fail.

An `avoid-term` check set with no `leading-word` entries is the acceptable landing the
charter names. Should a position later prove violation-testable, it is added here as an
ordinary entry with `check: leading-word`; the parse contract already carries the field.

## Rejected candidates

Recorded so the same candidates are not re-litigated. Each failed the admission gate.

- **`final-output block` versus `Final Output block`.** Real drift — both forms are in heavy
  live use across skill bodies and agent files, roughly balanced, and neither dominates.
  Picking a winner would be invention, not extraction, and would fire on a large share of the
  tree on first touch.
- **`cap` as a bare word.** Rejected as a bare-word pattern: `cap` is legitimate live use as a
  limit (`a silent per-file diff-size cap`, `**Round cap:**`, `a cap on pull requests`). Only
  the compound-noun form survived, and that is what the `capability` entry patterns.
- **`capability pack` as a collapsed unit.** A pack ships a capability, so the compound looked
  like drift. The tree says otherwise: `plugins/wf-node-ts/skills/init/SKILL.md` — "simplified
  for a single-capability pack" — uses it correctly as *a pack holding one capability*, as do
  the wf-angular and wf-browser-qa init bodies and `plugins/wf/skills/init/SKILL.md`. Live use
  contradicts the rule, so the rule loses.
- **`stage` as a synonym for an SDD phase.** No occurrence in the tree, and no observed
  confusion — nothing to extract.
- **Windows-style backslash paths.** CLAUDE.md bans them, but backslashes are legitimate
  inside the regexes and escape sequences that contracts and guard scripts quote, so no
  pattern separates the used form from the quoted one.
