# Subagents and the canonical vocabulary

Companion reference for `/wf-author-caps:authoring-guide`. Read it when deciding whether a skill
needs a subagent companion, or when authored prose has to satisfy the vocabulary lint.

**Model:** claude-opus-4-8

## Contents

- [Skill or subagent](#skill-or-subagent)
- [The four delegation patterns](#the-four-delegation-patterns)
- [Canonical vocabulary](#canonical-vocabulary)

## Skill or subagent

A skill may ship a subagent companion for delegation with isolation: the host invokes it through the
Task tool, the subagent reasons in its own context, and only its final block reaches the caller.
Agent files live in the plugin's `agents/` folder, named for the skill, auto-discovered on install.

**Add one when** the skill does focused reasoning that yields a small structured output, the
reasoning is verbose enough to pollute the caller, or several skills need the same unit. **Skip it
when** the skill is action-oriented, used in exactly one place, or its output is already one short
line.

Two rules govern every subagent:

- **Omit the `tools:` field** unless you genuinely mean to restrict. It is an allowlist that
  *overrides* the inherited toolset, so declaring a narrow built-in-only list silently starves the
  subagent of every connected MCP server. Omitting is also the configuration-agnostic choice, since
  server names vary per repository. Nested delegation works either way.
- **Never filesystem-read a sibling skill body — invoke the skill.** A version-pinned path to a
  skill body sits outside the workspace on a marketplace install, so reading it trips the
  workspace-boundary prompt and breaks on the next version bump. Invoking loads the body with no
  filesystem read, no prompt, and no version dependency, and runs it in the existing context. A
  failed invocation hard-stops into an error block naming what failed; it never falls back to
  reading the body.

## The four delegation patterns

| Pattern | Source of truth | Use when |
|---|---|---|
| Skill-primary, thin agent | the skill body; the agent is a short pointer at it | read-only reasoning called from a few places |
| Agent-primary, thin skill | the agent file, self-contained; the skill just spawns it | an action-oriented gate many skills depend on |
| Orchestrator plus utility agent | the skill owns the loop; the agent does one heavy unit | heavy work repeats and each iteration's context can die |
| Duplicate with fallback | mirrored in both files; expect drift | rare — only when an inline fallback is genuinely needed |

Default to the first for read-only reasoning, the second for action-oriented gates, the third for
repeated heavy work. Whichever you pick, the subagent emits the **same final-output block shape** as
the skill, with no narrative outside it — consumers parse that block.

## Canonical vocabulary

Authored prose is linted against a canonical vocabulary file, and the lint fails a pull request on
any file that change touches — always on a file it adds. A pre-existing violation in an untouched
file never fails the gate, so no repository-wide cleanup blocks a change, but a file you touch you
leave clean. Author to the vocabulary from the start rather than fixing violations at the end.

The entries that bite most often:

- Write **capability**, never the clipped form, before a noun such as manifest, registry, fragment,
  kind, slot, row, pack, path, or name.
- Write **subagent** closed — never hyphenated, never spaced.
- Qualify every `subagent_type` value with its owning plugin; a bare agent name resolves only by
  accident of install order.
- Keep a skill's frontmatter `name` bare, so the namespace is not doubled into the command.
- Never write an AI-attribution trailer, a "generated with" footer, an emoji, or a promotional
  tagline into any commit message, artifact, or published comment.

Each entry in the vocabulary file carries the pattern that makes it violation-testable, plus the
scopes it applies to and evidence of live use. A term that cannot be violation-tested is a
preference, not a rule, and is deliberately absent — consult the file itself for the full set rather
than working from this summary.
