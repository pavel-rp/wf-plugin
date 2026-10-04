#!/usr/bin/env bash
# Runs the kit's tests under plain Node — no mod, no host runtime.
# Exit status is node's: 0 when every test passes.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
command -v node >/dev/null 2>&1 || { echo "tui-kit tests: node is required" >&2; exit 2; }
exec node --test "$here"/*.test.mjs
