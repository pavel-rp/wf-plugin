#!/usr/bin/env bash
# build-arm.sh — build both fleet-ab arm images from the one Dockerfile, fingerprinting
# every build input so a later run.json can cite exactly what was built.
#
# Arm A (control): WF_REF=90cf319 (wf 0.79.0 — the committed-baseline version identity).
# Arm B (candidate): WF_REF=<main tip at freeze>, passed explicitly — never defaulted, so a
# stale "main" resolution can never silently drift the candidate build (design doc §8.1 freeze).
#
# Usage:
#   build-arm.sh --arm A [--wf-ref 90cf319] [--cli-version 2.1.218]
#   build-arm.sh --arm B --wf-ref <main-tip-sha-at-freeze> [--cli-version 2.1.218]
#   build-arm.sh --both --wf-ref-a 90cf319 --wf-ref-b <main-tip-sha-at-freeze>
#
# Writes plugins/wf-sandbox-testing/experiments/fleet-ab/results/build-<arm>.json with the
# resolved WF_REF, CLI_VERSION, and the local fingerprint of this kit's own tree (the fixture
# lineage precedent: fingerprint_tree/fingerprint_cli from runner/fingerprint.sh).
#
# This script only builds images — it never runs a container and never spends a measured run.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KIT_DIR="$SCRIPT_DIR"
REPO_ROOT="$(cd "$KIT_DIR/../../../.." && pwd)"
RUNNER_DIR="$REPO_ROOT/plugins/wf-sandbox-testing/runner"
# shellcheck source=../../runner/fingerprint.sh
. "$RUNNER_DIR/fingerprint.sh"

DEFAULT_WF_REF_A="90cf319"
DEFAULT_CLI_VERSION="2.1.218"

usage() {
  cat >&2 <<'EOF'
usage: build-arm.sh --arm A|B --wf-ref <ref> [--cli-version <ver>] [--tag <image-tag>]
       build-arm.sh --both --wf-ref-a <ref> --wf-ref-b <ref> [--cli-version <ver>]
EOF
}

build_one() {
  local arm="$1" wf_ref="$2" cli_version="$3"
  local tag="fleet-ab:arm${arm}"
  echo "build-arm.sh: building $tag (WF_REF=$wf_ref, CLI_VERSION=$cli_version)" >&2
  docker build \
    -f "$KIT_DIR/Dockerfile" \
    --build-arg "WF_REF=$wf_ref" \
    --build-arg "CLI_VERSION=$cli_version" \
    -t "$tag" \
    "$REPO_ROOT"

  local out_dir="$KIT_DIR/results"
  mkdir -p "$out_dir"
  local fp_kit; fp_kit="$(fingerprint_tree "$KIT_DIR")"
  local fp_runner; fp_runner="$(fingerprint_tree "$RUNNER_DIR")"
  local out_file="$out_dir/build-${arm}.json"
  if command -v jq >/dev/null 2>&1; then
    jq -n \
      --arg arm "$arm" --arg tag "$tag" --arg wf_ref "$wf_ref" --arg cli_version "$cli_version" \
      --arg fp_kit "$fp_kit" --arg fp_runner "$fp_runner" \
      '{ arm: $arm, image: $tag, wf_ref: $wf_ref, cli_version: $cli_version,
         fingerprints: { kit: $fp_kit, runner: $fp_runner } }' > "$out_file"
  else
    printf '{"arm":"%s","image":"%s","wf_ref":"%s","cli_version":"%s","fingerprints":{"kit":"%s","runner":"%s"}}\n' \
      "$arm" "$tag" "$wf_ref" "$cli_version" "$fp_kit" "$fp_runner" > "$out_file"
  fi
  echo "build-arm.sh: wrote $out_file" >&2
}

main() {
  local mode="" arm="" wf_ref="" wf_ref_a="$DEFAULT_WF_REF_A" wf_ref_b="" cli_version="$DEFAULT_CLI_VERSION"

  while [ $# -gt 0 ]; do
    case "$1" in
      --arm) arm="${2:?}"; mode="single"; shift 2;;
      --arm=*) arm="${1#*=}"; mode="single"; shift;;
      --wf-ref) wf_ref="${2:?}"; shift 2;;
      --wf-ref=*) wf_ref="${1#*=}"; shift;;
      --both) mode="both"; shift;;
      --wf-ref-a) wf_ref_a="${2:?}"; shift 2;;
      --wf-ref-a=*) wf_ref_a="${1#*=}"; shift;;
      --wf-ref-b) wf_ref_b="${2:?}"; shift 2;;
      --wf-ref-b=*) wf_ref_b="${1#*=}"; shift;;
      --cli-version) cli_version="${2:?}"; shift 2;;
      --cli-version=*) cli_version="${1#*=}"; shift;;
      -h|--help) usage; exit 0;;
      *) echo "build-arm.sh: unknown argument '$1'" >&2; usage; exit 2;;
    esac
  done

  case "$mode" in
    single)
      case "$arm" in A|B) ;; *) echo "build-arm.sh: --arm must be A or B (got '$arm')" >&2; exit 2;; esac
      [ -n "$wf_ref" ] || { [ "$arm" = "A" ] && wf_ref="$DEFAULT_WF_REF_A"; }
      [ -n "$wf_ref" ] || { echo "build-arm.sh: --wf-ref is required for --arm $arm (no default for B — freeze it explicitly)" >&2; exit 2; }
      build_one "$arm" "$wf_ref" "$cli_version"
      ;;
    both)
      [ -n "$wf_ref_b" ] || { echo "build-arm.sh: --both requires --wf-ref-b <main-tip-sha-at-freeze> (never defaulted)" >&2; exit 2; }
      build_one "A" "$wf_ref_a" "$cli_version"
      build_one "B" "$wf_ref_b" "$cli_version"
      ;;
    *) usage; exit 2;;
  esac
}

main "$@"
