# wf-sandbox-testing hermetic runner — one thin image, not a platform.
#
# node + git + the claude CLI + the in-repo marketplace build + the fixtures. It executes a
# real headless `claude -p "<skill>" --output-format stream-json` invocation against a canned
# fixture from a CLEAN in-image marketplace install (or a pinned earlier build supplied at
# runtime via --plugin-source). No orchestration layer, no eval framework, no sandbox service.
#
# AUTH/BILLING STANCE (non-negotiable): NO token of any kind is baked into this image — no
# ARG/ENV for CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY, no ~/.claude COPY, no credential
# file. The OAuth token is minted once on the host (`claude setup-token`) and injected ONLY at
# `docker run` time as a secret. `docker history`/layer inspection therefore finds no token.
#
#   Build:  docker build -f plugins/wf-sandbox-testing/runner/Dockerfile -t wf-sandbox-runner .
#           (build context = repo root, so the marketplace build and fixtures are in scope)
#   Run:    docker run --rm \
#             -e CLAUDE_CODE_OAUTH_TOKEN \
#             -v "$PWD/out:/work/run-output" \
#             wf-sandbox-runner --skill "/wf:branch FAKE-1"
#   Baseline arm (pinned build):  add  -v /path/to/pinned:/pinned:ro  and  --plugin-source /pinned

FROM node:20-bookworm-slim

# git — the fixture's local history + clean-install discipline; jq — deterministic run.json;
# ca-certificates — the ONE permitted egress (the Anthropic API). No tracker/delivery client
# is installed: there is nothing in this image that can reach a tracker or delivery host.
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates jq \
 && rm -rf /var/lib/apt/lists/*

# The claude CLI — the skill runtime. Its version is a fingerprinted input, so a CLI upgrade
# is a deliberate re-fingerprint event, never a silent behavior change.
RUN npm install -g @anthropic-ai/claude-code

# The in-image marketplace build under test ("current" plugin source), copied from the repo —
# no network fetch. A pinned earlier build is supplied read-only at runtime, never baked here.
COPY .claude-plugin /opt/wf-marketplace/.claude-plugin
COPY plugins        /opt/wf-marketplace/plugins
ENV WF_MARKETPLACE_DIR=/opt/wf-marketplace

# The runner tooling (guards, runner, fixtures).
COPY plugins/wf-sandbox-testing/runner   /opt/wf-runner/runner
COPY plugins/wf-sandbox-testing/fixtures /opt/wf-runner/fixtures
RUN chmod +x /opt/wf-runner/runner/*.sh /opt/wf-runner/fixtures/*/seed.sh

# Run outputs land here — bind-mount /work/run-output to collect the transcript + snapshot + run.json.
ENV WF_RUN_OUT=/work/run-output
# No-egress on by default: the entrypoint blackholes tracker/delivery hosts at container start,
# so the demonstration run proves egress is BLOCKED, not merely unused. Set WF_NO_EGRESS=0 to disable.
ENV WF_NO_EGRESS=1
WORKDIR /work

ENTRYPOINT ["/opt/wf-runner/runner/entrypoint.sh"]
