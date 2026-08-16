# GLOSSARY fixture — the self-test's own vocabulary

Not the repository's vocabulary. This file exists so `glossary-lint.sh --selftest`
asserts its catch against a glossary it owns: coupling the assertions to a live
`GLOSSARY.md` entry would let a later edit to that entry silently delete the term
the self-test depends on, and the self-test would then pass while proving nothing.

The format is byte-for-byte the parse contract `GLOSSARY.md` documents — same
`### term: ` opener, same seven mandatory fields in the same fixed order — so the
self-test exercises the real parser, not a simplified stand-in.

The three entries are chosen to exercise one discrimination each:

| Entry | Exercises |
|---|---|
| `widget` | the plain catch — a forbidden synonym fires |
| `dispatch is prefixed` | `except:` — a matching line is exempt and must stay silent |
| `gizmo` | `applies-to:` — an `agent`-only entry must not fire on a skill body |

## Entries

### term: widget
definition: The fixture's canonical noun; the seeded violation spells it wrong on purpose.
avoid: wodget, wodgets
pattern: wodgets?
except: none
applies-to: skill-body, agent
check: avoid-term
evidence: glossary-fixtures/violation/SKILL.md — the seeded misspelling this entry exists to catch

### term: dispatch is prefixed
definition: A fixture dispatch value carries an `inline:` or `subagent:` prefix; a bare value is the banned construction.
avoid: none
pattern: dispatch: [a-z]+
except: dispatch: (inline|subagent)
applies-to: skill-body
check: avoid-term
evidence: glossary-fixtures/clean/SKILL.md — carries `dispatch: inline`, which the except: ERE must exempt

### term: gizmo
definition: A fixture noun scoped to agent files only, so a skill body using the forbidden spelling must stay silent.
avoid: gizzmo
pattern: gizzmos?
except: none
applies-to: agent
check: avoid-term
evidence: glossary-fixtures/clean/SKILL.md — uses `gizzmo` in a skill body, out of this entry's applies-to scope
