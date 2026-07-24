#!/usr/bin/env bash
# run-experiment.sh — the generic, experiment-agnostic host-side orchestrator.
#
# Drives one manifest's phases (build → gate → pilot → analyze) with the experiment's constants set
# ONCE from its manifest, so it is one command per phase instead of copy-pasting long `docker run`
# invocations. Runs on YOUR Docker host — it drives `docker run`, it is not the in-container script
# (that is this folder's run-arm.sh).
#
# Every structural fact — how many arms, what they are called, which image repository, which output
# directories, which constants — comes from the manifest named by --manifest. This file contains no
# arm label, image tag, output directory, umbrella id, or mechanism literal of its own.
#
# SPEND SAFETY (non-negotiable): the billed `pilot` phase NEVER runs without BOTH --spend AND an
# interactive "RUN" confirmation (or --force for a vetted unattended run). No phase given defaults
# to the cheap `gate` only. --dry-run prints every command without running anything.
set -uo pipefail

ENGINE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=manifest.sh
. "$ENGINE_DIR/manifest.sh"

usage() {
  cat >&2 <<'EOF'
usage: run-experiment.sh --manifest <experiment.json> [PHASE ...] [options]

PHASES (run in canonical order build→gate→pilot→analyze regardless of arg order):
  build     build every declared arm image
  gate      cheap dry-run gate per arm    (validates the seed+container path; needs images)
  pilot     the BILLED measured run/arm   (needs --spend + confirm; shuffled, gap apart)
  analyze   offline analysis + verdict    (needs every arm's measured run)
  all       = build gate pilot analyze
  (no phase given -> 'gate' only)

OPTIONS:
  --manifest <path>      the experiment manifest (REQUIRED; see ../engine/schema.md)
  --workload-ref <W>     override the manifest's workload ref
  --wf-ref-<label> <sha> override one declared arm's ref (e.g. --wf-ref-a, --wf-ref-b)
  --cli-version <ver>    override the manifest's pinned CLI
  --umbrella-id <id>     override the manifest's measured umbrella
  --gate-skill <skill>   override the manifest's cheap gate skill
  --fake-scripts <name>  override the manifest's scripts file
  --packs "<a b c>"      override the manifest's packs (empty = the flag stays ABSENT)
  --gap-seconds <n>      override the manifest's inter-arm wait
  --runbook [<path>]     derive the ordered per-arm runbook document and exit; builds nothing,
                         runs nothing, spends nothing
  --spend                acknowledge the pilot is a real billed run
  --force                skip the interactive confirm (vetted unattended spend; implies intent)
  --dry-run              print every command, run nothing
EOF
}

log() { echo "run-experiment.sh: $*" >&2; }
die() { echo "run-experiment.sh: ERROR — $*" >&2; exit 1; }

# --- manifest first: every default below comes from it -------------------------------------------
MANIFEST_ARG=""
_scan=("$@")
_i=0
while [ "$_i" -lt "${#_scan[@]}" ]; do
  case "${_scan[$_i]}" in
    --manifest) _i=$((_i + 1)); MANIFEST_ARG="${_scan[$_i]:-}";;
    --manifest=*) MANIFEST_ARG="${_scan[$_i]#*=}";;
    -h|--help) usage; exit 0;;
  esac
  _i=$((_i + 1))
done
[ -n "$MANIFEST_ARG" ] || { echo "run-experiment.sh: ERROR — --manifest <experiment.json> is required" >&2; usage; exit 2; }
manifest_load "$MANIFEST_ARG" || exit 2

WORKLOAD_REF="$CONST_WORKLOAD_REF" CLI_VERSION="$CONST_CLI_VERSION"
UMBRELLA="$CONST_UMBRELLA_ID" GATE_SKILL="$CONST_GATE_SKILL" FAKE="$CONST_FAKE_SCRIPTS"
PACKS="$CONST_PACKS" GAP="$CONST_GAP_SECONDS"
SPEND=0 FORCE=0 DRY_RUN=0 RUNBOOK=0 RUNBOOK_OUT="" _flag=""
PHASES=()

# set_arm_ref <label-or-lowercased-label> <sha> — override one declared arm's ref.
set_arm_ref() {
  local want="${1,,}" val="$2" i
  for i in "${!ARM_LABELS[@]}"; do
    if [ "${ARM_LABELS[$i],,}" = "$want" ]; then ARM_REFS[$i]="$val"; return 0; fi
  done
  die "--wf-ref-$1 names an arm this manifest does not declare (declared: ${ARM_LABELS[*]})"
}

while [ $# -gt 0 ]; do
  case "$1" in
    build|gate|pilot|analyze) PHASES+=("$1"); shift;;
    all) PHASES+=(build gate pilot analyze); shift;;
    --manifest) shift 2;;
    --manifest=*) shift;;
    --workload-ref) WORKLOAD_REF="${2:?}"; shift 2;;
    --workload-ref=*) WORKLOAD_REF="${1#*=}"; shift;;
    --cli-version) CLI_VERSION="${2:?}"; shift 2;;
    --cli-version=*) CLI_VERSION="${1#*=}"; shift;;
    --umbrella-id) UMBRELLA="${2:?}"; shift 2;;
    --umbrella-id=*) UMBRELLA="${1#*=}"; shift;;
    --gate-skill) GATE_SKILL="${2:?}"; shift 2;;
    --gate-skill=*) GATE_SKILL="${1#*=}"; shift;;
    --fake-scripts) FAKE="${2:?}"; shift 2;;
    --fake-scripts=*) FAKE="${1#*=}"; shift;;
    --packs) PACKS="${2:?}"; shift 2;;
    --packs=*) PACKS="${1#*=}"; shift;;
    --gap-seconds) GAP="${2:?}"; shift 2;;
    --gap-seconds=*) GAP="${1#*=}"; shift;;
    --wf-ref-*=*) _flag="${1%%=*}"; set_arm_ref "${_flag#--wf-ref-}" "${1#*=}"; shift;;
    --wf-ref-*) set_arm_ref "${1#--wf-ref-}" "${2:?}"; shift 2;;
    --runbook) RUNBOOK=1; shift
               if [ $# -gt 0 ] && [ "${1#-}" = "$1" ]; then RUNBOOK_OUT="$1"; shift; fi;;
    --runbook=*) RUNBOOK=1; RUNBOOK_OUT="${1#*=}"; shift;;
    --spend) SPEND=1; shift;;
    --force) FORCE=1; shift;;
    --dry-run) DRY_RUN=1; shift;;
    -h|--help) usage; exit 0;;
    *) echo "run-experiment.sh: unknown argument '$1'" >&2; usage; exit 2;;
  esac
done

[ "${#PHASES[@]}" -gt 0 ] || PHASES=(gate)

want() { local p; for p in ${PHASES+"${PHASES[@]}"}; do [ "$p" = "$1" ] && return 0; done; return 1; }

# --- fail-fast validation before doing any work -------------------------------------------------
if want pilot && [ "$SPEND" != 1 ] && [ "$RUNBOOK" != 1 ]; then
  die "the 'pilot' phase is a real billed run. Pass --spend once you have okayed the cost AND a 'gate' run is green."
fi

check_prereqs() {
  [ "$DRY_RUN" = 1 ] && return 0
  command -v docker >/dev/null 2>&1 || die "docker not found on PATH."
  if want gate || want pilot; then
    [ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ] || die "CLAUDE_CODE_OAUTH_TOKEN not set — mint it with 'claude setup-token' and export it."
    [ -z "${ANTHROPIC_API_KEY:-}" ] || log "WARNING: ANTHROPIC_API_KEY is set — the container auth-guard refuses to start unless you pass API billing explicitly. Unset it for a subscription run."
  fi
  # The analyze phase runs host-side Node, so surface a missing Node up front rather than as a
  # late, less actionable failure inside analyze.sh.
  if want analyze; then
    command -v node >/dev/null 2>&1 || die "node not found on PATH — the 'analyze' phase runs analyze.sh, which needs Node."
  fi
}

require_image() {
  local arm="$1" tag
  [ "$DRY_RUN" = 1 ] && return 0
  tag="$(manifest_image_tag "$arm")"
  docker image inspect "$tag" >/dev/null 2>&1 \
    || die "image $tag not found — build first: $(basename "$0") --manifest $MANIFEST_PATH build"
}

# shuffle_arms — a uniform shuffle over every declared arm (the N-arm generalization of the
# two-arm coin flip). Order between independently emitted lines is a protocol requirement.
shuffle_arms() {
  local -a pool out=()
  pool=("${ARM_LABELS[@]}")
  local n=${#pool[@]} i
  while [ "$n" -gt 0 ]; do
    i=$((RANDOM % n))
    out+=("${pool[$i]}")
    pool[$i]="${pool[$((n - 1))]}"
    pool=("${pool[@]:0:$((n - 1))}")
    n=$((n - 1))
  done
  echo "${out[*]}"
}

# --- command composition ------------------------------------------------------------------------
# Every emitted command is composed here and nowhere else, so the dry-run surface, the runbook, and
# the real execution can never drift from one another.

CMD=()

# manifest_is_default — 0 when the loaded manifest is the kit's own `experiment.json`.
#
# That file is what every consuming surface (the kit's build/analyze shims, and the container via
# the image-baked experiment dir) already resolves with no selector at all. So the manifest
# selector below is forwarded ONLY for a non-default manifest: a kit's manifest of record keeps a
# command surface byte-identical to its pre-engine baseline, while any sibling manifest —
# a rung-added variant, a second experiment in the same folder — actually reaches its consumers.
manifest_is_default() { [ "$MANIFEST_PATH" = "$KIT_DIR/experiment.json" ]; }

compose_build_cmd() {
  CMD=(bash "$KIT_DIR/build-arm.sh" --both)
  local i
  for i in "${!ARM_LABELS[@]}"; do
    CMD+=("$(manifest_arm_ref_flag "${ARM_LABELS[$i]}")" "${ARM_REFS[$i]}")
  done
  CMD+=(--cli-version "$CLI_VERSION")
  # Appended LAST so it wins: build.sh's pre-scan takes the final --manifest, overriding the
  # default the kit shim pins ahead of these arguments.
  manifest_is_default || CMD+=(--manifest "$MANIFEST_PATH")
}

# compose_docker_cmd <arm> <out-subdir> <extra run-arm.sh args...>
compose_docker_cmd() {
  local arm="$1" outsub="$2"; shift 2
  local out="$RESULTS_DIR/$outsub"
  CMD=(docker run --rm -e CLAUDE_CODE_OAUTH_TOKEN)
  # The manifest selector crosses into the container as a BARE NAME, resolved in-container against
  # the image's baked experiment dir (run-arm.sh). A host path would be meaningless there, and this
  # keeps the host from having to know the in-container layout.
  manifest_is_default || CMD+=(-e "WF_EXPERIMENT_MANIFEST=$(basename "$MANIFEST_PATH")")
  CMD+=(-v "$out:/work/run-output" "$(manifest_image_tag "$arm")" --measured-fleet --arm "$arm"
    --workload-ref "$WORKLOAD_REF" --fake-scripts "$FAKE")
  # Appended ONLY when non-empty: a present-but-empty flag is a different command.
  [ -n "$PACKS" ] && CMD+=(--packs "$PACKS")
  CMD+=("$@")
}

compose_analyze_cmd() {
  CMD=(bash "$KIT_DIR/analyze.sh")
  local l
  for l in "${ARM_LABELS[@]}"; do
    CMD+=("$(manifest_run_flag "$l")" "$RESULTS_DIR/run-$l")
  done
  manifest_is_default || CMD+=(--manifest "$MANIFEST_PATH")
}

print_cmd() { printf '    '; printf '%q ' "${CMD[@]}"; printf '\n'; }

run_docker() {
  local arm="$1" outsub="$2"; shift 2
  compose_docker_cmd "$arm" "$outsub" "$@"
  local out="$RESULTS_DIR/$outsub"
  if [ "$DRY_RUN" = 1 ]; then print_cmd; return 0; fi
  mkdir -p "$out"
  "${CMD[@]}"
}

confirm_spend() {
  [ "$FORCE" = 1 ] && { log "--force given — skipping the interactive confirm."; return 0; }
  [ "$DRY_RUN" = 1 ] && return 0
  [ -t 0 ] || die "refusing to spend non-interactively without --force (no TTY to confirm on)."
  local reply
  printf 'run-experiment.sh: about to spend the BILLED pilot on every arm (umbrella %s). Type RUN to proceed: ' "$UMBRELLA" >&2
  read -r reply
  [ "$reply" = "RUN" ] || die "aborted — not spending."
}

do_build() {
  log "BUILD every declared arm (CLI=$CLI_VERSION)"
  compose_build_cmd
  if [ "$DRY_RUN" = 1 ]; then print_cmd; return 0; fi
  # No `set -e` in this script, and require_image only checks image EXISTENCE (a failed rebuild can
  # leave a stale image that slips through) — so a build failure must be fatal here, or gate/pilot
  # would run against missing/stale images. do_gate/do_pilot already `|| die` for the same reason.
  "${CMD[@]}" \
    || die "build-arm.sh failed — refusing to continue to gate/pilot with missing or stale images. Fix the build first."
}

do_gate() {
  local arm
  for arm in $(shuffle_arms); do
    log "GATE arm $arm (skill '$GATE_SKILL') → results/gate-$arm"
    require_image "$arm"
    run_docker "$arm" "gate-$arm" --gate-skill "$GATE_SKILL" \
      || die "dry-run gate arm $arm failed — fix the seeding/registration issue before spending. A failed gate is infrastructure, never charged against the pilot."
  done
  log "gates complete — review the scripted call ordering, then run 'pilot --spend'."
}

do_pilot() {
  confirm_spend
  local order; order="$(shuffle_arms)"
  log "PILOT — shuffled arm order: $order (${GAP}s gap between arms)"
  local first=1 arm
  for arm in $order; do
    if [ "$first" != 1 ]; then
      log "waiting ${GAP}s before the next arm (prompt-cache TTL)…"
      [ "$DRY_RUN" = 1 ] || sleep "$GAP"
    fi
    first=0
    log "PILOT arm $arm (umbrella $UMBRELLA) → results/run-$arm"
    require_image "$arm"
    run_docker "$arm" "run-$arm" --umbrella-id "$UMBRELLA" \
      || die "pilot arm $arm did not exit clean — an INFRA failure (container death/auth/fake gap) is discarded + re-run; an expensive-but-completed run is DATA, never discarded. Inspect results/run-$arm/run.json."
  done
  log "pilot complete — COMMIT results/run-*/projects-archive.tar.gz."
}

do_analyze() {
  if [ "$DRY_RUN" != 1 ]; then
    local l v
    for l in "${ARM_LABELS[@]}"; do
      [ -f "$RESULTS_DIR/run-$l/run.json" ] \
        || die "analyze needs results/run-$l/run.json for every declared arm — run the pilot first."
      # Presence is not sufficiency: a quota-exhausted or errored arm still writes run.json, and
      # analyze.sh reads only the session id, so a truncated arm would be reported as a clean
      # dollar delta. Gate on each arm's own recorded verdict instead.
      v="$(node -e 'const d=require("node:fs").readFileSync(process.argv[1],"utf8");process.stdout.write(String(JSON.parse(d).verdict??""))' "$RESULTS_DIR/run-$l/run.json" 2>/dev/null || true)"
      [ "$v" = "ok" ] \
        || die "arm $l's run.json records verdict '${v:-<unreadable>}', not 'ok' — refusing to report a dollar delta over an incomplete arm. Re-run that arm (an INFRA failure is discarded and re-run; an expensive-but-completed run is DATA)."
    done
  fi
  log "ANALYZE — offline, host-side, free"
  compose_analyze_cmd
  if [ "$DRY_RUN" = 1 ]; then print_cmd; return 0; fi
  # Fail-fast (no `set -e`): a failed analyze.sh must not fall through to the "now fill the verdict"
  # log and the final "done", which would read as a clean analysis over partial/missing outputs.
  "${CMD[@]}" \
    || die "analyze.sh failed — see its output; the analysis outputs are incomplete, do not fill the verdict yet."
  log "now fill $RESULTS_DIR/verdict-template.md — resolve its incomparability gate FIRST."
}

# --- runbook derivation --------------------------------------------------------------------------
# Derived from the SAME compose_* functions the dry run and the real execution use, so a runbook can
# never document a command the engine would not actually issue. Deterministic: arms appear in
# manifest declaration order, never shuffled, so re-deriving reproduces the file byte-for-byte.
# Builds nothing, runs nothing, spends nothing, makes no network call.
#
# The checkout root is emitted as a `$ROOT` shell variable rather than a literal prefix, so a
# committed runbook is byte-identical on every machine (an absolute prefix would bake one clone's
# location into the document) while every path stays absolute at run time — which `docker run -v`
# requires, since a relative source is read as a named volume, not a bind mount.
RUNBOOK_ROOT=""
runbook_block() {
  local line
  printf -v line '%q ' "${CMD[@]}"
  [ -n "$RUNBOOK_ROOT" ] && line="${line//"$RUNBOOK_ROOT/"/\$ROOT/}"
  printf '```sh\n%s\n```\n\n' "$line"
}

derive_runbook() {
  local out="$RUNBOOK_OUT"
  if [ -z "$out" ]; then
    local base; base="$(basename "$MANIFEST_PATH")"
    out="$KIT_DIR/runbooks/${base%.*}.md"
  fi
  mkdir -p "$(dirname "$out")"
  RUNBOOK_ROOT="$(git -C "$KIT_DIR" rev-parse --show-toplevel 2>/dev/null || true)"
  {
    printf '# %s — runbook\n\n' "$MANIFEST_NAME"
    printf '**Derived from:** `%s`\n' "$(basename "$MANIFEST_PATH")"
    printf '**Derived by:** `run-experiment.sh --runbook` (machine-derived — do not hand-edit)\n\n'
    printf 'The ordered command document for this experiment: build, then one gate per arm, then one\n'
    printf 'measured run per arm, then the analysis. Commands are shown in manifest declaration order;\n'
    printf 'at execution time the gate and measured phases shuffle arm order, which is a protocol\n'
    printf 'requirement and does not change any command below.\n\n'
    printf '**Running this is a human decision.** The measured phase is billed. Nothing here has been\n'
    printf 'executed: this document was derived offline, without Docker, without egress, without spend.\n\n'
    if [ -n "$RUNBOOK_ROOT" ]; then
      printf 'Every path below is anchored on `$ROOT`. Set it once, in the shell you run these from:\n\n'
      printf '```sh\nROOT="$(git rev-parse --show-toplevel)"\n```\n\n'
    fi
    printf 'Arms (%s), each identified by its own frozen ref:\n\n' "${#ARM_LABELS[@]}"
    printf '| Arm | `wf_ref` | Image |\n|---|---|---|\n'
    local i
    for i in "${!ARM_LABELS[@]}"; do
      printf '| `%s` | `%s` | `%s` |\n' "${ARM_LABELS[$i]}" "${ARM_REFS[$i]}" "$(manifest_image_tag "${ARM_LABELS[$i]}")"
    done
    printf '\n---\n\n## 1. Build\n\n'
    compose_build_cmd; runbook_block
    printf '## 2. Gate (cheap — prove the seed+container path per arm before any spend)\n\n'
    local l
    for l in "${ARM_LABELS[@]}"; do
      printf '### Arm `%s`\n\n' "$l"
      compose_docker_cmd "$l" "gate-$l" --gate-skill "$GATE_SKILL"; runbook_block
    done
    printf '## 3. Measured run — BILLED, ask first\n\n'
    printf 'One run per arm, order shuffled, at least %s seconds apart, same host, same day.\n\n' "$GAP"
    for l in "${ARM_LABELS[@]}"; do
      printf '### Arm `%s`\n\n' "$l"
      compose_docker_cmd "$l" "run-$l" --umbrella-id "$UMBRELLA"; runbook_block
    done
    printf '## 4. Analyze (offline, host-side, free)\n\n'
    compose_analyze_cmd; runbook_block
    printf '## Declared comparisons\n\n'
    printf '| Base | Against | Reported as |\n|---|---|---|\n'
    for i in "${!COMPARE_BASES[@]}"; do
      printf '| `%s` | `%s` | `%s` minus `%s` |\n' \
        "${COMPARE_BASES[$i]}" "${COMPARE_AGAINSTS[$i]}" "${COMPARE_AGAINSTS[$i]}" "${COMPARE_BASES[$i]}"
    done
  } > "$out"
  log "runbook derived → $out (nothing built, nothing run, nothing spent)"
}

if [ "$RUNBOOK" = 1 ]; then
  derive_runbook
  exit 0
fi

check_prereqs
[ "$DRY_RUN" = 1 ] && log "DRY RUN — printing commands only, nothing executes."

# Canonical order, only the requested phases.
want build   && do_build
want gate    && do_gate
want pilot   && do_pilot
want analyze && do_analyze

log "done — phases: ${PHASES[*]}"
