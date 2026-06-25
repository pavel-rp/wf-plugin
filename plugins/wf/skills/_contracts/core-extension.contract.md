# Core extension interface (the port)

**Version:** 1.0.0 (frozen — WF-1; superseded by v2, WF-21)
**Status:** **Superseded by** `capability-registry.contract.md` (v2.0.0, WF-21) — kept as the frozen v1 N=1 base; not reopened.
**Model:** claude-opus-4-8
**Owned by:** the `wf` core plugin (domain-agnostic; ships inside the plugin)

> **Superseded.** This is the v1 port: a single `{domain}` selector with a
> `<none>` Null Object, and three named hooks (`rule-audit`, `parity-suite`,
> `mapping`). The v2 boundary — a capability **registry**, the named **SDD
> phases** as injection points, and the generic **contribution taxonomy** —
> lives in `capability-registry.contract.md` (v2.0.0, WF-21), the authoritative
> source of truth for the boundary. This document is kept intact as the **N=1
> base** v2 generalises (a single-row registry reduces to exactly this single
> `{domain}`); it is not reopened. The runtime half is generalised separately by
> WF-22.

---

## Purpose

This document is the **port** between the domain-free `wf` core and a pluggable
domain capability. It declares the stable abstraction that core skills depend on
so that no core skill body ever names a concrete domain. A capability fills this
port from outside the core (see the companion capability contracts); the core
depends only on the names defined here, never on a capability's implementation.

This is the interface half of the ports-and-adapters design: core skills are the
invariant skeleton plus declared hooks; a capability is the adapter that fills
the hooks; the selector below chooses which adapter is active, with a Null Object
state that disables the seam cleanly.

This document defines **semantics only**. It does not wire any runtime, build a
validator, or layer profiles — those are owned by separate tasks. Nothing here
should be read as an instruction to execute behavior; it is a contract.

---

## The `{domain}` selector

Core reads a single selector, `{domain}`, that names the active capability (or
its absence). The selector has exactly two kinds of state:

| State | Meaning |
|-------|---------|
| `<none>` | No capability is active. This is the **default** and the **Null Object** state. Every hook below becomes a no-op (see semantics). |
| *an active capability* | A named capability is active. It fills the hooks below with its declared behavior. The capability is named only in its own contract and configuration — **never** inside a core skill body. |

The selector is the only thing core branches on, and it branches on it in the
**generic** form only: `<none>` versus "a capability is active." Core never lists
specific capability names, never tests `if {domain} == <some concrete name>`, and
never carries a code path keyed to one capability. Adding or removing a capability
must require **zero** edits to any core skill body.

---

## The hooks

Core skills invoke a fixed, small set of **named generic hooks**. A hook is an
extension point: core defines *when* it fires and *what shape* of result it
expects, and a capability defines *what the hook does*. Core references each hook
**by name only** — it carries no built-in implementation and no domain example of
any hook.

| Hook | Purpose (generic) |
|------|-------------------|
| `rule-audit` | An extension point where core invites the active capability to assert its domain-specific invariants and rule-checks against the work under review, and to report conformance findings. Core supplies the artifact under review and the generic finding shape; the capability supplies the rules. |
| `parity-suite` | An extension point where core invites the active capability to contribute an equivalence-checking layer — scenarios that assert the work matches a capability-defined reference oracle, beyond core's own checks. Core supplies the surface to be exercised and the generic scenario shape; the capability supplies what "matches" means. |
| `mapping` | An extension point where core invites the active capability to translate between a source representation and a target representation according to capability-defined correspondence rules, emitting a structured correspondence artifact. Core supplies the inputs to be related and the generic table shape; the capability supplies the correspondence rules. |

Each hook is a **named seam**, not a script: this contract fixes the hook's name,
the generic contract of when it fires and what it returns, and nothing about any
particular capability. The capability contract is responsible for declaring which
of its slots fill which hook.

---

## `<none>` selector contract semantics

When `{domain}` is `<none>`:

1. **Every hook is a no-op.** `rule-audit`, `parity-suite`, and `mapping` each
   produce the empty result of their declared shape — no findings, no scenarios,
   no correspondence rows. A core skill that reaches a hook with `<none>` active
   proceeds exactly as if the hook were absent; the surrounding workflow skeleton
   is unaffected.

2. **No domain-named branching anywhere in core.** The Null Object state is the
   *only* mechanism by which the seam is disabled. Core does not contain a code
   path, conditional, or message keyed to any specific capability. The single
   permitted branch is the generic one — `<none>` versus "a capability is active"
   — and even that resolves to "invoke the hook, which is a no-op under `<none>`,"
   so most core code need not branch at all.

3. **Core is fully usable with the domain disabled.** A project that sets
   `{domain}: <none>` gets the complete core workflow with the capability seam
   silently inert. No domain term ever surfaces. This is the guarantee that makes
   the core domain-free: the contract, not the skill bodies, carries the seam.

These semantics are **prose only**. The mechanism that makes a hook actually
return its empty result at runtime (selector wiring, no-op dispatch) is owned by a
separate downstream task and is intentionally unspecified here.

---

## Composition

Every hook named above is filled by exactly one or more capability slots, and
every capability slot either fills a hook named here or is an explicitly declared
extension hook with no core counterpart. The capability contract is the other half
of this composition and declares the slot→hook mapping from its side. This
contract names the hooks; the capability contract names the slots that fill them.

The two halves are mutually consistent by construction: a core skill invoking a
hook reaches capability behavior **only** through the hook name, and a capability
exposes behavior to core **only** by filling a named hook. Neither side names the
other's internals.

---

## What this contract is NOT

- It is **not** a runtime. No selector dispatch, no no-op machinery, no
  invocation wiring is defined or implied here.
- It is **not** a validator. The machine-checkable shape of a capability's slots
  lives in that capability's own contract; validating a capability against it is a
  separate concern.
- It is **not** a capability. It names zero domains. The hooks are generic seams;
  any concrete behavior, vocabulary, or example belongs in a capability contract
  outside the core.
