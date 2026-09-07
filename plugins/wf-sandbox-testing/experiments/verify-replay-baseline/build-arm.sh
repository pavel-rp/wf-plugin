#!/usr/bin/env bash
# Dispatch shim — this experiment's build entry point. All behaviour lives in the shared engine.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec bash "$SCRIPT_DIR/../engine/build.sh" --manifest "$SCRIPT_DIR/experiment.json" "$@"
