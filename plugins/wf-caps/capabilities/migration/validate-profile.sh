#!/usr/bin/env bash
#
# validate-profile.sh — fail-fast validator for a migration capability profile.
#
# Checks a downstream `_local/` migration profile (JSON) against the frozen
# migration capability contract's embedded slot schema and reports violations
# with actionable, slot-naming messages. Exits non-zero on any error.
#
# The slot schema is DERIVED FROM THE CONTRACT at runtime — the embedded
# JSON-Schema-style fence in `migration.contract.md` is the single source of
# truth. The required-slot list and per-slot required fields are NOT hardcoded
# or duplicated here; they are read out of the parsed schema with jq.
#
# Model: claude-opus-4-8
#
# Usage:
#   validate-profile.sh <profile.json>
#
# Exit codes:
#   0  — profile conforms (no errors; warnings allowed)
#   1  — one or more errors (missing slot, malformed row, dangling path, ...)
#   2  — usage / environment error (bad args, missing files, jq absent)

set -u

# ---------------------------------------------------------------------------
# Paths. The script lives in plugins/wf-caps/capabilities/migration/; resolve
# the contract relative to its own location and the repo root four levels up.
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTRACT="$SCRIPT_DIR/migration.contract.md"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"

# ---------------------------------------------------------------------------
# Colors (suppressed when stdout is not a TTY).
# ---------------------------------------------------------------------------
if [ -t 1 ]; then
  RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
else
  RED=''; GREEN=''; YELLOW=''; NC=''
fi

errors=0
warnings=0

# `printf '%b' "$COLOR"` renders the color escape; `%s "$*"` emits the message
# VERBATIM — unlike `echo -e`, which would interpret backslash escapes in
# user-controlled values (a Windows path like `C:\tmp\x`, a value with `\t`),
# corrupting or truncating diagnostics.
err()  { printf '%bERROR:%b %s\n'   "$RED"    "$NC" "$*"; errors=$((errors + 1)); }
warn() { printf '%bWARNING:%b %s\n' "$YELLOW" "$NC" "$*"; warnings=$((warnings + 1)); }
ok()   { printf '%bOK:%b %s\n'      "$GREEN"  "$NC" "$*"; }

# ---------------------------------------------------------------------------
# Preconditions.
# ---------------------------------------------------------------------------
if ! command -v jq >/dev/null 2>&1; then
  printf '%bERROR:%b jq is required but not found on PATH.\n' "$RED" "$NC" >&2
  exit 2
fi

PROFILE="${1:-}"
if [ -z "$PROFILE" ]; then
  echo "Usage: $(basename "$0") <profile.json>" >&2
  exit 2
fi
if [ ! -f "$PROFILE" ]; then
  printf '%bERROR:%b profile not found: %s\n' "$RED" "$NC" "$PROFILE" >&2
  exit 2
fi
if [ ! -f "$CONTRACT" ]; then
  printf '%bERROR:%b contract not found: %s\n' "$RED" "$NC" "$CONTRACT" >&2
  exit 2
fi

echo "Validating profile: $PROFILE"
echo "Schema source:      $CONTRACT"
echo ""

# ---------------------------------------------------------------------------
# Extract the single ```json fence from the contract and parse it as the
# schema. The contract guarantees exactly one json code block.
# ---------------------------------------------------------------------------
SCHEMA="$(awk '
  /^```json[[:space:]]*$/ { grab=1; next }
  /^```[[:space:]]*$/      { if (grab) { grab=0 } ; next }
  grab { print }
' "$CONTRACT")"

if [ -z "$SCHEMA" ]; then
  printf '%bERROR:%b could not extract a json fence from %s\n' "$RED" "$NC" "$CONTRACT" >&2
  exit 2
fi
if ! echo "$SCHEMA" | jq empty >/dev/null 2>&1; then
  printf '%bERROR:%b extracted schema fence is not valid JSON\n' "$RED" "$NC" >&2
  exit 2
fi

# Helper: run a jq query against the parsed schema.
#
# `tr -d '\r'`: jq on this Git Bash / MSYS build emits CRLF line terminators, so
# every line of `-r` output carries a trailing \r. Command substitution strips
# the final \n (and only the LAST line's \r), leaving interior tokens
# CR-contaminated — which made hyphenated-slot comparisons fail intermittently
# depending on token order. Strip all \r at the source so consumers see clean
# values.
schema_q() { echo "$SCHEMA" | jq -r "$1" | tr -d '\r'; }

# ---------------------------------------------------------------------------
# Profile must be syntactically valid JSON (fail-fast hard stop).
# ---------------------------------------------------------------------------
if ! jq empty "$PROFILE" >/dev/null 2>&1; then
  err "profile is not valid JSON — $(jq empty "$PROFILE" 2>&1 | head -1)"
  echo ""
  echo "=== Summary ==="
  printf '%bErrors: %s%b\n' "$RED" "$errors" "$NC"
  printf '%bValidation FAILED.%b\n' "$RED" "$NC"
  exit 1
fi
ok "profile JSON syntax"

# Helper: run a jq query against the profile file.
#
# The `</dev/null` matters: a `jq -r "$1" "$PROFILE"` call placed inside a shell
# `for`/`while` loop inherits that loop's stdin. On Git Bash / MSYS, jq drains
# the inherited stdin on its first invocation, so every later iteration sees an
# exhausted stream and returns stale/empty results (the classic "only the last
# iteration is correct" bug). Redirecting stdin from /dev/null per call makes
# each query independent of the surrounding loop.
#
# This is necessary but NOT sufficient on its own: command substitution
# `var="$(prof_q ...)"` inside a loop can still interact badly. Presence checks
# are therefore done against a single up-front snapshot of the profile's keys
# (see `profile_keys` below) rather than one `has()` call per iteration.
# (See schema_q for why `tr -d '\r'` is required on this jq build.)
prof_q() { jq -r "$1" "$PROFILE" </dev/null | tr -d '\r'; }

# Snapshot the profile's top-level keys ONCE, then test membership in shell.
# This replaces per-iteration `prof_q "has(...)"` calls — a single jq read,
# immune to the loop-stdin interaction described above.
profile_keys="$(prof_q 'keys[]')"
has_slot() {
  local needle="$1" k
  for k in $profile_keys; do
    [ "$k" = "$needle" ] && return 0
  done
  return 1
}

# ---------------------------------------------------------------------------
# Required top-level slots: read .required from the schema (not hardcoded).
# ---------------------------------------------------------------------------
required_slots="$(schema_q '.required[]')"
for slot in $required_slots; do
  if has_slot "$slot"; then
    ok "required slot present: \`$slot\`"
  else
    err "missing required slot: \`$slot\` — add a top-level \"$slot\" key to the profile."
  fi
done

# ---------------------------------------------------------------------------
# Per-slot row/field validation. For each property in the schema, decide its
# kind from the schema (array vs object) and read its required fields from the
# schema — the script never restates field names.
# ---------------------------------------------------------------------------
all_slots="$(schema_q '.properties | keys[]')"

for slot in $all_slots; do
  if ! has_slot "$slot"; then
    # Optional slots are validated only when present; required-but-absent
    # already reported above.
    continue
  fi

  slot_type="$(schema_q ".properties.\"$slot\".type")"

  if [ "$slot_type" = "object" ]; then
    # Object slot (e.g. `stack`): all schema-required object fields present.
    # Snapshot the slot's keys ONCE, then test membership in shell (same
    # loop-stdin defense as the top-level presence check).
    obj_required="$(schema_q ".properties.\"$slot\".required[]? // empty")"
    obj_keys="$(prof_q ".\"$slot\" | keys[]?")"
    for field in $obj_required; do
      if ! printf '%s\n' $obj_keys | grep -qx -- "$field"; then
        err "slot \`$slot\` is missing required field \`$field\`."
      fi
    done

  elif [ "$slot_type" = "array" ]; then
    # Array slot: each row carries its schema-required fields. Read, per row,
    # the row's present keys with ONE jq pass per row (the `</dev/null` in
    # prof_q keeps each pass independent), then test field membership in shell —
    # no per-field jq call inside the inner loop.
    row_required="$(schema_q ".properties.\"$slot\".items.required[]? // empty")"
    count="$(prof_q ".\"$slot\" | length")"
    idx=0
    while [ "$idx" -lt "$count" ]; do
      row_keys="$(prof_q ".\"$slot\"[$idx] | keys[]?")"
      for field in $row_required; do
        if ! printf '%s\n' $row_keys | grep -qx -- "$field"; then
          err "slot \`$slot\` row $idx is missing required field \`$field\`."
        fi
      done
      idx=$((idx + 1))
    done
  fi
done

# ---------------------------------------------------------------------------
# Extension-point-slot on-disk path checks. Any slot whose items declare a `path`
# field (discovered from the schema, not hardcoded) has each present entry's path
# checked for existence relative to the repo root.
# ---------------------------------------------------------------------------
for slot in $all_slots; do
  has_slot "$slot" || continue
  has_path_field="$(schema_q ".properties.\"$slot\".items.properties | has(\"path\") // false" 2>/dev/null)"
  [ "$has_path_field" = "true" ] || continue

  count="$(prof_q ".\"$slot\" | length")"
  idx=0
  while [ "$idx" -lt "$count" ]; do
    p="$(prof_q ".\"$slot\"[$idx].path // empty")"
    if [ -n "$p" ]; then
      # `-f` (regular file), not `-e`: extension-point paths point at committed
      # docs/scripts, so a directory at that path is not a valid target.
      if [ ! -f "$REPO_ROOT/$p" ] && [ ! -f "$p" ]; then
        err "slot \`$slot\` entry $idx has a dangling \`path\`: \`$p\` (no regular file at that path relative to repo root \`$REPO_ROOT\`)."
      fi
    fi
    idx=$((idx + 1))
  done
done

# ---------------------------------------------------------------------------
# Enum checks. For any field declaring an enum in the schema (e.g.
# rule-checks[].severity), an out-of-enum value on a present row is a WARNING,
# not a hard fail — exercising the error-vs-warning distinction.
# ---------------------------------------------------------------------------
for slot in $all_slots; do
  has_slot "$slot" || continue
  [ "$(schema_q ".properties.\"$slot\".type")" = "array" ] || continue

  # Fields on this slot's rows that declare an enum.
  enum_fields="$(schema_q ".properties.\"$slot\".items.properties | to_entries[] | select(.value.enum != null) | .key")"
  [ -n "$enum_fields" ] || continue

  count="$(prof_q ".\"$slot\" | length")"
  for field in $enum_fields; do
    allowed="$(schema_q ".properties.\"$slot\".items.properties.\"$field\".enum | join(\", \")")"
    idx=0
    while [ "$idx" -lt "$count" ]; do
      val="$(prof_q ".\"$slot\"[$idx].\"$field\" // empty")"
      if [ -n "$val" ]; then
        # Pass the profile value as a jq --arg, never interpolated into the
        # program, so a value containing `"` or `\` cannot break the query.
        in_enum="$(echo "$SCHEMA" | jq -r --arg v "$val" ".properties.\"$slot\".items.properties.\"$field\".enum | index(\$v) != null" | tr -d '\r')"
        if [ "$in_enum" != "true" ]; then
          warn "slot \`$slot\` row $idx has out-of-enum \`$field\` value \`$val\` (allowed: $allowed)."
        fi
      fi
      idx=$((idx + 1))
    done
  done
done

# ---------------------------------------------------------------------------
# Summary + exit semantics.
# ---------------------------------------------------------------------------
echo ""
echo "=== Summary ==="
if [ "$errors" -gt 0 ]; then
  printf '%bErrors: %s%b\n' "$RED" "$errors" "$NC"
fi
if [ "$warnings" -gt 0 ]; then
  printf '%bWarnings: %s%b\n' "$YELLOW" "$warnings" "$NC"
fi

if [ "$errors" -gt 0 ]; then
  printf '%bValidation FAILED.%b\n' "$RED" "$NC"
  exit 1
fi

printf '%bValidation passed%b (warnings: %s).\n' "$GREEN" "$NC" "$warnings"
exit 0
