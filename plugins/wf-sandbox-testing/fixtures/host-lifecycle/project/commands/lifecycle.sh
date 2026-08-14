#!/usr/bin/env bash
# lifecycle.sh — deterministic reversible host-operation fixture commands.
set -euo pipefail

operation="${1:?usage: lifecycle.sh <setup|teardown|health|assert> <operation>}"
kind="${2:-}"
root="${WF_HOST_FIXTURE_ROOT:?WF_HOST_FIXTURE_ROOT is required}"
tree="$root/tree"
log="${WF_HOST_LOG:?WF_HOST_LOG is required}"
state="$tree/.host-state"

record() { printf '%s:%s:%s\n' "${WF_HOST_SCENARIO:-lifecycle}" "$operation" "$kind" >> "$log"; }
record_failure() { printf '%s:%s-failed:%s\n' "${WF_HOST_SCENARIO:-lifecycle}" "$operation" "$kind" >> "$log"; }

case "$operation:$kind" in
  setup:expose|setup:augment|setup:seed|setup:fixture)
    mkdir -p "$state"
    if [ "${WF_HOST_FAIL_SETUP_OPERATION:-}" = "$kind" ]; then
      # Setup may have changed durable state before reporting failure; teardown must be safe.
      printf 'partial temporary host operation\n' > "$state/$kind"
      record_failure
      exit 1
    fi
    case "$kind" in
      expose) printf 'temporary API surface\n' > "$state/expose" ;;
      augment) printf 'temporary host augmentation\n' > "$state/augment" ;;
      seed) printf 'temporary persistence seed\n' > "$state/seed" ;;
      fixture) printf 'temporary synthetic fixture\n' > "$state/fixture" ;;
    esac
    record
    ;;
  teardown:expose|teardown:augment|teardown:seed|teardown:fixture)
    rm -f "$state/$kind"; rmdir "$state" 2>/dev/null || true; record ;;
  health:verify)
    if [ "${WF_HOST_FAIL_HEALTH:-}" = "1" ]; then
      record_failure
      exit 1
    fi
    [ -d "$state" ] && [ "$(find "$state" -type f | wc -l | tr -d ' ')" -ge 1 ]; record ;;
  assert:clean)
    [ ! -e "$state" ]; record ;;
  *) echo "lifecycle: unsupported operation '$operation:$kind'" >&2; exit 2 ;;
esac
