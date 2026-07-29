# wf-sandbox-testing cost-program-ab — one arm-buildable image, not a platform.
#
# **Model:** claude-opus-5[1m]
#
# Extends the hermetic-runner lineage (../../runner/Dockerfile): node + git + the claude CLI,
# no token baked in, no-egress applied at container start. The ONE axis this kit varies is the
# plugin SOURCE per build (ARG WF_REF selects which marketplace ref installs), crossed with a
# pinned WORKLOAD snapshot that seed-workspace.sh clones at container-run time via its run-time
# `--workload-ref` (NOT a build ARG — never declared or baked into the image, so the same image
# can seed any run without a rebuild). WF_REF is the per-arm axis; the workload ref is held
# identical across arms.
#
# AUTH/BILLING STANCE (non-negotiable, unchanged from the runner): NO token of any kind baked into
# this image — no ARG/ENV for CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY, no ~/.claude COPY, no
# credential file. Minted once on the host (`claude setup-token`), injected ONLY at `docker run`
# time as a secret.
#
# Build and run commands for this kit are not restated here: they are derived, in order, into
# runbooks/experiment.md by the shared engine's `run-experiment.sh --runbook`. That document is
# machine-derived from this kit's manifest, so it cannot drift from what the engine would issue.
# No ref is quoted in this file for the same reason — a sha copied forward into a comment would
# document a build this kit never issues.

FROM node:20-bookworm-slim

# git — per-arm marketplace checkout + workload clone; jq — deterministic run.json;
# ca-certificates — the ONE permitted egress (the Anthropic API).
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates jq \
 && rm -rf /var/lib/apt/lists/*

# The claude CLI — pinned to one exact version, identical in every arm. The version is itself a
# fingerprinted input (fingerprint_cli), so an upgrade is a deliberate re-fingerprint event, never
# a silent behavior change. Override at build time if a different pin is frozen for a given run.
ARG CLI_VERSION=2.1.218
RUN npm install -g "@anthropic-ai/claude-code@${CLI_VERSION}"

# --- the per-arm axis: which marketplace ref installs -------------------------------------------
# WF_REF selects the git ref of THIS repo's marketplace checked out and installed into the image.
# Every value is a frozen explicit sha declared in experiment.json — this is a checkout-and-install,
# never a local `COPY plugins/`, because the plugin source must vary by build while the kit itself
# stays at HEAD (outside the image, run host-side by analyze.sh).
ARG WF_REF
ARG REPO_URL=https://github.com/pavel-rp/wf-plugin.git
RUN test -n "$WF_REF" || (echo "cost-program-ab Dockerfile: --build-arg WF_REF=<ref> is required" >&2 && exit 2)
# The clone is authenticated when, and only when, a gh_token build secret is mounted. A private
# REPO_URL needs one; a public one does not, so the secret is optional and the unauthenticated
# path is preserved verbatim. The secret is a BuildKit mount, never an ARG/ENV — it does not
# become an image layer and does not appear in `docker history`. The token is never interpolated
# into the clone URL or a command line: a throwaway credential helper reads the mounted secret at
# the moment git asks for it, so the value never enters argv, never enters the remote URL, and
# never lands in .git/config. The helper and the whole .git directory are both removed inside the
# same layer, so no credential — and no path to one — survives into the image.
RUN --mount=type=secret,id=gh_token \
    if [ -s /run/secrets/gh_token ]; then \
      printf '#!/bin/sh\necho username=x-access-token\necho "password=$(cat /run/secrets/gh_token)"\n' > /tmp/ghcred.sh; \
      chmod +x /tmp/ghcred.sh; \
      GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=credential.helper GIT_CONFIG_VALUE_0=/tmp/ghcred.sh \
        git clone --quiet "$REPO_URL" /opt/wf-marketplace-src; \
      rm -f /tmp/ghcred.sh; \
    else \
      git clone --quiet "$REPO_URL" /opt/wf-marketplace-src; \
    fi \
 && git -C /opt/wf-marketplace-src checkout --quiet "$WF_REF" \
 && rm -rf /opt/wf-marketplace-src/.git
ENV WF_MARKETPLACE_DIR=/opt/wf-marketplace-src
ENV WF_ARM_REF="${WF_REF}"

# The shared engine plus this kit's own data (always used at HEAD, outside the per-arm axis —
# measurement code is not treatment). WORKLOAD_REF is NOT resolved here: seed-workspace.sh clones
# the workload snapshot at container-run time (its own step, not a build layer) so the same image
# serves any workload pin without a rebuild.
# Layout preserves the repo's experiments/<name> → ../../runner and → ../engine relative paths, so
# the engine resolves the runner (fingerprint.sh, no-egress.sh) and this kit's manifest identically
# in-image and in-repo.
COPY plugins/wf-sandbox-testing/runner                        /opt/wf-runner/runner
COPY plugins/wf-sandbox-testing/experiments/engine            /opt/wf-runner/experiments/engine
COPY plugins/wf-sandbox-testing/experiments/cost-program-ab   /opt/wf-runner/experiments/cost-program-ab
RUN chmod +x /opt/wf-runner/runner/*.sh /opt/wf-runner/experiments/engine/*.sh /opt/wf-runner/experiments/cost-program-ab/*.sh

# Which kit this image belongs to. The entrypoint's --measured-fleet seam reads this and hands it to
# the engine, which loads the manifest from it — so no flag is ever added to the measured
# `docker run` command line.
ENV WF_EXPERIMENT_DIR=/opt/wf-runner/experiments/cost-program-ab

# The CLI refuses --dangerously-skip-permissions under root, which every step here runs as (the
# base image defines no non-root user, and the run-output volume is bind-mounted root-owned).
# IS_SANDBOX=1 is the CLI's own escape for the case this image IS: a disposable container with
# no-egress applied and nothing on it worth protecting from itself. Without this the seed's
# unmeasured /wf:init emits a plain-text refusal where the harness expects stream-json, and the
# run fails at jq --argjson rather than at anything to do with the thing being compared.
# Preferred alternative — a non-root USER — would need the bind-mounted output dir to match its
# uid, which the host cannot guarantee across machines.
ENV IS_SANDBOX=1

ENV WF_RUN_OUT=/work/run-output
# No-egress on by default (named tracker/delivery hostnames blackholed via /etc/hosts — see
# no-egress.sh; the Anthropic API stays reachable, and raw-IP / unlisted hosts are NOT blocked,
# so this is a fail-fast guard against accidental named egress, not a hard network jail). Applied
# at container start, not baked as an image layer, so a run proves the guard is active, not unused.
ENV WF_NO_EGRESS=1
WORKDIR /work

ENTRYPOINT ["/opt/wf-runner/runner/entrypoint.sh"]
