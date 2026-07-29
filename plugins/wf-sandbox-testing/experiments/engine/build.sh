#!/usr/bin/env bash
# build.sh — build every declared arm's image from the experiment's one Dockerfile, fingerprinting
# every build input so a later run.json can cite exactly what was built.
#
# Experiment-agnostic: how many arms exist, what they are called, which ref each one pins, and which
# image repository their tags live under all come from the manifest named by --manifest. Each arm's
# ref is a frozen explicit value declared in the manifest — this script never defaults one and never
# re-resolves a moving ref.
#
# Usage:
#   build.sh --manifest <experiment.json> --both [--cli-version <ver>]
#   build.sh --manifest <experiment.json> --arm <label> [--wf-ref-<label> <sha>] [--cli-version <ver>]
#
# Writes <kit>/results/build-<label>.json with the resolved ref, CLI version, and the local
# fingerprint of the experiment's own tree and the shared runner.
#
# This script only builds images — it never runs a container and never spends a measured run.
#
# CLONE AUTH: when the experiment's Dockerfile clones a private repository, the build needs a
# GitHub token. It is taken from GH_TOKEN, else GITHUB_TOKEN, else `gh auth token`, and handed to
# docker as a BuildKit secret (id=gh_token) — never a --build-arg, never an ENV, never recorded in
# build-<label>.json. When no token is found the build proceeds unauthenticated, which is correct
# for a public repository and fails at the clone for a private one.
#
# REF GUARD: before ANY image is built, every arm to be built has its ref resolved against the local
# checkout. An unresolvable ref exits non-zero with a named reason before a single build starts — a
# failed guard is infrastructure, never charged against a measured run.
set -euo pipefail

ENGINE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$ENGINE_DIR/../../../.." && pwd)"
RUNNER_DIR="$REPO_ROOT/plugins/wf-sandbox-testing/runner"
# shellcheck source=manifest.sh
. "$ENGINE_DIR/manifest.sh"
# shellcheck source=../../runner/fingerprint.sh
. "$RUNNER_DIR/fingerprint.sh"
# shellcheck source=gh-token.sh
. "$ENGINE_DIR/gh-token.sh"

usage() {
  cat >&2 <<'EOF'
usage: build.sh --manifest <experiment.json> --all [--cli-version <ver>]
       build.sh --manifest <experiment.json> --arm <label> [--wf-ref-<label> <sha>]
                [--cli-version <ver>] [--tag <image-tag>]

  --all   build every arm the manifest declares, whatever N is. `--both` is the
          back-compat spelling of the same flag, kept because emitted command
          surfaces pin that token.
EOF
}

die() { echo "build.sh: ERROR — $*" >&2; exit 2; }

# resolve_ref <ref> — 0 when the ref names a commit reachable in the local checkout.
resolve_ref() {
  git -C "$REPO_ROOT" rev-parse --verify --quiet "$1^{commit}" >/dev/null 2>&1
}

# guard_refs <label...> — every named arm's ref must resolve BEFORE any image is built.
guard_refs() {
  local l ref problems=0
  for l in "$@"; do
    ref="$(manifest_arm_ref "$l")" || die "arm '$l' is not declared by this manifest"
    if ! resolve_ref "$ref"; then
      echo "build.sh: REF GUARD FAIL — arm '$l' pins wf_ref '$ref', which does not resolve to a commit in $REPO_ROOT." >&2
      problems=1
    fi
  done
  if [ "$problems" -ne 0 ]; then
    echo "build.sh: refusing to build — an unresolvable arm ref would produce an image that does not match its declared treatment. No image built, no container started, nothing spent." >&2
    exit 4
  fi
}

# resolve_gh_token — echo a GitHub token for the build's clone, or nothing when none is available.
# Order: an explicit GH_TOKEN/GITHUB_TOKEN in the environment, then the gh CLI's stored token.
# A private REPO_URL needs one; a public one does not, so an empty result is not an error here —
# the Dockerfile falls back to an unauthenticated clone and fails on its own terms if that is wrong.
# Credential lookup and its shape check are shared with the run path — see engine/gh-token.sh.

build_one() {
  local arm="$1" wf_ref="$2" cli_version="$3" tag="$4"
  echo "build.sh: building $tag (WF_REF=$wf_ref, CLI_VERSION=$cli_version)" >&2

  # The token reaches docker only as a BuildKit secret, never as a --build-arg (which would land
  # in image metadata). It is exported into this function's subshell environment solely so
  # `--secret env=` can read it; it is never echoed and never written to build-<arm>.json.
  local -a secret_args=()
  local gh_token; gh_token="$(resolve_gh_token)"
  if [ -n "$gh_token" ]; then
    export WF_BUILD_GH_TOKEN="$gh_token"
    secret_args=(--secret "id=gh_token,env=WF_BUILD_GH_TOKEN")
    echo "build.sh: authenticating the in-image clone with a gh_token build secret" >&2
  else
    echo "build.sh: no GitHub token found (GH_TOKEN/GITHUB_TOKEN/gh auth token) — the in-image clone will be unauthenticated, which fails against a private REPO_URL" >&2
  fi

  DOCKER_BUILDKIT=1 docker build \
    -f "$KIT_DIR/Dockerfile" \
    --build-arg "WF_REF=$wf_ref" \
    --build-arg "CLI_VERSION=$cli_version" \
    ${secret_args+"${secret_args[@]}"} \
    -t "$tag" \
    "$REPO_ROOT"
  unset WF_BUILD_GH_TOKEN

  local out_dir="$RESULTS_DIR"
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
  echo "build.sh: wrote $out_file" >&2
}

main() {
  local manifest="" mode="" arm="" cli_version="" tag_override=""
  local -a ref_overrides=()

  # --- manifest first: every default below comes from it ----------------------------------------
  local -a argv=("$@")
  local i=0
  while [ "$i" -lt "${#argv[@]}" ]; do
    case "${argv[$i]}" in
      --manifest) i=$((i + 1)); manifest="${argv[$i]:-}";;
      --manifest=*) manifest="${argv[$i]#*=}";;
      -h|--help) usage; exit 0;;
    esac
    i=$((i + 1))
  done
  [ -n "$manifest" ] || { echo "build.sh: ERROR — --manifest <experiment.json> is required" >&2; usage; exit 2; }
  manifest_load "$manifest" || exit 2
  cli_version="$CONST_CLI_VERSION"

  while [ $# -gt 0 ]; do
    case "$1" in
      --manifest) shift 2;;
      --manifest=*) shift;;
      --arm) arm="${2:?}"; mode="single"; shift 2;;
      --arm=*) arm="${1#*=}"; mode="single"; shift;;
      --all|--both) mode="all"; shift;;
      --cli-version) cli_version="${2:?}"; shift 2;;
      --cli-version=*) cli_version="${1#*=}"; shift;;
      --tag) tag_override="${2:?}"; shift 2;;
      --tag=*) tag_override="${1#*=}"; shift;;
      --wf-ref-*=*) local f="${1%%=*}"; ref_overrides+=("${f#--wf-ref-}=${1#*=}"); shift;;
      --wf-ref-*) ref_overrides+=("${1#--wf-ref-}=${2:?}"); shift 2;;
      --wf-ref) ref_overrides+=("${arm}=${2:?}"); shift 2;;
      --wf-ref=*) ref_overrides+=("${arm}=${1#*=}"); shift;;
      -h|--help) usage; exit 0;;
      *) echo "build.sh: unknown argument '$1'" >&2; usage; exit 2;;
    esac
  done

  # Apply per-arm ref overrides onto the manifest-declared values.
  local ov want val j
  for ov in ${ref_overrides+"${ref_overrides[@]}"}; do
    want="${ov%%=*}"; val="${ov#*=}"
    local matched=0
    for j in "${!ARM_LABELS[@]}"; do
      if [ "${ARM_LABELS[$j],,}" = "${want,,}" ]; then ARM_REFS[$j]="$val"; matched=1; break; fi
    done
    [ "$matched" = 1 ] || die "--wf-ref-$want names an arm this manifest does not declare (declared: ${ARM_LABELS[*]})"
  done

  local -a to_build=()
  case "$mode" in
    single)
      manifest_require_arm "$arm" "build.sh" || exit 2
      to_build=("$arm")
      ;;
    all)
      to_build=("${ARM_LABELS[@]}")
      ;;
    *) usage; exit 2;;
  esac

  # Every ref resolves BEFORE the first image is built.
  guard_refs "${to_build[@]}"

  local l ref tag
  for l in "${to_build[@]}"; do
    ref="$(manifest_arm_ref "$l")"
    if [ -n "$tag_override" ] && [ "${#to_build[@]}" -eq 1 ]; then tag="$tag_override"; else tag="$(manifest_image_tag "$l")"; fi
    build_one "$l" "$ref" "$cli_version" "$tag"
  done
}

main "$@"
