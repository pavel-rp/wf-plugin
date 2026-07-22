#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
ACCOUNTING="$ROOT/plugins/wf-sandbox-testing/accounting"
SCRATCH="$ROOT/_local/scratch/wf-373-accounting"
ACTUAL="$SCRATCH/actual.json"
MISSING="$SCRATCH/missing.json"

mkdir -p "$SCRATCH"
rm -f "$ACTUAL" "$MISSING"

node "$ACCOUNTING/fleet-cost.mjs" measure \
  --session session-fixture \
  --root "$ACCOUNTING/testdata" \
  --capture-date 2026-07-22 \
  --output "$ACTUAL"

node "$ACCOUNTING/fleet-cost.mjs" compare \
  --actual "$ACTUAL" \
  --reference "$ACCOUNTING/fixture-reference.json" \
  --tolerance 0.01

if node "$ACCOUNTING/fleet-cost.mjs" measure \
  --session pruned-session \
  --root "$ACCOUNTING/testdata" \
  --output "$MISSING" 2>"$SCRATCH/missing.stderr"; then
  printf '%s\n' 'selfcheck: missing transcript unexpectedly succeeded' >&2
  exit 1
fi

grep -F "missing transcript path: $ACCOUNTING/testdata/pruned-session.jsonl" "$SCRATCH/missing.stderr" >/dev/null
if [ -e "$MISSING" ]; then
  printf '%s\n' 'selfcheck: missing transcript emitted an output file' >&2
  exit 1
fi

node "$ACCOUNTING/fleet-cost.mjs" compare \
  --actual "$ACCOUNTING/baseline-reference.json" \
  --reference "$ACCOUNTING/baseline-reference.json" \
  --tolerance 0.01

printf '%s\n' 'fleet-cost selfcheck: PASS'
