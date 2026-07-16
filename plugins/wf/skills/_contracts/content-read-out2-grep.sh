#!/usr/bin/env bash
# OUT-2 acceptance check — the COMPOSITE gate over all FIVE content classes
# (FRAGMENT + SHARED + CONTRACT-OPS + REFERENCES + PROFILE), charter C011 / WF-301.
#
# Charter outcome OUT-2: no agent or skill instructs a raw `Read`/`Glob` of a
# bundled content-class doc — every such body is obtained through the resolver
# `resolve_content` content surface, with NO fallback carve-out. C011 sweeps five
# content classes across reviewed slices: SUB-3 (WF-304) landed the **fragment**
# clause; SUB-4 (WF-305) the **shared** clause; SUB-5 (WF-306) the **contract-ops**
# clause; SUB-6 (WF-307) the **references** clause; and this terminal slice SUB-7
# (WF-308) appends the **profile** clause AND CONSOLIDATES the gate: every clause
# now scans the whole marketplace — each plugin's `skills/` and `agents/` under
# `plugins/**` (core wf PLUS every pack), not just the core spine. Zero hits across
# all five clauses = pass; there is no raw-read carve-out and no fall-through.
#
# (Charter warning F4.2: the example name `out1-grep.sh` mislabels the outcome it
# gates — that script gates OUT-1 of a DIFFERENT charter, C001/WF-119. This gate
# is OUT-2 of C011, hence the corrected name settled here.)
#
# Requires GNU/PCRE grep (`grep -P`; present on the Linux CI runner and Git Bash).
# Exit 0 = all clauses clean; exit 1 = residue found in any clause; exit 2 =
# grep error (e.g. PCRE grep unavailable) — never a silent pass.
set -u

root="$(cd "$(dirname "$0")/../.." && pwd)"   # -> plugins/wf
ops="$root/skills/_contracts/invocation-runtime.ops.md"
plugins_root="$(cd "$root/.." && pwd)"        # -> plugins
overall_fail=0

# Every plugin's skills/ and agents/ consumer prose (core wf + every pack). This
# is the composite scope: OUT-2 admits no raw read anywhere under `plugins/**`, not
# just the core spine. Per-clause, `_contracts/` is excluded (read TARGETS / the
# `*.contract.md` reference halves / the validator / the fixtures / this script),
# and the one central procedure doc `invocation-runtime.ops.md` — which lives in
# `_contracts/` yet is read at runtime — is scanned explicitly as `$ops`.
consumer_dirs=$(ls -d "$plugins_root"/*/skills "$plugins_root"/*/agents 2>/dev/null)

# =============================================================================
# Clause 1 — FRAGMENT class (WF-304 / SUB-3; scope broadened to plugins/** by SUB-7)
# =============================================================================
#
# --- What it proves ---
# A fragment body — a phase-fragment dispatched at a phase fire, a `delivery`/
# `tracker` provider fragment resolved on demand, a fragment carried on a
# run-scoped forwarded record, or a subagent's self-boot read of its OWN bundled
# fragment (e.g. the wf-audit lens agents reading their finding-contract + rubric
# fragments) — is served by `resolve_content` (class `fragment`), NEVER by a raw
# `Read`/`Glob` of the version-pinned plugin-cache path. Zero surviving raw-read
# instructions = pass.
#
# --- Scope (path) ---
# Scanned:  every plugin's skills/<name>/**.md (SKILL.md + references) and
#           agents/*.md across the whole marketplace (core wf PLUS every pack —
#           the pack fragment consumers include the wf-audit lens/retrospective
#           agents' self-boot fragment reads, WF-303 inventory §4.1(c)) — PLUS the
#           one central procedure doc invocation-runtime.ops.md (where the
#           fragment-dispatch step is defined).
# NOT scanned (path-scoped out, not a content carve-out):
#   - skills/_contracts/ — the `*.contract.md` reference halves (never read at
#     boot), capability-registry/pack-onboarding ops (the CONTRACT-OPS class,
#     clause 3), the registry validator, the registry-fixtures, and this script.
#   - capability fragment BODIES (capabilities/*/fragments/*.md) — read targets,
#     served through the resolver, not consumer instructions (they live outside
#     `skills/` and `agents/`).
#
# --- The single content allowance (not a carve-out) ---
# The compliant form: a line that obtains the fragment body through the resolver
# content surface names `resolve_content`. Such lines still legitimately mention a
# fragment path or the `fragmentPath` record field (as the RESOLVED locator / record
# data), so the raw-read match below excludes any line that also names
# `resolve_content`. A raw fragment read with NO `resolve_content` on the line is a
# residual and fails. There is no path-fallback exemption.

# Raw-read-of-a-fragment-body shapes (the instruction the sweep removed):
#   1. "follow[ing] ... `fragmentPath`" — the provider/phase dispatch read.
#   2. "read the fragment at ..." — the per-fragment inline dispatch read.
#   3. Read `<path>/<rel-path>` — the ops step-4 placeholder read.
#   4. an explicit Read/Glob of a fragment .md file (fragments/*.md, or a resolved
#      delivery.ops.md / tracker.ops.md provider fragment).
frag_pat='\bfollow(?:ing|s)?\b[^\n]{0,40}\bfragmentPath\b'
frag_pat="$frag_pat"'|\bread the fragment at\b'
frag_pat="$frag_pat"'|\bRead\b\s+`?<path>/<rel-path>'
frag_pat="$frag_pat"'|\b(?:Read|Glob)\b[^\n]{0,80}(?:fragments/[A-Za-z0-9._-]+\.md|delivery\.ops\.md|tracker\.ops\.md)'

frag_raw=$(grep -rPno --include='*.md' --exclude-dir='_contracts' "$frag_pat" $consumer_dirs "$ops")
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
  echo "OUT-2 (fragment): PASS — every fragment-body read across core + packs + invocation-runtime ops routes through resolve_content; zero raw reads."
fi

# =============================================================================
# Clause 2 — SHARED class (WF-305 / SUB-4; scope broadened to plugins/** by SUB-7)
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
# Scanned:  every plugin's skills/<name>/**.md and agents/*.md across the whole
#           marketplace — same composite scope as the fragment clause above (the
#           `_shared/` consumers are all in core today, but the clause scans every
#           pack so a pack that later references the shared doc cannot slip a raw
#           read past the gate).
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

shared_raw=$(grep -rPno --include='*.md' --exclude-dir='_contracts' "$shared_pat" $consumer_dirs)
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
  echo "OUT-2 (shared): PASS — every shared-doc read across core + packs routes through resolve_content; zero raw reads."
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

contract_raw=$(grep -rPno --include='*.md' --exclude-dir='_contracts' "$contract_pat" $consumer_dirs)
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

# =============================================================================
# Clause 4 — REFERENCES class (WF-307 / SUB-6)
# =============================================================================
#
# --- What it proves ---
# A skill `references/*` template read on that skill's own write/execution path
# (spec/plan/verify/triage/lite/constitution/init/classify templates; the
# qa-gen/qa-run/qa-auto/qa-followup shared report-format.md; the wf-browser-qa
# qa-engine preconditions/output-format/visual-verification templates; the
# wf-angular qa-host/test-page scaffold/backend-host/page-test/harness/
# component-injection/bootstrap templates) is obtained via `resolve_content`
# (class `references-template`), NEVER by a raw `Read`/`Glob`, a markdown link,
# or a backtick literal path into the version-pinned plugin-cache `references/`
# folder. Zero surviving raw-read instructions = pass.
#
# --- Scope (path) ---
# Scanned: every plugin's `SKILL.md` files and `agents/*.md` files (core + every
# pack) — the consumer prose that instructs a template read.
# NOT scanned (path-scoped out, not a content carve-out):
#   - `references/*.md` bodies themselves (the read TARGETS) — a target may
#     legitimately name its own path in a rationale/provenance note (e.g. a
#     cross-plugin mirror's "source of truth is `<path>`" comment); that is
#     documentation about the file, not a consumer instruction, so `SKILL.md` /
#     `agents/*.md` is the exhaustive consumer surface for this clause.
#   - `capabilities/*/references/onboarding.md` mentions in `manifest.md` — the
#     ops/reference split's non-runtime reference halves (C011 §6 exclusion,
#     already excluded from the WF-303 inventory's references class).
#   - README.md catalogue entries (documentation, not a runtime consumer).
#
# --- The single content allowance (not a carve-out) ---
# The compliant form names `resolve_content` (`class: references-template`,
# `skill: <name>`, optional `plugin: <pack>`, `ref: <file>.md`) — so the
# raw-read match below excludes any line that also names `resolve_content`. A
# BARE-filename citation (`` `rubric.md` `` with no path separator) is a
# documentation pointer whose runtime behaviour is already served, not a raw
# read, and is left untouched: every shape below requires a `references/`
# path segment, so a bare filename never matches. A raw `references/*` PATH
# with NO `resolve_content` on the line is a residual and fails. No
# path-fallback exemption.

# Raw-read-of-a-references-template shapes (the instruction SUB-6 removed):
#   1. a markdown link into a path containing `references/<file>.md` —
#      `[...](references/<file>.md)` or `[...](../<skill>/references/<file>.md)`,
#      including an anchored form `references/<file>.md#<anchor>`.
#   2. a backtick literal PATH containing `references/<file>.md` — including a
#      version-pinned `${CLAUDE_PLUGIN_ROOT}/skills/<skill>/references/<file>.md`
#      or a relative `../<skill>/references/<file>.md`.
#   3. an explicit Read/Glob of a `references/*.md` doc.
refs_pat='\]\([^)\n]*references/[A-Za-z0-9._-]+\.md[^)\n]*\)'
refs_pat="$refs_pat"'|`[^`\n]*references/[A-Za-z0-9._-]+\.md[^`\n]*`'
refs_pat="$refs_pat"'|\b(?:Read|Glob)\b[^\n]{0,80}references/[A-Za-z0-9._-]+\.md'

# Scan every plugin's SKILL.md and agents/*.md (core + packs); references/*.md
# target bodies themselves are excluded (see "Scope" above). Two separate
# `grep -r` calls (not `find | xargs`, whose exit code conflates "no matches"
# with a real grep failure) — concatenate their output.
refs_raw_skill=$(grep -rPno --include='SKILL.md' "$refs_pat" "$plugins_root")
rc1=$?
refs_raw_agents=$(grep -rPno --include='*.md' "$refs_pat" "$plugins_root"/*/agents 2>/dev/null)
rc2=$?
# rc 0 = matches found, rc 1 = no matches (fine), rc >=2 = a real grep error.
if [ "$rc1" -ge 2 ] || [ "$rc2" -ge 2 ]; then
  echo "OUT-2 (references): ERROR — grep failed (rc1=$rc1 rc2=$rc2). This check requires PCRE grep (grep -P), which may be unavailable on this platform."
  exit 2
fi
refs_raw=$(printf '%s\n%s\n' "$refs_raw_skill" "$refs_raw_agents")

refs_hits=$(printf '%s\n' "$refs_raw" | grep -v 'resolve_content' | grep -v '^$')

if [ -n "$refs_hits" ]; then
  echo "OUT-2 (references): FAIL — raw-read instructions for a references-template doc (route them through resolve_content, class: references-template):"
  echo "$refs_hits"
  overall_fail=1
else
  echo "OUT-2 (references): PASS — every references-template read across core + packs routes through resolve_content; zero raw reads."
fi

# =============================================================================
# Clause 5 — PROFILE class (WF-308 / SUB-7)
# =============================================================================
#
# --- What it proves ---
# A pack's `profile.template.json` BODY read at init to seed a downstream override
# `_local/profiles/<cap>.profile.json` on divergence (wf-audit/skills/init Phase 3,
# wf-angular/skills/init Phase 3 — WF-303 inventory §4.5) is obtained through
# `resolve_content` (class `profile-template`, keyed on the `capability`), NEVER by
# a raw `Read`/`Glob` or a version-pinned plugin-cache PATH the init skill would
# open. Zero surviving raw-path read instructions = pass.
#
# (C008's `resolve_profile` serves override-merged profile VALUES; this ref serves
# the TEMPLATE BODY needed at seed time to detect divergence — a different thing.)
#
# --- Scope (path) ---
# Scanned:  every plugin's `skills/` and `agents/` consumer prose across the whole
#           marketplace — the profile consumers are the pack init skills.
# NOT scanned (path-scoped out, not a content carve-out):
#   - skills/_contracts/ (reference halves, the seeding-convention contract text).
#   - capabilities/*/profile.template.json BODIES themselves (read TARGETS) and the
#     `manifest.md` `profile-template:` metadata key — outside `skills/`/`agents/`.
#
# --- The single content allowance (not a carve-out) ---
# The compliant form names `resolve_content` (`class: profile-template`,
# `capability: <name>`) — so the raw-read match below excludes any line that also
# names `resolve_content`. A BARE-filename citation (the manifest-key mention
# `` `profile-template: profile.template.json` `` with NO path separator) is a
# documentation pointer, not a raw read, and is left untouched: the shapes below
# require a PATH separator (or an explicit Read/Glob), so a bare filename is never
# a hit. A raw `profile.template.json` PATH with NO `resolve_content` on the line
# is a residual and fails. No path-fallback exemption.

# Raw-read-of-a-profile-template shapes (the instruction SUB-7 removed):
#   1. a markdown link into a path ending in profile.template.json —
#      `](…/profile.template.json)`.
#   2. a backtick literal PATH ending in profile.template.json — `` `…/profile.template.json` ``
#      (a leading path segment before the filename; a bare `` `profile.template.json` ``
#      has no `/` and is NOT matched).
#   3. an explicit Read/Glob of a profile.template.json file.
profile_pat='\]\([^)\n]*/profile\.template\.json[^)\n]*\)'
profile_pat="$profile_pat"'|`[^`\n]*/profile\.template\.json`'
profile_pat="$profile_pat"'|\b(?:Read|Glob)\b[^\n]{0,80}profile\.template\.json'

profile_raw=$(grep -rPno --include='*.md' --exclude-dir='_contracts' "$profile_pat" $consumer_dirs)
rc=$?
if [ "$rc" -ge 2 ]; then
  echo "OUT-2 (profile): ERROR — grep failed (rc=$rc). This check requires PCRE grep (grep -P), which may be unavailable on this platform."
  exit 2
fi

profile_hits=$(printf '%s\n' "$profile_raw" | grep -v 'resolve_content' | grep -v '^$')

if [ -n "$profile_hits" ]; then
  echo "OUT-2 (profile): FAIL — raw-read instructions for a profile-template body (route them through resolve_content, class: profile-template):"
  echo "$profile_hits"
  overall_fail=1
else
  echo "OUT-2 (profile): PASS — every profile-template-body read across core + packs routes through resolve_content; zero raw reads."
fi

exit "$overall_fail"
