---
name: clean
description: Clean-sibling fixture for glossary-lint.sh. Never installed, never invoked.
allowed-tools: [Read]
---

# /wf:clean — clean-sibling fixture

The counterpart to `../violation/SKILL.md`. Same document class, same fixture
glossary, zero violations — so the self-test proves the lint DISCRIMINATES rather
than merely fires. Two of the three fixture entries are exercised here in shapes
that must stay silent.

## Conformant prose

The canonical spelling is used throughout: this step configures the widget before
the run begins, and the plan may declare several widgets.

## An `except:`-exempt line

The `dispatch is prefixed` entry bans a bare value, but its `except:` ERE exempts
the two prefixed forms. This row is therefore legitimate and must not fire:

dispatch: inline

## An out-of-scope term

The `gizmo` entry is scoped `applies-to: agent`. This file is a skill body, so the
forbidden spelling gizzmo below must stay silent — the scope test, not a
suppression:

The gizzmo is configured by the host agent, never here.

## Edge Cases

None. This fixture is never executed; it is only ever read by the lint.
