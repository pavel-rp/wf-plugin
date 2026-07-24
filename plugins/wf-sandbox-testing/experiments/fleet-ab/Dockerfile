# wf-sandbox-testing fleet-ab — one arm-buildable image, not a platform.
#
# Extends the hermetic-runner lineage (../../runner/Dockerfile): node + git + the claude CLI,
# no token baked in, no-egress applied at container start. The ONE new axis this kit needs that
# the runner didn't: the plugin SOURCE varies per build (ARG WF_REF selects which marketplace ref
# installs), crossed with a pinned WORKLOAD snapshot that seed-workspace.sh clones at
# container-run time via its run-time `--workload-ref` (NOT a build ARG — never declared or baked
# into the image, so the same image can seed any run without a rebuild). WF_REF is the treatment;
# the workload ref is the workload, held identical across arms.
#
# AUTH/BILLING STANCE (non-negotiable, unchanged from the runner): NO token of any kind baked into
# this image — no ARG/ENV for CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY, no ~/.claude COPY, no
# credential file. Minted once on the host (`claude setup-token`), injected ONLY at `docker run`
# time as a secret.
#
#   Build (per arm, via build-arm.sh):
#     docker build -f plugins/wf-sandbox-testing/experiments/fleet-ab/Dockerfile \
#       --build-arg WF_REF=90cf319 -t fleet-ab:armA .
#     docker build -f plugins/wf-sandbox-testing/experiments/fleet-ab/Dockerfile \
#       --build-arg WF_REF=<main-tip-sha-at-freeze> -t fleet-ab:armB .   # frozen sha, never bare "main"
#
#   Run (the ONE measured pilot per arm — seeds the workload, applies no-egress, then measures,
#   all inside this container so isolation + no-egress + the pinned in-image CLI all apply):
#     docker run --rm -e CLAUDE_CODE_OAUTH_TOKEN -v "$PWD/results/run-A:/work/run-output" \
#       fleet-ab:armA --measured-fleet --arm A --umbrella-id WF-405 \
#       --workload-ref "$WORKLOAD_REF" --fake-scripts fake-scripts.json
#   The container ENTRYPOINT (auth-guard) dispatches --measured-fleet to run-arm.sh, which clones
#   the workload BEFORE applying no-egress (the clone needs github; the measured run must not) —
#   see run-arm.sh. The single-skill --skill path (run-skill.sh, canned suites) is unchanged.

FROM node:20-bookworm-slim

# git — arm marketplace checkout + workload clone; jq — deterministic run.json;
# ca-certificates — the ONE permitted egress (the Anthropic API).
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates jq \
 && rm -rf /var/lib/apt/lists/*

# The claude CLI — pinned to one exact version, identical in both arms (design doc §3). The
# version is itself a fingerprinted input (fingerprint_cli), so an upgrade is a deliberate
# re-fingerprint event, never a silent behavior change. Override at build time if a different
# pin is frozen for a given run.
ARG CLI_VERSION=2.1.218
RUN npm install -g "@anthropic-ai/claude-code@${CLI_VERSION}"

# --- the arm dimension: which marketplace ref installs -----------------------------------------
# WF_REF selects the git ref of THIS repo's marketplace (wf, wf-audit, wf-fake packs) checked out
# and installed into the image — arm A = 90cf319 (baseline version identity, wf 0.79.0), arm B =
# main HEAD at experiment freeze. This is a checkout-and-install, never a local `COPY plugins/`,
# because the arm's plugin source must vary by build while the kit itself stays at HEAD (outside
# the image, run host-side by analyze.sh).
ARG WF_REF
ARG REPO_URL=https://github.com/pavel-rp/wf-plugin.git
RUN test -n "$WF_REF" || (echo "fleet-ab Dockerfile: --build-arg WF_REF=<ref> is required" >&2 && exit 2)
RUN git clone --quiet "$REPO_URL" /opt/wf-marketplace-src \
 && git -C /opt/wf-marketplace-src checkout --quiet "$WF_REF" \
 && rm -rf /opt/wf-marketplace-src/.git
ENV WF_MARKETPLACE_DIR=/opt/wf-marketplace-src
ENV WF_ARM_REF="${WF_REF}"

# The experiment kit's own scripts (always used at HEAD, outside the arm — measurement code is
# not treatment). WORKLOAD_REF is NOT resolved here: seed-workspace.sh clones the workload
# snapshot at container-run time (its own step, not a build layer) so the same image serves any
# workload pin without a rebuild.
# Layout preserves the repo's experiments/fleet-ab → ../../runner relative path, so run-arm.sh and
# seed-workspace.sh resolve the runner (fingerprint.sh, no-egress.sh) identically in-image and in-repo.
COPY plugins/wf-sandbox-testing/runner               /opt/wf-runner/runner
COPY plugins/wf-sandbox-testing/experiments/fleet-ab /opt/wf-runner/experiments/fleet-ab
RUN chmod +x /opt/wf-runner/runner/*.sh /opt/wf-runner/experiments/fleet-ab/*.sh

ENV WF_RUN_OUT=/work/run-output
# No-egress on by default (named tracker/delivery hostnames blackholed via /etc/hosts — see
# no-egress.sh; the Anthropic API stays reachable, and raw-IP / unlisted hosts are NOT blocked,
# so this is a fail-fast guard against accidental named egress, not a hard network jail). Applied
# at container start, not baked as an image layer, so a run proves the guard is active, not unused.
ENV WF_NO_EGRESS=1
WORKDIR /work

ENTRYPOINT ["/opt/wf-runner/runner/entrypoint.sh"]
