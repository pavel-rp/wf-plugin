#!/usr/bin/env bash
# gate-map-guard.sh — every published gate-eligibility map must be well formed and must agree
# with the grammar its layer actually emits.
#
# A gate map (gate-map.contract.md, beside this file) states, per review layer, which labels
# MAY block and which are only advisory. Its value is that an operator can read "may this
# block?" the same way everywhere — which holds only while every map stays complete and in step
# with the output block its labels come from. A label added to a layer's grammar but never
# mapped is exactly the silent drift this guard exists to catch.
#
# Discovery names no capability and no pack:
#   - core maps:        every *.md in gate-maps/ beside this file;
#   - capability maps:  every `gate-map: <rel-path>` line in every installed capability
#                       manifest (plugins/*/capabilities/*/manifest.md), the path resolved
#                       relative to that manifest's folder.
#
# Per map it asserts the four metadata lines, the closed `declared | none` labels value, the
# exact `Label | Eligibility | Basis` table with unique labels, an eligibility of exactly
# `may-block` or `advisory`, a non-empty basis, and — when a grammar source is named — that the
# declared label set equals the set extracted by the contract's one generic rule. An unmapped
# label (in the grammar, not the map) and a stale label (in the map, not the grammar) are both
# named.
#
# --selftest runs the same evaluators over the committed fixtures in gate-map-fixtures/ and
# requires each defective fixture to be REJECTED (exit 1 from the evaluator, never a harness
# error) and each sound one ACCEPTED — including a fixture capability manifest whose declared map
# must be found and checked. A lint that scans a clean tree and finds nothing is
# indistinguishable from a lint that does nothing.
#
# Usage:  bash gate-map-guard.sh              # live-tree scan (what CI runs)
#         bash gate-map-guard.sh --selftest   # committed fixtures only
#
# Exit 0 = every map conforms; exit 1 = at least one violation; exit 2 = the guard could not run.
#
# Model: claude-opus-5-5
set -u

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$DIR/../../../.." && pwd)"
MAPS_DIR="$DIR/gate-maps"
FIX_DIR="$DIR/gate-map-fixtures"

err() { printf 'gate-map-guard: %s\n' "$*" >&2; }

# meta <file> <key> — the value after `**<key>:**` on the first line that starts with it.
meta() {
  awk -v k="**$2:**" 'index($0, k) == 1 { v = substr($0, length(k) + 1); sub(/^[ \t]+/, "", v); sub(/[ \t]+$/, "", v); print v; found = 1; exit } END { if (!found) exit 1 }' "$1"
}

# rows <file> — one `label<TAB>eligibility<TAB>basis` line per table row, or the token
# `BADROW<TAB><raw line>` for a row that does not carry three cells. Exit 1 if no header.
rows() {
  awk '
    function trim(s) { sub(/^[ \t]+/, "", s); sub(/[ \t]+$/, "", s); return s }
    !hdr {
      line = $0; gsub(/[ \t]/, "", line)
      if (line == "|Label|Eligibility|Basis|") { hdr = 1; sep = 1 }
      next
    }
    sep { sep = 0; next }
    /^\|/ {
      n = split($0, c, "|")
      if (n < 5) { printf "BADROW\t%s\n", $0; next }
      basis = c[4]
      for (i = 5; i < n; i++) basis = basis "|" c[i]
      printf "%s\t%s\t%s\n", trim(c[2]), trim(c[3]), trim(basis)
      next
    }
    { exit }
    END { if (!hdr) exit 1 }
  ' "$1"
}

# extract <source> <block> <anchor> — the contract's one generic rule. Prints one label per line.
# Exit 3 = no such block, 4 = anchor not in the block, 5 = no `<…|…>` group after the anchor.
extract() {
  awk -v block="$2" -v anchor="$3" '
    function ltrim(s) { sub(/^[ \t]+/, "", s); return s }
    /^[ \t]*```/ {
      if (!inb) { inb = 1; first = 1; want = 0; next }
      if (want) { code = 4; exit }
      inb = 0; next
    }
    !inb { next }
    first {
      if ($0 ~ /^[ \t]*$/) next
      first = 0
      if (index(ltrim($0), block) == 1) { want = 1; seenblock = 1 } else next
    }
    want {
      p = index($0, anchor)
      if (!p) next
      rest = substr($0, p + length(anchor))
      while ((o = index(rest, "<")) > 0) {
        rest = substr(rest, o + 1)
        cl = index(rest, ">")
        if (!cl) break
        grp = substr(rest, 1, cl - 1)
        rest = substr(rest, cl + 1)
        if (index(grp, "|")) {
          n = split(grp, parts, "|")
          for (i = 1; i <= n; i++) { s = parts[i]; gsub(/^[ \t]+|[ \t]+$/, "", s); print s }
          done = 1
          exit
        }
      }
      code = 5
      exit
    }
    END { if (done) exit 0; if (code) exit code; if (!seenblock) exit 3; exit 4 }
  ' "$1"
}

# check_map <file> <label> — prints one diagnostic per violation; returns 1 if any, 0 if clean.
check_map() {
  local f="$1" label="$2" bad=0
  local layer gsrc labels model rowdata

  if [ ! -f "$f" ]; then
    printf '%s: map file is absent: %s\n' "$label" "$f"
    return 1
  fi

  layer="$(meta "$f" Layer)"           || { printf '%s: missing **Layer:** line\n' "$label"; bad=1; }
  gsrc="$(meta "$f" 'Grammar source')" || { printf '%s: missing **Grammar source:** line\n' "$label"; bad=1; }
  labels="$(meta "$f" Labels)"         || { printf '%s: missing **Labels:** line\n' "$label"; bad=1; }
  model="$(meta "$f" Model)"           || { printf '%s: missing **Model:** line\n' "$label"; bad=1; }
  [ "$bad" -eq 0 ] || return 1
  [ -n "$layer" ] || { printf '%s: **Layer:** is empty\n' "$label"; bad=1; }
  [ -n "$model" ] || { printf '%s: **Model:** is empty (write unknown rather than nothing)\n' "$label"; bad=1; }

  if ! rowdata="$(rows "$f")"; then
    if [ "$labels" = "none" ]; then rowdata=""; else
      printf '%s: no `| Label | Eligibility | Basis |` table\n' "$label"; return 1
    fi
  fi

  case "$labels" in
    declared)
      [ -n "$rowdata" ] || { printf '%s: **Labels:** declared but the table carries no rows\n' "$label"; bad=1; } ;;
    none)
      [ -z "$rowdata" ] || { printf '%s: **Labels:** none (emits no labels) but the table carries rows\n' "$label"; bad=1; }
      [ "$gsrc" = "none" ] || { printf '%s: **Labels:** none requires **Grammar source:** none\n' "$label"; bad=1; } ;;
    *)
      printf '%s: **Labels:** must be `declared` or `none`, found `%s`\n' "$label" "$labels"; return 1 ;;
  esac

  local declared="" lab elig basis
  while IFS="$(printf '\t')" read -r lab elig basis; do
    [ -n "$lab" ] || continue
    if [ "$lab" = "BADROW" ]; then printf '%s: malformed table row: %s\n' "$label" "$elig"; bad=1; continue; fi
    case "$elig" in
      may-block|advisory) ;;
      *) printf '%s: label `%s` has eligibility `%s`; only `may-block` or `advisory` is allowed\n' "$label" "$lab" "$elig"; bad=1 ;;
    esac
    [ -n "$basis" ] || { printf '%s: label `%s` has an empty Basis\n' "$label" "$lab"; bad=1; }
    if printf '%s\n' "$declared" | grep -qxF -- "$lab"; then
      printf '%s: label `%s` is mapped more than once\n' "$label" "$lab"; bad=1
    fi
    declared="${declared}${lab}
"
  done <<EOF
$rowdata
EOF

  if [ "$gsrc" != "none" ]; then
    local spath sblock sanchor src extracted rc l
    spath="$(printf '%s' "$gsrc" | awk -F'`' 'NF >= 7 { print $2 }')"
    sblock="$(printf '%s' "$gsrc" | awk -F'`' 'NF >= 7 { print $4 }')"
    sanchor="$(printf '%s' "$gsrc" | awk -F'`' 'NF >= 7 { print $6 }')"
    if [ -z "$spath" ] || [ -z "$sblock" ] || [ -z "$sanchor" ]; then
      printf '%s: **Grammar source:** must be `none` or `<path>` · block `<name>` · anchor `<text>`\n' "$label"
      return 1
    fi
    src="$(dirname "$f")/$spath"
    if [ ! -f "$src" ]; then
      printf '%s: grammar source file not found: %s\n' "$label" "$spath"; return 1
    fi
    extracted="$(extract "$src" "$sblock" "$sanchor")"; rc=$?
    case "$rc" in
      0) ;;
      3) printf '%s: grammar source %s has no fenced block starting with `%s`\n' "$label" "$spath" "$sblock"; return 1 ;;
      4) printf '%s: block `%s` in %s has no line containing anchor `%s`\n' "$label" "$sblock" "$spath" "$sanchor"; return 1 ;;
      *) printf '%s: no `<…|…>` label group follows anchor `%s` in %s\n' "$label" "$sanchor" "$spath"; return 1 ;;
    esac
    while IFS= read -r l; do
      [ -n "$l" ] || continue
      printf '%s\n' "$declared" | grep -qxF -- "$l" || { printf '%s: unmapped label `%s` — emitted by %s but absent from the map\n' "$label" "$l" "$spath"; bad=1; }
    done <<EOF
$extracted
EOF
    while IFS= read -r l; do
      [ -n "$l" ] || continue
      printf '%s\n' "$extracted" | grep -qxF -- "$l" || { printf '%s: stale label `%s` — mapped but not emitted by %s\n' "$label" "$l" "$spath"; bad=1; }
    done <<EOF
$declared
EOF
  fi

  [ "$bad" -eq 0 ] || return 1
  printf '%s: OK\n' "$label"
  return 0
}

# scan_manifests <manifest>... — check every map a manifest declares with `gate-map:`.
# Prints `checked <map path>` per declared map found; returns 1 if any map fails or is absent.
scan_manifests() {
  local m rel mapf bad=0
  for m in "$@"; do
    [ -f "$m" ] || continue
    while IFS= read -r rel; do
      [ -n "$rel" ] || continue
      mapf="$(dirname "$m")/$rel"
      if [ ! -f "$mapf" ]; then
        printf '%s: declared gate-map `%s` does not resolve to a file\n' "${m#"$ROOT"/}" "$rel"
        bad=1; continue
      fi
      printf 'checked %s\n' "${mapf#"$ROOT"/}"
      check_map "$mapf" "${mapf#"$ROOT"/}" || bad=1
    done <<EOF
$(awk '/^gate-map:/ { v = $0; sub(/^gate-map:[ \t]*/, "", v); sub(/[ \t]+$/, "", v); print v }' "$m")
EOF
  done
  return "$bad"
}

# --- self-test --------------------------------------------------------------

if [ "${1:-}" = "--selftest" ]; then
  if [ ! -d "$FIX_DIR" ]; then err "fixture folder is absent: $FIX_DIR"; exit 2; fi
  st_fail=0

  # expect <accept|reject> <fixture map> [<label the rejection must name>]
  expect() {
    local want="$1" fx="$2" name="${3:-}" out rc
    out="$(check_map "$FIX_DIR/$fx" "selftest/$fx" 2>&1)"; rc=$?
    if [ "$want" = accept ] && [ "$rc" -ne 0 ]; then
      err "SELFTEST FAIL — sound fixture '$fx' was rejected:"; printf '%s\n' "$out" >&2; st_fail=$((st_fail + 1)); return
    fi
    if [ "$want" = reject ] && [ "$rc" -ne 1 ]; then
      err "SELFTEST FAIL — defective fixture '$fx' returned $rc; expected 1 (a violation)"; st_fail=$((st_fail + 1)); return
    fi
    if [ -n "$name" ] && ! printf '%s' "$out" | grep -qF -- "\`$name\`"; then
      err "SELFTEST FAIL — rejection of '$fx' does not name \`$name\`:"; printf '%s\n' "$out" >&2; st_fail=$((st_fail + 1))
    fi
  }

  expect accept maps/sound.gate-map.md
  expect reject maps/grammar-drift.gate-map.md halt
  expect reject maps/stale-label.gate-map.md retired
  expect accept maps/none-source.gate-map.md
  expect reject maps/none-source-bad-eligibility.gate-map.md blocking
  expect accept maps/no-labels.gate-map.md
  expect reject maps/no-labels-with-rows.gate-map.md
  expect reject maps/missing-model.gate-map.md
  expect reject maps/duplicate-label.gate-map.md ok

  # A fixture capability manifest declaring a gate-map path: the map is found through the
  # manifest key alone and checked.
  out="$(scan_manifests "$FIX_DIR"/caps/*/manifest.md 2>&1)"; rc=$?
  if ! printf '%s' "$out" | grep -qF 'caps/with-map/maps/declared.gate-map.md'; then
    err "SELFTEST FAIL — the map declared by caps/with-map/manifest.md was not found through its gate-map: key"
    printf '%s\n' "$out" >&2; st_fail=$((st_fail + 1))
  fi
  if ! printf '%s' "$out" | grep -qE 'caps/with-map/maps/declared.gate-map.md: OK'; then
    err "SELFTEST FAIL — the declared fixture map was found but not accepted"; printf '%s\n' "$out" >&2; st_fail=$((st_fail + 1))
  fi
  if ! printf '%s' "$out" | grep -qF 'caps/drifted/maps/declared.gate-map.md: unmapped label `halt`'; then
    err "SELFTEST FAIL — a drifted map declared through a manifest was not rejected naming its unmapped label"
    printf '%s\n' "$out" >&2; st_fail=$((st_fail + 1))
  fi
  if ! printf '%s' "$out" | grep -qF 'declared gate-map `maps/absent.gate-map.md` does not resolve'; then
    err "SELFTEST FAIL — a manifest declaring an absent map was not rejected"; printf '%s\n' "$out" >&2; st_fail=$((st_fail + 1))
  fi
  if [ "$rc" -ne 1 ]; then
    err "SELFTEST FAIL — scanning manifests with defective declarations returned $rc; expected 1"; st_fail=$((st_fail + 1))
  fi

  if [ "$st_fail" -ne 0 ]; then err "self-test FAILED ($st_fail case(s))"; exit 1; fi
  echo "gate-map-guard: self-test passed — unmapped, stale, duplicate, bad-eligibility, missing-field and none-with-rows maps rejected (each naming its cause); sound, none-source and no-labels maps accepted; a manifest-declared map found and checked, a drifted one rejected, and an absent one reported."
  exit 0
fi

# --- live-tree scan ---------------------------------------------------------

if [ ! -d "$MAPS_DIR" ]; then err "core gate-maps folder is absent: $MAPS_DIR"; exit 2; fi

fail=0
n=0
for f in "$MAPS_DIR"/*.md; do
  [ -f "$f" ] || continue
  n=$((n + 1))
  check_map "$f" "${f#"$ROOT"/}" || fail=$((fail + 1))
done
if [ "$n" -eq 0 ]; then err "no core gate map found in $MAPS_DIR"; exit 2; fi

scan_manifests "$ROOT"/plugins/*/capabilities/*/manifest.md || fail=$((fail + 1))

if [ "$fail" -ne 0 ]; then
  err "FAIL — $fail gate map check(s) failed."
  exit 1
fi
echo "gate-map-guard: PASS — $n core map(s) and every manifest-declared map are well formed and agree with their grammar sources."
