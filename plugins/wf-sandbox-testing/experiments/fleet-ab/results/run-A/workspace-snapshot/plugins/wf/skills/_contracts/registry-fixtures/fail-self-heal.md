# Fixture registry — plugin-anchored Path unrecoverable even via self-heal (fails)

`lostpkg` has a dangling `## Plugin Roots` root AND its record in the injected fixture
install manifest points at an installPath that does not exist on disk — neither the
recorded root nor the install-manifest fallback recovers a readable manifest, so the
row is unrecoverable: a validation error naming the capability and the remedy.

## Capabilities

| Capability | Path                     |
|------------|--------------------------|
| lost       | plugin:lostpkg/caps/solo |

## Plugin Roots

| Plugin  | Root                                                    |
|---------|---------------------------------------------------------|
| lostpkg | plugins/wf/skills/_contracts/registry-fixtures/gone-dir |
