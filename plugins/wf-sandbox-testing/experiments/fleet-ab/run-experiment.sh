#!/usr/bin/env bash
# run-experiment.sh — host-side orchestrator for the fleet-ab A/B experiment.
#
# Wraps README steps 1–4 (build → gate → pilot → analyze) with the freeze vars set ONCE, so
# it's one command per phase instead of copy-pasting long `docker run` invocations. Runs on
# YOUR Docker host — it drives `docker run`, it is not the in-container script (that's run-arm.sh).
#
# SPEND SAFETY (non-negotiable, spec Boundaries "ask first"): the billed `pilot` phase NEVER runs
# without BOTH --spend AND an interactive "RUN" confirmation (or --force for a vetted unattended
# run). No phase given defaults to the cheap `gate` only. --dry-run prints every command without
# running anything.
#
# Authored + bash -n checked only in the WF-382 implement session (no Docker host here). Prove the
# path with `gate` before you ever pass `pilot`.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESULTS_DIR="$SCRIPT_DIR/results"

DEFAULT_WF_REF_A="90cf319"          # arm A — the $114.55 baseline's version identity
DEFAULT_CLI_VERSION="2.1.218"
DEFAULT_UMBRELLA="WF-405"
DEFAULT_GATE_SKILL="/wf:triage WF-406"
DEFAULT_GAP=330                     # >5 min between the two billed runs (prompt-cache TTL)
DEFAULT_FAKE="fake-scripts.json"

usage() {
  cat >&2 <<'EOF'
usage: run-experiment.sh [PHASE ...] --workload-ref <W> [options]

PHASES (run in canonical order build→gate→pilot→analyze regardless of arg order):
  build     build both arm images        (needs --wf-ref-b)
  gate      cheap dry-run gate per arm    (validates the seed+container path; needs images)
  pilot     the BILLED measured run/arm   (needs --spend + confirm; coin-flipped, gap apart)
  analyze   offline analysis + verdict    (needs results/run-A and run-B)
  all       = build gate pilot analyze
  (no phase given → 'gate' only)

OPTIONS:
  --workload-ref <W>     pinned workload ref (required for gate/pilot; must predate docs/wf382-*)
  --wf-ref-a <sha>       arm A ref            (default: 90cf319)
  --wf-ref-b <sha>       arm B ref            (required for build; a frozen sha, never bare "main")
  --cli-version <ver>    pinned CLI           (default: 2.1.218)
  --umbrella-id <id>     measured umbrella    (default: WF-405)
  --gate-skill <skill>   cheap gate skill     (default: "/wf:triage WF-406")
  --fake-scripts <name>  scripts file         (default: fake-scripts.json, image-baked)
  --packs "<a b c>"      packs to install+init (default: run-arm.sh's "wf wf-audit wf-fake";
                         each is installed AND its /<pack>:init self-registers its capability —
                         wf-fake is what supplies the delivery+tracker provider /wf:fleet needs)
  --gap-seconds <n>      inter-arm wait        (default: 330)
  --spend                acknowledge the pilot is a real billed run (~$85–115/arm)
  --force                skip the interactive confirm (vetted unattended spend; implies intent)
  --dry-run              print every command, run nothing
EOF
}

log() { echo "run-experiment.sh: $*" >&2; }
die() { echo "run-experiment.sh: ERROR — $*" >&2; exit 1; }

WORKLOAD_REF="" WF_REF_A="$DEFAULT_WF_REF_A" WF_REF_B="" CLI_VERSION="$DEFAULT_CLI_VERSION"
UMBRELLA="$DEFAULT_UMBRELLA" GATE_SKILL="$DEFAULT_GATE_SKILL" FAKE="$DEFAULT_FAKE"
GAP="$DEFAULT_GAP" SPEND=0 FORCE=0 DRY_RUN=0 PACKS=""
PHASES=()

while [ $# -gt 0 ]; do
  case "$1" in
    build|gate|pilot|analyze) PHASES+=("$1"); shift;;
    all) PHASES+=(build gate pilot analyze); shift;;
    --workload-ref) WORKLOAD_REF="${2:?}"; shift 2;;
    --workload-ref=*) WORKLOAD_REF="${1#*=}"; shift;;
    --wf-ref-a) WF_REF_A="${2:?}"; shift 2;;
    --wf-ref-a=*) WF_REF_A="${1#*=}"; shift;;
    --wf-ref-b) WF_REF_B="${2:?}"; shift 2;;
    --wf-ref-b=*) WF_REF_B="${1#*=}"; shift;;
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
    --spend) SPEND=1; shift;;
    --force) FORCE=1; shift;;
    --dry-run) DRY_RUN=1; shift;;
    -h|--help) usage; exit 0;;
    *) echo "run-experiment.sh: unknown argument '$1'" >&2; usage; exit 2;;
  esac
done

[ "${#PHASES[@]}" -gt 0 ] || PHASES=(gate)

want() { local p; for p in ${PHASES+"${PHASES[@]}"}; do [ "$p" = "$1" ] && return 0; done; return 1; }

# --- fail-fast validation before doing any work -----------------------------------------------
if want pilot && [ "$SPEND" != 1 ]; then
  die "the 'pilot' phase is a real billed run (~\$85–115/arm). Pass --spend once you've okayed the cost AND a 'gate' run is green."
fi
if want build && [ -z "$WF_REF_B" ]; then
  die "'build' needs --wf-ref-b <frozen main-tip sha> (arm A defaults to $WF_REF_A)."
fi
if { want gate || want pilot; } && [ -z "$WORKLOAD_REF" ]; then
  die "'gate'/'pilot' need --workload-ref <W> (the pinned workload snapshot; must predate docs/wf382-* and experiments/)."
fi

check_prereqs() {
  [ "$DRY_RUN" = 1 ] && return 0
  command -v docker >/dev/null 2>&1 || die "docker not found on PATH."
  if want gate || want pilot; then
    [ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ] || die "CLAUDE_CODE_OAUTH_TOKEN not set — mint it with 'claude setup-token' and export it."
    [ -z "${ANTHROPIC_API_KEY:-}" ] || log "WARNING: ANTHROPIC_API_KEY is set — the container auth-guard refuses to start unless you pass API billing explicitly. Unset it for a Max-subscription run."
  fi
  # The analyze phase runs host-side Node (analyze.sh drives node), so surface a missing Node up
  # front rather than as a late, less actionable failure inside analyze.sh.
  if want analyze; then
    command -v node >/dev/null 2>&1 || die "node not found on PATH — the 'analyze' phase runs analyze.sh, which needs Node."
  fi
}

require_image() {
  local arm="$1"
  [ "$DRY_RUN" = 1 ] && return 0
  docker image inspect "fleet-ab:arm$arm" >/dev/null 2>&1 \
    || die "image fleet-ab:arm$arm not found — build first: $(basename "$0") build --wf-ref-b <sha>"
}

coin_order() { if [ $((RANDOM % 2)) -eq 0 ]; then echo "A B"; else echo "B A"; fi; }

# run_docker <arm> <out-subdir> <extra run-arm.sh args...>
run_docker() {
  local arm="$1" outsub="$2"; shift 2
  local out="$RESULTS_DIR/$outsub"
  local -a cmd=(docker run --rm -e CLAUDE_CODE_OAUTH_TOKEN
    -v "$out:/work/run-output" "fleet-ab:arm${arm}" --measured-fleet --arm "$arm"
    --workload-ref "$WORKLOAD_REF" --fake-scripts "$FAKE")
  [ -n "$PACKS" ] && cmd+=(--packs "$PACKS")
  cmd+=("$@")
  if [ "$DRY_RUN" = 1 ]; then printf '    '; printf '%q ' "${cmd[@]}"; printf '\n'; return 0; fi
  mkdir -p "$out"
  "${cmd[@]}"
}

confirm_spend() {
  [ "$FORCE" = 1 ] && { log "--force given — skipping the interactive confirm."; return 0; }
  [ "$DRY_RUN" = 1 ] && return 0
  [ -t 0 ] || die "refusing to spend non-interactively without --force (no TTY to confirm on)."
  local reply
  printf 'run-experiment.sh: about to spend the BILLED pilot on both arms (~$85–115 each, umbrella %s). Type RUN to proceed: ' "$UMBRELLA" >&2
  read -r reply
  [ "$reply" = "RUN" ] || die "aborted — not spending."
}

do_build() {
  log "BUILD both arms (A=$WF_REF_A, B=$WF_REF_B, CLI=$CLI_VERSION)"
  if [ "$DRY_RUN" = 1 ]; then
    printf '    '; printf '%q ' bash "$SCRIPT_DIR/build-arm.sh" --both --wf-ref-a "$WF_REF_A" --wf-ref-b "$WF_REF_B" --cli-version "$CLI_VERSION"; printf '\n'; return 0
  fi
  # No `set -e` in this script, and require_image only checks image EXISTENCE (a failed rebuild can
  # leave a stale image that slips through) — so a build failure must be fatal here, or gate/pilot
  # would run against missing/stale images. do_gate/do_pilot already `|| die` for the same reason.
  bash "$SCRIPT_DIR/build-arm.sh" --both --wf-ref-a "$WF_REF_A" --wf-ref-b "$WF_REF_B" --cli-version "$CLI_VERSION" \
    || die "build-arm.sh failed — refusing to continue to gate/pilot with missing or stale images. Fix the build first."
}

do_gate() {
  local arm
  for arm in $(coin_order); do
    log "GATE arm $arm (skill '$GATE_SKILL') → results/gate-$arm"
    require_image "$arm"
    run_docker "$arm" "gate-$arm" --gate-skill "$GATE_SKILL" \
      || die "dry-run gate arm $arm failed — fix the seeding/registration issue before spending (README §2). A failed gate is infrastructure, never charged against the pilot."
  done
  log "gates complete — eyeball fake-scripts.json call-ordering (its header), then run 'pilot --spend'."
}

do_pilot() {
  confirm_spend
  local order; order="$(coin_order)"
  log "PILOT — coin-flipped arm order: $order (${GAP}s gap between arms)"
  local first=1 arm
  for arm in $order; do
    if [ "$first" != 1 ]; then
      log "waiting ${GAP}s before the second arm (prompt-cache TTL)…"
      [ "$DRY_RUN" = 1 ] || sleep "$GAP"
    fi
    first=0
    log "PILOT arm $arm (umbrella $UMBRELLA) → results/run-$arm"
    require_image "$arm"
    run_docker "$arm" "run-$arm" --umbrella-id "$UMBRELLA" \
      || die "pilot arm $arm did not exit clean — an INFRA failure (container death/auth/fake gap) is discarded + re-run; an expensive-but-completed run is DATA, never discarded (README §5). Inspect results/run-$arm/run.json."
  done
  log "pilot complete — COMMIT results/run-*/projects-archive.tar.gz (the baseline died of pruned transcripts)."
}

do_analyze() {
  [ "$DRY_RUN" = 1 ] || { [ -f "$RESULTS_DIR/run-A/run.json" ] && [ -f "$RESULTS_DIR/run-B/run.json" ]; } \
    || die "analyze needs results/run-A/run.json and results/run-B/run.json — run the pilot first."
  log "ANALYZE — offline, host-side, free"
  if [ "$DRY_RUN" = 1 ]; then
    printf '    '; printf '%q ' bash "$SCRIPT_DIR/analyze.sh" --run-a "$RESULTS_DIR/run-A" --run-b "$RESULTS_DIR/run-B"; printf '\n'; return 0
  fi
  # Fail-fast (no `set -e`): a failed analyze.sh must not fall through to the "now fill the verdict"
  # log and the final "done", which would read as a clean analysis over partial/missing outputs.
  bash "$SCRIPT_DIR/analyze.sh" --run-a "$RESULTS_DIR/run-A" --run-b "$RESULTS_DIR/run-B" \
    || die "analyze.sh failed — see its output; the analysis outputs are incomplete, do not fill the verdict yet."
  log "now fill $SCRIPT_DIR/results/verdict-template.md — resolve its §0 incomparability gate FIRST."
}

check_prereqs
[ "$DRY_RUN" = 1 ] && log "DRY RUN — printing commands only, nothing executes."

# Canonical order, only the requested phases.
want build   && do_build
want gate    && do_gate
want pilot   && do_pilot
want analyze && do_analyze

log "done — phases: ${PHASES[*]}"
