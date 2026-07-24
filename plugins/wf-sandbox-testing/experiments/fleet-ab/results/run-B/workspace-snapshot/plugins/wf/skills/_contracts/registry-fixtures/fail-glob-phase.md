# Fixture registry — fragment phase is a glob metacharacter (fails)

Guards the quoting in CHECK 6's `case "$VALID_PHASES" in *" $f_phase "*)`:
because `$f_phase` is interpolated INSIDE quotes, a glob metacharacter like `*`
is matched literally and must be rejected — it must NOT bypass the allowlist.

## Capabilities

| Capability | Path                                                            |
|------------|-----------------------------------------------------------------|
| glob-phase | plugins/wf/skills/_contracts/registry-fixtures/caps/glob-phase  |
