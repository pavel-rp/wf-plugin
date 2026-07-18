#!/usr/bin/env bash
# no-egress.sh — blackhole tracker/delivery hosts so any accidental egress fails FAST.
#
# Applied at container START (not baked as an image layer), so the demonstration run proves
# tracker/delivery egress is BLOCKED, not merely unused. The Anthropic API host is left
# reachable on purpose — the real skill invocation is a billed Max-subscription call, the
# one permitted egress. The fixture carries no tracker/delivery credentials, so even the
# blackholed hosts are never addressed on the happy path; the blackhole is the proof.
#
# Sourcing defines apply_no_egress; running directly applies it.
set -uo pipefail

WF_NOEGRESS_HOSTS_DEFAULT="linear.app api.linear.app github.com api.github.com dev.azure.com gitlab.com bitbucket.org"

apply_no_egress() {
  local hosts="${WF_NOEGRESS_HOSTS:-$WF_NOEGRESS_HOSTS_DEFAULT}"
  local h applied=0
  for h in $hosts; do
    if grep -qE "[[:space:]]${h}([[:space:]]|\$)" /etc/hosts 2>/dev/null; then
      continue
    fi
    if printf '0.0.0.0 %s\n' "$h" >> /etc/hosts 2>/dev/null; then
      applied=$((applied + 1))
    else
      echo "no-egress: WARNING — cannot write /etc/hosts (need root); '$h' NOT blackholed." >&2
      return 1
    fi
  done
  echo "no-egress: blackholed ${applied} tracker/delivery host(s); Anthropic API left reachable." >&2
  return 0
}

if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  apply_no_egress
fi
