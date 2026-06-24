# `rule-audit` hook — migration capability (inline reference doc)

**Version:** 1.0.0 (WF-10 — kept prototype)
**Wired by:** `domain/migration/manifest.md` (`rule-audit → inline: hooks/rule-audit.md`)
**Backed by:** the `rule-checks` and `invariants` slots of `domain/migration/migration.contract.md`
**Fills:** the `rule-audit` hook of `plugins/wf/skills/_contracts/core-extension.contract.md`
**Model:** claude-opus-4-8

---

## What this doc is

This is the **inline reference doc** the core reads and follows in-context when it fires the
`rule-audit` hook with the migration capability active. The invocation mechanism
(`invocation-mechanism.contract.md`) resolves `rule-audit → inline: hooks/rule-audit.md`
from the manifest and reads this file; the core then performs the procedure below and
returns findings in the hook's generic finding shape.

It introduces **no new slots or hooks**. Every check below is the migration capability's
`rule-checks` slot asserting the `invariants` slot, exactly as
`migration.contract.md` declares (`rule-audit ← rule-checks, invariants`). Concrete
per-project values (the actual forbidden APIs, the casing rule specifics) come from a
downstream `_local/` profile that fills these slots — this doc is the kept reference shape,
not the populated profile.

---

## Inputs the core supplies

- **The work under review** — the changed code / artifact the core is auditing (the diff,
  the ported unit).
- **The generic finding shape** — from the `rule-audit` hook contract: each finding carries
  the rule it asserts, a severity, and a concrete location/evidence.

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

A list of conformance findings in the `rule-audit` generic finding shape — one entry per
tripped rule-check:

```
- rule: <invariant id this check asserts>
  severity: <fail | warn>
  location: <file:line or unit identifier>
  evidence: <the concrete divergence observed in the diff>
```

If every rule-check passes, return an **empty findings list** — the same empty shape the
`<none>` no-op produces, signalling a conformant unit. The core proceeds with its workflow
either way; this hook contributes findings, it does not halt the skeleton.
