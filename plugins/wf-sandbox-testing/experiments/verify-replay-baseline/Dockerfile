# wf-sandbox-testing verify-replay-baseline — one arm-buildable image, not a platform.
#
# **Model:** claude-fable-5-1
#
# Same lineage as scaffold-selftest's Dockerfile (node + git + the claude CLI, no token baked in,
# no-egress applied at container start). The ONE axis this kit varies is the plugin SOURCE per
# build (ARG WF_REF selects which marketplace ref installs — i.e. WHICH verify-spec / run the
# recorded rounds are replayed through), crossed with a per-ROUND workload snapshot that the
# kit's replay-round.sh seeds at container-run time from each round's recorded commit (never a
# build ARG). Both arms of the shipped manifest point at the same frozen ref; a later C033 SUB
# repoints arm B's wf_ref at its own branch and rebuilds only that arm.
#
# AUTH/BILLING STANCE (non-negotiable, unchanged from the runner): NO token of any kind baked into
# this image — no ARG/ENV for CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY, no ~/.claude COPY, no
# credential file. Minted once on the host (`claude setup-token`), injected ONLY at `docker run`
# time as a secret.
#
# The replayed task folders (`_local/_archive/<task>/00_reqs.md`, `01_spec.md`, `02_plan.md`) are
# gitignored and are NOT in this image either: mount the archive read-only at run time and pass
# `--task-src` to replay-round.sh. The kit ships every round's audit transcript; it does not ship
# the task's own spec.

FROM node:20-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates jq \
 && rm -rf /var/lib/apt/lists/*

ARG CLI_VERSION=2.1.218
RUN npm install -g "@anthropic-ai/claude-code@${CLI_VERSION}"

# --- the per-arm axis: which marketplace ref installs -------------------------------------------
ARG WF_REF
ARG REPO_URL=https://github.com/pavel-rp/wf-plugin.git
RUN test -n "$WF_REF" || (echo "verify-replay-baseline Dockerfile: --build-arg WF_REF=<ref> is required" >&2 && exit 2)
RUN git clone --quiet "$REPO_URL" /opt/wf-marketplace-src \
 && git -C /opt/wf-marketplace-src checkout --quiet "$WF_REF" \
 && rm -rf /opt/wf-marketplace-src/.git
ENV WF_MARKETPLACE_DIR=/opt/wf-marketplace-src
ENV WF_ARM_REF="${WF_REF}"

# The shared engine, the corpus items this kit replays, and the kit itself — always at HEAD,
# outside the per-arm axis (measurement code and recorded data are not treatment).
COPY plugins/wf-sandbox-testing/runner                                    /opt/wf-runner/runner
COPY plugins/wf-sandbox-testing/experiments/engine                        /opt/wf-runner/experiments/engine
COPY plugins/wf-sandbox-testing/experiments/verify-replay-baseline        /opt/wf-runner/experiments/verify-replay-baseline
COPY plugins/wf-sandbox-testing/corpus/items/verify-replay-wf552          /opt/wf-runner/corpus/items/verify-replay-wf552
COPY plugins/wf-sandbox-testing/corpus/items/verify-replay-wf553          /opt/wf-runner/corpus/items/verify-replay-wf553
COPY plugins/wf-sandbox-testing/corpus/items/verify-replay-wf554          /opt/wf-runner/corpus/items/verify-replay-wf554
RUN chmod +x /opt/wf-runner/runner/*.sh /opt/wf-runner/experiments/engine/*.sh \
             /opt/wf-runner/experiments/verify-replay-baseline/*.sh \
             /opt/wf-runner/experiments/verify-replay-baseline/kit/*.sh

ENV WF_EXPERIMENT_DIR=/opt/wf-runner/experiments/verify-replay-baseline
ENV WF_RUN_OUT=/work/run-output
ENV WF_NO_EGRESS=1
WORKDIR /work

ENTRYPOINT ["/opt/wf-runner/runner/entrypoint.sh"]
