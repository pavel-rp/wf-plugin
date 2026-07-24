# Fixture registry — fragment contribution-kind is a glob metacharacter (fails)

Guards the quoting in CHECK 6's `case "$VALID_KINDS" in *" $f_kind "*)`:
because `$f_kind` is interpolated INSIDE quotes, a glob metacharacter like `*`
is matched literally and must be rejected — it must NOT bypass the allowlist.

## Capabilities

| Capability | Path                                                          |
|------------|---------------------------------------------------------------|
| glob-kind  | plugins/wf/skills/_contracts/registry-fixtures/caps/glob-kind |
