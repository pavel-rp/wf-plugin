# Fixture registry — dangling recorded root recovered via install-manifest self-heal (passes)

`healpkg` IS mapped in `## Plugin Roots`, but its recorded root dangles (the directory
does not exist). Recorded-root-first fails, so resolution falls back to the injected
fixture install manifest, which recovers the live root — `plugin:healpkg/caps/solo`
resolves via the fallback and validation passes.

## Capabilities

| Capability | Path                     |
|------------|--------------------------|
| healed     | plugin:healpkg/caps/solo |

## Plugin Roots

| Plugin  | Root                                                          |
|---------|---------------------------------------------------------------|
| healpkg | plugins/wf/skills/_contracts/registry-fixtures/healroot-moved |
