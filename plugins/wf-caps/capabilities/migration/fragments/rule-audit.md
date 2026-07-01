# `rule-audit` fragment — migration capability (inline reference doc)

**Version:** 1.1.0 (WF-82 — absorbed the mechanical-remedy recipes re-sourced from the domain-free core fix skill; `finding` now carries a `remedy` field)
**Wired by:** `plugins/wf-caps/capabilities/migration/manifest.md` (`rule-audit → inline: fragments/rule-audit.md`)
**Backed by:** the `rule-checks` and `invariants` slots of `plugins/wf-caps/capabilities/migration/migration.contract.md`
**Contributes:** a `finding` at the `verify` phase, per `plugins/wf/skills/_contracts/capability-registry.contract.md`
**Model:** claude-opus-4-8

---

## What this doc is

This is the **inline reference doc** the core reads and follows in-context when it fires the
`verify` phase with the migration capability active. The invocation runtime
(`plugins/wf/skills/_contracts/invocation-runtime.contract.md`) resolves
`verify | finding | inline: fragments/rule-audit.md` from the manifest and reads this file;
the core then performs the procedure below and returns findings in the phase's generic
`finding` shape, provenance-tagged to this capability.

It introduces **no new slots or fragments**. Every check below is the migration capability's
`rule-checks` slot asserting the `invariants` slot, exactly as
`migration.contract.md` declares (`rule-audit ← rule-checks, invariants`). Concrete
per-project values (the actual forbidden APIs, the casing rule specifics) come from a
downstream `_local/` profile that fills these slots — this doc is the kept reference shape,
not the populated profile.

---

## Inputs the core supplies

- **The work under review** — the changed code / artifact the core is auditing (the diff,
  the ported unit).
- **The generic `finding` shape** — the `verify` phase's `finding` contribution kind: each
  finding carries the rule it asserts, a severity, and a concrete location/evidence.

## What the core does (follow in-context)

Assert the migration **`rule-checks`** against the work under review. Each `rule-check` is
the mechanical, ticket-agnostic counterpart of an **`invariant`** — the invariant states the
rule; the rule-check asserts it against the concrete diff. Walk the changed unit and, for
each rule-check the profile declares, decide PASS or a finding.

The standing **`invariants`** a faithful 1:1 migration port must hold are the four declared
in `migration.contract.md`'s `invariants` slot. Each row below pairs an invariant with the
`rule-check` that asserts it against the diff (per the `rule-checks` slot — no new slot is
introduced):

| Invariant (`invariants` slot) | Rule-check that asserts it (`rule-checks` slot) |
|-------------------------------|--------------------------------------------------|
| **Names preserved** under the casing rule | The target property/member names correspond 1:1 to the source names under the declared casing transform; no name was dropped, added, or renamed beyond the rule. |
| **Integer values round-trip** | Enum/constant integer values in the target match the source values exactly — no renumbering. |
| **DOM ids/classes preserved verbatim** | Every target DOM id and class string matches its source counterpart character-for-character. |
| **Signatures preserved** | Method/function signatures (parameter order, count, and corresponding types per the `type-map`) match the source; and no API the migration policy forbids on the target side was introduced in place of the preserved signature. |

For each rule-check that trips, emit one finding. Use the rule-check's declared
**severity** (`fail` or `warn`, per the `rule-checks` slot schema) as the finding severity.
A unit that violates a `fail`-severity invariant is **non-conformant**.

## Output the core returns

A list of conformance findings in the `verify` phase's generic `finding` shape — one entry per
tripped rule-check:

```
- rule: <invariant id this check asserts>
  severity: <fail | warn>
  location: <file:line or unit identifier>
  evidence: <the concrete divergence observed in the diff>
  remedy: <the concrete, bounded mechanical edit that resolves the finding — see "Mechanical remedies" below; omit when no bounded edit applies (the finding is then escalation-only)>
```

The **`remedy`** field is what a fix step (`/wf:verify-fix`) applies. Core's fix skill is
domain-free — it applies whatever bounded edit the finding names but knows none of the
migration-specific recipes itself. So every migration finding that *has* a mechanical fix
carries that fix here, in the `remedy` field, spelled out concretely enough that a fix step can
apply it verbatim without knowing this capability's stack. A finding whose remedy is
context-dependent (no single bounded edit) omits `remedy` — the fix step then escalates it.

If every rule-check passes, return an **empty findings list** — the same empty shape the
`<none>` no-op produces, signalling a conformant unit. The core proceeds with its workflow
either way; this fragment contributes findings, it does not halt the skeleton.

## Mechanical remedies (the fix recipes core no longer carries)

These are the concrete, bounded edits that resolve a tripped rule-check — the migration
capability's own recipes, re-homed here from the (now domain-free) core fix skill. Each finding
that flags one of these violations sets its `remedy` field to the matching recipe, so a fix step
applies it without knowing the stack. The recipes:

| Violation the rule-check flags | `remedy` the finding carries |
|--------------------------------|------------------------------|
| A forbidden legacy utility call survives on the target side (e.g. a `CacheUtility.*` call the migration policy says has no target equivalent) | **Comment out** the forbidden line at the cited `file:line` — do not translate it. The behavior is deliberately dropped, not ported. |
| A legacy DOM/navigation API survives that the target framework replaces (e.g. a `jQuery` call, a `window.location` navigation) where the bounded replacement is unambiguous | **Wrap the line with a marker comment** flagging it for the target-framework equivalent (see the marker convention below), leaving the call commented so the port is explicit. When the correct replacement depends on surrounding context, **omit `remedy`** — escalate instead. |
| A ported unit is missing a required migration-note marker on a cited line | **Prepend or replace the marker comment** on the cited line, using the marker convention below. |
| A stack-specific branch the target must handle differently survives unported (e.g. a render-mode / output-mode branch the target implements another way) | **Comment out the legacy branch** at the cited `file:line` and mark it for re-implementation via the marker convention; escalate (omit `remedy`) if the target approach isn't a single bounded edit. |

**Marker-comment convention.** Migration-note markers are `//MIGRATION NOTE (XX):` /
`//MIGRATION TODO (XX):` / `//MIGRATION QUESTION (XX):`, where `XX` is the author's initials
tag. A finding's `remedy` gives the exact marker text to apply; if the file already uses a
consistent initials tag, reuse it, otherwise the `remedy` leaves `XX` as a placeholder for the
fix step to flag as an open question rather than guess.

These recipes are the migration capability's, not core's: they name legacy utilities, the target
framework's DOM/navigation replacements, and the migration-note marker convention — all
stack-specific, all owned here. Core's fix step reads the `remedy` string and applies it; it
never reconstructs these recipes.
