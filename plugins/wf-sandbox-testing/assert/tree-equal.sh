#!/usr/bin/env bash
# tree-equal.sh — fail closed when two non-git file trees differ byte-for-byte.
# Usage: tree-equal.sh <before-dir> <after-dir>
set -euo pipefail

before="${1:?usage: tree-equal.sh <before-dir> <after-dir>}"
after="${2:?usage: tree-equal.sh <before-dir> <after-dir>}"
[ -d "$before" ] || { echo "tree-equal: missing before tree: $before" >&2; exit 2; }
[ -d "$after" ] || { echo "tree-equal: missing after tree: $after" >&2; exit 2; }

# Reject nodes outside a checkout's normal directory/file/symlink tree.  Do this
# before comparing manifests because a failure inside process substitution would
# not reliably propagate through the comparison.
check_entry_types() {
  local root="$1" path
  (
    cd "$root"
    while IFS= read -r -d '' path; do
      [ "$path" = . ] && continue
      if [ -L "$path" ] || [ -d "$path" ] || [ -f "$path" ]; then
        continue
      fi
      printf 'tree-equal: unsupported filesystem entry type (%s) at %q\n' \
        "$(stat -c '%F' -- "$path")" "${path#./}" >&2
      return 1
    done < <(find . -path './.git' -prune -o -print0 | LC_ALL=C sort -z)
  )
}

# NUL-delimited records keep both paths and link targets exact, including unusual
# whitespace.  `readlink -z` writes the target without command-substitution's
# trailing-newline loss.
manifest() {
  local root="$1" path
  (
    cd "$root"
    while IFS= read -r -d '' path; do
      [ "$path" = . ] && continue
      if [ -L "$path" ]; then
        printf 'symlink\0%s\0' "${path#./}"
        readlink -z -- "$path"
      elif [ -d "$path" ]; then
        printf 'dir\0%s\0' "${path#./}"
      else
        printf 'file\0%s\0%s\0' "$(sha256sum -- "$path" | cut -d' ' -f1)" "${path#./}"
      fi
    done < <(find . -path './.git' -prune -o -print0 | LC_ALL=C sort -z)
  )
}

check_entry_types "$before"
check_entry_types "$after"

if ! cmp -s <(manifest "$before") <(manifest "$after"); then
  echo "tree-equal: trees differ" >&2
  exit 1
fi
echo "tree-equal: PASS"
