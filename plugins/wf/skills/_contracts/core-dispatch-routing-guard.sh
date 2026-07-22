#!/usr/bin/env bash
# core-dispatch-routing-guard.sh — enforce WF-399 fixed core dispatch adoption.
# Model: gpt-5.6-sol[1m]
set -u

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$DIR/../../../.." && pwd)"
DEFAULT_INVENTORY="$DIR/core-dispatch-inventory.tsv"

fail=0
err() { printf 'core-dispatch-routing-guard: %s\n' "$*" >&2; fail=$((fail + 1)); }

scan() {
  local root="$1" inventory="$2" id class file target role selectors evidence retry path body
  [ -f "$inventory" ] || { err "inventory missing: $inventory"; return 1; }
  local seen=""
  while IFS=$'\t' read -r id class file target role selectors evidence retry; do
    [ -z "$id" ] && continue
    case "$id" in \#*) continue ;; esac
    case " $seen " in *" $id "*) err "duplicate inventory id: $id" ;; esac
    seen="$seen $id"
    case "$class" in
      excluded)
        [ -n "$role" ] && [ -n "$evidence" ] || err "$id: malformed exclusion"
        continue
        ;;
      included) ;;
      *) err "$id: classification must be included or excluded"; continue ;;
    esac
    path="$root/$file"
    [ -f "$path" ] || { err "$id: stale inventory path $file"; continue; }
    body="$(<"$path")"
    local target_part old_ifs="$IFS"
    IFS=','
    for target_part in $target; do
      case "$body" in *"$target_part"*) ;; *) err "$id: stale target $target_part in $file" ;; esac
    done
    IFS="$old_ifs"
    if [ "$evidence" = "shared-gate-and-index" ]; then
      case "$body" in *"pipeline-conventions.md"*"/wf:index"*) ;; *) err "$id: shared routed branch/index convention missing in $file" ;; esac
      continue
    fi
    if [ "$evidence" = "index-wrapper-mediated" ]; then
      case "$body" in *"/wf:index"*) ;; *) err "$id: index wrapper invocation missing in $file" ;; esac
      continue
    fi
    local block
    block="$(ROLE="$role" TARGET="$target" perl -0777 -ne '
      $r = quotemeta($ENV{ROLE}); $t = quotemeta($ENV{TARGET});
      if (/resolve_routing[\s\S]{0,1500}?role:\s*(?:"|`)?$r(?:"|`)?[\s\S]{0,8000}?subagent_type:\s*$t[\s\S]{0,1200}/) { print $& }
    ' "$path")"
    [ -n "$block" ] || { err "$id: no routed block associates role $role with target $target in $file"; continue; }
    case "$block" in *"resolve_routing"*) ;; *) err "$id: missing resolve_routing in $file" ;; esac
    case "$block" in *"shapeEvidence"*) ;; *) err "$id: missing shapeEvidence in $file" ;; esac
    case "$block" in *"status:"*"diagnostic"*) ;; *) err "$id: missing stop/diagnostic handling in $file" ;; esac
    case "$block" in *"executionShape"*) ;; *) err "$id: selected shape not obeyed in $file" ;; esac
    case "$block" in *"compact"*"record"*|*"compact"*"metadata"*) ;; *) err "$id: compact routing metadata dropped in $file" ;; esac
    case "$selectors" in
      model=true\;effort=false)
        case "$block" in *"supportsModelSelector: true"*) ;; *) err "$id: model selector-support fact does not match $file" ;; esac
        case "$block" in *"supportsEffortSelector:"*"false"*) ;; *) err "$id: effort selector-support fact does not match $file" ;; esac
        ;;
      model=false\;effort=false)
        case "$block" in *"supportsModelSelector: false"*) ;; *) err "$id: model selector-support fact does not match $file" ;; esac
        case "$block" in *"supportsEffortSelector: false"*) ;; *) err "$id: effort selector-support fact does not match $file" ;; esac
        ;;
      mixed) ;;
      *) err "$id: malformed selector-support facts" ;;
    esac
    case "$block" in *"role:"*"\"$role\""*) ;; *) err "$id: role does not match $file" ;; esac
    local work atomic units independent ambiguity risk tools validation isolation review return_contract parallel
    IFS=',' read -r work atomic units independent ambiguity risk tools validation isolation review return_contract parallel <<< "$evidence"
    [ -n "$parallel" ] || { err "$id: incomplete shape evidence"; continue; }
    case "$work" in caller-context|external-context|dynamic) ;; *) err "$id: invalid workSurface evidence: $work" ;; esac
    case "$atomic" in atomic|composite) ;; *) err "$id: invalid atomicity evidence: $atomic" ;; esac
    case "$units" in dynamic) ;; *[!0-9]*|'') err "$id: invalid unitCount evidence: $units" ;; esac
    case "$independent" in true|false) ;; *) err "$id: invalid unitsIndependent evidence: $independent" ;; esac
    case "$ambiguity" in none|bounded|material) ;; *) err "$id: invalid ambiguity evidence: $ambiguity" ;; esac
    case "$risk" in low|elevated) ;; *) err "$id: invalid risk evidence: $risk" ;; esac
    case "$tools" in none|bounded|material|dynamic) ;; *) err "$id: invalid toolWork evidence: $tools" ;; esac
    case "$validation" in mechanical|judgment) ;; *) err "$id: invalid validation evidence: $validation" ;; esac
    case "$isolation" in none|useful|required) ;; *) err "$id: invalid contextIsolation evidence: $isolation" ;; esac
    case "$review" in true|false) ;; *) err "$id: invalid independentReview evidence: $review" ;; esac
    case "$return_contract" in mechanically-judgeable|judgment) ;; *) err "$id: invalid returnContract evidence: $return_contract" ;; esac
    case "$parallel" in dynamic) ;; *[!0-9]*|'') err "$id: invalid requestedParallelism evidence: $parallel" ;; esac
    local normalized_block i
    local -a evidence_fields=(workSurface atomicity unitCount unitsIndependent ambiguity risk toolWork validation contextIsolation independentReview returnContract requestedParallelism)
    local -a evidence_values=("$work" "$atomic" "$units" "$independent" "$ambiguity" "$risk" "$tools" "$validation" "$isolation" "$review" "$return_contract" "$parallel")
    normalized_block="$(printf '%s' "$block" | tr '\n' ' ' | tr -s '[:space:]' ' ')"
    for i in "${!evidence_fields[@]}"; do
      if [ "${evidence_values[$i]}" = "dynamic" ]; then
        case "$normalized_block" in *"${evidence_fields[$i]}:"*) ;; *) err "$id: callsite omits dynamic ${evidence_fields[$i]} evidence in $file" ;; esac
      else
        case "$normalized_block" in
          *"${evidence_fields[$i]}: \"${evidence_values[$i]}\""*|*"${evidence_fields[$i]}: ${evidence_values[$i]}"*) ;;
          *) err "$id: inventory ${evidence_fields[$i]}=${evidence_values[$i]} does not match its callsite block in $file" ;;
        esac
      fi
    done
    case "$block" in *"only when non-null"*|*"when non-null"*|*"non-null model selector"*|*"non-null model"*|*"selector only when"*|*"model selector only when non-null"*) ;;
      *) case "$selectors" in model=false\;effort=false|mixed) ;; *) err "$id: non-null-only selector forwarding absent in $file" ;; esac ;;
    esac
  done < "$inventory"

  # Discover executable fixed dispatch syntax. Every core file/target pair must be
  # represented by an included row, except the four reviewable exclusion classes.
  while IFS=: read -r file line text; do
    [ -n "$file" ] || continue
    case "$file" in
      *"/_contracts/"*|*"/references/"*) continue ;;
    esac
    case "$text" in
      *"registered"*"provider"*|*"fragment"*"subagent"*|*"Next:"*) continue ;;
    esac
    target="$(printf '%s' "$text" | grep -oE 'subagent_type: (wf:[a-z0-9-]+|general-purpose)' | head -1 | cut -d' ' -f2)"
    [ -n "$target" ] || continue
    file="${file#$root/}"
    if ! awk -F '\t' -v f="$file" -v t="$target" '$2=="included" && $3==f && index($4,t){found=1} END{exit !found}' "$inventory"; then
      err "unlisted live dispatch $file:$line ($target)"
    fi
  done < <(grep -RInE 'Invoke (one |the )?\*\*Task\*\*|invoke one \*\*Task\*\*|Spawn each shipper|subagent_type: general-purpose' "$root/plugins/wf/skills" "$root/plugins/wf/agents" --include='*.md' 2>/dev/null || true)

  [ "$fail" -eq 0 ] && printf 'Core dispatch routing guard passed: %s included, %s explicit exclusions.\n' \
    "$(awk -F '\t' '$2=="included"{n++} END{print n+0}' "$inventory")" \
    "$(awk -F '\t' '$2=="excluded"{n++} END{print n+0}' "$inventory")"
  [ "$fail" -eq 0 ]
}

selftest() {
  local tmp rc=0
  tmp="$(mktemp -d)"
  mkdir -p "$tmp/plugins/wf/skills/demo"
  cat > "$tmp/plugins/wf/skills/demo/SKILL.md" <<'EOF'
Call `resolve_routing` with `role: "demo"`, `shapeEvidence: { workSurface: "external-context", atomicity: "atomic", unitCount: 1, unitsIndependent: false, ambiguity: "none", risk: "low", toolWork: "bounded", validation: "mechanical", contextIsolation: "useful", independentReview: false, returnContract: "mechanically-judgeable", requestedParallelism: 1 }`, `supportsModelSelector: true`, and `supportsEffortSelector: false`; emit compact metadata; on `status: stop` or non-null `diagnostic`, stop. Obey `executionShape`; pass the model selector only when non-null. Invoke the **Task** tool with `subagent_type: wf:demo`.
EOF
  cat > "$tmp/pass.tsv" <<'EOF'
demo	included	plugins/wf/skills/demo/SKILL.md	wf:demo	demo	model=true;effort=false	external-context,atomic,1,false,none,low,bounded,mechanical,useful,false,mechanically-judgeable,1	parent
provider	excluded	plugins/wf/skills/**	provider	WF-400	—	registry-derived provider dispatch	—
EOF
  fail=0; scan "$tmp" "$tmp/pass.tsv" >/dev/null || rc=1
  cp "$tmp/pass.tsv" "$tmp/bad.tsv"; printf 'stale\tincluded\tplugins/wf/skills/missing.md\twf:missing\tindex\tmodel=false;effort=false\texternal-context,atomic,1,dependent,none,low,bounded,mechanical,useful,false,mechanically-judgeable,1\tparent\n' >> "$tmp/bad.tsv"
  fail=0; scan "$tmp" "$tmp/bad.tsv" >/dev/null 2>&1 && rc=1
  sed 's/,mechanically-judgeable,1/,1/' "$tmp/pass.tsv" > "$tmp/evidence.tsv"
  fail=0; scan "$tmp" "$tmp/evidence.tsv" >/dev/null 2>&1 && rc=1
  sed 's/compact metadata/metadata/' "$tmp/plugins/wf/skills/demo/SKILL.md" > "$tmp/plugins/wf/skills/demo/tmp" && mv "$tmp/plugins/wf/skills/demo/tmp" "$tmp/plugins/wf/skills/demo/SKILL.md"
  fail=0; scan "$tmp" "$tmp/pass.tsv" >/dev/null 2>&1 && rc=1
  [ "$rc" -eq 0 ] && printf 'Core dispatch routing guard self-test passed.\n'
  rm -rf "$tmp"
  return "$rc"
}

case "${1:-}" in
  --selftest) selftest ;;
  --scan) fail=0; scan "${2:?root required}" "${3:?inventory required}" ;;
  "") fail=0; scan "$ROOT" "$DEFAULT_INVENTORY" ;;
  *) printf 'usage: %s [--selftest|--scan ROOT INVENTORY]\n' "$0" >&2; exit 2 ;;
esac
