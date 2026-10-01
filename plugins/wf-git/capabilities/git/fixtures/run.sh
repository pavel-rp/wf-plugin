#!/usr/bin/env bash
# wf-git deterministic self-checks.
#
# Auto-discovered by CI via the convention `plugins/*/capabilities/*/fixtures/run.sh`
# (.github/workflows/ci.yml, "Each capability's fixture suite" step). Capability-agnostic:
# CI never names wf-git — it runs whatever fixtures run.sh a capability ships.
#
# Checks (all deterministic, no network, no model):
#   1. OP-LIST INTEGRITY — every op on the fragment's `**Operations:**` line has its own
#      `## <op>` section in delivery.ops.md (no op announced but unimplemented).
#   2. CONTRACT PARITY — every op the fragment lists is also named in the core capability
#      registry's NORMATIVE runtime half (capability-registry.ops.md §"The delivery provider
#      surface") — no op invented by an owner alone. The reference half
#      (capability-registry.contract.md) is prose about that surface, not the op oracle.
#   3. CROSS-OWNER PARITY — the delivery op set here is identical to the fixture owner's
#      (plugins/wf-fake). Two owners of one partitioned surface must never diverge, or a
#      consumer can be written against a surface only one of them honours.
#   4. TYPED-RESULT DISCIPLINE — each typed read documents its `<read-performed>` flag, and
#      newest-published-version-read documents every `<reason>` token reachable from a
#      registered provider plus the performed return; branch-head-read likewise documents
#      its remote-read performed return (<commit>, <tree>) and each reachable reason token.
#   5. HEAD BINDING (WF-881) — branch-head-read reads the branch's configured remote and
#      pr-merge is pinned to <expected-head>; exercised behaviorally against local bare remotes.
#
# Usage:  run.sh    run every check (default; used by CI)
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CAP_DIR="$(dirname "$SCRIPT_DIR")"                  # capabilities/git
PLUGINS_DIR="$(cd "$CAP_DIR/../../.." && pwd)"      # plugins/
OPS="$CAP_DIR/fragments/delivery.ops.md"
CONTRACT="$PLUGINS_DIR/wf/skills/_contracts/capability-registry.ops.md"
PEER_OPS="$PLUGINS_DIR/wf-fake/capabilities/fake/fragments/delivery.ops.md"

fail=0
err() { printf 'FAIL: %s\n' "$1" >&2; fail=1; }
ok()  { printf 'ok:   %s\n' "$1"; }

# The declared op list: the `**Operations:**` line, split on the middot separator.
op_list() {  # $1 = an ops fragment
  grep -m1 '^\*\*Operations:\*\*' "$1" \
    | sed -e 's/^\*\*Operations:\*\* *//' -e 's/\.$//' -e 's/ *· */\n/g' \
    | sed -e 's/^ *//' -e 's/ *$//' \
    | grep -v '^$' \
    | sort
}

# A mis-parsed or renamed `**Operations:**` line yields an EMPTY list, and every loop below
# would then iterate zero times and report ok — a vacuous pass, the exact defect these checks
# exist to catch. Fail loudly on an implausible list instead. The floor is deliberately well
# under the real count: it detects a broken parse, not a deliberate op removal.
MIN_OPS=10

check_op_list_sane() {
  local n before=$fail
  [ -f "$OPS" ] || { err "op-list: $OPS missing"; return; }
  n=$(op_list "$OPS" | grep -c .)
  [ "$n" -ge "$MIN_OPS" ] \
    || err "op-list: the Operations line parsed to $n op(s) (< $MIN_OPS) — a missing or mis-parsed list, never a vacuous pass"
  [ "$fail" = "$before" ] && ok "op-list: the Operations line parses to $n ops — the suite has a real target set"
}

check_op_sections() {
  local op before=$fail
  [ -f "$OPS" ] || { err "op-sections: $OPS missing"; return; }
  while read -r op; do
    grep -qE "^## $op( |$)" "$OPS" \
      || err "op-sections: op '$op' is on the Operations line but has no '## $op' section"
  done < <(op_list "$OPS")
  [ "$fail" = "$before" ] && ok "op-sections: every declared op has its own procedure section"
}

check_contract_parity() {
  local op before=$fail
  [ -f "$CONTRACT" ] || { err "contract-parity: $CONTRACT missing"; return; }
  while read -r op; do
    grep -qF -- "\`$op\`" "$CONTRACT" \
      || err "contract-parity: op '$op' is bound here but named nowhere in the core contract"
  done < <(op_list "$OPS")
  [ "$fail" = "$before" ] && ok "contract-parity: every bound op is a contract-named operation"
}

check_cross_owner_parity() {
  local before=$fail diff_out
  if [ ! -f "$PEER_OPS" ]; then
    ok "cross-owner parity: no peer delivery owner vendored — skipped"
    return
  fi
  # Two EMPTY lists compare equal, so parity would pass vacuously on a mis-parsed peer.
  if [ "$(op_list "$PEER_OPS" | grep -c .)" -lt "$MIN_OPS" ]; then
    err "cross-owner parity: the peer owner's Operations line parsed to fewer than $MIN_OPS ops — mis-parsed, never a vacuous parity pass"
    return
  fi
  diff_out=$(diff <(op_list "$OPS") <(op_list "$PEER_OPS") || true)
  if [ -n "$diff_out" ]; then
    err "cross-owner parity: the delivery op sets of the two owners differ (< git, > fake):"
    printf '%s\n' "$diff_out" >&2
  fi
  [ "$fail" = "$before" ] && ok "cross-owner parity: both delivery owners bind an identical op set"
}

# Reads whose result is TYPED with a <read-performed> flag, so a degraded result can never be
# mistaken for a performed read (capability-registry contract, "Degradation shape").
TYPED_READS=(review-threads-read newest-published-version-read branch-head-read merged-ref-read review-request-read)

# Print one operation's own section body — from its `## <op>` heading to the next `## `.
# Scoping every typed-result assertion to this body is what stops the check passing because
# some OTHER operation happens to mention the token.
op_section() {  # $1 = ops file, $2 = op
  awk -v op="$2" '
    $0 ~ "^## " op "( |$)" { inb = 1; next }
    inb && /^## / { exit }
    inb { print }
  ' "$1"
}

check_typed_results() {
  local op before=$fail token section
  for op in "${TYPED_READS[@]}"; do
    section=$(op_section "$OPS" "$op")
    if [ -z "$section" ]; then
      err "typed-result: typed read '$op' has no section in delivery.ops.md"
      continue
    fi
    # Per-op, not file-wide: this op's OWN section must document the flag.
    printf '%s\n' "$section" | grep -qF -- 'read-performed' \
      || err "typed-result: the '$op' section documents no 'read-performed' flag"
  done
  section=$(op_section "$OPS" newest-published-version-read)
  # The PERFORMED return needs its own assertion. Without it the degraded clauses alone carry
  # the token `read-performed`, so deleting the success clause would leave this suite green.
  printf '%s\n' "$section" | grep -qF -- '= true' \
    || err "typed-result: the newest-published-version-read section documents no performed return (<read-performed> = true)"
  printf '%s\n' "$section" | grep -qF -- '<version>' \
    || err "typed-result: the newest-published-version-read section never names the <version> the performed return carries"
  # A registered provider can reach exactly these two degraded reasons; no-provider is core's.
  for token in read-failed none-published; do
    printf '%s\n' "$section" | grep -qF -- "\`$token\`" \
      || err "typed-result: the newest-published-version-read section documents no '$token' reason token"
  done
  printf '%s\n' "$section" | grep -qF -- 'no-provider' \
    || err "typed-result: the newest-published-version-read section does not record that 'no-provider' is core's own token"
  # branch-head-read (WF-839): the performed return carries the REMOTE head's commit and tree, and
  # each degraded return a closed reason — a stale local head must never pass as a performed read.
  section=$(op_section "$OPS" branch-head-read)
  printf '%s\n' "$section" | grep -qF -- '= true' \
    || err "typed-result: the branch-head-read section documents no performed return (<read-performed> = true)"
  for token in '<commit>' '<tree>' 'ls-remote'; do
    printf '%s\n' "$section" | grep -qF -- "$token" \
      || err "typed-result: the branch-head-read section never names '$token' (the remote head it must read)"
  done
  for token in read-failed not-published; do
    printf '%s\n' "$section" | grep -qF -- "\`$token\`" \
      || err "typed-result: the branch-head-read section documents no '$token' reason token"
  done
  printf '%s\n' "$section" | grep -qF -- 'no-provider' \
    || err "typed-result: the branch-head-read section does not record that 'no-provider' is core's own token"
  # merged-ref-read (WF-838): the performed return carries the merge commit the host names and, on
  # request, a read-only export of its tree — never the local checkout, which can predate the merge.
  section=$(op_section "$OPS" merged-ref-read)
  printf '%s\n' "$section" | grep -qF -- '= true' \
    || err "typed-result: the merged-ref-read section documents no performed return (<read-performed> = true)"
  for token in '<merge-commit>' '<tree>' '<root>' 'mergeCommit' 'git archive' 'tar -xf'; do
    printf '%s\n' "$section" | grep -qF -- "$token" \
      || err "typed-result: the merged-ref-read section never names '$token' (the merged state it must read and export)"
  done
  for token in read-failed not-merged; do
    printf '%s\n' "$section" | grep -qF -- "\`$token\`" \
      || err "typed-result: the merged-ref-read section documents no '$token' reason token"
  done
  printf '%s\n' "$section" | grep -qF -- 'no-provider' \
    || err "typed-result: the merged-ref-read section does not record that 'no-provider' is core's own token"
  # review-request-read (WF-837): the performed return carries every count the pre-merge review
  # step classifies a capped outcome by — including the timeline read-back, without which a request
  # the host registered and then withdrew would read as never requested.
  section=$(op_section "$OPS" review-request-read)
  printf '%s\n' "$section" | grep -qF -- '= true' \
    || err "typed-result: the review-request-read section documents no performed return (<read-performed> = true)"
  for token in '<requested>' '<pending>' '<request-events>' '<reviews>' 'reviewRequests' 'timeline' 'review_requested'; do
    printf '%s\n' "$section" | grep -qF -- "$token" \
      || err "typed-result: the review-request-read section never names '$token' (the request state it must read back)"
  done
  printf '%s\n' "$section" | grep -qF -- '`read-failed`' \
    || err "typed-result: the review-request-read section documents no 'read-failed' reason token"
  printf '%s\n' "$section" | grep -qF -- 'no-provider' \
    || err "typed-result: the review-request-read section does not record that 'no-provider' is core's own token"
  printf '%s\n' "$section" | grep -qiF -- 'nothing is requested' \
    || err "typed-result: the review-request-read section does not state that it requests nothing"
  [ "$fail" = "$before" ] && ok "typed-result: each typed read's own section documents read-performed and every reachable reason token"
}

# 5. HEAD BINDING (WF-881) — the head a drift check reads and the head a merge takes are the same
#    one. Static: branch-head-read resolves the branch's configured remote (never a fixed origin)
#    and pr-merge pins the merge to <expected-head>, mapping a moved head to `head-moved`.
#    Behavioral: the documented branch-head-read sequence, run against a temporary repository
#    whose branch is published ONLY to a non-origin remote, returns that remote's head; and the
#    documented pr-merge pin, run against a stub host that honours the head-match condition,
#    merges an unchanged head and refuses (head-moved) one that moved after verification.
#    The upstream probe, escaped as push-upstream step 2 defines, resolves a branch whose
#    name carries a regex metacharacter (feat+1), which the raw pattern misses (WF-929).
#    Everything runs in a private temp dir with local bare remotes — no network.
check_head_binding() {
  local before=$fail section tmp
  section=$(op_section "$OPS" push-upstream)
  printf '%s\n' "$section" | grep -qF -- "'^branch\.<branch-re>\.(remote|merge)\$'" \
    || err "head-binding: the push-upstream section never defines the escaped, single-quoted upstream probe over <branch-re>"
  section=$(op_section "$OPS" branch-head-read)
  for token in '<branch-re>' '`push-upstream` step 2 defines' '"<remote>" "refs/heads/<remote-branch>"' 'Never assume `origin`'; do
    printf '%s\n' "$section" | grep -qF -- "$token" \
      || err "head-binding: the branch-head-read section never names '$token' (it must read the branch's configured remote)"
  done
  grep -qF -- 'branch\.<branch>\.' "$OPS" \
    && err "head-binding: the ops doc still places the raw <branch> in the upstream probe pattern"
  section=$(op_section "$OPS" pr-merge)
  for token in '<expected-head>' '--match-head-commit "<expected-head>"' 'headRefOid' '`head-moved`'; do
    printf '%s\n' "$section" | grep -qF -- "$token" \
      || err "head-binding: the pr-merge section never names '$token' (the merge must be pinned to the verified head)"
  done
  grep -qE '^\| pr-merge \|.*expected-head\?.*`head-moved`' "$PEER_OPS" \
    || err "head-binding: the fixture owner's pr-merge row does not record expected-head? and head-moved"
  command -v git >/dev/null 2>&1 || { err "head-binding: git is required for the behavioral check"; return; }

  tmp="$(mktemp -d)"
  (
    set -e
    export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
    export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
    git init -q --bare "$tmp/fork.git"
    git init -q "$tmp/work"
    cd "$tmp/work"
    git commit -q --allow-empty -m one
    git branch -q -m feat-x
    git remote add fork "$tmp/fork.git"
    git push -q fork HEAD:refs/heads/feat-x
    git config branch.feat-x.remote fork
    git config branch.feat-x.merge refs/heads/feat-x
    pushed=$(git rev-parse HEAD)
    git commit -q --allow-empty -m local-only   # the local head now LEADS the remote one

    # --- branch-head-read, as documented (step 2 probe + fallback, ls-remote, step 3 fetch) ---
    probe=$(git config --get-regexp '^branch\.feat-x\.(remote|merge)$' || true)
    remote=$(printf '%s\n' "$probe" | awk '$1 ~ /\.remote$/ {print $2}')
    rbranch=$(printf '%s\n' "$probe" | awk '$1 ~ /\.merge$/ {sub("^refs/heads/", "", $2); print $2}')
    [ -n "$remote" ] || { remote=origin; rbranch=feat-x; }
    [ "$remote" != "." ]
    head=$(git ls-remote --exit-code --heads "$remote" "refs/heads/$rbranch" | awk 'NR==1 {print $1}')
    git fetch --quiet "$remote" "refs/heads/$rbranch"
    git rev-parse --verify -q "$head^{tree}" >/dev/null
    [ "$head" = "$pushed" ] || { echo "read $head, expected the fork head $pushed" >&2; exit 11; }
    # the fixed-origin read this replaces fails here: there is no origin remote at all
    if git ls-remote --exit-code --heads origin "refs/heads/feat-x" >/dev/null 2>&1; then exit 12; fi

    # --- the same probe for a branch name carrying a regex metacharacter (WF-929) ---
    git config 'branch.feat+1.remote' fork
    git config 'branch.feat+1.merge' refs/heads/feat+1
    bre=$(printf '%s' 'feat+1' | sed 's/[][\.*^$+?(){}|]/\\&/g')   # <branch-re>, as documented
    probe=$(git config --get-regexp '^branch\.'"$bre"'\.(remote|merge)$' || true)
    remote=$(printf '%s\n' "$probe" | awk '$1 ~ /\.remote$/ {print $2}')
    [ "$remote" = fork ] || { echo "escaped probe read remote '$remote', expected fork" >&2; exit 17; }
    # the raw, unescaped pattern this replaces misses the keys and would fall back to origin
    raw=$(git config --get-regexp '^branch\.feat+1\.(remote|merge)$' || true)
    [ -z "$raw" ] || { echo "the raw pattern unexpectedly matched: $raw" >&2; exit 18; }

    # --- pr-merge pin, as documented, against a stub host honouring --match-head-commit ---
    mkdir "$tmp/bin"
    cat >"$tmp/bin/gh" <<STUB
#!/usr/bin/env bash
cur=\$(git ls-remote --heads "$tmp/fork.git" refs/heads/feat-x | awk '{print \$1}')
case "\$1 \$2" in
  "pr view") printf '%s\n' "\$cur" ;;
  "pr merge") want=""; while [ \$# -gt 0 ]; do [ "\$1" = --match-head-commit ] && want="\$2"; shift; done
              [ -z "\$want" ] || [ "\$want" = "\$cur" ] || { echo "Head branch was modified" >&2; exit 1; }
              echo "\$cur" >"$tmp/merged" ;;
esac
STUB
    chmod +x "$tmp/bin/gh"
    pin_merge() {  # $1 = expected head; prints the documented <state>
      if bash "$tmp/bin/gh" pr merge feat-x --squash --match-head-commit "$1" 2>/dev/null; then
        echo merged
      elif [ "$(bash "$tmp/bin/gh" pr view feat-x --json headRefOid)" != "$1" ]; then
        echo head-moved
      else
        echo error
      fi
    }
    verified=$pushed
    [ "$(pin_merge "$verified")" = merged ] || exit 13                 # unchanged head merges
    [ "$(cat "$tmp/merged")" = "$verified" ] || exit 14                # ...and merges exactly it
    rm -f "$tmp/merged"
    git push -q fork HEAD:refs/heads/feat-x                             # a push lands after verification
    [ "$(pin_merge "$verified")" = head-moved ] || exit 15             # the moved head is refused
    [ ! -e "$tmp/merged" ] || exit 16                                   # ...and nothing was merged
  ) || err "head-binding: behavioral check failed (exit $?) — the non-origin head read or the pinned merge did not behave as documented"
  rm -rf "$tmp"
  [ "$fail" = "$before" ] && ok "head-binding: branch-head-read reads a non-origin remote's head, the escaped upstream probe matches a metacharacter branch name; pr-merge merges an unchanged head and refuses a moved one"
}

echo "== wf-git capability self-checks =="
check_op_list_sane
check_op_sections
check_contract_parity
check_cross_owner_parity
check_typed_results
check_head_binding

if [ "$fail" -ne 0 ]; then
  echo "wf-git self-checks: FAIL" >&2
  exit 1
fi
echo "wf-git self-checks: PASS"
