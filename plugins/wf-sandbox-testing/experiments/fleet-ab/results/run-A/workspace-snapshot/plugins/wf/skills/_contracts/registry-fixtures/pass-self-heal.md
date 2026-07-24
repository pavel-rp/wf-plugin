# Fixture registry — plugin-anchored Path recovered via install-manifest self-heal (passes)

`healpkg` has NO `## Plugin Roots` entry at all, but the injected fixture install
manifest carries records for it: a stale record whose installPath does not exist on
disk (skipped — prefer-existing-installPath) and a live record whose backslashed,
repo-relative installPath normalizes and resolves against the repo root. The fallback
recovers the root, so `plugin:healpkg/caps/solo` resolves and validation passes.

## Capabilities

| Capability | Path                     |
|------------|--------------------------|
| healed     | plugin:healpkg/caps/solo |
