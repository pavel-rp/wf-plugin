#!/usr/bin/env bash
# Pins every adapter mount with the host's own test runner.
#
# Assembles the example mod into <new-dir> the way a mod author would (the
# example, plus kit/ and adapters/ copied into its lib/), runs
# `claude plugin validate` and `claude plugin test` on it, then removes
# <new-dir>. <new-dir> must not exist yet; its parent must.
#
# Needs an authenticated `claude` CLI, so CI does not run it. If the host's
# mods switch is stale, run one networked `claude -p` first.
#
# Usage: bash plugins/tui-kit/tests/plugin-test.sh <new-dir>
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
pack="$(cd "$here/.." && pwd)"

if [ "$#" -ne 1 ] || [ -z "$1" ]; then
  echo "usage: plugin-test.sh <new-dir>" >&2
  exit 2
fi
target="$1"
if [ -e "$target" ]; then
  echo "plugin-test: $target already exists; name a new folder" >&2
  exit 2
fi
command -v claude >/dev/null 2>&1 || { echo "plugin-test: the claude CLI is required" >&2; exit 2; }

mkdir "$target"
trap 'rm -rf "$target"' EXIT

cp -R "$pack/example/." "$target/"
mkdir "$target/lib"
cp -R "$pack/kit" "$target/lib/kit"
cp -R "$pack/adapters" "$target/lib/adapters"

claude plugin validate "$target"
claude plugin test "$target"
