#!/usr/bin/env bash
# currency-check-guard.sh — the version-currency check must keep all four of its
# paths, and must never let a non-check render as a pass.
#
# The two run-driving bodies — the fan-out orchestrator and the single-task
# shipper — compare the version they are executing against the newest published
# one at Prerequisites. That check has FOUR outcomes, and its whole value is that
# only ONE of them asserts currency. A silent regression here is invisible: an
# edit that drops the provider-less branch, or that lets `current` render on a
# degraded read, leaves every other guard green while turning "the check did not
# run" into "you are up to date" — the exact misreading the outcome was written
# to prevent.
#
# For each body it asserts:
#
#   1. the branch is taken on SURFACE OWNERSHIP, never on what a read returned —
#      the contract keeps those two decisions separate on purpose;
#   2. the provider-present branch names the abstract published-version read;
#   3. the declaration is the resolver-served config value, so no body names a
#      path of its own;
#   4. the provider-less branch falls back to the local install inventory;
#   5. all FOUR outcome tokens are present;
#   6. `current` is explicitly gated on a performed read;
#   7. the non-check outcomes are explicitly stated NOT to be a pass;
#   8. the block carries the `Currency:` label (position and column belong to
#      run-block-slot-guard.sh, which is deliberately not duplicated here);
#   9. no host, marketplace, repository, or release-channel noun appears — core
#      names a version and a declaration, never where versions are published.
#
# The fan-out body additionally carries the durable scoreboard header stamp, the
# third render site.
#
# --selftest runs the same evaluator over seeded synthetic bodies and requires it
# to REJECT each defective one and ACCEPT the sound one. A lint that scans a clean
# tree and finds nothing is indistinguishable from a lint that does nothing.
# Rejections are checked for the guard's own violation exit (1), never a harness
# error (2), so a broken fixture cannot masquerade as a caught defect.
#
# Usage:  bash currency-check-guard.sh              # live-tree scan (what CI runs)
#         bash currency-check-guard.sh --selftest   # seeded fixtures only
#
# Exit 0 = both bodies conform; exit 1 = at least one violation; exit 2 = the
# guard could not run (a target file is missing).
#
# Model: claude-opus-5[1m]
set -u

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$DIR/../../../.." && pwd)"

fail=0
err() { printf 'currency-check-guard: %s\n' "$*" >&2; }

# A noun here would mean core had learned WHERE versions are published. The
# operation names a published state; it never names the thing publishing it.
BANNED_NOUNS='github|gitlab|bitbucket|marketplace|npmjs|homebrew|crates\.io|pypi|release channel|package registry|plugin cache'

# require <file> <label> <rule-id> <description> <extended-regex>
# Prints a diagnostic and returns 1 when the pattern is absent.
require() {
  local file="$1" label="$2" rule="$3" desc="$4" pattern="$5"
  if grep -qiE "$pattern" "$file"; then
    return 0
  fi
  printf '%s: [%s] %s — no line matches /%s/\n' "$label" "$rule" "$desc" "$pattern"
  return 1
}

# evaluate_body <file> <label> <expect-header-stamp: yes|no>
#
# Applies the nine rules. Prints one diagnostic per violation; returns 1 if any
# fired, 0 when clean.
evaluate_body() {
  local file="$1" label="$2" want_stamp="$3"
  local bad=0 n=0

  require "$file" "$label" C1 'the branch is taken on surface ownership' \
    'branch on \*\*surface ownership\*\*' || bad=1
  require "$file" "$label" C1b 'surface ownership is not inferred from a read result' \
    'never on what a read returned' || bad=1
  require "$file" "$label" C2 'the provider-present branch names the published-version read' \
    'newest-published-version-read' || bad=1
  require "$file" "$label" C3 'the declaration comes from resolved config' \
    'coreConfig\.versionDeclaration' || bad=1
  require "$file" "$label" C4 'the provider-less branch falls back to the local install inventory' \
    'local install inventory' || bad=1
  require "$file" "$label" C4b 'the inventory fallback names the resolver query it uses' \
    'discover_packs' || bad=1

  # Rule 5 — all four outcome tokens. Each is quoted at the start of its own
  # bullet, so the token plus its em-dash is the stable anchor.
  local tok
  for tok in 'current' 'trailing' 'provider-less' 'not checked'; do
    if ! grep -qE "\`${tok} —" "$file"; then
      printf '%s: [C5] outcome token `%s` is absent; the check has four outcomes and each must render\n' "$label" "$tok"
      bad=1
    fi
  done

  # A backtick is not written into these patterns: GNU grep reads `\`` as a
  # start-of-buffer anchor in ERE, so the literal is matched by `.` instead.
  require "$file" "$label" C6 'the outcome is gated on a performed read' \
    'emitted \*\*only\*\* on .<read-performed>. = true' || bad=1
  require "$file" "$label" C6b 'only the current token asserts currency' \
    'only .current. asserts currency' || bad=1
  require "$file" "$label" C7 'a non-check is explicitly not a pass' \
    'never rounded up to a pass|is \*\*not\*\* a pass' || bad=1
  require "$file" "$label" C8 'the run block carries the Currency label' \
    '^Currency:' || bad=1

  # Rule 9 — the noun ban.
  n=$(grep -icE "$BANNED_NOUNS" "$file")
  if [ "$n" -ne 0 ]; then
    printf '%s: [C9] %d line(s) name a host, marketplace, repository, or release-channel noun; core names a version and a declaration only\n' "$label" "$n"
    grep -inE "$BANNED_NOUNS" "$file" | head -5
    bad=1
  fi

  if [ "$want_stamp" = "yes" ]; then
    if ! grep -q '\*\*Currency:\*\*' "$file"; then
      printf '%s: [C10] the scoreboard header carries no **Currency:** stamp; the outcome must render at every site, under one label token\n' "$label"
      bad=1
    fi
  fi

  [ "$bad" -eq 0 ] || return 1
  printf '%s: OK — ownership branch, published read, served declaration, inventory fallback, four outcome tokens, performed-read gate, stated non-pass, Currency label%s\n' \
    "$label" "$( [ "$want_stamp" = "yes" ] && printf ', header stamp' )"
  return 0
}

# --- self-test --------------------------------------------------------------

if [ "${1:-}" = "--selftest" ]; then
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT

  # A sound body carrying every asserted property, in the live wording.
  sound_body() {
    cat <<'SOUND'
Branch on **surface ownership** — the record's `state` — never on what a read returned:

- **Owned** — invoke the delivery `newest-published-version-read` operation once,
  passing `coreConfig.versionDeclaration` as the already-resolved declaration.
- **Unowned** — fall back to the **local install inventory** the resolver already
  serves read-only (`discover_packs`).

There are four leading tokens and **only `current` asserts currency**, emitted **only** on `<read-performed>` = true:

- `current — running <version>, newest published <version>` — no warning.
- `trailing — running <version>, newest published <version>` — warn here.
- `provider-less — no delivery provider; newest recorded locally <version>` — this
  is **not** a pass and never renders as one.
- `not checked — <reason>` — the check did not complete.

```
BLOCK — <A | B>

Version:  <resolved | unknown>
Currency: <current | trailing | provider-less | not checked — <reason>>
Next:     <none — terminus>
```

`provider-less` and `not checked` name what did **not** happen and are never
rounded up to a pass here.
SOUND
  }

  sound_body >"$tmp/sound.md"

  # Defect 1 — the provider-less branch is gone, so an unowned surface would fall
  # through with nothing said.
  sound_body | grep -v 'provider-less — no delivery provider' >"$tmp/no-providerless.md"

  # Defect 2 — the ownership branch is gone, so presence would be inferred from a
  # read's result.
  sound_body | sed 's/Branch on \*\*surface ownership\*\*/Branch on the read result/' >"$tmp/no-ownership.md"

  # Defect 3 — `current` is no longer gated on a performed read, so a degraded
  # read could render as a pass. This is the defect the whole outcome exists for.
  sound_body | sed 's/, emitted \*\*only\*\* on `<read-performed>` = true:/, emitted whenever the check finishes:/' >"$tmp/ungated.md"

  # Defect 4 — the inventory fallback lost the query it names, so the branch has
  # no way to run.
  sound_body | sed 's/(`discover_packs`)/(some inventory)/' >"$tmp/no-inventory.md"

  # Defect 5 — a host noun leaked into core prose.
  sound_body | sed 's/the newest published state/the GitHub release/' >"$tmp/host-noun.md"
  printf 'The newest published version is read from the marketplace.\n' >>"$tmp/host-noun.md"

  # Defect 6 — the served declaration was replaced by a hardcoded path.
  sound_body | sed 's/`coreConfig\.versionDeclaration`/`plugins\/unit\/manifest.json`/' >"$tmp/hardcoded.md"

  # Defect 7 — the block lost its Currency label, so the outcome renders nowhere.
  sound_body | grep -v '^Currency:' >"$tmp/no-label.md"

  selftest_fail=0
  for case in no-providerless no-ownership ungated no-inventory host-noun hardcoded no-label; do
    evaluate_body "$tmp/$case.md" "selftest/$case" no >/dev/null 2>&1
    rc=$?
    if [ "$rc" -ne 1 ]; then
      err "SELFTEST FAIL — seeded '$case' body returned exit $rc; expected 1 (a violation, not a harness error or a pass)"
      selftest_fail=$((selftest_fail + 1))
    fi
  done

  if ! evaluate_body "$tmp/sound.md" "selftest/sound" no >/dev/null 2>&1; then
    err "SELFTEST FAIL — the evaluator REJECTED the seeded sound body"
    evaluate_body "$tmp/sound.md" "selftest/sound" no >&2
    selftest_fail=$((selftest_fail + 1))
  fi

  # The header-stamp rule must catch a missing stamp when one is expected.
  if evaluate_body "$tmp/sound.md" "selftest/sound-nostamp" yes >/dev/null 2>&1; then
    err "SELFTEST FAIL — the header-stamp rule ACCEPTED a body carrying no **Currency:** stamp"
    selftest_fail=$((selftest_fail + 1))
  fi

  if [ "$selftest_fail" -ne 0 ]; then
    err "self-test FAILED ($selftest_fail case(s))"
    exit 1
  fi
  echo "currency-check-guard: self-test passed — seven seeded defects rejected (dropped provider-less branch, ownership inferred from a read, an ungated \`current\`, a fallback with no inventory query, a leaked host noun, a hardcoded declaration, a missing Currency label), a missing header stamp rejected, and the sound body accepted."
  exit 0
fi

# --- live-tree scan ---------------------------------------------------------

FLEET="$ROOT/plugins/wf/skills/fleet/SKILL.md"
SHIP="$ROOT/plugins/wf/skills/ship/SKILL.md"

for f in "$FLEET" "$SHIP"; do
  if [ ! -f "$f" ]; then
    err "target file is absent: $f"
    exit 2
  fi
done

evaluate_body "$FLEET" "FLEET" yes || fail=$((fail + 1))
evaluate_body "$SHIP" "SHIP" no || fail=$((fail + 1))

if [ "$fail" -ne 0 ]; then
  err "FAIL — $fail body/bodies no longer carry every path of the version-currency check."
  exit 1
fi
echo "currency-check-guard: PASS — both run-driving bodies keep all four currency paths, gate \"current\" on a performed read, state a non-check as a non-pass, and name no host, marketplace, repository, or release-channel noun."
