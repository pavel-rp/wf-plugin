# Fixture grammar — a label added without a map entry

The same synthetic output contract as `grammar.md`, with one label (`halt`) added to the
grammar. Every map pointing here but mapping only `ok` and `warn` must be rejected naming `halt`.

```text
SAMPLE — <summary>

1. item: <id>
   level: <ok | warn | halt>
   note: <one line>
```
