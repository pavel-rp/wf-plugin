# angular capability manifest

**Version:** 1.1.0 (WF-258 — genericized + extracted to wf-angular; `requires:` drops `ado`, keeps `git`)
**Conforms to:** `plugins/wf/skills/_contracts/capability-registry.contract.md` (manifest schema v2)
**Capability:** angular (registered in the downstream `_local/config.md` `## Capabilities` table)
**Kind:** feature (ships its own skills; also attaches one phase fragment via the registry)
**Model:** claude-opus-4-8

---

This is the angular capability's **fragments manifest** — the file a core skill reads
at `<path>/manifest.md` (when iterating the `## Capabilities` registry) to learn which
fragments this capability attaches to which SDD phases. Core resolves `<path>` from the
registry row in `_local/config.md`; it does not hardcode this path.

angular supplies the **Angular stack test-host surface** — the routed test-host page
scaffolder (`qa-host`) that gives an un-routed component a runnable URL (and an ephemeral
backend-controller analog), and the DI-level black-box page-test harness (`test-page`) that
injects spec-derived tests into the stack's sandbox component. Both are **stack-specific**:
they name the Angular runtime (DI, zone.js, `HttpClient`), the stack's routing module, and
the stack's web/test-host paths — which is exactly why they belong in a stack capability and
not in domain-free core. **Every project-specific token in the scaffolded output** — the
web/test-host/routing paths, the routing-module class, the route prefix, the sandbox host
folder/component, and the route guards — is **profile-slot-driven**, so scaffolding a
differently-named app emits no borrowed identifiers. The concrete slot values live in the
capability's **profile** (below), not in the skill bodies.

## Requires

requires: git

This capability assumes a `delivery` provider (`git`) is registered in the capability
registry — the scaffolders infer targets from the branch diff and index their artifacts via
the delivery surface. It is **tracker-agnostic**: it names no work-item tracker, so it
declares no `tracker` requirement and composes whether or not an `ado`/`linear` provider is
registered.

## Fragments

Each row attaches one fragment to one phase, typed by the contribution taxonomy. The
schema is the v2 shape fixed by `capability-registry.contract.md`:
`phase | contribution-kind | dispatch | scope`. `subagent:` dispatch names a registered
subagent invoked via the Task tool. `scope` is required for partitioned kinds; `provider`
carries a **`surface`** enum token.

| phase         | contribution-kind | dispatch                        | scope |
|---------------|-------------------|---------------------------------|-------|
| qa-execution  | provider          | `subagent: wf-angular:qa-host`  | host  |

Read off the columns:

- **qa-host** (`qa-execution | provider | subagent: wf-angular:qa-host | host`) — the Angular
  **test-host execution provider**. A core skill orchestrating `qa-execution` walks the
  registry, finds the `provider` row that owns `surface: host`, and dispatches the
  host-scaffolding work to it via the Task tool (`subagent_type: wf-angular:qa-host`). It
  scaffolds a routed test-host page (or wires an ephemeral backend endpoint) so a scenario
  has a runnable URL/endpoint, then returns its `QA-HOST — …` block. The orchestrator owns
  run lifecycle; the host provider owns only the stack-specific scaffolding surface.

`provider` is a **partitioned** kind: only the capability owning `surface: host` applies at
`qa-execution` for that surface. Two capabilities claiming the same surface is a
registry-validation error; different surfaces compose. angular owns `host` only — it makes
no claim on `engine` (the browser-automation surface), so it composes alongside
**browser-qa**'s `surface: engine` with no conflict (one owns the test-host scaffolding, the
other owns the browser drive).

## Skills

As a `feature` capability, angular ships its skills natively (install the plugin → the
`/wf-angular:*` commands are discoverable; native plugin composition handles loading).
Documented for reference:

```
skills:
  - plugins/wf-angular/skills/qa-host/    # /wf-angular:qa-host — routed Angular test-host scaffolder (the host provider dispatch target)
  - plugins/wf-angular/skills/test-page/  # /wf-angular:test-page — browser-run black-box DI-level tests for Angular targets
agents:
  - plugins/wf-angular/agents/qa-host.md  # wf-angular:qa-host — the host scaffolder's subagent companion (the qa-execution host-provider dispatch target)
```

The fragment row's `subagent: wf-angular:qa-host` resolves to that companion — a thin
redirect that reads the `/wf-angular:qa-host` skill and executes it in an isolated context,
mirroring how browser-qa ships `agents/qa-engine.md` for its `engine` surface. The agent
holds no procedural logic of its own (skill-primary, thin agent); the scaffolding lives in
the skill. It declares **no** `tools:` field, so it inherits the full session catalog —
including the `Write`/`Edit`/`Bash` tools the host scaffolding and typecheck need (per
`CLAUDE.md` §8).

## Deferred fragments

This manifest wires only the `qa-execution | provider | surface: host` fragment. The
authoring `guidance` fragments this capability will gain at **`spec`** (Angular conventions)
and **`implement`** (stack idioms / scaffolds), and any constitution `article` clauses for
the stack's non-negotiables, are **deferred** to the per-phase wiring work — exactly as the
migration manifest notes its own deferred authoring `guidance`. Until those land, angular
attaches the single host-provider fragment above and nothing else.

## Profile seed template

This capability ships a human-fillable **profile seed template** declared via the v2 manifest
`profile-template:` field (`capability-registry.contract.md` §"Manifest schema v2"). The path
is forward-slash, **relative to this capability's registry path** (so it resolves to
`<capability-path>/profile.template.json` under the resolved `wf-angular` install root):

```
profile-template: profile.template.json
```

The template ships as the capability's **authoritative default template** — the baseline
shape a project overrides; it carries neutral angle-bracketed placeholder slots (per the
contract's placeholder syntax) for **every** project-specific token the moved skills emit:
the four Angular stack paths (`web-root`, `routing-module`, `test-host-root`,
`verify-command`), the routing-module class (`routing-module-class`), the test-host route
prefix (`route-prefix`), the sandbox host folder and component (`sandbox-host-folder`,
`sandbox-host-component`), and the route guards (`route-guards`). `init` seeds a downstream
**override** at `_local/profiles/angular.profile.json` **only when the project diverges**
from the default (skip-if-present, never overwrites). Precedence is **downstream override >
capability default**: where a project sets no override, the capability default applies; where
it diverges, the project fills the slots in the override. No slot carries a borrowed
identifier — the placeholders name generic example values only.

## Downstream registration

This repo ships the capability + its skills inside the `wf-angular` plugin; it does **not**
carry a `_local/config.md` (that lives in each consuming project). To activate angular
downstream, run `/wf-angular:init` — it records the pack's install root in the `## Plugin
Roots` table and appends the plugin-anchored capability row:

```markdown
## Capabilities

| Capability | Path                                 |
|------------|--------------------------------------|
| angular    | plugin:wf-angular/capabilities/angular |
```

On `init`, the `angular` profile seeds `_local/profiles/angular.profile.json` on divergence
from the shipped default template.
