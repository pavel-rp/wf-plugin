# Core→domain invocation mechanism (the no-DI substrate)

**Version:** 1.0.0 (frozen — WF-10; superseded by v2, WF-22)
**Status:** **Superseded by** `invocation-runtime.contract.md` (v2.0.0, WF-22) — kept as the frozen v1 N=1 substrate; not reopened.
**Fills:** the runtime gap deferred by `core-extension.contract.md` ("the mechanism that makes a hook actually return its empty result at runtime … is owned by a separate downstream task")
**Composes with:** `plugins/wf/skills/_contracts/core-extension.contract.md` (the port — hook names and `<none>` semantics)
**v2 generalisation:** the registry-iterating, per-phase-injecting, per-kind-aggregating runtime lives in `invocation-runtime.contract.md` (v2.0.0, WF-22), the authoritative v2 runtime; this v1 substrate is kept as the N=1 base it generalises (see `capability-registry.contract.md`, v2.0.0/WF-21, for the v2 port).
**Model:** claude-opus-4-8
**Owned by:** the `wf` core plugin (domain-agnostic; ships inside the plugin)

> **Superseded.** This is the v1 runtime: four moving parts over one `{domain}`
> selector — folder resolution, one manifest read, per-hook `inline:` / `subagent:`
> dispatch, and the `<none>` no-op path. The v2 runtime — iterate the
> `## Capabilities` registry, inject each capability's phase fragments in registry
> order, and aggregate per the contribution kind's policy — lives in
> `invocation-runtime.contract.md` (v2.0.0, WF-22), the authoritative source of
> truth for the runtime. This document is kept intact as the **N=1 substrate** v2
> generalises (a single-row registry reduces to exactly this single-manifest
> dispatch; an empty registry is exactly this `<none>` Null Object); it is not
> reopened. The port half is generalised separately by `capability-registry.contract.md`
> (v2.0.0, WF-21).

---

## Purpose

`core-extension.contract.md` froze the **semantics** of the core↔capability seam: the
`{domain}` selector, the three named hooks (`rule-audit`, `parity-suite`, `mapping`),
and the prose `<none>` Null-Object guarantee. It deliberately left the **runtime** —
how a core skill, at execution time, turns "fire the `rule-audit` hook" into actual
capability behavior — unspecified.

This document settles that runtime. It is the procedure a **core skill author** follows
to invoke a domain hook in the Claude Code skill substrate, where there is **no DI
container** to inject an implementation. It introduces **no new runtime**: the mechanism
is built entirely from primitives every `wf:*` skill already uses — reading
`_local/config.md`, reading a file at a contracted path, and invoking a subagent by
`subagent_type` via the Task tool (the established Pattern C delegation).

The mechanism is a **hybrid manifest**. Core resolves the active capability's folder from
two config keys, reads a contracted manifest in that folder that maps each hook to one of
two dispatch kinds, and dispatches per hook. Absence (`{domain}: <none>`) no-ops every
hook cleanly.

This document defines **semantics and procedure**, not behavior of any one capability. It
names zero domains. The worked demonstration below references the kept `domain/migration/`
prototype by path only — as an example a core skill resolves *to*, never as something the
core depends on.

---

## The four moving parts

A core skill invoking a hook performs exactly four steps, in order. Each is a distinct,
greppable section below.

1. **Folder resolution** — read `{domain}` and `{domain-path}` from `_local/config.md`.
2. **Manifest read** — read the contracted manifest at the fixed path under `{domain-path}`.
3. **Per-hook dispatch** — look the hook name up in the manifest and dispatch on its kind.
4. **No-op path** — when the domain is disabled or the hook is unmapped, produce the hook's
   declared empty result and proceed as if the hook were absent.

---

## 1. Folder resolution

Core resolves the active capability's folder from **two config keys**, read from
`_local/config.md` (the same file every `wf:*` skill reads as its first step):

| Key | Meaning | Default |
|-----|---------|---------|
| `{domain}` | The active capability's **name**, or `<none>`. Decoupled from any path so the binding survives the future move into `_local/` profiles. | `<none>` |
| `{domain-path}` | The repo-relative **folder** (forward slashes) holding the active capability's manifest and reference docs. Empty / `<none>` when no capability is active. | `<none>` |

The name is decoupled from the location on purpose: discovery reads the path from config
and **never hardcodes `domain/<name>/`**. A core skill must not assume the capability
lives at any fixed location — it only knows the two keys.

Resolution outcome:

- If `{domain}` is `<none>`, **or** `{domain-path}` is empty / resolves to nothing →
  the domain is disabled. Go straight to the **no-op path** (§4); do not read a manifest.
- Otherwise the capability folder is `{domain-path}`. Proceed to the manifest read.

This step branches **only** on the generic `<none>` vs. active distinction. It never tests
`if {domain} == <some concrete name>`; the resolved name is used solely to locate config,
never to key a code path. (See "Generic-only branch rule" below.)

---

## 2. Manifest read

Each capability folder carries exactly one **manifest** at a contracted, fixed path:

```
{domain-path}/manifest.md
```

A core skill reads `{domain-path}/manifest.md` to learn how the active capability fills
each hook. The skill does **not** scan, glob, or guess — the path is fixed by this
contract, so resolution is a single deterministic read.

Outcome:

- If the manifest file does not exist at that path → treat the domain as effectively
  disabled for this invocation. Go to the **no-op path** (§4).
- Otherwise parse the manifest (schema below) and proceed to per-hook dispatch.

### Manifest schema (frozen)

The manifest maps each hook name it wires to **exactly one** dispatch kind. Format rules:

- One row per wired hook. The hook name is a name frozen by `core-extension.contract.md`
  (`rule-audit`, `parity-suite`, `mapping`) — the manifest may not invent a hook name.
- Each wired hook maps to exactly one of two **dispatch kinds**:
  - `inline: <relative-path>` — a reference doc the core **reads and follows in-context**.
    The path is **forward-slash, relative to `{domain-path}`** (not repo-relative, not the
    manifest-relative `./`). So `inline: hooks/rule-audit.md` resolves to
    `{domain-path}/hooks/rule-audit.md`.
  - `subagent: <agent-name>` — a generically-named subagent the core **invokes via the
    Task tool** (`subagent_type: <agent-name>`). The heavy work runs in isolated context;
    only the agent's final block returns to the caller.
- A hook a capability does not fill is simply **absent** from the manifest. Absence is not
  an error — core treats an unmapped hook exactly like the no-op path (§4). A capability
  need not wire all three hooks; it wires only the ones it provides.
- Paths use forward slashes only, per `CLAUDE.md` authoring rules.

Canonical manifest table shape:

```markdown
| Hook | Dispatch |
|------|----------|
| rule-audit | `inline: hooks/rule-audit.md` |
| mapping | `subagent: <agent-name>` |
```

Each capability **chooses per hook** which kind to use: a cheap, prose-driven hook is
naturally `inline`; a heavy, context-hungry hook is naturally `subagent`. The mechanism is
indifferent to the choice — it dispatches on whichever kind the row declares.

---

## 3. Per-hook dispatch

To fire a hook, the core skill looks the hook name up in the parsed manifest and acts on
the row's dispatch kind:

| Manifest row | Core action |
|--------------|-------------|
| `inline: <relative-path>` | Read `{domain-path}/<relative-path>` and **follow it in-context**: the reference doc instructs the core what to assert/produce, and the core returns the result in the hook's generic shape (from `core-extension.contract.md`). No subagent is spawned. |
| `subagent: <agent-name>` | Invoke the Task tool with `subagent_type: <agent-name>`, passing the artifact under review and the hook's generic shape. The subagent runs in isolated context and returns the hook's result block. |
| *(hook name absent from manifest)* | No-op path (§4) — the hook produces its declared empty result. |
| *(row present, kind neither `inline:` nor `subagent:`)* | No-op path (§4, fail-safe) — core does not guess a malformed kind. |

In all three cases the **core supplies the generic shape** the hook returns (the finding
shape for `rule-audit`, the scenario shape for `parity-suite`, the correspondence-table
shape for `mapping`), and the **capability supplies the content**. Core reaches capability
behavior only through the manifest row — never by naming the capability.

---

## 4. No-op path (the `<none>` Null Object)

A hook **no-ops** — produces the empty result of its declared shape and lets the
surrounding workflow proceed exactly as if the hook were absent — in any of these cases:

1. `{domain}` is `<none>` (the default), **or**
2. `{domain-path}` is empty / resolves to nothing, **or**
3. the manifest at `{domain-path}/manifest.md` does not exist, **or**
4. the manifest exists but **lacks a row** for the hook being fired, **or**
5. the manifest has a row for the hook but its dispatch kind is neither `inline:` nor
   `subagent:` (a malformed or unrecognized kind) — core does **not** guess; it treats the
   row as the no-op path. (Rejecting a malformed manifest up front is a validator concern,
   owned by WF-2; until then this fail-safe keeps a core skill from being stranded.)

In every case the core skill emits the hook's declared empty result — no findings, no
scenarios, no correspondence rows — and continues. No domain term surfaces. The
surrounding skeleton is unaffected. This is the runtime realization of the prose `<none>`
guarantee in `core-extension.contract.md`: the contract carries the seam, the skill bodies
stay domain-free.

### Generic-only branch rule

The **only** branch a core skill may evaluate around a hook is the generic one:
`<none>` (disabled) vs. **a capability is active**. A core skill body must **never**:

- test `if {domain} == <some concrete name>`,
- carry a code path, conditional, or message keyed to one specific capability,
- name a concrete capability anywhere in its body.

Adding or removing a capability must require **zero** edits to any core skill body — the
manifest (under `{domain-path}`, outside `plugins/wf/`) carries every binding. Even the one
permitted generic branch usually collapses to "fire the hook, which no-ops under `<none>`,"
so most core code need not branch at all.

---

## Worked demonstration: `rule-audit`, active vs. `<none>`

This traces the kept `domain/migration/` prototype (committed under this task) through the
two resolutions. It is an **example a core skill resolves to** — the core depends on none
of these paths; it depends only on the two config keys and the fixed manifest path.

### Active — `{domain}: migration`

1. **Folder resolution.** Core reads `_local/config.md`: `{domain}: migration`,
   `{domain-path}: domain/migration`. Domain is active.
2. **Manifest read.** Core reads `domain/migration/manifest.md` and parses it. The
   manifest row reads `| rule-audit | inline: hooks/rule-audit.md |`.
3. **Per-hook dispatch.** The kind is `inline`, so core reads
   `domain/migration/hooks/rule-audit.md` and follows it in-context: it asserts the
   migration `rule-checks` (which enforce the `invariants`, per `migration.contract.md`)
   against the work under review.
4. **Result.** Core returns conformance findings shaped per the `rule-audit` generic
   finding contract and continues its workflow.

### Disabled — `{domain}: <none>`

1. **Folder resolution.** Core reads `_local/config.md`: `{domain}: <none>`. Domain is
   disabled — core does not read a manifest.
2. **No-op path.** The `rule-audit` hook produces its declared empty result — no findings.
3. **Result.** Core proceeds exactly as if the hook were absent. No domain term surfaced,
   and no capability-name branch was evaluated. The same skill body ran unchanged in both
   resolutions; only the config differed.

---

## Composition with WF-1

- **Hook names** come **only** from `core-extension.contract.md` — `rule-audit`,
  `parity-suite`, `mapping`. The manifest may map only these; it cannot invent a hook name.
- **Result shapes** are the generic shapes those hooks declare; the manifest binds a kind,
  never a shape.
- The migration prototype's `rule-audit` is backed by the **`rule-checks`** and
  **`invariants`** slots declared in `domain/migration/migration.contract.md` — the
  slot→hook table there maps `rule-audit → rule-checks, invariants`. This mechanism does
  not redefine that mapping; it only specifies how core reaches it at runtime.

The two WF-1 halves stay mutually consistent: core invokes a hook by name (port), a
capability fills the hook via its manifest + slots (adapter), and this document is the wire
between them — discovery, read, dispatch, no-op — with no new vocabulary.

---

## What this contract is NOT

- It is **not** a dispatcher, registry service, or build step. The "runtime" is three
  existing substrate primitives: config read, file read, Task-tool subagent invocation.
- It is **not** a validator. Checking that a manifest maps only frozen hook names, or that
  a capability's slots are well-formed, is WF-2's concern.
- It is **not** a capability. It names zero domains. The `domain/migration/` references are
  a worked example, not a dependency.
- It does **not** rewire any consumer skill. Making `verify-spec` fire `rule-audit`,
  `migration-map` fire `mapping`, or `qa-gen` fire `parity-suite` is owned by WF-7/WF-6/WF-8
  respectively.
