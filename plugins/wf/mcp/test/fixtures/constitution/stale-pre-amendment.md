# Project Constitution

**Composed:** 2026-07-21 11:38
**Model:** gpt-5.6-sol[1m]
**Registry:** git, audit, sr

<!-- COMMITTED FIXTURE — a constitution composed against the PRE-AMENDMENT core
     article text, kept checked in so the re-composition path has a repeatable
     signal available to every clone and to CI.

     `_local/constitution.md` is gitignored, so a live composed record is evidence
     of drift and never an acceptance artifact: it is untracked, invisible
     elsewhere, and its own first re-run destroys the staleness a test over it
     would depend on. This file exists so that check survives its first run.

     DO NOT REFRESH THIS FILE when core article text changes. Its staleness IS the
     fixture. The test composes over its bytes in memory and asserts the file on
     disk is untouched afterwards. -->

The non-negotiable principles this project's workflow holds itself to. **Composed, not
baked** — core process articles + each registered capability's non-negotiables + the
project's own clauses, each tagged with its source.

## Precedence

1. **Project clauses override capability clauses** — a project clause wins over any
   capability article, regardless of registry order.
2. **Capability-vs-capability contradiction is a registry-validation error** — resolved by
   the registry validator, not here; only the project may resolve it (rule 1).

## Core articles (provenance: core)

1. **The spec is the single source of truth.** A derived artifact (plan, task list) never overrides the spec; conformance is judged against the spec.
2. **No phase skips its gate.** Every phase is a human-approved artifact that feeds the next; nothing advances past an unapproved gate.
3. **Nothing writes outside `_local/`** except the designated source-mutating skills.
4. **Every artifact carries model attribution.** A `**Model:** <id>` line (or a verb-shaped variant) records which model produced each artifact.
5. **No AI attribution in commits.** Commit messages and PR descriptions carry no `Co-Authored-By` trailer, "generated with" footer, emoji, or promotional tagline.
6. **Never commit to `main`.** All work happens on a feature branch (`feat/…`, `fix/…`, `chore/…`); pushing to `main` is forbidden regardless of registered capabilities.
7. **Project configuration lives in `_local/config.md`.** Project-specific values are read from config, never hardcoded into a skill.
8. **Core never requires a capability.** Every core extension point ships a lean default and runs inert when no capability is registered; core never names or hard-depends on a specific capability.
9. **Temp and scratch files live under `_local/`.** Working, temporary, and scratch files route to a dedicated scratch area under `_local/` (`_local/scratch/`).

## Capability articles (provenance: each capability)

### sr

- **precommit-self-review:** required

## Project clauses (provenance: project)

<!-- Add this project's own non-negotiable clauses below. They override capability
     articles. This section is preserved verbatim across re-runs — /wf:constitution never
     overwrites it without asking. -->

1. **no-vendored-forks:** a third-party dependency is upgraded, never forked in place.
2. **one-issue-one-branch:** every change ships on its own branch with its own acceptance
   check, and a branch that cannot state its check is not ready to open.

   A trailing indented paragraph, kept deliberately: a composition that re-rendered the
   project's writing rather than slicing it would normalize this indentation away, and the
   test asserts it survives to the byte.
