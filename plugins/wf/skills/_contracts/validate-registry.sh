#!/usr/bin/env bash
#
# validate-registry.sh — fail-fast validator for the v2 capability registry.
#
# Checks the whole capability registry — the `## Capabilities` table at the
# resolved registry file plus every active capability's `manifest.md` — before
# any phase composes them. It is a SECOND, ADDITIVE validator that sits on top
# of the per-capability profile validator (which it does not touch); this one
# catches a malformed or self-contradictory REGISTRY at init / validate time.
#
# Every error names the SPECIFIC row / name / path / scope / clause / fragment
# at fault — never a bare "validation failed."
#
# The fixed vocabularies (the 7 SDD phases, the 7 contribution kinds, the
# partitioned-scope token shapes) are pinned to the v2 contract
# `capability-registry.contract.md` (sections "The SDD phases", "The
# contribution taxonomy"). They are stable contract vocabulary, not project
# values, so an embedded allowlist here does not name a stack/domain/project
# concern — no concrete capability, stack, or product name appears in any code
# path below.
#
# Model: claude-opus-4-8
#
# Usage:
#   validate-registry.sh <registry-file> [registry-path-value]
#
#   <registry-file>        Path to the registry file holding the `## Capabilities`
#                          table (a self-contained fixture file, or the resolved
#                          downstream registry). Required.
#   [registry-path-value]  Optional override for the configured registryPath
#                          string whose SHAPE is checked. When omitted, the value
#                          is read from wf.config.js `registryPath` at the repo
#                          root. The override exists so the shape check can be
#                          exercised in isolation without a per-case config file;
#                          real invocation passes only <registry-file>.
#
# Exit codes:
#   0  — registry conforms (no errors; warnings allowed)
#   1  — one or more errors (duplicate/unsafe name, bad registryPath shape,
#         dangling path, missing manifest, scope overlap, bad phase/kind,
#         unsatisfied requires, co-active conflicts, article contradiction)
#   2  — usage / environment error (bad args, missing registry file)

set -u

# ---------------------------------------------------------------------------
# Paths. The script lives three levels under the repo root
# (plugins/wf/skills/_contracts/); resolve the repo root from its own location
# so on-disk path checks resolve against the real repo root in BOTH real and
# fixture runs (fixtures therefore use full repo-relative paths, not bare names,
# keeping resolution byte-identical to production).
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
CONFIG_JS="$REPO_ROOT/wf.config.js"

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
# value-carrying messages (a path like `C:\x`, a token with `\t`), corrupting
# or truncating diagnostics.
err()  { printf '%bERROR:%b %s\n'   "$RED"    "$NC" "$*"; errors=$((errors + 1)); }
warn() { printf '%bWARNING:%b %s\n' "$YELLOW" "$NC" "$*"; warnings=$((warnings + 1)); }
ok()   { printf '%bOK:%b %s\n'      "$GREEN"  "$NC" "$*"; }

# ---------------------------------------------------------------------------
# Argument handling.
# ---------------------------------------------------------------------------
REGISTRY="${1:-}"
REGISTRY_PATH_OVERRIDE="${2:-}"

if [ -z "$REGISTRY" ]; then
  echo "Usage: $(basename "$0") <registry-file> [registry-path-value]" >&2
  exit 2
fi
if [ ! -f "$REGISTRY" ]; then
  printf '%bERROR:%b registry file not found: %s\n' "$RED" "$NC" "$REGISTRY" >&2
  exit 2
fi

echo "Validating registry: $REGISTRY"
echo "Repo root:           $REPO_ROOT"
echo ""

# ---------------------------------------------------------------------------
# Helper: strip a markdown table cell — drop a leading/trailing pipe's
# surrounding whitespace and any trailing CR (this jq/Git-Bash MSYS build and
# CRLF-checked-out files both leave \r on parsed lines).
# ---------------------------------------------------------------------------
trim() {
  # shellcheck disable=SC2001
  printf '%s' "$1" | sed -e 's/\r$//' -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//'
}

# ===========================================================================
# CHECK 1 — registryPath shape.
#
# The configured registryPath (the location the downstream registry lives at)
# must be a forward-slash, repo-relative FILE path: no leading `/`, no drive
# prefix (a letter followed by `:`), and no `..` segment, so the resolved
# location can never escape the repo root. The value comes from the optional
# 2nd arg (fixtures) or wf.config.js `registryPath` (real runs). A CRLF-safe,
# value-exact line read pulls the single string from the JS object without a
# JSON parser — the config is a tiny JS module, and only this one value is read.
# ===========================================================================
registry_path_value=""
if [ -n "$REGISTRY_PATH_OVERRIDE" ]; then
  registry_path_value="$REGISTRY_PATH_OVERRIDE"
elif [ -f "$CONFIG_JS" ]; then
  # Match:  registryPath: "value"   (single or double quotes), first hit only.
  # sed extracts the quoted value; tr -d '\r' guards a CRLF-checked-out config.
  registry_path_value="$(
    grep -E '^[[:space:]]*registryPath[[:space:]]*:' "$CONFIG_JS" \
      | head -n 1 \
      | sed -E 's/^[[:space:]]*registryPath[[:space:]]*:[[:space:]]*["'"'"']([^"'"'"']*)["'"'"'].*/\1/' \
      | tr -d '\r'
  )"
fi

if [ -z "$registry_path_value" ]; then
  warn "registryPath not set (no override and none in wf.config.js) — shape check skipped."
else
  bad_shape=""
  # Backslash is rejected outright: the value must be a forward-slash path, and
  # a backslash also evades the segment-aware checks below (a `..\` traversal or
  # a `\`-rooted absolute path would otherwise slip through), defeating the
  # "can never escape the repo root" invariant.
  case "$registry_path_value" in
    *\\*) bad_shape="contains a backslash (must use forward slashes)" ;;
  esac
  case "$registry_path_value" in
    /*)         [ -z "$bad_shape" ] && bad_shape="absolute path (leading '/')" ;;
    [A-Za-z]:*) [ -z "$bad_shape" ] && bad_shape="drive-prefixed path" ;;
  esac
  # A `..` segment anywhere (start, middle, end, or whole value).
  case "/$registry_path_value/" in
    */../*) [ -z "$bad_shape" ] && bad_shape="contains a '..' segment" ;;
  esac
  if [ -n "$bad_shape" ]; then
    err "registryPath \`$registry_path_value\` is not a forward-slash repo-relative file path: $bad_shape."
  else
    ok "registryPath shape: \`$registry_path_value\`"
  fi
fi

# ===========================================================================
# Parse the `## Capabilities` table from the registry file.
#
# Collect rows between the `## Capabilities` heading and the next `##` heading
# (or EOF). A data row starts with `|`; the header row (`| Capability | Path |`)
# and the separator row (`|---|---|`) are skipped. Whitespace-padded pipes and
# trailing CR are tolerated. Parallel arrays hold each row's name + path.
# ===========================================================================
cap_names=()
cap_paths=()

in_table=0
while IFS= read -r raw || [ -n "$raw" ]; do
  line="$(printf '%s' "$raw" | sed 's/\r$//')"
  case "$line" in
    '## Capabilities'*) in_table=1; continue ;;
    '##'*) [ "$in_table" -eq 1 ] && break ;;
  esac
  [ "$in_table" -eq 1 ] || continue

  # Only pipe-delimited rows are table rows.
  case "$line" in
    \|*) ;;
    *) continue ;;
  esac

  # Separator row: cells contain only dashes/colons/spaces.
  case "$line" in
    *[!\|:_\ -]*) ;;            # has a "real" char — a data or header row
    *) continue ;;              # only | : - space → separator, skip
  esac

  # Split the two leading cells.
  body="${line#|}"                 # drop leading pipe
  c_name="${body%%|*}"             # first cell
  rest="${body#*|}"                # after first pipe
  c_path="${rest%%|*}"            # second cell

  c_name="$(trim "$c_name")"
  c_path="$(trim "$c_path")"

  # Skip the header row.
  [ "$c_name" = "Capability" ] && continue
  [ -z "$c_name" ] && continue

  cap_names+=("$c_name")
  cap_paths+=("$c_path")
done < "$REGISTRY"

if [ "${#cap_names[@]}" -eq 0 ]; then
  ok "registry has an empty \`## Capabilities\` table — fully generic core (no capabilities to validate)."
fi

# ===========================================================================
# Parse the `## Plugin Roots` table (WF-99) — the <plugin-name> → install-root
# mapping that resolves a plugin-anchored `Path` (`plugin:<name>/<rel-path>`).
# Co-located with `## Capabilities` at the registry file. Same block-scan style.
# An absent/empty table means no plugin is mapped (only repo-relative Paths can
# resolve). Parallel arrays hold each row's plugin name + root.
# ===========================================================================
pr_names=()
pr_roots=()

in_pr=0
while IFS= read -r raw || [ -n "$raw" ]; do
  line="$(printf '%s' "$raw" | sed 's/\r$//')"
  case "$line" in
    '## Plugin Roots'*) in_pr=1; continue ;;
    '##'*) [ "$in_pr" -eq 1 ] && break ;;
  esac
  [ "$in_pr" -eq 1 ] || continue

  case "$line" in \|*) ;; *) continue ;; esac
  case "$line" in *[!\|:_\ -]*) ;; *) continue ;; esac

  body="${line#|}"
  p_name="${body%%|*}"
  rest="${body#*|}"
  p_root="${rest%%|*}"

  p_name="$(trim "$p_name")"
  p_root="$(trim "$p_root")"

  [ "$p_name" = "Plugin" ] && continue
  [ -z "$p_name" ] && continue

  pr_names+=("$p_name")
  pr_roots+=("$p_root")
done < "$REGISTRY"

# ---------------------------------------------------------------------------
# CHECK 4a — plugin-root shape. A `Root` MAY be absolute or drive-prefixed (a
# plugin install root is absolute by nature and lives in gitignored `_local/`),
# so — unlike `Path`/`registryPath` — absolute is allowed. It must still not
# contain a backslash or a `..` segment (forward slashes; no traversal).
# ---------------------------------------------------------------------------
i=0
while [ "$i" -lt "${#pr_roots[@]}" ]; do
  pn="${pr_names[$i]}"
  prt="${pr_roots[$i]}"
  bad_root=""
  case "$prt" in *\\*) bad_root="contains a backslash (must use forward slashes)" ;; esac
  if [ -z "$bad_root" ]; then
    case "/$prt/" in */../*) bad_root="contains a '..' segment" ;; esac
  fi
  if [ -z "$prt" ] || [ "$prt" = "—" ]; then
    err "plugin root for \`$pn\` is empty — every \`## Plugin Roots\` row needs a Root."
  elif [ -n "$bad_root" ]; then
    err "plugin root for \`$pn\` \`$prt\` is not a valid root: $bad_root."
  else
    ok "plugin root \`$pn\` → \`$prt\`."
  fi
  i=$((i + 1))
done

# ---------------------------------------------------------------------------
# CHECK 4b — plugin-root names unique. A duplicate `Plugin` key would make
# resolve_plugin_root silently pick the first match and hide a misconfigured
# mapping, so duplicates are a validation error (mirrors CHECK 2 for names).
# ---------------------------------------------------------------------------
i=0
while [ "$i" -lt "${#pr_names[@]}" ]; do
  j=$((i + 1))
  while [ "$j" -lt "${#pr_names[@]}" ]; do
    if [ "${pr_names[$i]}" = "${pr_names[$j]}" ]; then
      err "duplicate plugin root name \`${pr_names[$i]}\` (rows $((i + 1)) and $((j + 1))) — \`## Plugin Roots\` names must be unique so resolution is deterministic."
    fi
    j=$((j + 1))
  done
  i=$((i + 1))
done

# Resolve a plugin name to its on-disk root via the `## Plugin Roots` mapping.
# Echoes the resolved root (absolute as-is; repo-relative joined to REPO_ROOT);
# returns non-zero (echoing nothing) when the plugin is unmapped.
resolve_plugin_root() {
  local needle="$1" i=0 r
  while [ "$i" -lt "${#pr_names[@]}" ]; do
    if [ "${pr_names[$i]}" = "$needle" ]; then
      r="${pr_roots[$i]}"
      case "$r" in
        /* | [A-Za-z]:*) printf '%s' "$r" ;;
        *)               printf '%s' "$REPO_ROOT/$r" ;;
      esac
      return 0
    fi
    i=$((i + 1))
  done
  return 1
}

# ===========================================================================
# CHECK 2 — capability names unique.
# ===========================================================================
i=0
while [ "$i" -lt "${#cap_names[@]}" ]; do
  j=$((i + 1))
  while [ "$j" -lt "${#cap_names[@]}" ]; do
    if [ "${cap_names[$i]}" = "${cap_names[$j]}" ]; then
      err "duplicate capability name \`${cap_names[$i]}\` (rows $((i + 1)) and $((j + 1))) — names must be unique across the registry."
    fi
    j=$((j + 1))
  done
  i=$((i + 1))
done

# ===========================================================================
# CHECK 3 — filesystem-safe names.
#
# A name is used verbatim as a filename stem (the seeded profile path), so it
# must be a safe token: lowercase letters, digits, hyphens only — no uppercase,
# whitespace, path separator, or `..` segment.
# ===========================================================================
i=0
while [ "$i" -lt "${#cap_names[@]}" ]; do
  n="${cap_names[$i]}"
  if printf '%s' "$n" | grep -qE '[^a-z0-9-]'; then
    err "capability name \`$n\` is not filesystem-safe — only lowercase letters, digits, and hyphens are allowed (no uppercase, whitespace, or path separators)."
  elif case "$n" in *..*) true ;; *) false ;; esac; then
    err "capability name \`$n\` is not filesystem-safe — it contains a \`..\` segment."
  fi
  i=$((i + 1))
done

# ===========================================================================
# CHECK 4 — declared paths exist and carry a manifest.md.
#
# Two `Path` shapes exist in the contract, and BOTH resolve (WF-99). The
# repo-relative folder form resolves against REPO_ROOT. The plugin-anchored
# token `plugin:<name>/<rel-path>` resolves via the `## Plugin Roots` mapping
# (`<root>/<rel-path>`): an unmapped plugin, or a resolved path with no
# `manifest.md`, is an error naming the offender. Every resolvable manifest is
# added to the checkable set so CHECK 5-9 run against it too.
# ===========================================================================
manifest_files=()   # parallel to a filtered list of cap indices we can check
checkable_idx=()
i=0
while [ "$i" -lt "${#cap_paths[@]}" ]; do
  p="${cap_paths[$i]}"
  n="${cap_names[$i]}"
  case "$p" in
    plugin:*)
      # plugin:<name>/<rel-path> — resolve via the `## Plugin Roots` mapping (WF-99).
      tok="${p#plugin:}"        # <name>/<rel-path>
      pl_name="${tok%%/*}"      # <name>
      pl_rel="${tok#*/}"        # <rel-path>
      if [ "$pl_name" = "$tok" ] || [ -z "$pl_rel" ] || [ -z "$pl_name" ]; then
        err "capability \`$n\` has a malformed plugin-anchored path \`$p\` — expected \`plugin:<name>/<rel-path>\`."
      elif ! pl_root="$(resolve_plugin_root "$pl_name")"; then
        err "capability \`$n\` names plugin \`$pl_name\` in its path \`$p\`, but there is no \`## Plugin Roots\` entry for \`$pl_name\`."
      else
        folder="$pl_root/$pl_rel"
        if [ ! -d "$folder" ]; then
          err "capability \`$n\` plugin-anchored path \`$p\` does not resolve to a directory (looked in \`$folder\` via plugin root \`$pl_name\`)."
        elif [ ! -f "$folder/manifest.md" ]; then
          err "capability \`$n\` plugin-anchored path \`$p\` is missing a \`manifest.md\` (expected \`$folder/manifest.md\`)."
        else
          ok "capability \`$n\` plugin-anchored path \`$p\` resolves via plugin root \`$pl_name\` and carries a manifest.md."
          manifest_files+=("$folder/manifest.md")
          checkable_idx+=("$i")
        fi
      fi
      ;;
    "" | "—")
      err "capability \`$n\` has no Path in the registry."
      ;;
    *)
      folder="$REPO_ROOT/$p"
      if [ ! -d "$folder" ]; then
        err "capability \`$n\` path does not exist: \`$p\` (no directory at \`$folder\`)."
      elif [ ! -f "$folder/manifest.md" ]; then
        err "capability \`$n\` path \`$p\` is missing a \`manifest.md\` (expected \`$folder/manifest.md\`)."
      else
        ok "capability \`$n\` path \`$p\` exists and carries a manifest.md."
        manifest_files+=("$folder/manifest.md")
        checkable_idx+=("$i")
      fi
      ;;
  esac
  i=$((i + 1))
done

# ===========================================================================
# Parse each resolvable manifest's fragments table + key lines, then run the
# cross-manifest checks (CHECK 5-9). The fixed vocabularies are pinned to the
# v2 contract.
# ===========================================================================

# The 7 SDD phases (contract: "The SDD phases").
VALID_PHASES=" spec plan tasks implement verify qa-generation qa-execution "
# The 7 contribution kinds (contract: "The contribution taxonomy").
VALID_KINDS=" guidance task-list artifact finding scenario provider article "

# Ownership-scope accounting for the partitioned kinds (CHECK 5).
#   provider keyed by its surface token; artifact keyed by its source->target pair.
prov_surface=()   # "<capname>|<surface>"
art_pair=()       # "<capname>|<pair>"

# requires/conflicts accounting (CHECK 7/8).
req_pairs=()      # "<capname>|<required-name>"
conf_pairs=()     # "<capname>|<conflicting-name>"

# Declared-article accounting (CHECK 9): "<capname>|<article-key>|<value>".
article_decls=()

ci=0
while [ "$ci" -lt "${#checkable_idx[@]}" ]; do
  idx="${checkable_idx[$ci]}"
  cap="${cap_names[$idx]}"
  mf="${manifest_files[$ci]}"

  in_frag=0
  while IFS= read -r raw || [ -n "$raw" ]; do
    line="$(printf '%s' "$raw" | sed 's/\r$//')"

    # --- manifest key lines (anywhere in the file) -----------------------
    case "$line" in
      requires:*)
        vals="$(printf '%s' "${line#requires:}" | tr ',' ' ')"
        for v in $vals; do
          v="$(trim "$v")"
          [ -n "$v" ] && req_pairs+=("$cap|$v")
        done
        ;;
      conflicts:*)
        vals="$(printf '%s' "${line#conflicts:}" | tr ',' ' ')"
        for v in $vals; do
          v="$(trim "$v")"
          [ -n "$v" ] && conf_pairs+=("$cap|$v")
        done
        ;;
      article:*)
        # Structural article declaration:  article: <key> = <value>
        # (the only mechanism parsed; prose-level contradiction detection is
        # out of scope and noted as a known limitation).
        decl="$(trim "${line#article:}")"
        akey="$(trim "${decl%%=*}")"
        aval="$(trim "${decl#*=}")"
        if [ -n "$akey" ] && [ "$akey" != "$decl" ]; then
          article_decls+=("$cap|$akey|$aval")
        fi
        ;;
    esac

    # --- fragments table -------------------------------------------------
    case "$line" in
      '## Fragments'*) in_frag=1; continue ;;
      '##'*) [ "$in_frag" -eq 1 ] && in_frag=0 ;;
    esac
    [ "$in_frag" -eq 1 ] || continue
    case "$line" in \|*) ;; *) continue ;; esac
    # Skip separator rows.
    case "$line" in *[!\|:_\ -]*) ;; *) continue ;; esac

    body="${line#|}"
    f_phase="${body%%|*}";          r1="${body#*|}"
    f_kind="${r1%%|*}";             r2="${r1#*|}"
    f_dispatch="${r2%%|*}";         r3="${r2#*|}"
    f_scope="${r3%%|*}"

    f_phase="$(trim "$f_phase")"
    f_kind="$(trim "$f_kind")"
    f_scope="$(trim "$f_scope")"

    # Skip the header row.
    [ "$f_phase" = "phase" ] && continue
    [ -z "$f_phase" ] && continue

    # --- CHECK 6: valid phase + contribution-kind tokens -----------------
    case "$VALID_PHASES" in
      *" $f_phase "*) ;;
      *) err "capability \`$cap\` fragment names an unknown phase \`$f_phase\` (row: \`$f_phase | $f_kind | ...\`) — not one of the contract's SDD phases." ;;
    esac
    case "$VALID_KINDS" in
      *" $f_kind "*) ;;
      *) err "capability \`$cap\` fragment names an unknown contribution-kind \`$f_kind\` (row: \`$f_phase | $f_kind | ...\`) — not one of the contract's taxonomy kinds." ;;
    esac

    # --- CHECK 5: accumulate partitioned-kind ownership ------------------
    norm_scope="$f_scope"
    case "$norm_scope" in "—" | "-") norm_scope="" ;; esac
    if [ "$f_kind" = "provider" ] && [ -n "$norm_scope" ]; then
      prov_surface+=("$cap|$norm_scope")
    elif [ "$f_kind" = "artifact" ] && [ -n "$norm_scope" ]; then
      art_pair+=("$cap|$norm_scope")
    fi
  done < "$mf"

  ci=$((ci + 1))
done

# ===========================================================================
# CHECK 5 — no overlapping ownership scopes across active capabilities.
#   Two capabilities claiming the same provider surface, or the same artifact
#   source->target pair, is a validation error naming BOTH offenders.
# ===========================================================================
check_scope_overlap() {
  local kind="$1"; shift
  local arr=("$@")
  local a b
  local ai=0
  while [ "$ai" -lt "${#arr[@]}" ]; do
    local bj=$((ai + 1))
    while [ "$bj" -lt "${#arr[@]}" ]; do
      local cap_a="${arr[$ai]%%|*}" scope_a="${arr[$ai]#*|}"
      local cap_b="${arr[$bj]%%|*}" scope_b="${arr[$bj]#*|}"
      if [ "$scope_a" = "$scope_b" ] && [ "$cap_a" != "$cap_b" ]; then
        err "capabilities \`$cap_a\` and \`$cap_b\` both claim the same $kind scope \`$scope_a\` — partitioned ownership must not overlap."
      fi
      bj=$((bj + 1))
    done
    ai=$((ai + 1))
  done
}
[ "${#prov_surface[@]}" -gt 0 ] && check_scope_overlap "provider surface" "${prov_surface[@]}"
[ "${#art_pair[@]}" -gt 0 ] && check_scope_overlap "artifact source→target" "${art_pair[@]}"

# Helper: is a name an active capability in the registry?
is_active() {
  local needle="$1" k
  for k in "${cap_names[@]}"; do
    [ "$k" = "$needle" ] && return 0
  done
  return 1
}

# ===========================================================================
# CHECK 7 — requires: satisfied (the required capability is active).
# ===========================================================================
for pair in ${req_pairs[@]+"${req_pairs[@]}"}; do
  requirer="${pair%%|*}"; needed="${pair#*|}"
  if is_active "$needed"; then
    ok "capability \`$requirer\` requires \`$needed\` — satisfied (active)."
  else
    err "capability \`$requirer\` requires \`$needed\`, which is not an active capability in the registry. Install and register/initialize the capability that provides \`$needed\`, then re-run validation."
  fi
done

# ===========================================================================
# CHECK 8 — conflicts: not both active.
# ===========================================================================
for pair in ${conf_pairs[@]+"${conf_pairs[@]}"}; do
  owner="${pair%%|*}"; foe="${pair#*|}"
  if is_active "$foe"; then
    err "capabilities \`$owner\` and \`$foe\` are both active but \`$owner\` declares a conflict with \`$foe\`."
  fi
done

# ===========================================================================
# CHECK 9 — declared article contradiction (structural only).
#   Two active capabilities declaring the SAME article key with DIFFERENT
#   values contradict. Detected structurally via the `article: <key> = <value>`
#   declaration; prose-level contradiction is a known limitation (not detected).
# ===========================================================================
ai=0
while [ "$ai" -lt "${#article_decls[@]}" ]; do
  bj=$((ai + 1))
  while [ "$bj" -lt "${#article_decls[@]}" ]; do
    a="${article_decls[$ai]}"; b="${article_decls[$bj]}"
    cap_a="${a%%|*}";  rest_a="${a#*|}";  key_a="${rest_a%%|*}";  val_a="${rest_a#*|}"
    cap_b="${b%%|*}";  rest_b="${b#*|}";  key_b="${rest_b%%|*}";  val_b="${rest_b#*|}"
    if [ "$cap_a" != "$cap_b" ] && [ "$key_a" = "$key_b" ] && [ "$val_a" != "$val_b" ]; then
      err "capabilities \`$cap_a\` and \`$cap_b\` declare contradictory article clause \`$key_a\` (\`$val_a\` vs \`$val_b\`) — a capability-vs-capability contradiction is a validation error."
    fi
    bj=$((bj + 1))
  done
  ai=$((ai + 1))
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
