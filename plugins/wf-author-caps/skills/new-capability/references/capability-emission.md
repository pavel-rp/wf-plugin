# Capability emission — the manifest and fragment rule set

**Model:** claude-opus-4-8


Before following any resolver MCP call in this document, run `pwd -P` and use the returned absolute current Agent/session workspace directory as `workspaceRoot`. In a linked-worktree Agent, that cwd is the Agent's own worktree; never inherit a parent root. Pass it explicitly on every call. Omitting `workspaceRoot` is a hard schema error; resolver MCP calls have no default or fallback root.
The single rule source for emitting a capability's artifact set: one schema-v2 `manifest.md` plus one
fragment file per declared Fragments row. It is written over an abstract **target capability folder**,
so any scaffolder that emits a capability — on its own, or as one part of a larger pack emission —
supplies the validated interview answers and inherits every rule below unchanged. Reuse it; never
fork it.

Runtime-read: behavior-bearing rules and outcome mappings only. The authoritative upstream is the
core contract `capability-registry.ops.md` §"Manifest schema v2", §"The SDD phases", and §"The
contribution taxonomy"; when this file and the contract disagree, the contract wins and this file is
the defect.

## Contents

- [The target folder](#the-target-folder)
- [The fixed vocabularies](#the-fixed-vocabularies-what-an-answer-may-name)
- [The manifest](#the-manifest-what-to-emit)
- [The fragment files](#the-fragment-files-one-per-declared-row)
- [Composing this rule set](#composing-this-rule-set)

## The target folder

Every emitted path is relative to `plugins/<plugin-name>/capabilities/<capability-name>/`. The
capability name is a filesystem-safe token — lowercase letters, digits, and hyphens — and is the same
token a registry row's `Capability` column carries. Emission targets a downstream pack's tree, never
core's own `plugins/wf/`.

## The fixed vocabularies (what an answer may name)

A manifest may not invent a phase or a contribution kind. Validate every answer against these sets.

**Kinds:** `adapter` (fragments only, ships no skill) · `feature` (ships its own skills, may also
attach fragments) · `both`.

**Phases:** `spec` · `plan` · `tasks` · `implement` · `verify` · `qa-generation` · `qa-execution` ·
`pre-commit`.

**Contribution kinds, their phases, and whether they partition:**

| Contribution kind | Valid phase(s) | Partitioned? | Scope token required |
|---|---|---|---|
| `guidance` | `spec`, `implement` | no — aggregates | `—` |
| `task-list` | `tasks` | no — aggregates | `—` |
| `artifact` | `plan` | **yes** | a `source→target` pair |
| `finding` | `verify`, `pre-commit` | no — aggregates | `—` |
| `scenario` | `qa-generation` | no — aggregates | `—` |
| `provider` | `qa-execution`, `implement` (delivery), `spec` (tracker) | **yes** | a `surface` token |
| `slot` | none — targets a skill point, so its phase cell is `—` | `replace` partitions; `append` aggregates | a `<skill>.<point> <merge-policy>` compound |

**The partitioned-kind rule is absolute.** A row whose contribution kind is `artifact`, `provider`,
or `slot` must carry a declared scope, and that scope must not collide with a scope an already-active
capability owns. An answer that names a partitioned kind with no scope, or with a scope another
capability already claims, cannot produce a valid manifest: state the rule, state why the answer
violates it, and re-ask. Never emit the row with a blank scope, never invent a scope the author did
not give, and never fall back to an aggregate kind to dodge the requirement.

**`article` is not a contribution kind.** A constitution clause is the repeatable manifest key
`article: <key> = <value>`, never a Fragments row. A row naming `article` is a validator error.

## The manifest — what to emit

Emit exactly one file at `manifest.md` in the target folder, carrying in order:

1. **A title** — `# <capability-name> capability manifest`.
2. **A metadata block** — `**Version:**`, `**Conforms to:**` (the core contract path above),
   `**Capability:**` (the name, and where it registers), `**Kind:**` (one of the three, with the
   one-clause reason it is that kind), and a `**Model:** <current model id>` attribution line.
3. **A prose paragraph** stating what the capability supplies and what it deliberately does not own.
4. **`requires:` / `conflicts:`** — only when the author named them; both are optional and resolved
   at registry validation.
5. **`profile-template:`** — only when the capability fills contract slots with project values; one
   forward-slash path relative to the capability folder.
6. **`article:` keys** — one line per declared constitution clause.
7. **A `## Fragments` section** carrying the header row `| phase | contribution-kind | dispatch |
   scope |` and one row per contribution.

**Row rules.** `dispatch` is `inline: <rel-path>` (forward-slash, relative to the capability folder)
or `subagent: <plugin>:<agent>`. `scope` is the required token for a partitioned kind and `—`
otherwise. A `slot` row's phase cell is `—`.

**A zero-row table is valid** — registry validation tolerates it, so a capability that ships skills
before its first contribution emits the heading and header row with a sentence stating the emptiness
is deliberate. Emit that sentence only when the author declared no contributions; never use it to
paper over an answer that was asked for and not given.

## The fragment files — one per declared row

For every row whose dispatch is `inline: <rel-path>`, emit a real file at exactly that path — the
path the row declares, byte for byte, with no folder or suffix improvised. A row dispatching to a
`subagent:` emits no fragment file; the agent file is the pack's own, out of this rule set's scope.

Each fragment file is **runtime-read**, so it carries the ops budget: 150 lines or fewer,
behavior-bearing steps, guards, and outcome mappings only, one level deep, and a table of contents
when it exceeds 100 lines. Apply the removal test to each clause — does striking it leave a
plausible-but-wrong next action? If not, the clause is rationale and belongs in a paired reference
file that is never read at runtime.

Each fragment carries a `**Model:** <current model id>` attribution line, uses forward slashes in
every path, and addresses any companion reference through the resolver's `resolve_content` rather
than a relative markdown link — a link to one is classified as a raw-read instruction and fails the
repository's content-read guard.

## Composing this rule set

A scaffolder that emits a capability as part of a larger artifact set — a whole pack, or a provider
pack with its surface already fixed — obtains this file through the resolver's `resolve_content`
(`workspaceRoot: <Agent/session absolute current workspace directory>`, `class:
references-template`, `plugin: wf-author-caps`, `skill: new-capability`, `ref:
capability-emission.md`) and follows it for the capability portion, supplying its own already-
validated answers for name, kind, and rows. `workspaceRoot` is schema-required, has no default or
fallback, and omission is a hard schema error; a linked-worktree Agent passes its own worktree root,
not its parent's. It contributes the surrounding artifacts itself and
restates nothing above. The composing scaffolder still runs the manifest and registry checks over
what this rule set emitted; composition changes who asks the questions, never which checks the
emission must pass.
