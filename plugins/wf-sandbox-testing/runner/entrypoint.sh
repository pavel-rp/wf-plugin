#!/usr/bin/env bash
# entrypoint.sh — the auth/billing guard gate for a hermetic skill run.
#
# This is the container ENTRYPOINT. It runs BEFORE any `claude` process can start and
# makes every auth/billing misconfiguration LOUD and non-zero rather than silent:
#
#   - ANTHROPIC_API_KEY present (without the explicit --allow-api-key opt-in) → refuse,
#     so a hermetic run can never silently bill the API instead of the Max subscription.
#   - CLAUDE_CODE_OAUTH_TOKEN absent (without --allow-api-key) → refuse: there is no
#     subscription auth to run under.
#   - --allow-api-key given but ANTHROPIC_API_KEY absent → refuse: the opt-in is empty.
#
# The token is expected ONLY from the runtime environment (a `docker run` secret / --env),
# never a build arg, never an image layer, never a ~/.claude mount. This script neither
# reads nor writes any token file.
#
# Sourcing this file (BASH_SOURCE != $0) defines the guard functions WITHOUT running the
# gate, so selfcheck.sh can exercise each guard against a hostile environment offline.
set -uo pipefail

RUNNER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# guard_api_key <allow_api_key:0|1>
#   Non-zero + loud reason when ANTHROPIC_API_KEY is set and the opt-in was not passed.
guard_api_key() {
  local allow="${1:-0}"
  if [ -n "${ANTHROPIC_API_KEY:-}" ] && [ "$allow" != "1" ]; then
    {
      echo "FATAL [auth-guard]: ANTHROPIC_API_KEY is set in the container environment."
      echo "  A hermetic run must bill the Max subscription via CLAUDE_CODE_OAUTH_TOKEN, never the API."
      echo "  Refusing to start — before any skill runs. Unset ANTHROPIC_API_KEY, or pass"
      echo "  --allow-api-key to opt into API billing explicitly for this run."
    } >&2
    return 3
  fi
  return 0
}

# guard_oauth_token <allow_api_key:0|1>
#   Non-zero + loud reason when the subscription token is missing (and no API opt-in), or
#   when the API opt-in was requested but the API key it needs is absent.
guard_oauth_token() {
  local allow="${1:-0}"
  if [ "$allow" = "1" ]; then
    if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
      {
        echo "FATAL [auth-guard]: --allow-api-key was passed but ANTHROPIC_API_KEY is not set."
        echo "  The explicit API-billing opt-in requires the API key to be present. Refusing to start."
      } >&2
      return 5
    fi
    return 0
  fi
  if [ -z "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]; then
    {
      echo "FATAL [auth-guard]: CLAUDE_CODE_OAUTH_TOKEN is not set."
      echo "  Mint it once on the host with 'claude setup-token' and inject it at container"
      echo "  runtime as a secret (never a build arg, never an image layer). Refusing to start."
    } >&2
    return 4
  fi
  return 0
}

main() {
  local allow_api_key=0
  local on_quota="fail"
  local -a forward=()

  while [ $# -gt 0 ]; do
    case "$1" in
      --allow-api-key) allow_api_key=1; shift;;
      --on-quota)      on_quota="${2:?--on-quota needs a value: fail|wait}"; shift 2;;
      --on-quota=*)    on_quota="${1#*=}"; shift;;
      *)               forward+=("$1"); shift;;
    esac
  done

  case "$on_quota" in
    fail|wait) ;;
    *) echo "FATAL [config]: --on-quota must be fail|wait (got '$on_quota')." >&2; exit 2;;
  esac

  # Dispatch mode: --measured-fleet clones a workload snapshot (needs egress to the workload
  # host) BEFORE the measured run, so run-arm.sh applies no-egress AFTER its seed — never here.
  # The single-skill path (run-skill.sh, canned suites, the dry-run gate) clones nothing, so
  # no-egress is applied up front as before.
  local measured_fleet=0 a
  for a in ${forward+"${forward[@]}"}; do
    [ "$a" = "--measured-fleet" ] && { measured_fleet=1; break; }
  done

  guard_api_key "$allow_api_key"    || exit $?
  guard_oauth_token "$allow_api_key" || exit $?

  local -a runner_args=(--on-quota "$on_quota")
  [ "$allow_api_key" = "1" ] && runner_args+=(--allow-api-key)
  runner_args+=(${forward+"${forward[@]}"})

  if [ "$measured_fleet" = "1" ]; then
    # The measured path is experiment-agnostic: WF_EXPERIMENT_DIR names the experiment folder
    # baked into this image (the folder holding its manifest), and the shared engine beside it
    # runs the arm. WF_FLEET_AB_DIR is the pre-engine name for the same seam and is honoured FIRST
    # when a caller sets it explicitly — the image bakes WF_EXPERIMENT_DIR, so checking it first
    # would make the legacy override unreachable rather than deprecated.
    local experiment_dir
    if [ -n "${WF_FLEET_AB_DIR:-}" ]; then
      echo "entrypoint.sh: WARNING — WF_FLEET_AB_DIR is deprecated; use WF_EXPERIMENT_DIR. Honouring '$WF_FLEET_AB_DIR' for this run." >&2
      experiment_dir="$WF_FLEET_AB_DIR"
    else
      experiment_dir="${WF_EXPERIMENT_DIR:-$RUNNER_DIR/../experiments/fleet-ab}"
    fi
    local engine_dir="${WF_EXPERIMENT_ENGINE_DIR:-$RUNNER_DIR/../experiments/engine}"
    export WF_EXPERIMENT_DIR="$experiment_dir"
    echo "auth-guard: passed (allow-api-key=$allow_api_key, on-quota=$on_quota) — measured-fleet path; run-arm.sh applies no-egress after the workload seed." >&2
    exec "$engine_dir/run-arm.sh" "${runner_args[@]}"
  fi

  # No-egress at container start (single-skill path only): blackhole tracker/delivery hosts
  # before the run, so an accidental egress fails fast. Applied here, not baked as a layer.
  if [ "${WF_NO_EGRESS:-0}" = "1" ]; then
    . "$RUNNER_DIR/no-egress.sh"
    apply_no_egress || echo "auth-guard: no-egress requested but not fully applied (see warning above)." >&2
  fi

  echo "auth-guard: passed (allow-api-key=$allow_api_key, on-quota=$on_quota) — handing off to run-skill.sh" >&2
  exec "$RUNNER_DIR/run-skill.sh" "${runner_args[@]}"
}

# Run the gate only when executed directly; sourcing defines the guards without gating.
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  main "$@"
fi
