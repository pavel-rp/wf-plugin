#!/usr/bin/env bash
# wf-postmortem deterministic self-checks — the report-state contract round trip.
#
# Auto-discovered by CI via the convention `plugins/*/capabilities/*/fixtures/run.sh`
# (.github/workflows/ci.yml). Capability-agnostic: CI never names this pack.
#
# The postmortem skill is prose followed by a model, so these checks pin the two things a
# fixture can pin mechanically: (1) the writer (report-template.md), the follow-up parser
# (continuation.md) and the fallback-evidence rules (coverage-cross-check.md) state ONE
# report-state format, spelled identically; and (2) a corpus of reports written to that format
# satisfies the contract's invariants across a first-run -> follow-up -> promotion -> follow-up
# sequence, a legacy-report normalization, and trigger-(b) grouping.
#
# Checks (deterministic, no network, no model):
#   1. CROSS-DOC AGREEMENT — the draw-key grammar, the high-water line and the draw-key
#      suffix appear verbatim where each document states them; the self-contradictory
#      singleton-folder grouping rule is gone.
#   2. CONTINUATION NAVIGATION — continuation.md's Contents anchors resolve to its own
#      headings, and the file stays within its runtime line budget.
#   3. SEQUENCE INVARIANTS — ids never reused or renumbered, a monotonic high-water line,
#      every fallback entry keyed, drawn keys new, suppressed keys already present, no entry
#      or Coverage row ever dropped.
#   4. LEGACY NORMALIZATION — a reference model of the contract's legacy rule reproduces the
#      normalized report exactly, and is a no-op on its output.
#   5. GROUPING — a reference model of Part A step 5 yields one group per task id, id-less
#      candidates as singletons, and no group for a covered id.
#
# Usage:  run.sh    run every check (default; used by CI)
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CAP_DIR="$(dirname "$SCRIPT_DIR")"                    # capabilities/postmortem
PACK_DIR="$(cd "$CAP_DIR/../.." && pwd)"              # plugins/wf-postmortem
REFS="$PACK_DIR/skills/postmortem/references"
TEMPLATE="$REFS/report-template.md"
CONT="$REFS/continuation.md"
CROSS="$REFS/coverage-cross-check.md"
CORPUS="${POSTMORTEM_FIXTURE_CORPUS:-$SCRIPT_DIR/corpus}"   # override: mutation-test a copy
CONT_BUDGET=162

fail=0
err() { printf 'FAIL: %s\n' "$1" >&2; fail=$((fail + 1)); }   # a count, so each section can tell its own failures
ok()  { printf 'ok:   %s\n' "$1"; }

for f in "$TEMPLATE" "$CONT" "$CROSS"; do
  [ -f "$f" ] || { err "missing reference: $f"; exit 1; }
done

# --- 1. Cross-doc agreement -------------------------------------------------------------
KEY_A='(a) | <locator> | <source> | H<n>'
KEY_BI='(b-i) | <run> | <locator> | H<n>'
KEY_BII='(b-ii) | <run>'
for g in "$KEY_A" "$KEY_BI" "$KEY_BII"; do
  for f in "$TEMPLATE" "$CROSS"; do
    grep -qF -- "\`$g\`" "$f" || err "draw-key grammar \`$g\` not stated in $(basename "$f")"
  done
done
for f in "$TEMPLATE" "$CONT"; do
  grep -qF '**Highest minted id:**' "$f" || err "high-water line not named in $(basename "$f")"
done
for f in "$TEMPLATE" "$CROSS"; do
  grep -qF '`· draw key:`' "$f" || err "draw-key suffix not stated in $(basename "$f")"
done
grep -qF 'Report-state contract' "$CONT" || err "continuation.md does not point at the Report-state contract"
grep -qF 'retired id: H<n>' "$TEMPLATE" || err "template does not render a confirmed factor's retired id"
grep -qF 'Legacy state normalized:' "$TEMPLATE" || err "template Continuation entry lacks the legacy-normalization line"
if grep -qF 'every task-folder candidate is its own singleton group' "$CROSS"; then
  err "coverage-cross-check.md still states the contradictory singleton-folder grouping rule"
fi
grep -qF 'by extracted task id first' "$CROSS" || err "coverage-cross-check.md does not group by task id first"
# Confirmation thresholds are unchanged: fallback evidence never confirms, promotion stays two-sided.
grep -qF 'A mechanism is promoted only through the two-sided check.' "$TEMPLATE" \
  || err "template no longer states the two-sided promotion rule"
grep -qF 'It never confirms a factor' "$CROSS" || err "coverage-cross-check.md no longer bars fallback confirmation"
[ "$fail" -eq 0 ] && ok "cross-doc agreement"

# --- 2. Continuation navigation ---------------------------------------------------------
before=$fail
lines=$(wc -l < "$CONT")
[ "$lines" -le "$CONT_BUDGET" ] || err "continuation.md is $lines lines, budget $CONT_BUDGET"
slug() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | sed -e 's/[^a-z0-9 _-]//g' -e 's/ /-/g'; }
anchors=$(grep '^## ' "$CONT" | sed 's/^## //' | while IFS= read -r h; do slug "$h"; echo; done)
links=$(awk '/^## Contents/{on=1;next} /^## /{on=0} on' "$CONT" | grep -o '](#[^)]*)' | sed -e 's/^](#//' -e 's/)$//')
[ -n "$links" ] || err "continuation.md has no Contents links"
nlinks=0
while IFS= read -r l; do
  [ -z "$l" ] && continue
  nlinks=$((nlinks + 1))
  printf '%s\n' "$anchors" | grep -qxF -- "$l" || err "continuation.md Contents link #$l resolves to no heading"
done <<< "$links"
nparts=$(grep -c '^## Part ' "$CONT")
[ "$nlinks" -eq "$nparts" ] || err "continuation.md Contents lists $nlinks entries for $nparts Parts"
[ "$fail" -eq "$before" ] && ok "continuation navigation ($lines lines, $nlinks anchors)"

# --- helpers over one report ------------------------------------------------------------
# id<TAB>mechanism for every hypothesis and confirmed factor
ids_of() {
  awk '
    /^- \*\*H[0-9]+\*\* / { id=$2; gsub(/\*/,"",id); m=$0; sub(/^- \*\*H[0-9]+\*\* /,"",m); sub(/ — suggested from.*/,"",m); print id "\t" m; next }
    /retired id: H[0-9]+/ { match($0,/retired id: H[0-9]+/); id=substr($0,RSTART+12,RLENGTH-12); m=$0; sub(/^- /,"",m); sub(/ — .*/,"",m); print id "\t" m }
  ' "$1"
}
hw_of() { grep '^\*\*Highest minted id:\*\*' "$1" | sed 's/^\*\*Highest minted id:\*\* *//'; }
hw_num() { case "$1" in none|"") echo 0 ;; H*) echo "${1#H}" ;; *) echo -1 ;; esac; }
keys_of() { grep -o 'draw key: `[^`]*`' "$1" | sed -e 's/^draw key: `//' -e 's/`$//' | sort -u; }
sessions_of() {
  awk '/^## Coverage/{on=1;next} /^## /{on=0} on && /^- `/' "$1" | grep -o '^- `[^`]*`' | sed -e 's/^- `//' -e 's/`$//' | sort -u
}
# keys named on one line of the LAST Continuation entry ($2 = line prefix)
last_entry_keys() {
  awk '/^\*\*[0-9-]+ [0-9:]+ follow-up:\*\*$/{buf=""} {buf=buf $0 "\n"} END{printf "%s", buf}' "$1" \
    | grep -F -- "$2" | grep -o '`[^`]*`' | sed -e 's/^`//' -e 's/`$//' | grep '^(' | sort -u
}
KEY_RE='^(\(a\) \| [^|]+ \| [^|]+ \| H[1-9][0-9]*|\(b-i\) \| (task|delivery):[^ |]+ \| [^|]+ \| H[1-9][0-9]*|\(b-ii\) \| (task|delivery):[^ |]+)$'

# --- 3. Sequence invariants -------------------------------------------------------------
before=$fail
reports=("$CORPUS"/sequence/*.md)
[ "${#reports[@]}" -ge 4 ] || err "sequence corpus has ${#reports[@]} reports, expected at least 4"
prev=""
seen_ids=""   # every id minted anywhere earlier in the sequence, id<TAB>mechanism
for r in "${reports[@]}"; do
  name=$(basename "$r")
  hw=$(hw_of "$r")
  [ "$(printf '%s\n' "$hw" | grep -c .)" -eq 1 ] || { err "$name: expected exactly one high-water line"; continue; }
  hwn=$(hw_num "$hw")
  [ "$hwn" -ge 0 ] || err "$name: malformed high-water '$hw'"
  ids=$(ids_of "$r")
  dups=$(printf '%s\n' "$ids" | cut -f1 | grep . | sort | uniq -d)
  [ -z "$dups" ] || err "$name: id(s) carried by more than one entry: $dups"
  while IFS=$'\t' read -r id mech; do
    [ -z "$id" ] && continue
    [ "${id#H}" -le "$hwn" ] || err "$name: $id exceeds the high-water $hw"
  done <<< "$ids"
  bad=$(grep '\[fallback evidence\]' "$r" | grep -v 'draw key: `' || true)
  [ -z "$bad" ] || err "$name: fallback entry without a draw key: $bad"
  while IFS= read -r k; do
    [ -z "$k" ] && continue
    printf '%s\n' "$k" | grep -qE "$KEY_RE" || err "$name: draw key off-grammar: $k"
  done <<< "$(keys_of "$r")"

  if [ -n "$prev" ]; then
    pname=$(basename "$prev"); phwn=$(hw_num "$(hw_of "$prev")")
    [ "$hwn" -ge "$phwn" ] || err "$name: high-water fell from H$phwn to $hw"
    # carried ids keep their mechanism; new ids are minted past every earlier high-water
    while IFS=$'\t' read -r id mech; do
      [ -z "$id" ] && continue
      earlier=$(printf '%s\n' "$seen_ids" | awk -F'\t' -v i="$id" '$1==i{print $2; exit}')
      if [ -n "$earlier" ]; then
        [ "$earlier" = "$mech" ] || err "$name: $id reused for a different mechanism ('$earlier' -> '$mech')"
      else
        [ "${id#H}" -gt "$phwn" ] || err "$name: new $id minted at or below the prior high-water H$phwn"
      fi
    done <<< "$ids"
    # no id silently dropped
    while IFS=$'\t' read -r id mech; do
      [ -z "$id" ] && continue
      printf '%s\n' "$ids" | cut -f1 | grep -qxF "$id" || err "$name: $id from $pname disappeared"
    done <<< "$(ids_of "$prev")"
    # fallback entries never deleted; new keys are exactly this run's draws
    pk=$(keys_of "$prev"); ck=$(keys_of "$r")
    missing=$(comm -23 <(printf '%s\n' "$pk") <(printf '%s\n' "$ck") | grep . || true)
    [ -z "$missing" ] || err "$name: fallback entries dropped since $pname: $missing"
    added=$(comm -13 <(printf '%s\n' "$pk") <(printf '%s\n' "$ck") | grep . || true)
    drawn=$(last_entry_keys "$r" '- Fallback evidence drawn this run:')
    [ "$added" = "$drawn" ] || err "$name: new keys [$added] differ from the keys logged as drawn [$drawn]"
    while IFS= read -r k; do
      [ -z "$k" ] && continue
      printf '%s\n' "$pk" | grep -qxF -- "$k" && err "$name: key drawn again although already present: $k"
    done <<< "$drawn"
    while IFS= read -r k; do
      [ -z "$k" ] && continue
      printf '%s\n' "$pk" | grep -qxF -- "$k" || err "$name: key logged as suppressed but never present: $k"
    done <<< "$(last_entry_keys "$r" '- Fallback evidence suppressed (duplicate key):')"
    lost=$(comm -23 <(sessions_of "$prev") <(sessions_of "$r") | grep . || true)
    [ -z "$lost" ] || err "$name: Coverage rows dropped since $pname: $lost"
  fi
  seen_ids=$(printf '%s\n%s\n' "$seen_ids" "$ids" | grep . | sort -u)
  prev="$r"
done
# The sequence must actually exercise the promotion case: an empty Hypotheses list followed by
# a fresh mint that lands past every retired id.
grep -q '^- \*\*H' "$CORPUS/sequence/03-promotion.md" && err "03-promotion.md should leave the Hypotheses list empty"
grep -qF 'retired id: H1' "$CORPUS/sequence/03-promotion.md" || err "03-promotion.md should retire H1"
# Distinct sources and distinct hypotheses stay distinct keys.
nk=$(keys_of "$CORPUS/sequence/04-follow-up.md" | grep -c '_local/fleet/scoreboard.md')
[ "$nk" -ge 2 ] || err "04-follow-up.md should hold two distinct scoreboard-sourced keys"
[ "$fail" -eq "$before" ] && ok "sequence invariants (${#reports[@]} reports)"

# --- 4. Legacy normalization ------------------------------------------------------------
before=$fail
# Reference model of the contract's legacy rule. Prints mechanism<TAB>id, then HW<TAB><n>.
normalize() {
  awk '
    function valid(x) { return x ~ /^H[1-9][0-9]*$/ }
    /^### Hypotheses/ { inh=1; next }
    /^## / && inh { inh=0 }
    /^\*\*Highest minted id:\*\*/ { v=$0; sub(/^\*\*Highest minted id:\*\* */,"",v); if (valid(v)) rec=substr(v,2)+0; next }
    /^## Contributing Factors/ { incf=1; next }
    /^## / { incf=0 }
    incf && !inh && /^- / && / — `/ {
      m=$0; sub(/^- /,"",m); sub(/ — .*/,"",m); id=""
      if (match($0,/retired id: [^ ]+/)) id=substr($0,RSTART+12,RLENGTH-12)
      n++; mech[n]=m; cand[n]=id; next
    }
    inh && /^- / && $0 !~ /^- none$/ {
      m=$0; sub(/^- /,"",m); id=""
      if (m ~ /^\*\*[^*]+\*\* /) { id=m; sub(/^\*\*/,"",id); sub(/\*\*.*/,"",id); sub(/^\*\*[^*]+\*\* /,"",m) }
      sub(/ — suggested from.*/,"",m)
      n++; mech[n]=m; cand[n]=id
    }
    END {
      hw=rec+0
      for (i=1;i<=n;i++) if (valid(cand[i]) && !(cand[i] in kept)) { kept[cand[i]]=1; out[i]=cand[i]; k=substr(cand[i],2)+0; if (k>hw) hw=k }
      for (i=1;i<=n;i++) if (out[i]=="") { hw++; out[i]="H" hw }
      for (i=1;i<=n;i++) print mech[i] "\t" out[i]
      print "HW\t" hw
    }
  ' "$1"
}
exp=$(normalize "$CORPUS/legacy/before.md")
got=$(ids_of "$CORPUS/legacy/after.md" | awk -F'\t' '{print $2 "\t" $1}')
exp_ids=$(printf '%s\n' "$exp" | grep -v '^HW	' | sort)
[ "$exp_ids" = "$(printf '%s\n' "$got" | sort)" ] \
  || err "legacy: normalized ids differ from the reference model"$'\n'"expected:"$'\n'"$exp_ids"$'\n'"got:"$'\n'"$(printf '%s\n' "$got" | sort)"
exp_hw=$(printf '%s\n' "$exp" | awk -F'\t' '$1=="HW"{print $2}')
[ "$(hw_num "$(hw_of "$CORPUS/legacy/after.md")")" = "$exp_hw" ] || err "legacy: high-water is not H$exp_hw"
# already-valid ids are never renumbered
grep -qF -- '- **H2** retry counter resets' "$CORPUS/legacy/after.md" || err "legacy: valid H2 was renumbered"
# idempotent: normalizing the normalized report changes nothing
again=$(normalize "$CORPUS/legacy/after.md")
[ "$again" = "$exp" ] || err "legacy: normalization is not a no-op on its own output"
for tok in 'assigned H3 (no id)' 'assigned H5 (duplicate of H2)' 'assigned H6 (invalid id "H07")' \
           'highest minted id derived from visible ids (H2)' 'fallback entry without draw key kept:'; do
  grep -qF -- "$tok" "$CORPUS/legacy/after.md" || err "legacy: Continuation does not log: $tok"
done
[ "$fail" -eq "$before" ] && ok "legacy normalization"

# --- 5. Grouping ------------------------------------------------------------------------
before=$fail
# Reference model of Part A step 5: group unmatched candidates by task id first; id-less ones
# are singletons; an id also carried by a covered (matched) candidate forms no group.
got_groups=$(awk -F'\t' '
  { kind[NR]=$1; name[NR]=$2; id[NR]=$3; st[NR]=$4; if ($4=="matched" && $3!="-") covered[$3]=1 }
  END {
    for (i=1;i<=NR;i++) {
      if (st[i]!="unmatched") continue
      if (id[i]=="-") { g["delivery:" name[i]]=1; continue }
      if (!(id[i] in covered)) g["task:" id[i]]=1
    }
    for (k in g) print k
  }' "$CORPUS/grouping/candidates.tsv" | sort)
[ "$got_groups" = "$(sort "$CORPUS/grouping/expected-groups.txt")" ] \
  || err "grouping: groups differ from expected"$'\n'"$got_groups"
[ "$fail" -eq "$before" ] && ok "trigger-(b) grouping"

if [ "$fail" -ne 0 ]; then
  echo "wf-postmortem fixtures: FAILED" >&2
  exit 1
fi
echo "wf-postmortem fixtures: all checks passed"
