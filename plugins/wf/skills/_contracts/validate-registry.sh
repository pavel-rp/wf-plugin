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
# The fixed vocabularies (the 8 SDD phases, the 7 contribution kinds, the
# partitioned-scope token shapes) are pinned to the runtime-ops half of the v2
# port, `capability-registry.ops.md` (sections "The SDD phases", "The
# contribution taxonomy"; rationale and authoring detail live in the reference
# half, `capability-registry.contract.md`). They are stable contract
# vocabulary, not project values, so an embedded allowlist here does not name a
# stack/domain/project concern — no concrete capability, stack, or product name
# appears in any code path below.
#
# Model: claude-fable-5
#
# Usage:
#   validate-registry.sh <registry-file> [registry-path-value] [install-manifest-path]
#
#   <registry-file>        Path to the registry file holding the `## Capabilities`
#                          table (a self-contained fixture file, or the resolved
#                          downstream registry). Required.
#   [registry-path-value]  Optional override for the configured registryPath
#                          string whose SHAPE is checked. When omitted (or empty),
#                          the value is read from wf.config.js `registryPath` at
#                          the repo root. The override exists so the shape check
#                          can be exercised in isolation without a per-case config
#                          file; real invocation passes only <registry-file>.
#   [install-manifest-path] Optional override for the install manifest the
#                          recorded-root-first self-heal fallback reads (WF-200;
#                          runtime algorithm: capability-registry.ops.md
#                          §"Recorded-root-first resolution with install-manifest
#                          self-heal"). When omitted (or empty), defaults to the
#                          real ~/.claude/plugins/installed_plugins.json. Fixture
#                          runs ALWAYS inject a fixture manifest here, so
#                          validation never depends on the real machine manifest.
#
# Exit codes:
#   0  — registry conforms (no errors; warnings allowed)
#   1  — one or more errors (duplicate/unsafe name, bad registryPath shape,
#         dangling path, missing manifest, scope overlap, bad phase/kind,
#         unsatisfied requires, co-active conflicts, article contradiction)
#   2  — usage / environment error (bad args, missing registry file)

set -u

# ---------------------------------------------------------------------------
# Paths. Resolve the repo root by walking UP from the script's own location to
# the marketplace marker (`.claude-plugin/marketplace.json`) instead of hardcoding
# a fixed number of `..` levels — so on-disk path checks keep resolving against
# the real repo root even if the script is moved within the tree (the previous
# fixed four-levels-up depth broke silently on any relocation). On-disk path
# checks then resolve against the real repo root in BOTH real and fixture runs
# (fixtures use full repo-relative paths, keeping resolution byte-identical to
# production). When the marker is not found (a hermetic checkout without the
# marketplace manifest), fall back to the historical four-levels-up location
# (plugins/wf/skills/_contracts/ → repo root), preserving byte-identical behaviour.
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT=""
_probe="$SCRIPT_DIR"
while :; do
  if [ -f "$_probe/.claude-plugin/marketplace.json" ]; then
    REPO_ROOT="$_probe"
    break
  fi
  _parent="$(dirname "$_probe")"
  [ "$_parent" = "$_probe" ] && break   # reached the filesystem root — stop
  _probe="$_parent"
done
if [ -z "$REPO_ROOT" ]; then
  REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
fi
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
# Install manifest read by the self-heal fallback (WF-200). An empty 3rd arg
# means "not provided" — the real per-machine manifest applies (real runs);
# fixture runs inject a fixture path so they never read the real manifest.
INSTALL_MANIFEST="${3:-}"
if [ -z "$INSTALL_MANIFEST" ]; then
  INSTALL_MANIFEST="$HOME/.claude/plugins/installed_plugins.json"
fi

if [ -z "$REGISTRY" ]; then
  echo "Usage: $(basename "$0") <registry-file> [registry-path-value] [install-manifest-path]" >&2
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

# ---------------------------------------------------------------------------
# Heading-typo guard (WF-239). Every block below is parsed by its EXACT heading
# text (`## Capabilities`, `## Plugin Roots`, `## Fragments`); a casing/spacing
# slip (`## capabilities`, `##Fragments`, `## Plugin  Roots`) matches nothing and
# the block parses to ZERO rows — which would otherwise PASS validation
# vacuously. This guard scans a file for any heading whose alphanumerics-only,
# lowercased form equals a canonical block keyword but whose raw text is NOT the
# exact heading, and errors — naming the file context and the offending line — so
# a typo fails LOUDLY instead of passing silent. It never requires a block to be
# present (an absent `## Capabilities` is the legitimate fully-generic-core case);
# it only rejects a near-miss.
# ---------------------------------------------------------------------------
check_heading_typos() {
  local file="$1" label="$2" raw norm
  [ -f "$file" ] || return 0
  while IFS= read -r raw || [ -n "$raw" ]; do
    raw="$(printf '%s' "$raw" | sed 's/\r$//')"
    case "$raw" in \#*) ;; *) continue ;; esac
    # Exact canonical headings are correct — skip them.
    case "$raw" in
      '## Capabilities' | '## Plugin Roots' | '## Fragments') continue ;;
    esac
    norm="$(printf '%s' "$raw" \
      | sed -e 's/^#\{1,6\}[[:space:]]*//' \
      | tr '[:upper:]' '[:lower:]' \
      | tr -cd 'a-z0-9')"
    case "$norm" in
      capabilities)
        err "$label heading \`$raw\` looks like a typo of \`## Capabilities\` — the exact heading is required, or the block parses to zero rows (a silent pass)." ;;
      pluginroots)
        err "$label heading \`$raw\` looks like a typo of \`## Plugin Roots\` — the exact heading is required, or the block parses to zero rows (a silent pass)." ;;
      fragments)
        err "$label heading \`$raw\` looks like a typo of \`## Fragments\` — the exact heading is required, or the block parses to zero rows (a silent pass)." ;;
    esac
  done < "$file"
}

# Guard the registry file's own block headings (`## Capabilities` / `## Plugin
# Roots`) before parsing them below.
check_heading_typos "$REGISTRY" "registry"

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

# Recover a plugin's install root from the install manifest — the self-heal
# fallback (WF-200; runtime algorithm: capability-registry.ops.md
# §"Recorded-root-first resolution with install-manifest self-heal"). Echoes
# the recovered root (backslash→forward-slash normalized; repo-relative joined
# to REPO_ROOT — fixtures ship repo-relative installPaths so resolution is
# machine-independent; a real manifest's absolute path is used as-is). Returns
# non-zero, echoing nothing, when the manifest is absent, jq is unavailable,
# the JSON is unparseable, or no matching record's installPath exists on disk
# — the bounded-dependency degrade: the row stays unrecoverable, nothing else
# breaks. In-memory only: this never writes any root anywhere.
#
# Match rule: the manifest keys records as `<plugin-name>@<marketplace>`; the
# runtime looks up the marketplace-exact key first by deriving core's own
# marketplace from ${CLAUDE_PLUGIN_ROOT} — an input a hermetic validation run
# deliberately lacks — so the validator matches on the bare left-of-`@`
# segment alone (the runtime's own fallback match). Across all matching
# records it prefers one whose installPath EXISTS on disk, so a stale record
# never shadows the live one.
resolve_from_install_manifest() {
  local needle="$1" mpaths p norm
  [ -f "$INSTALL_MANIFEST" ] || return 1
  command -v jq >/dev/null 2>&1 || return 1
  mpaths="$(jq -r --arg n "$needle" '
      .plugins // {} | to_entries[]
      | select((.key | split("@")[0]) == $n)
      | .value[]?.installPath // empty
    ' "$INSTALL_MANIFEST" 2>/dev/null)" || return 1
  [ -n "$mpaths" ] || return 1
  while IFS= read -r p; do
    [ -n "$p" ] || continue
    norm="$(printf '%s' "$p" | tr '\\' '/')"
    case "$norm" in
      /* | [A-Za-z]:*) ;;
      *) norm="$REPO_ROOT/$norm" ;;
    esac
    if [ -d "$norm" ]; then
      printf '%s' "$norm"
      return 0
    fi
  done <<< "$mpaths"
  return 1
}

# Read the installed plugin's declared name rather than inferring it from its root
# path: installed roots commonly end in a version directory.
plugin_name_at_root() {
  local root="$1"
  [ -f "$root/.claude-plugin/plugin.json" ] || return 1
  command -v jq >/dev/null 2>&1 || return 1
  jq -er '.name | select(type == "string" and test("^[a-z][a-z0-9-]*$"))' \
    "$root/.claude-plugin/plugin.json" 2>/dev/null
}

# Resolve a `subagent:` target to its discoverable agent file. A bare name belongs
# to the owning plugin inferred from the manifest path; a `<plugin>:<agent>` name
# resolves through that plugin's recorded or self-healed root. Echoes the expected
# file path and returns success only when that file exists.
resolve_subagent_target() {
  local manifest="$1" target="$2"
  local plugin="" agent="$target" root="" owning_root="" owning_plugin=""
  # Both workspace and installed manifests use the conventional
  # <plugin-root>/capabilities/... layout. Prefer it over `/plugins/`: an
  # installed cache path can contain that segment before the actual pack root.
  case "$manifest" in
    */capabilities/*)
      # Strip from the final conventional segment so cache/workspace ancestors
      # that themselves contain a `capabilities` directory do not truncate the root.
      owning_root="${manifest%/capabilities/*}"
      ;;
    */plugins/*)
      local prefix="${manifest%%/plugins/*}" rest owning_plugin_path
      rest="${manifest#"$prefix/plugins/"}"
      owning_plugin_path="${rest%%/*}"
      [ -n "$owning_plugin_path" ] && owning_root="$prefix/plugins/$owning_plugin_path"
      ;;
  esac
  owning_plugin="$(plugin_name_at_root "$owning_root" 2>/dev/null || true)"
  case "$target" in
    *:*)
      plugin="${target%%:*}"
      agent="${target#*:}"
      case "$agent" in *:*) return 1 ;; esac
      ;;
    *) root="$owning_root" ;;
  esac
  printf '%s' "$agent" | grep -qE '^[a-z][a-z0-9-]*$' || return 1
  if [ -n "$plugin" ]; then
    printf '%s' "$plugin" | grep -qE '^[a-z][a-z0-9-]*$' || return 1
    if [ "$plugin" = "$owning_plugin" ]; then
      root="$owning_root"
    else
      root="$(resolve_plugin_root "$plugin" 2>/dev/null || true)"
      if [ -z "$root" ]; then
        root="$(resolve_from_install_manifest "$plugin" 2>/dev/null || true)"
      fi
      if [ -z "$root" ] && [ -d "$REPO_ROOT/plugins/$plugin" ]; then
        root="$REPO_ROOT/plugins/$plugin"
      fi
    fi
  fi
  [ -n "$root" ] || return 1
  printf '%s' "$root/agents/$agent.md"
  [ -f "$root/agents/$agent.md" ]
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
      # plugin:<name>/<rel-path> — recorded-root-first resolution with the
      # install-manifest self-heal (WF-99 / WF-200; runtime algorithm:
      # capability-registry.ops.md §"Recorded-root-first resolution with
      # install-manifest self-heal"). The recorded `## Plugin Roots` root is
      # tried FIRST; only when it is absent (no row) or dangling (no readable
      # manifest under it) is the injectable install manifest consulted to
      # recover the current root — a live recorded root never triggers a
      # manifest read. The row errors, named, only when NEITHER route yields
      # a readable manifest.md.
      tok="${p#plugin:}"        # <name>/<rel-path>
      pl_name="${tok%%/*}"      # <name>
      pl_rel="${tok#*/}"        # <rel-path>
      if [ "$pl_name" = "$tok" ] || [ -z "$pl_rel" ] || [ -z "$pl_name" ]; then
        err "capability \`$n\` has a malformed plugin-anchored path \`$p\` — expected \`plugin:<name>/<rel-path>\`."
      else
        resolved=""
        primary_fail=""
        if pl_root="$(resolve_plugin_root "$pl_name")"; then
          folder="$pl_root/$pl_rel"
          if [ -f "$folder/manifest.md" ]; then
            resolved="$folder"
            ok "capability \`$n\` plugin-anchored path \`$p\` resolves via plugin root \`$pl_name\` and carries a manifest.md."
          elif [ ! -d "$folder" ]; then
            primary_fail="plugin-anchored path \`$p\` does not resolve to a directory via its recorded root (looked in \`$folder\` via plugin root \`$pl_name\`)"
          else
            primary_fail="plugin-anchored path \`$p\` is missing a \`manifest.md\` (expected \`$folder/manifest.md\`)"
          fi
        else
          primary_fail="names plugin \`$pl_name\` in its path \`$p\`, but there is no \`## Plugin Roots\` entry for \`$pl_name\`"
        fi
        if [ -z "$resolved" ]; then
          # Recorded root absent or dangling → install-manifest fallback.
          # (Never reached when the recorded root resolved above.)
          if heal_root="$(resolve_from_install_manifest "$pl_name")" \
             && [ -f "$heal_root/$pl_rel/manifest.md" ]; then
            resolved="$heal_root/$pl_rel"
            ok "capability \`$n\` plugin-anchored path \`$p\` resolves via the install-manifest fallback (recovered root \`$heal_root\` for \`$pl_name\`) and carries a manifest.md."
          else
            err "capability \`$n\` $primary_fail, and the install manifest (\`$INSTALL_MANIFEST\`) recovers no live root for \`$pl_name\` — unrecoverable; re-run the pack's init to refresh its \`## Plugin Roots\` row."
          fi
        fi
        if [ -n "$resolved" ]; then
          manifest_files+=("$resolved/manifest.md")
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

# The 8 SDD phases (contract: "The SDD phases") — `pre-commit` (WF-154) is the
# operation-time commit-path self-review seam; it reuses the `finding` kind.
VALID_PHASES=" spec plan tasks implement verify qa-generation qa-execution pre-commit "
# The 7 contribution kinds (contract: "The contribution taxonomy"). `article` is
# NOT a contribution kind (WF-239): a constitution clause is declared with the
# `article: <key> = <value>` manifest KEY (parsed below, cross-checked in CHECK 9),
# never as a fragments-table row — its home is the constitution, which is not an
# SDD phase, so a fragment naming `article` as its kind is rejected by CHECK 6.
# `slot` (WF-323) is the seventh kind: a per-skill composition-surface contribution
# scoped by a `skill.point` token (carried in the scope column — a slot targets a
# skill point, not an SDD phase, so its phase cell is `—`) and a declared merge
# policy (`replace` | `append`); its well-formedness is checked in CHECK 6c and its
# replace-overlap in CHECK 5.
VALID_KINDS=" guidance task-list artifact finding scenario provider slot "
# The 2 slot merge policies (WF-323): `replace` (single-owner, partition-like — two
# `replace` claims on one skill.point conflict) and `append` (list-like, aggregate —
# multiple contributors to one skill.point compose, never conflict).
VALID_SLOT_POLICIES=" replace append "

# Ownership-scope accounting for the partitioned kinds (CHECK 5).
#   provider keyed by its surface token; artifact keyed by its source->target pair.
prov_surface=()   # "<capname>|<surface>"
art_pair=()       # "<capname>|<pair>"
# Slot `replace`-policy ownership accounting (WF-323, CHECK 5): a slot skill.point
# claimed with `replace` is single-owner, so two DIFFERENT capabilities each
# `replace`-claiming the same skill.point conflict; `append` claims are never
# accumulated here (they compose).
slot_replace=()   # "<capname>|<skill.point>"

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

  # Guard this manifest's `## Fragments` heading against a casing/spacing typo
  # that would parse zero rows and pass silently (WF-239).
  check_heading_typos "$mf" "capability \`$cap\` manifest"

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
        # Constitution-clause declaration — the documented `article:` manifest KEY
        # (contract §"Manifest schema v2"; WF-239): `article: <key> = <value>`. This
        # is a manifest key like `requires:`/`conflicts:`, NOT a fragments-table row
        # (`article` is not a contribution kind). It is the only structural mechanism
        # parsed; prose-level contradiction detection is out of scope (a known
        # limitation).
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
    f_dispatch="$(trim "$f_dispatch")"
    f_scope="$(trim "$f_scope")"

    # Skip the header row.
    [ "$f_phase" = "phase" ] && continue
    [ -z "$f_phase" ] && continue

    # --- CHECK 6: valid phase + contribution-kind tokens -----------------
    # A `slot` (WF-323) targets a skill point (its scope), NOT an SDD phase, so its
    # phase cell must be `—`; every other kind must name one of the SDD phases.
    if [ "$f_kind" = "slot" ]; then
      case "$f_phase" in
        "—" | "-") ;;
        *) err "capability \`$cap\` slot fragment names phase \`$f_phase\` (row: \`$f_phase | $f_kind | ...\`) — a slot targets a skill point (its scope), not an SDD phase; put \`—\` in the phase column." ;;
      esac
    else
      case "$VALID_PHASES" in
        *" $f_phase "*) ;;
        *) err "capability \`$cap\` fragment names an unknown phase \`$f_phase\` (row: \`$f_phase | $f_kind | ...\`) — not one of the contract's SDD phases." ;;
      esac
    fi
    case "$VALID_KINDS" in
      *" $f_kind "*) ;;
      *) err "capability \`$cap\` fragment names an unknown contribution-kind \`$f_kind\` (row: \`$f_phase | $f_kind | ...\`) — not one of the contract's taxonomy kinds." ;;
    esac

    # --- CHECK 6b: dispatch column well-formed (WF-239) ------------------
    # The dispatch cell must be `inline: <rel-path>` or `subagent: <agent>`
    # (optionally wrapped in backticks in the table). A blank or otherwise
    # malformed dispatch is a fragment core cannot reach — reject it, naming the
    # capability and the offending row. (Previously f_dispatch was extracted but
    # never validated — dead code.)
    d="$f_dispatch"
    d="${d#\`}"; d="${d%\`}"          # strip surrounding backticks, if any
    d="$(trim "$d")"
    case "$d" in
      inline:*)
        [ -z "$(trim "${d#inline:}")" ] && \
          err "capability \`$cap\` fragment at \`$f_phase | $f_kind\` has an \`inline:\` dispatch with no path (dispatch: \`$f_dispatch\`)." ;;
      subagent:*)
        subagent_target="$(trim "${d#subagent:}")"
        if [ -z "$subagent_target" ]; then
          err "capability \`$cap\` fragment at \`$f_phase | $f_kind\` has a \`subagent:\` dispatch with no agent name (dispatch: \`$f_dispatch\`)."
        elif expected_agent="$(resolve_subagent_target "$mf" "$subagent_target")"; then
          :
        else
          # Call once more for the deterministic expected-path diagnostic when
          # grammar/root resolution succeeded but the agent file is missing.
          expected_agent="$(resolve_subagent_target "$mf" "$subagent_target" 2>/dev/null || true)"
          if [ -n "$expected_agent" ]; then
            err "capability \`$cap\` fragment at \`$f_phase | $f_kind\` names undiscoverable subagent target \`$d\` — no agent file at \`$expected_agent\`."
          else
            err "capability \`$cap\` fragment at \`$f_phase | $f_kind\` names an undiscoverable subagent target \`$d\` — expected a lowercase agent name, optionally qualified as \`<plugin>:<agent>\`, in the owning plugin/workspace agent tree."
          fi
        fi
        ;;
      *)
        err "capability \`$cap\` fragment at \`$f_phase | $f_kind\` has a malformed dispatch \`$f_dispatch\` — expected \`inline: <rel-path>\` or \`subagent: <agent>\`." ;;
    esac

    # --- CHECK 5: accumulate partitioned-kind ownership ------------------
    norm_scope="$f_scope"
    case "$norm_scope" in "—" | "-") norm_scope="" ;; esac
    if [ "$f_kind" = "provider" ] && [ -n "$norm_scope" ]; then
      prov_surface+=("$cap|$norm_scope")
    elif [ "$f_kind" = "artifact" ] && [ -n "$norm_scope" ]; then
      art_pair+=("$cap|$norm_scope")
    elif [ "$f_kind" = "slot" ]; then
      # --- CHECK 6c: slot scope grammar + declared merge policy (WF-323) --
      # A slot's scope cell is a compound `<skill>.<point> <merge-policy>` token:
      # the `skill.point` names the composition point (the ownership identity), the
      # merge policy declares how multiple contributions to it combine. BOTH are
      # required — a `—`/blank scope, a malformed skill.point, or an absent/unknown
      # merge policy is rejected, naming the offending capability and row.
      if [ -z "$norm_scope" ]; then
        err "capability \`$cap\` slot fragment at \`$f_phase | $f_kind\` has no scope — a slot row must carry a \`<skill>.<point> <merge-policy>\` scope (e.g. \`ship.review replace\`)."
      else
        slot_point="${norm_scope%% *}"            # first whitespace-delimited token
        slot_policy="$(trim "${norm_scope#* }")"  # the remainder after the first space
        if ! printf '%s' "$slot_point" | grep -qE '^[a-z0-9-]+\.[a-z0-9-]+$'; then
          err "capability \`$cap\` slot fragment has a malformed scope \`$f_scope\` — the skill.point must be \`<skill>.<point>\`, each segment lowercase letters/digits/hyphens joined by a single dot (e.g. \`ship.review\`)."
        elif [ "$slot_policy" = "$slot_point" ]; then
          err "capability \`$cap\` slot fragment scope \`$f_scope\` declares no merge policy — a slot row must state \`replace\` or \`append\` after the skill.point (e.g. \`$slot_point replace\`)."
        else
          case "$VALID_SLOT_POLICIES" in
            *" $slot_policy "*) ;;
            *) err "capability \`$cap\` slot fragment scope \`$f_scope\` names an unknown merge policy \`$slot_policy\` — expected \`replace\` or \`append\`." ;;
          esac
          # A `replace` claim is single-owner — accumulate it for the CHECK 5 overlap.
          [ "$slot_policy" = "replace" ] && slot_replace+=("$cap|$slot_point")
        fi
      fi
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
# WF-323: two DIFFERENT capabilities each `replace`-claiming the same slot
# skill.point conflict (append claims compose and are never accumulated above).
[ "${#slot_replace[@]}" -gt 0 ] && check_scope_overlap "slot skill.point (replace)" "${slot_replace[@]}"

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
