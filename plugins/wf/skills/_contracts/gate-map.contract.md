# Gate-eligibility map contract

**Version:** 1.0.0 (WF-704 — the schema, the `gate-map:` manifest key, the core guard, and the first core maps)
**Model:** claude-opus-5-5
**Enforced by:** `gate-map-guard.sh` (beside this file), run in CI by `registry-fixtures/run.sh`

A **gate map** states, for one review layer, which of the labels it emits **may** block and which are
only **advisory**. It is eligibility only: the actual gate — including any conditional blocking —
stays with the layer's own loop rules, and publishing a map changes no finding's blocking status.
A map names no stack, domain, project, or pack; it names only its layer's own labels.

This document is read by authors and by the guard. It is never read at a phase's runtime.

## Map file shape

One markdown file per layer. Four metadata lines, each at the start of its own line, then a table:

```markdown
# Gate map — <layer>

**Layer:** <the layer this map describes, in plain words>
**Grammar source:** `<path>` · block `<block name>` · anchor `<anchor text>`
**Labels:** declared
**Model:** <model id that authored the map, or unknown>

| Label | Eligibility | Basis |
|---|---|---|
| <label> | <may-block \| advisory> | <where today's behaviour for this label is established> |
```

- **`**Labels:**`** is exactly `declared` or `none`. `none` is the explicit **"emits no labels"**
  declaration: the map then carries **no** table rows, and its grammar source must be `none`.
- **`**Grammar source:**`** is either the literal `none`, or three backtick-quoted values in order:
  the source file, the output block's name, and a line anchor. The path is **relative to the folder
  holding the map file**, forward-slash, so a map resolves the same way from any install root. One
  source may be shared by several maps.
- **The table** has exactly the columns `Label | Eligibility | Basis`. Every `Label` is unique.
  `Eligibility` is exactly `may-block` or `advisory` — no other token. `Basis` is non-empty and
  cites where today's behaviour for that label is established, so a reader can compare the map with
  current behaviour label by label.
- **A layer that gates nothing today** maps every label to `advisory`.

## Grammar extraction (the one generic rule)

When a map names a grammar source, its declared labels are compared with the labels extracted from
that source by this rule — the same for every map, core or pack:

1. Open the source file (resolved relative to the map's folder).
2. Take the **first fenced code block** whose first non-blank line **starts with** the block name.
3. In that block, take the **first line containing** the anchor text.
4. After the anchor on that line, take the **first `<…>` group that contains `|`**.
5. Split its content on `|` and trim each part: that is the extracted label set.

The declared set must **equal** the extracted set. A label in the source but not in the map is
**unmapped**; a label in the map but not in the source is **stale**. Either fails the guard, naming
the label.

With grammar source `none`, no extraction runs: the guard checks only that every declared label
carries a valid eligibility.

## Where maps are found

- **Core layers** — every `*.md` in the `gate-maps/` folder beside this contract.
- **Capabilities** — a capability manifest declares each of its maps with the optional, repeatable
  manifest key `gate-map: <rel-path>`, one per line, the path relative to the capability folder
  (see the registry contract's manifest schema). The guard reads every installed capability
  manifest in the tree for that key; it never names a capability or a pack, so a newly declared map
  is checked with no guard or schema edit.

## What the guard rejects

The guard exits 1, naming the map and the cause, when a map:

- lacks one of the four metadata lines, or carries a `**Labels:**` value other than `declared`/`none`;
- declares `none` labels yet carries rows or a grammar source, or declares labels yet carries no rows;
- carries a malformed row, a duplicate label, an empty `Basis`, or an eligibility outside the pair;
- names a grammar source whose file, block, anchor, or label group cannot be found;
- has an unmapped or a stale label against its grammar source;
- is declared by a manifest `gate-map:` line whose path does not resolve to a file.

It exits 2 when it cannot run at all (the core maps folder is absent), and 0 when every map conforms.
