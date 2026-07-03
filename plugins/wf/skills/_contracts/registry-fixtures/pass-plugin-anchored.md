# Fixture registry — plugin-anchored Path (passes via `## Plugin Roots`)

A `plugin:<name>/<rel-path>` Path resolves through the co-located `## Plugin Roots`
mapping. `testpkg` maps to the fixtures tree (repo-relative, joined to the repo root),
so `plugin:testpkg/caps/solo` resolves to the real `caps/solo/manifest.md`.

## Capabilities

| Capability | Path                     |
|------------|--------------------------|
| solo       | plugin:testpkg/caps/solo |

## Plugin Roots

| Plugin  | Root                                           |
|---------|------------------------------------------------|
| testpkg | plugins/wf/skills/_contracts/registry-fixtures |
