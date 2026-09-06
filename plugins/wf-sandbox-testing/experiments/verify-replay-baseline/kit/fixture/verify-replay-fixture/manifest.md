# verify-replay-fixture capability manifest

**Version:** 0.1.0
**Conforms to:** `plugins/wf/skills/_contracts/capability-registry.ops.md` §"Manifest schema v2" (v1.1.0)
**Executed by:** `plugins/wf/skills/_contracts/invocation-runtime.ops.md` §"The moving parts" (phase firing at `verify`)
**Capability:** verify-replay-fixture (registered **only** inside a replay-seeded fixture workspace's `_local/config.md`, as the repo-relative row `_local/verify-replay-fixture`)
**Kind:** adapter (fragments only — no skills, no agents)
**Model:** claude-fable-5-1

---

verify-replay-fixture is the **static stand-in for every lens and critic contributor** a replayed
`/wf:verify-spec` round would otherwise dispatch. It attaches exactly one `finding` contribution
at the `verify` phase, dispatched `inline:` — an ordinary registry contribution the skill follows
in its own context — whose body is the round's **recorded** `## Capability findings` block,
rendered into the generic finding shape by `kit/materialize-round.sh` before the round runs.
Because the contribution is `inline:` and not `subagent:`, the aggregation, blocking, ledger, and
verdict code of the installed `verify-spec` runs **unmodified** over that content while **no lens
agent, critic agent, or tracker operation is dispatched** — the mechanism signals in
`experiment.json` assert exactly that over the transcript.

## Fragments

Schema (`capability-registry.ops.md` §"Manifest schema v2"): `phase | contribution-kind |
dispatch | scope`. The inline path is forward-slash, **relative to this capability's registry
path**. `finding` is an aggregate kind, so `scope` is `—`.

| phase  | contribution-kind | dispatch                        | scope |
|--------|-------------------|---------------------------------|-------|
| verify | finding           | `inline: fragments/findings.md` | —     |

`fragments/findings.md` in this folder is the **committed template**; the file the seeded
workspace carries is regenerated per round from `corpus/items/verify-replay-<task>/rounds/round-NN.json`.
When a recorded critic stub is supplied (`materialize-round.sh --critic <file>`), a second row
`| verify | finding | inline: fragments/critic.md | — |` is appended to the seeded copy of this
table — never to this committed template.

**Never register this capability alongside `audit`** (or any other `verify`-phase `finding`
contributor) in a replay workspace: the point of the replay is that the recorded findings are the
*only* findings, so a live lens beside it would double-count and break the invariant.
