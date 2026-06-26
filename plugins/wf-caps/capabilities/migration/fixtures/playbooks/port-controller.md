# Playbook — port a controller (fixture target)

A real, committed procedure document used as the on-disk target for the
`valid-profile.json` fixture's `playbooks` entry. Its only purpose is to make the
validator's path-existence check pass for the valid case — the validator checks
that each hook entry's `path` resolves to a real file relative to the repo root.

> Fixture support file. Not a production playbook.
