#!/usr/bin/env bash
# Dispatch shim — this experiment's analysis entry point. All behaviour lives in the shared engine.
# The per-round replay judgement (verdict / blocking set / stop decision, pairwise) is the kit's
# own kit/replay-check.mjs; this shim is the engine's mechanism-signal analysis over the arms'
# transcripts (lens/critic dispatch absence, tracker-write absence, fixture-served presence).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec bash "$SCRIPT_DIR/../engine/analyze.sh" --manifest "$SCRIPT_DIR/experiment.json" "$@"
