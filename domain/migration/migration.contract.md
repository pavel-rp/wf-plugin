# Migration capability contract

**Version:** 1.0.0 (frozen — WF-1)
**Status:** authoritative source of truth for the migration capability's slot schema
**Fills:** the core extension interface — `plugins/wf/skills/_contracts/core-extension.contract.md`
**Model:** claude-opus-4-8
**Location:** `domain/migration/` — a transitional in-repo domain folder at the
repository top level, deliberately **outside** `plugins/wf/`. It foreshadows the
future standalone add-on plugin; the core plugin stays domain-free.

---

## Purpose

This document is the **adapter side** of the core↔domain port. It declares the
slots a migration capability provides and shows how each slot composes with the
generic hooks the core extension interface defines. A downstream profile fills
these slots with concrete project values; this contract only freezes the slot
schema and the slot→hook mapping.

The migration domain this capability externalizes is a strict 1:1 source→target
port (a legacy C#/MVC unit ported to an Angular/TypeScript counterpart) in which
property names are preserved, enum integer values round-trip, DOM ids/classes are
preserved verbatim, and method signatures are preserved. That domain knowledge
currently lives inline in core skills; this contract is the schema those future
extractions fill. **No skill body is moved or modified by this contract** — it is
the frozen interface, not the migration of the content.

This is a contract, not a runtime. The embedded slot schema is JSON-Schema-*style*
— a frozen, machine-readable shape meant to feed a validator directly — but no
validator is run or wired here.

---

## The six slots

A migration capability provides six slots. Four are **data/policy** slots; two
are **hook** slots (explicit extension points the profile points at a script or
playbook for).

### `stack` (data)

The source and target stack coordinates: the source-side root and file
extensions, the target-side root and file extensions. This is what lets core
relate a source unit to its target counterpart without naming any concrete path
in a skill body. Example shape (not values): a source root with its extensions
(`.cs` / `.cshtml` class), a target root with its extensions (`.ts` / `.html` /
`.scss` class).

### `type-map` (data)

The ordered list of source-type → target-type correspondence rules, one row per
mappable type, including nullability and collection handling. This is the
authoritative table that decides, for any source type, what the target type must
be (and flags any source type absent from the table as an escalation). It is the
data a `mapping` invocation consults to fill the type column of a correspondence
artifact.

### `invariants` (data)

The list of cross-cutting properties that must hold for every migrated unit
regardless of the specific ticket — the standing rules of a faithful 1:1 port
(names preserved under the casing rule, integer values round-trip, ids/classes
preserved verbatim, signatures preserved). These are assertions, not opinions: a
unit that violates one is non-conformant.

### `rule-checks` (policy)

The ticket-agnostic conformance checks run against the work under review — the
mechanical assertions that the `invariants` hold in the actual changed code
(e.g. a forbidden API was not introduced, a target id matches its source id). A
`rule-check` is the executable/checkable counterpart of an `invariant`: the
invariant states the rule, the rule-check asserts it against a concrete diff.

### `playbooks` (hook)

An extension-point slot: an ordered set of pointers to capability-defined
procedure documents (the "how to port this class of unit" guides) that core loads
conditionally when a task touches the relevant area. The profile points this slot
at the procedure documents; core never embeds the procedures. This slot fills an
explicit extension hook with **no core counterpart** — core does not define a
generic hook for procedure loading; the capability declares it.

### `extraction-overrides` (hook)

An extension-point slot: optional pointers to capability-defined scripts or
alternate grammars that replace the default source→target extraction for stacks
whose shape the default grammar does not fit. When present, the override fills the
extraction step the `mapping` hook would otherwise drive with its built-in
grammar. This slot, like `playbooks`, fills an explicit extension hook with **no
core counterpart** — it is a declared capability extension, not a core seam.

---

## Slot → hook composition

Every core hook named in the core extension interface is filled by one or more of
the slots above, and every slot either fills a core hook or is an explicitly
declared extension hook with no core counterpart.

| Core hook (from the core extension interface) | Filled by slot(s) | Composition |
|------------------------------------------------|-------------------|-------------|
| `rule-audit` | `rule-checks`, `invariants` | Core fires `rule-audit`; the capability runs its `rule-checks` (which assert the `invariants`) against the work under review and returns conformance findings. |
| `mapping` | `type-map`, `stack` | Core fires `mapping`; the capability uses `stack` to locate the source/target pair and `type-map` to decide each correspondence row, returning the correspondence artifact. |
| `parity-suite` | `invariants` (the parity-relevant subset) | Core fires `parity-suite`; the capability contributes equivalence-checking scenarios asserting the migrated unit matches its legacy oracle, derived from the 1:1 `invariants`. |
| *(no core counterpart)* | `playbooks` | Explicit declared extension hook — capability-defined procedure pointers loaded conditionally. Core defines no generic hook for it. |
| *(no core counterpart)* | `extraction-overrides` | Explicit declared extension hook — capability-defined extraction replacement. Core defines no generic hook for it. |

This mapping is mutually consistent with the core extension interface: the three
core hooks (`rule-audit`, `parity-suite`, `mapping`) each have a filling slot, and
the two hook slots (`playbooks`, `extraction-overrides`) are declared extension
hooks with no core counterpart. No slot is left unmapped; no core hook is left
unfilled.

---

## Embedded slot schema (JSON-Schema-style)

Frozen machine-readable shape covering all six slots. This is the input a future
validator consumes to check a downstream profile; it is not run or wired here.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "domain/migration/migration.contract.md#slots",
  "title": "Migration capability profile",
  "type": "object",
  "required": ["stack", "type-map", "invariants", "rule-checks"],
  "additionalProperties": false,
  "properties": {
    "stack": {
      "type": "object",
      "description": "Source and target stack coordinates. Fills the core 'mapping' hook (with type-map).",
      "required": ["source-root", "target-root", "source-exts", "target-exts"],
      "additionalProperties": false,
      "properties": {
        "source-root": { "type": "string", "description": "Repo-relative root of the source side (forward slashes)." },
        "target-root": { "type": "string", "description": "Repo-relative root of the target side (forward slashes)." },
        "source-exts": { "type": "array", "items": { "type": "string" }, "minItems": 1, "description": "Source file extensions, e.g. ['.cs', '.cshtml']." },
        "target-exts": { "type": "array", "items": { "type": "string" }, "minItems": 1, "description": "Target file extensions, e.g. ['.ts', '.html', '.scss']." }
      }
    },
    "type-map": {
      "type": "array",
      "description": "Ordered source-type to target-type correspondence rules. Fills the core 'mapping' hook (with stack).",
      "minItems": 1,
      "items": {
        "type": "object",
        "required": ["source-type", "target-type"],
        "additionalProperties": false,
        "properties": {
          "source-type": { "type": "string", "description": "Source-language type token." },
          "target-type": { "type": "string", "description": "Target-language type token." },
          "nullable": { "type": "boolean", "description": "Whether the rule covers the nullable form." },
          "note": { "type": "string", "description": "Optional clarification (round-trip behavior, collection handling)." }
        }
      }
    },
    "invariants": {
      "type": "array",
      "description": "Cross-cutting properties every migrated unit must hold. Fills the core 'rule-audit' hook (asserted via rule-checks) and seeds 'parity-suite'.",
      "minItems": 1,
      "items": {
        "type": "object",
        "required": ["id", "statement"],
        "additionalProperties": false,
        "properties": {
          "id": { "type": "string", "description": "Stable identifier for the invariant." },
          "statement": { "type": "string", "description": "The rule, in prose." },
          "parity-relevant": { "type": "boolean", "description": "Whether this invariant contributes to the parity-suite oracle." }
        }
      }
    },
    "rule-checks": {
      "type": "array",
      "description": "Ticket-agnostic conformance checks asserting the invariants against the changed code. Fills the core 'rule-audit' hook.",
      "minItems": 1,
      "items": {
        "type": "object",
        "required": ["id", "asserts", "check"],
        "additionalProperties": false,
        "properties": {
          "id": { "type": "string", "description": "Stable identifier for the check." },
          "asserts": { "type": "string", "description": "Identifier of the invariant this check enforces." },
          "check": { "type": "string", "description": "The mechanical/checkable assertion against the diff." },
          "severity": { "type": "string", "enum": ["fail", "warn"], "description": "Conformance severity when the check trips." }
        }
      }
    },
    "playbooks": {
      "type": "array",
      "description": "Declared extension hook (no core counterpart). Pointers to capability-defined procedure documents loaded conditionally.",
      "items": {
        "type": "object",
        "required": ["id", "path"],
        "additionalProperties": false,
        "properties": {
          "id": { "type": "string", "description": "Stable identifier for the playbook." },
          "path": { "type": "string", "description": "Repo-relative pointer to the procedure document (forward slashes)." },
          "applies-when": { "type": "string", "description": "Condition under which core loads this playbook." }
        }
      }
    },
    "extraction-overrides": {
      "type": "array",
      "description": "Declared extension hook (no core counterpart). Optional script/grammar pointers replacing the default extraction for unsupported stacks.",
      "items": {
        "type": "object",
        "required": ["match", "path"],
        "additionalProperties": false,
        "properties": {
          "match": { "type": "string", "description": "Source-shape selector this override applies to." },
          "path": { "type": "string", "description": "Repo-relative pointer to the override script/grammar (forward slashes)." }
        }
      }
    }
  }
}
```

The four data/policy slots (`stack`, `type-map`, `invariants`, `rule-checks`) are
**required** — a migration capability that does not provide them cannot fill the
core hooks it claims. The two hook slots (`playbooks`, `extraction-overrides`) are
**optional** — they are extension points a profile fills only when its stack needs
them.

---

## What this contract is NOT

- It is **not** a profile. It declares the slot schema; the concrete project
  values that fill the slots live in a downstream profile, owned by a later task.
- It is **not** a validator. The schema above is the validator's *input*; running
  it against a profile is a separate concern.
- It does **not** modify or move any existing skill. The inline domain knowledge
  in the core skills stays where it is; relocating it into a profile that fills
  these slots is owned by later tasks.
- It does **not** ship inside the core plugin. It lives under `domain/migration/`
  precisely so the core stays domain-free.
