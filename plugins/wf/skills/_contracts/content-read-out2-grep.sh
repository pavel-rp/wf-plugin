#!/usr/bin/env bash
# OUT-2 acceptance check — FRAGMENT + SHARED + CONTRACT-OPS content classes
# (WF-304 / WF-305 / WF-306, charter C011 / WF-301).
#
# Charter outcome OUT-2: no agent or skill instructs a raw `Read`/`Glob` of a
# bundled content-class doc — every such body is obtained through the resolver
# `resolve_content` content surface, with NO fallback carve-out. C011 sweeps five
# content classes across reviewed slices (fragment, shared, contract-ops,
# references, profile). This script accumulates each slice's clause as it lands:
# SUB-3 (WF-304) landed the **fragment-class clause**; SUB-4 (WF-305) appended the
# **shared-class clause**; SUB-5 (WF-306) appends the **contract-ops-class clause**
# below. The terminal slice (SUB-7) consolidates all five per-class clauses into
# one composite gate.
#
# (Charter warning F4.2: the example name `out1-grep.sh` mislabels the outcome it
# gates — that script gates OUT-1 of a DIFFERENT charter, C001/WF-119. This gate
# is OUT-2 of C011, hence the corrected name settled here.)
#
# Requires GNU/PCRE grep (`grep -P`; present on the Linux CI runner and Git Bash).
# Exit 0 = both clauses clean; exit 1 = residue found in either clause; exit 2 =
# grep error (e.g. PCRE grep unavailable) — never a silent pass.
set -u

root="$(cd "$(dirname "$0")/../.." && pwd)"   # -> plugins/wf
ops="$root/skills/_contracts/invocation-runtime.ops.md"
overall_fail=0

# =============================================================================
# Clause 1 — FRAGMENT class (WF-304 / SUB-3)
# =============================================================================
#
# --- What it proves ---
# A fragment body — a phase-fragment dispatched at a phase fire, a `delivery`/
# `tracker` provider fragment resolved on demand, or a fragment carried on a
# run-scoped forwarded record — is served by `resolve_content` (class `fragment`),
# NEVER by a raw `Read`/`Glob` of the version-pinned plugin-cache path. Zero
# surviving raw-read instructions = pass.
#
# --- Scope (path) ---
# Scanned:  plugins/wf/skills/<name>/**.md (SKILL.md + references) and
#           plugins/wf/agents/*.md — the domain-free SDD spine's consumer prose —
#           PLUS the one central procedure doc skills/_contracts/invocation-runtime.ops.md
#           (the runtime-read ops where the fragment-dispatch step is defined).
# NOT scanned (path-scoped out, not a content carve-out):
#   - the rest of skills/_contracts/ — the `*.contract.md` reference halves (never
#     read at boot; the ops/reference split's rationale halves), capability-registry
#     /pack-onboarding ops (the CONTRACT-OPS class, owned by SUB-5), the registry
#     validator, the registry-fixtures, and this script.
#   - capability fragment BODIES (capabilities/*/fragments/*.md) and pack consumer
#     bodies — read targets / other-slice consumers, not this core-spine clause.
#
# --- The single content allowance (not a carve-out) ---
# The compliant form: a line that obtains the fragment body through the resolver
# content surface names `resolve_content`. Such lines still legitimately mention a
# fragment path or the `fragmentPath` record field (as the RESOLVED locator / record
# data), so the raw-read match below excludes any line that also names
# `resolve_content`. A raw fragment read with NO `resolve_content` on the line is a
# residual and fails. There is no path-fallback exemption.

# Raw-read-of-a-fragment-body shapes (the instruction SUB-3 removed):
#   1. "follow[ing] ... `fragmentPath`" — the provider/phase dispatch read.
#   2. "read the fragment at ..." — the per-fragment inline dispatch read.
#   3. Read `<path>/<rel-path>` — the ops step-4 placeholder read.
#   4. an explicit Read/Glob of a fragment .md file (fragments/*.md, or a resolved
#      delivery.ops.md / tracker.ops.md provider fragment).
frag_pat='\bfollow(?:ing|s)?\b[^\n]{0,40}\bfragmentPath\b'
frag_pat="$frag_pat"'|\bread the fragment at\b'
frag_pat="$frag_pat"'|\bRead\b\s+`?<path>/<rel-path>'
frag_pat="$frag_pat"'|\b(?:Read|Glob)\b[^\n]{0,80}(?:fragments/[A-Za-z0-9._-]+\.md|delivery\.ops\.md|tracker\.ops\.md)'

frag_raw=$(grep -rPno --include='*.md' --exclude-dir='_contracts' "$frag_pat" "$root/skills" "$root/agents" "$ops")
rc=$?
if [ "$rc" -ge 2 ]; then
  echo "OUT-2 (fragment): ERROR — grep failed (rc=$rc). This check requires PCRE grep (grep -P), which may be unavailable on this platform."
  exit 2
fi

# A hit is a residual only if the SAME line does not route through resolve_content.
frag_hits=$(printf '%s\n' "$frag_raw" | grep -v 'resolve_content' | grep -v '^$')

if [ -n "$frag_hits" ]; then
  echo "OUT-2 (fragment): FAIL — raw-read instructions for fragment bodies (route them through resolve_content):"
  echo "$frag_hits"
  overall_fail=1
else
  echo "OUT-2 (fragment): PASS — every fragment-body read in the wf spine + invocation-runtime ops routes through resolve_content; zero raw reads."
fi

# =============================================================================
# Clause 2 — SHARED class (WF-305 / SUB-4)
# =============================================================================
#
# --- What it proves ---
# A `_shared/*` convention doc read (id inference, the branch gate, artifact
# rotation, the staleness check — all defined in `_shared/pipeline-conventions.md`
# and consulted by verify-spec, verify-fix, qa-gen, qa-run, qa-auto, qa-followup)
# is served by `resolve_content` (class `shared`), NEVER by a raw `Read`/`Glob` or
# a markdown link into the version-pinned plugin-cache path. Zero surviving
# raw-read instructions = pass.
#
# --- Scope (path) ---
# Scanned:  plugins/wf/skills/<name>/**.md (SKILL.md + references) and
#           plugins/wf/agents/*.md — same scope as the fragment clause above.
# NOT scanned: skills/_contracts/ (reference halves, other-slice content), and
#   the `_shared/pipeline-conventions.md` target doc itself (a read TARGET, not a
#   consumer instruction — it names no path to itself).
#
# --- The single content allowance (not a carve-out) ---
# A line that obtains the shared doc through the resolver names `resolve_content`
# — such a line may legitimately name the bare `ref` value (`pipeline-conventions.md`)
# as resolved-locator data, so the raw-read match below excludes any line that
# also names `resolve_content`. A raw `_shared/*` reference with NO
# `resolve_content` on the line is a residual and fails.

# Raw-read-of-a-shared-doc shapes (the instruction this slice removes):
#   1. a markdown link into `_shared/<file>.md` — `[...](../_shared/<file>.md)` or
#      `[...](_shared/<file>.md)`.
#   2. a backtick literal relative path — `` `../_shared/<file>.md` ``.
#   3. an explicit Read/Glob of a `_shared/*.md` doc.
shared_pat='\]\([^)]*_shared/[A-Za-z0-9._-]+\.md\)'
shared_pat="$shared_pat"'|`\.?\.?/?_shared/[A-Za-z0-9._-]+\.md`'
shared_pat="$shared_pat"'|\b(?:Read|Glob)\b[^\n]{0,80}_shared/[A-Za-z0-9._-]+\.md'

shared_raw=$(grep -rPno --include='*.md' --exclude-dir='_contracts' "$shared_pat" "$root/skills" "$root/agents")
rc=$?
if [ "$rc" -ge 2 ]; then
  echo "OUT-2 (shared): ERROR — grep failed (rc=$rc). This check requires PCRE grep (grep -P), which may be unavailable on this platform."
  exit 2
fi

shared_hits=$(printf '%s\n' "$shared_raw" | grep -v 'resolve_content' | grep -v '^$')

if [ -n "$shared_hits" ]; then
  echo "OUT-2 (shared): FAIL — raw-read instructions for the shared convention doc (route them through resolve_content):"
  echo "$shared_hits"
  overall_fail=1
else
  echo "OUT-2 (shared): PASS — every shared-doc read in the wf spine routes through resolve_content; zero raw reads."
fi

# =============================================================================
# Clause 3 — CONTRACT-OPS class (WF-306 / SUB-5)
# =============================================================================
#
# --- What it proves ---
# A `_contracts/*.ops.md` contract ops doc read at runtime — the three contract
# docs `capability-registry.ops.md`, `invocation-runtime.ops.md`, and
# `pack-onboarding.ops.md` — is obtained through `resolve_content` (class
# `contract`), NEVER by a raw `Read`/`Glob` or a version-pinned plugin-cache PATH
# a consumer would open. Zero surviving raw-path read instructions = pass.
#
# --- Scope (path) ---
# Scanned:  every plugin's `skills/` and `agents/` consumer prose across the whole
#           marketplace — core (plugins/wf) PLUS every pack (the contract-ops
#           consumers include the pack init skills, e.g. wf-audit/skills/init and
#           wf-browser-qa/skills/init, per the WF-303 inventory §4.3).
# NOT scanned (path-scoped out, not a content carve-out):
#   - skills/_contracts/ itself — the contract ops docs (read TARGETS, and their
#     own paired-doc cross-references are the ops-doc bodies, out of this slice),
#     the `*.contract.md` reference halves, the validator, the registry-fixtures,
#     and this script.
#   - capabilities/*/ bodies — provider fragment `.ops.md`/`.md` halves and
#     `manifest.md` metadata cite invocation-runtime.ops.md by path, but they are
#     the FRAGMENT class / metadata / reference halves, not skills/agents consumer
#     instructions; they live outside `skills/` and `agents/` and so are excluded.
#   - README.md and other docs (outside `skills/` and `agents/`).
#
# --- The single content allowance (not a carve-out) ---
# The compliant form names `resolve_content` (`class: contract`, `ref:
# <file>.ops.md`) — so the raw-read match below excludes any line that also names
# `resolve_content`. A BARE-filename citation (`` `capability-registry.ops.md` ``
# with NO path separator) is a documentation pointer whose runtime behaviour C008's
# typed MCP already serves (`resolve_provider`/`resolve_gate`/`resolve_registry`),
# not a raw read, and is left untouched: the shapes below require a PATH separator
# (or an explicit Read/Glob), so a bare filename is never a hit. A raw contract-doc
# PATH with NO `resolve_content` on the line is a residual and fails. No
# path-fallback exemption.

# Raw-read-of-a-contract-ops-doc shapes (the instruction SUB-5 removed):
#   1. a markdown link into a path ending in a contract ops doc — `](…/<doc>.ops.md)`.
#   2. a backtick literal PATH ending in a contract ops doc — `` `…/<doc>.ops.md` ``
#      (a leading path segment / `_contracts/…` before the filename; a bare
#      `` `<doc>.ops.md` `` has no `/` and is NOT matched).
#   3. an explicit Read/Glob of a contract ops doc.
contract_docs='(?:capability-registry|invocation-runtime|pack-onboarding)\.ops\.md'
contract_pat='\]\([^)\n]*/'"$contract_docs"
contract_pat="$contract_pat"'|`[^`\n]*/'"$contract_docs"
contract_pat="$contract_pat"'|\b(?:Read|Glob)\b[^\n]{0,80}'"$contract_docs"

# Scan every plugin's skills/ and agents/ dirs (core + packs); _contracts excluded.
plugins_root="$(cd "$root/.." && pwd)"   # -> plugins
contract_dirs=$(ls -d "$plugins_root"/*/skills "$plugins_root"/*/agents 2>/dev/null)

contract_raw=$(grep -rPno --include='*.md' --exclude-dir='_contracts' "$contract_pat" $contract_dirs)
rc=$?
if [ "$rc" -ge 2 ]; then
  echo "OUT-2 (contract-ops): ERROR — grep failed (rc=$rc). This check requires PCRE grep (grep -P), which may be unavailable on this platform."
  exit 2
fi

contract_hits=$(printf '%s\n' "$contract_raw" | grep -v 'resolve_content' | grep -v '^$')

if [ -n "$contract_hits" ]; then
  echo "OUT-2 (contract-ops): FAIL — raw-read instructions for a contract ops doc (route them through resolve_content, class: contract):"
  echo "$contract_hits"
  overall_fail=1
else
  echo "OUT-2 (contract-ops): PASS — every contract-ops-doc read across core + packs routes through resolve_content; zero raw reads."
fi

exit "$overall_fail"
