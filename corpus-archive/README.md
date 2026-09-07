# corpus-archive — verbatim transcripts behind the replay corpus

Frozen historical data, **not** part of any plugin deliverable. Each folder mirrors one
`plugins/wf-sandbox-testing/corpus/items/verify-replay-*` item and holds the verbatim
`rounds/round-NN.md` (and `verify-fix-after-round-NN.md`) transcripts that item's structured
`rounds/*.json` records were transcribed from. The pack ships only the records; the kit resolves a
transcript as `<archive>/<item-name>/<record.transcript>`, where `<archive>` is
`$WF_CORPUS_ARCHIVE` when set and this folder otherwise.

Who reads it: `corpus/run.sh` (header and existence checks, records-only when this folder is
absent), `kit/materialize-round.sh` (rebuilds the ledger a replayed round saw from the earlier
rounds' transcripts — a live replay needs it), and `kit/extract-rounds.mjs` (writes here).
Transcripts quote whatever the original audits ran, so this folder sits outside `plugins/` on
purpose: no plugin-tree guard scans it.
