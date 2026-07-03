# Fixture registry — plugin-anchored Path resolves to a dir with no manifest.md (fails)

`testpkg` is mapped and `<rel-path>` resolves to an existing directory (`caps/no-manifest`),
but that directory carries no `manifest.md` — a validation error naming the capability.

## Capabilities

| Capability | Path                            |
|------------|---------------------------------|
| nomani     | plugin:testpkg/caps/no-manifest |

## Plugin Roots

| Plugin  | Root                                           |
|---------|------------------------------------------------|
| testpkg | plugins/wf/skills/_contracts/registry-fixtures |
