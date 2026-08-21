# Agent instructions for the `wf` plugin repository

[`CLAUDE.md`](CLAUDE.md) is the authoritative engineering guide for this repository — read it
first, and follow it in full. This file exists so an agent that looks for `AGENTS.md` by
convention finds the same rules rather than a different set. Where the two could ever be read
apart, `CLAUDE.md` wins.

The two rules that govern everything else: **core names zero stack/domain/project nouns**
(`CLAUDE.md` §1), and **every change ships a version bump** (`CLAUDE.md` §8).

## Write scope

**Never write outside `_local/`.** The only exceptions are the source-mutating skills
(`implement`, `verify-fix`, `qa-followup`), `qa-host`, `ship` (scoped: its Phase 4.2
CI-remediation loop only), and `add-term` (scoped: the authoring glossary file only).
Temporary and scratch files go under `_local/scratch/` — never the repo root, a system temp
directory, or anywhere alongside tracked files.

### The one committed-lifecycle exception

The resolver runtime — and only it — manages **declared** committed lifecycle artifacts under
`.wf/`:

- `.wf/install-state.json` — the portable install-state ledger.
- `.wf/slots/<skill>.<point>.md` — the committed project-override slot tier.
- Any destination a capability declares in a complete `## Payloads` row, whose production,
  refresh, and removal the resolver then owns.

**`.wf/` is not a general writable home.** Authority comes from two things together — the
resolver's *lifecycle ownership* and a *declared artifact class* — never from the path prefix.
An undeclared path under `.wf/` is out of scope even when the resolver is named as managing it.
An ordinary skill or agent reaches these artifacts through the resolver and still writes only
inside `_local/`; this exception adds **no** skill to the list above.

This is enforced in CI by `check-lifecycle-write-scope.sh` in the `wf-core-authoring` pack's
fixture suite, which rejects both an unowned write claim and an undeclared artifact class.

## Everything else

Skill and subagent authoring rules, the capability/contribution taxonomy, the SDD spine, plugin
mechanics, versioning tiers, and the commit workflow (feature branch always, **no AI
attribution anywhere**) are all in [`CLAUDE.md`](CLAUDE.md). Deeper repo-specific detail lives in
[`docs/authoring-notes.md`](docs/authoring-notes.md).
