# Fixture registry — a manifest's `## Fragments` heading is miscased (fails, WF-239)

A casing/spacing typo of a block heading would otherwise parse zero rows and pass
silently; the heading guard rejects the near-miss, naming the offender.

## Capabilities

| Capability   | Path                                                             |
|--------------|------------------------------------------------------------------|
| heading-typo | plugins/wf/skills/_contracts/registry-fixtures/caps/heading-typo |
