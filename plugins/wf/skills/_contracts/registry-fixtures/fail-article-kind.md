# Fixture registry — a fragment names `article` as its contribution kind (fails, WF-239)

`article` is not a contribution kind (a constitution clause is declared with the
`article:` manifest key, not a fragments-table row) — so a fragment naming it is
rejected as an unknown contribution kind, naming the offender.

## Capabilities

| Capability   | Path                                                             |
|--------------|------------------------------------------------------------------|
| article-kind | plugins/wf/skills/_contracts/registry-fixtures/caps/article-kind |
