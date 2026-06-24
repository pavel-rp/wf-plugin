# Migration capability manifest

**Version:** 1.0.0 (WF-10 — kept `rule-audit` prototype)
**Conforms to:** `plugins/wf/skills/_contracts/invocation-mechanism.contract.md` (manifest schema)
**Capability:** migration (`{domain}: migration`, `{domain-path}: domain/migration`)
**Model:** claude-opus-4-8

---

This is the migration capability's **hook→dispatch manifest** — the file a core skill reads
at `{domain-path}/manifest.md` to learn how this capability fills each core hook. Core
resolves `{domain-path}` from `_local/config.md`; it does not hardcode this path.

Each row maps a hook frozen by `core-extension.contract.md` to exactly one dispatch kind.
Inline paths are forward-slash, **relative to `{domain-path}`** (so `hooks/rule-audit.md`
resolves to `domain/migration/hooks/rule-audit.md`).

| Hook | Dispatch |
|------|----------|
| rule-audit | `inline: hooks/rule-audit.md` |

## Unwired hooks

`mapping` and `parity-suite` are **intentionally absent** — they are out of scope for the
WF-10 prototype (WF-6 wires `mapping`; WF-8 wires `parity-suite`). Per the invocation
mechanism's no-op path, a hook with no manifest row no-ops cleanly: a core skill firing
`mapping` or `parity-suite` while `{domain}: migration` is active proceeds exactly as if the
hook were absent, until a later task adds its row here. Absence is not an error.
