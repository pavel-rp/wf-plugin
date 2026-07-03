# Fixture registry — plugin-anchored Path resolves but manifest missing (fails)

`testpkg` is mapped, but the `<rel-path>` points at a folder that does not exist under
the resolved root, so no `manifest.md` is found — a validation error naming the
capability.

## Capabilities

| Capability | Path                               |
|------------|------------------------------------|
| ghost      | plugin:testpkg/caps/does-not-exist |

## Plugin Roots

| Plugin  | Root                                           |
|---------|------------------------------------------------|
| testpkg | plugins/wf/skills/_contracts/registry-fixtures |
