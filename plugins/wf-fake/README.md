# wf-fake — the hermetic fixture-provider pack

A standalone marketplace plugin that ships the **`fake` capability**: a `both`-kind capability
owning **BOTH** the wf capability-registry's **`delivery`** and **`tracker`** `provider` surfaces
(`plugins/wf/skills/_contracts/capability-registry.ops.md` §"The delivery provider surface" and
§"The tracker provider surface") with a **hermetic, in-memory, scripted, op-recording** binding.

It is the OUT-1 test seam of charter C016 (skill-eval harness): it lets a skill run drive its
tracker/delivery operations end-to-end with **no** Linear, GitHub, git, gh, or network of any
kind, so a skill run can be hermetic. Every op returns a **scripted** response read from a
fixture-local scripts file and appends its invocation to a machine-readable **op log**.

## What ships

| Item | What it is |
|---|---|
| `capabilities/fake/manifest.md` | the `fake` capability's manifest — two `provider` rows, scoped `delivery` and `tracker` |
| `capabilities/fake/fragments/delivery.ops.md` | runtime-ops half of the delivery binding — the uniform scripted-response protocol + the delivery op list |
| `capabilities/fake/fragments/tracker.ops.md` | runtime-ops half of the tracker binding — the same protocol + the tracker op list |
| `capabilities/fake/fragments/{delivery,tracker}.md` | reference halves — rationale + edge-case matrix; never read at boot |
| `capabilities/fake/references/scripts-format.md` | the scripts + op-log format legend |
| `capabilities/fake/references/onboarding.md` | onboarding + authoring reference for `init` |
| `capabilities/fake/fixtures/sample-scripts.json` | reference sample scripting every op (incl. a review-thread scenario) |
| `capabilities/fake/fixtures/op-vocabulary.txt` | canonical op oracle the self-checks assert against |
| `capabilities/fake/fixtures/run.sh` | deterministic self-checks (no-egress, completeness, loud-failure, sanity), CI-auto-discovered |
| `/wf-fake:init` | one-command self-registration into a fixture registry + `## Fake` config seed |

## The scripted-response protocol

Both surface fragments follow one uniform protocol: on every op, resolve the fixture's scripts +
op-log paths (`## Fake` config), append `{seq, surface, op, args, response}` to the op log, then
look up the scripted response for `(surface, op)` and return it — or, when no script exists,
**fail loudly** naming the unscripted op (never a silent skip). A scripted value that is an array
is an ordered response sequence (poll outcomes, evolving review-thread states) indexed by the
op's prior call count. Format detail: `capabilities/fake/references/scripts-format.md`.

## Hermetic by construction

No fragment, script, or fixture invokes a network-reaching tool or names an external
tracker/delivery host. `capabilities/fake/fixtures/run.sh` enforces this with a **static
no-egress assertion** (plus op-vocabulary completeness, loud-failure-guard presence, and manifest
surface sanity), and is auto-discovered by CI via `plugins/*/capabilities/*/fixtures/run.sh`.
Scripted URLs use the synthetic host `fake.local`; scripted ids use the `FAKE-` prefix. Runtime
zero-egress *observation* (a containerized clean-install run) is the container-runner sub-task's
deliverable, not this pack's.

## Fixture-only registration

`fake` is registered **only inside fixture registries**, where it is the **sole owner of both
surfaces**. Run `/wf-fake:init` inside a fixture project (after `/wf:init`) — it registers the
`fake` capability as a plugin-anchored row (`plugin:wf-fake/capabilities/fake`) via core's
`inspect_pack`/`register_pack` resolver tools and seeds the `## Fake` config section.

**Never register `fake` in a real project.** Alongside `git` (delivery) or `linear`/`ado`
(tracker) it correctly trips the registry's partitioned-ownership overlap validation — failing
and naming both offenders. That is the contract working as designed.

See `plugins/wf/skills/_contracts/capability-registry.ops.md` for the full operation set and
degradation rules of both surfaces.
