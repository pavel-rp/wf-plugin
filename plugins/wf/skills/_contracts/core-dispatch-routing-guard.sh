#!/usr/bin/env bash
# core-dispatch-routing-guard.sh — enforce WF-399 fixed core dispatch adoption.
# Model: gpt-5.6-sol[1m]
set -u

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$DIR/../../../.." && pwd)"
DEFAULT_INVENTORY="$DIR/core-dispatch-inventory.tsv"

fail=0
err() { printf 'core-dispatch-routing-guard: %s\n' "$*" >&2; fail=$((fail + 1)); }

is_prose_only_skill_line() {
  local line="$1"
  while case "$line" in [[:space:]\>\*-]*) true ;; *) false ;; esac; do
    line="${line:1}"
  done
  case "$line" in Next:*|Example:*|example:*|Recommendation:*|recommendation:*|Suggestion:*|suggestion:*) return 0 ;; esac
  case "$1" in *"may invoke"*|*"should never invoke"*|*"that invoked"*|*"If the Skill-tool invocation fails"*) return 0 ;; esac
  return 1
}

permission_list_context() {
  local file="$1" line="$2"
  awk -v stop="$line" '
    NR>stop{exit}
    /^## /{active=0; started=0}
    /^\*\*Allowed:\*\*/ || /^\*\*Forbidden:\*\*/{active=1; started=0; next}
    active {
      if ($0 ~ /^[[:space:]]*$/) {
        if (started) active=0
      } else if ($0 ~ /^[[:space:]]*[-*][[:space:]]/) {
        started=1
      } else if (!started || $0 !~ /^[[:space:]]{2,}/) {
        active=0
      }
    }
    END{print active+0}
  ' "$file"
}

inventory_target_present() {
  local path="$1" raw="$2"
  TARGET="$raw" perl -0777 -ne '
    $raw=$ENV{TARGET};
    if ($raw =~ m{/(?:wf:[a-z0-9-]+|<skill>|wf:<phase>)}) {
      $token=$&; exit 0 if /\Q$token\E(?![a-z0-9-])/;
    } elsif ($raw =~ /(?:^|[^a-z0-9-])((?:wf:[a-z0-9-]+|general-purpose))(?![a-z0-9-])/) {
      $token=$1; exit 0 if /(?<![a-z0-9\/-])\Q$token\E(?![a-z0-9-])/;
    } else {
      exit 0 if index($_, $raw) >= 0;
    }
    exit 1;
  ' "$path"
}

inventory_count_task_target() {
  local inventory="$1" file="$2" target="$3"
  awk -F '\t' -v f="$file" -v t="$target" '
    $2=="included" && $3==f && $7!="index-wrapper-mediated" && $7!="fixed-skill-route" {
      s=$4; matched=0
      while (match(s, /\/?wf:[a-z0-9-]+|general-purpose/)) {
        token=substr(s, RSTART, RLENGTH); sub(/^\//, "", token)
        if (token==t) matched=1
        s=substr(s, RSTART+RLENGTH)
      }
      if (matched) n++
    }
    END{print n+0}
  ' "$inventory"
}

inventory_has_task_target() {
  local inventory="$1" file="$2" target="$3"
  awk -F '\t' -v f="$file" -v t="$target" '
    $2=="included" && $3==f {
      s=$4
      while (match(s, /\/?wf:[a-z0-9-]+|general-purpose/)) {
        token=substr(s, RSTART, RLENGTH)
        sub(/^\//, "", token)
        if (token==t) found=1
        s=substr(s, RSTART+RLENGTH)
      }
    }
    END{exit !found}
  ' "$inventory"
}

inventory_has_index_wrapper_target() {
  local inventory="$1" file="$2" target="$3"
  awk -F '\t' -v f="$file" -v t="$target" '
    $2=="included" && $3==f && $7=="index-wrapper-mediated" {
      s=$4
      while (match(s, /\/?wf:[a-z0-9-]+/)) {
        token=substr(s, RSTART, RLENGTH); sub(/^\//, "", token)
        if (token==t) found=1
        s=substr(s, RSTART+RLENGTH)
      }
    }
    END{exit !found}
  ' "$inventory"
}

inventory_has_skill_target() {
  local inventory="$1" file="$2" target="$3"
  awk -F '\t' -v f="$file" -v t="$target" '
    $2=="included" && $3==f {
      s=$4
      while (match(s, /\/(wf:[a-z0-9-]+|<skill>|wf:<phase>)/)) {
        if (substr(s, RSTART, RLENGTH)==t) found=1
        s=substr(s, RSTART+RLENGTH)
      }
    }
    END{exit !found}
  ' "$inventory"
}

inventory_count_fixed_skill_target() {
  local inventory="$1" file="$2" target="$3"
  awk -F '\t' -v f="$file" -v t="$target" '
    $2=="included" && $3==f && $7=="fixed-skill-route" {
      s=$4
      while (match(s, /\/(wf:[a-z0-9-]+|<skill>|wf:<phase>)/)) {
        if (substr(s, RSTART, RLENGTH)==t) n++
        s=substr(s, RSTART+RLENGTH)
      }
    }
    END{print n+0}
  ' "$inventory"
}

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
      inventory_target_present "$path" "$target_part" || err "$id: stale or non-exact target $target_part in $file"
    done
    IFS="$old_ifs"
    case "$evidence" in
      shared-branch-gate)
        case "$body" in *"pipeline-conventions.md"*"Branch gate"*) ;; *) err "$id: shared routed branch convention missing in $file" ;; esac
        continue
        ;;
      index-wrapper-mediated)
        case "$body" in *"/wf:index"*) ;; *) err "$id: index wrapper invocation missing in $file" ;; esac
        continue
        ;;
      fixed-skill-route)
        local skill_block
        skill_block="$(ROLE="$role" TARGET="$target" perl -0777 -ne '
          $r = quotemeta($ENV{ROLE}); $t = quotemeta($ENV{TARGET});
          if (/role:\s*"$r"[\s\S]{0,2500}?$t/) { print $& }
        ' "$path")"
        [ -n "$skill_block" ] || { err "$id: no nearby role $role decision precedes Skill target $target in $file"; continue; }
        case "$body" in *"resolve_routing"*) ;; *) err "$id: fixed Skill edge lacks resolve_routing in $file" ;; esac
        case "$body" in *"role: \"$role\""*) ;; *) err "$id: fixed Skill role is not stated in $file" ;; esac
        case "$body" in *"shapeEvidence"*"supportsModelSelector: false"*"supportsEffortSelector: false"*) ;; *) err "$id: fixed Skill selector/shape facts are incomplete in $file" ;; esac
        case "$body" in *"actualModel"*"compact operational record"*) ;; *) err "$id: optional actualModel or compact record handling is absent in $file" ;; esac
        case "$body" in *"status: stop"*"diagnostic"*) ;; *) err "$id: fixed Skill stop/diagnostic behavior is absent in $file" ;; esac
        case "$body" in *"executionShape"*|*"inline"*"shape"*) ;; *) err "$id: fixed Skill shape obedience is absent in $file" ;; esac
        case "$body" in *"$target"*) ;; *) err "$id: fixed Skill target is absent in $file" ;; esac
        if [ "$retry" != "—" ]; then
          case "$body" in *"postAttempt"*"never self"*|*"postAttempt"*"never invokes its own replacement"*) ;; *) err "$id: parent retry ownership is not explicit in $file" ;; esac
        fi
        continue
        ;;
      fleet-cardinality-route)
        case "$body" in *"resolve_routing"*"role: \"shipper\""*"subagent_type: general-purpose"*) ;; *) err "$id: fleet shipper route is incomplete in $file" ;; esac
        case "$body" in *"One-item wave"*"workSurface: \"external-context\""*"atomicity: \"atomic\""*"unitCount: 1"*"unitsIndependent: false"*"requestedParallelism: 1"*"isolated"*) ;; *) err "$id: singleton fleet evidence is not the exact atomic isolated contract in $file" ;; esac
        case "$body" in *"Multi-item wave"*"workSurface: \"external-context\""*"atomicity: \"composite\""*"unitCount: <wave-size>"*"unitsIndependent: true"*"requestedParallelism: <configured-pool-bound>"*"bounded-parallel"*) ;; *) err "$id: multi-item fleet evidence is not the exact composite bounded contract in $file" ;; esac
        case "$body" in *"supportsModelSelector: true"*"supportsEffortSelector: false"*"invocationModel"*) ;; *) err "$id: fleet selector facts are incomplete in $file" ;; esac
        case "$body" in *"compact operational record"*"status: stop"*"diagnostic"*"executionShape"*"effectiveParallelism"*) ;; *) err "$id: fleet routing outcome handling is incomplete in $file" ;; esac
        case "$body" in *"postAttempt"*"never"*"self"*) ;; *) err "$id: fleet parent retry ownership is absent in $file" ;; esac
        continue
        ;;
      fleet-recovery-route)
        case "$body" in *"resolve_routing"*"role: \"shipper\""*"postAttempt"*"$target"*) ;; *) err "$id: fleet recovery lacks a parent-owned routing decision in $file" ;; esac
        continue
        ;;
    esac
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

  # Discover executable dispatch syntax structurally. Task/Agent calls are concrete
  # subagent_type declarations. Skill calls are executable directives in operational
  # sections; command syntax, safety lists, examples, recommendations, Next blocks,
  # and Edge Cases are structurally excluded rather than hidden by favored phrases.
  local candidates
  candidates="$(mktemp)" || { err "cannot create Task/Agent discovery file"; return 1; }
  while IFS=: read -r file line text; do
    [ -n "$file" ] || continue
    case "$file" in *"/_contracts/"*|*"/references/"*) continue ;; esac
    local task_permission task_heading task_routed
    task_permission="$(permission_list_context "$file" "$line")"
    task_heading="$(awk -v stop="$line" 'NR>stop{exit} /^## /{heading=$0} END{print heading}' "$file")"
    [ "$task_permission" -eq 1 ] && continue
    case "$task_heading" in ""|*" contract"*) continue ;; esac
    case "$text" in *"may invoke"*|*"registered"*"provider"*|*"fragment"*"subagent"*|*"Next:"*) continue ;; esac
    task_routed="$(awk -v stop="$line" 'NR>stop{exit} /^## /{routed=0} /resolve_routing/{routed=1} END{print routed+0}' "$file")"
    while IFS= read -r target; do
      [ -n "$target" ] || continue
      target="${target#subagent_type: }"
      printf '%s\t%s\t%s\t%s\n' "${file#$root/}" "$line" "$target" "$task_routed" >> "$candidates"
    done < <(printf '%s' "$text" | grep -oE 'subagent_type: (wf:[a-z0-9-]+|general-purpose)' || true)
  done < <(grep -RInE 'subagent_type: (wf:[a-z0-9-]+|general-purpose)' "$root/plugins/wf/skills" "$root/plugins/wf/agents" --include='*.md' 2>/dev/null || true)

  while IFS=$'\t' read -r file line target routed; do
    if ! inventory_has_task_target "$inventory" "$file" "$target"; then
      err "unlisted live Task/Agent dispatch $file:$line ($target)"
    fi
  done < "$candidates"

  # One Task/Agent inventory row represents one executable occurrence. Exact token
  # counts prevent a single row or a longer sibling name from laundering another edge.
  while IFS=$'\t' read -r file target; do
    [ -n "$file" ] && [ -n "$target" ] || continue
    local task_discovered task_declared
    task_discovered="$(awk -F '\t' -v f="$file" -v t="$target" '$1==f && $3==t{n++} END{print n+0}' "$candidates")"
    task_declared="$(inventory_count_task_target "$inventory" "$file" "$target")"
    # Index-wrapper rows are counted by their concrete Skill occurrences below; their
    # single shared Task wrapper is not another logical edge.
    if [ "$task_declared" -eq 0 ] && inventory_has_index_wrapper_target "$inventory" "$file" "$target"; then
      continue
    fi
    if [ "$task_discovered" -ne "$task_declared" ]; then
      err "$file: Task/Agent target $target has $task_discovered executable occurrence(s) but $task_declared inventory row(s)"
    fi
  done < <(cut -f1,3 "$candidates" | sort -u)

  local skill_candidates declared_skill_pairs skill_pairs
  skill_candidates="$(mktemp)" || { err "cannot create Skill discovery file"; rm -f "$candidates"; return 1; }
  declared_skill_pairs="$(mktemp)" || { err "cannot create declared-Skill file"; rm -f "$candidates" "$skill_candidates"; return 1; }
  skill_pairs="$(mktemp)" || { err "cannot create Skill-pair file"; rm -f "$candidates" "$skill_candidates" "$declared_skill_pairs"; return 1; }
  while IFS=: read -r file line text; do
    [ -n "$file" ] || continue
    case "$file" in *"/_contracts/"*|*"/references/"*) continue ;; esac
    local permission
    permission="$(permission_list_context "$file" "$line")"
    # Only contiguous Allowed/Forbidden list prose is non-executable. Headings such
    # as Edge Cases or Final Output receive no blanket exemption.
    [ "$permission" -eq 1 ] && continue
    is_prose_only_skill_line "$text" && continue
    file="${file#$root/}"
    while IFS= read -r target; do
      [ -n "$target" ] || continue
      printf '%s\t%s\t%s\n' "$file" "$line" "$target" >> "$skill_candidates"
      if ! inventory_has_skill_target "$inventory" "$file" "$target"; then
        err "unlisted live Skill dispatch $file:$line ($target)"
      fi
    done < <(printf '%s' "$text" | grep -oE '/(wf:[a-z0-9-]+|<skill>|wf:<phase>)' || true)
  done < <(grep -RInE '([Ss]kill tool|Skill-tool).*/(wf:[a-z0-9-]+|<skill>|wf:<phase>)|/(wf:[a-z0-9-]+|<skill>|wf:<phase>).*([Ss]kill tool|Skill-tool)|(^|[[:space:]])(invoke|re-invoke|execute|call).*/wf:index' "$root/plugins/wf/skills" "$root/plugins/wf/agents" --include='*.md' 2>/dev/null || true)

  # A Skill-tool execution signal may be split from its concrete target by one
  # adjacent markdown line. Join that pair structurally; prose-only signals remain inert.
  while IFS=: read -r file line text; do
    [ -n "$file" ] || continue
    case "$file" in *"/_contracts/"*|*"/references/"*) continue ;; esac
    case "$text" in *"/wf:"*|*"/<skill>"*) continue ;; esac
    local permission next_line next_text next_permission
    permission="$(permission_list_context "$file" "$line")"
    [ "$permission" -eq 1 ] && continue
    is_prose_only_skill_line "$text" && continue
    next_line=$((line + 1))
    next_text="$(awk -v target="$next_line" 'NR==target{print; exit}' "$file")"
    [ -n "$next_text" ] || continue
    next_permission="$(permission_list_context "$file" "$next_line")"
    [ "$next_permission" -eq 1 ] && continue
    is_prose_only_skill_line "$next_text" && continue
    file="${file#$root/}"
    while IFS= read -r target; do
      [ -n "$target" ] || continue
      printf '%s\t%s\t%s\n' "$file" "$next_line" "$target" >> "$skill_candidates"
      if ! inventory_has_skill_target "$inventory" "$file" "$target"; then
        err "unlisted adjacent-line Skill dispatch $file:$next_line ($target)"
      fi
    done < <(printf '%s' "$next_text" | grep -oE '/(wf:[a-z0-9-]+|<skill>|wf:<phase>)' || true)
  done < <(grep -RInE '([Ss]kill tool|Skill-tool)' "$root/plugins/wf/skills" "$root/plugins/wf/agents" --include='*.md' 2>/dev/null || true)

  # A fixed Skill target cannot disappear or be laundered by another occurrence in
  # the same file. Compare the union of declared and discovered file+target pairs;
  # every discovered occurrence consumes exactly one fixed-route inventory row.
  while IFS=$'\t' read -r id class file target role selectors evidence retry; do
    [ "$class" = "included" ] && [ "$evidence" = "fixed-skill-route" ] || continue
    while IFS= read -r target_part; do
      [ -n "$target_part" ] && printf '%s\t%s\n' "$file" "$target_part" >> "$declared_skill_pairs"
    done < <(printf '%s' "$target" | grep -oE '/(wf:[a-z0-9-]+|<skill>|wf:<phase>)' || true)
  done < "$inventory"
  if ! { cut -f1,3 "$skill_candidates"; cat "$declared_skill_pairs"; } | sort -u > "$skill_pairs"; then
    err "cannot compose declared/discovered Skill pairs"
    rm -f "$candidates" "$skill_candidates" "$declared_skill_pairs" "$skill_pairs"
    return 1
  fi
  while IFS=$'\t' read -r file target; do
    [ -n "$file" ] && [ -n "$target" ] || continue
    local discovered declared
    discovered="$(awk -F '\t' -v f="$file" -v t="$target" '$1==f && $3==t{n++} END{print n+0}' "$skill_candidates")"
    declared="$(inventory_count_fixed_skill_target "$inventory" "$file" "$target")"
    if [ "$declared" -gt 0 ] && [ "$discovered" -ne "$declared" ]; then
      err "$file: fixed Skill target $target has $discovered executable occurrence(s) but $declared inventory row(s)"
    fi
  done < "$skill_pairs"

  # Fixed sibling-Skill execution is represented one edge per included inventory row.
  # The structural classes prove a local routing procedure or the routed index wrapper;
  # prose-only and provider/pack execution remain explicit exclusions.
  while IFS=$'\t' read -r id class file target role selectors evidence retry; do
    [ "$class" = "included" ] || continue
    case "$evidence" in fixed-skill-route|index-wrapper-mediated)
      path="$root/$file"
      case "$(<"$path")" in *"$target"*) ;; *) err "$id: executable Skill target missing from $file" ;; esac
      ;;
    esac
  done < "$inventory"

  # Fleet's selected wave bound and parent-owned retries are behavior, not inventory
  # metadata: fail if either contract disappears from the executable skill body.
  local fleet="$root/plugins/wf/skills/fleet/SKILL.md"
  if awk -F '\t' '$2=="included" && $3=="plugins/wf/skills/fleet/SKILL.md"{found=1} END{exit !found}' "$inventory"; then
    local fleet_body="$(<"$fleet")"
    case "$fleet_body" in *"One-item wave"*"atomicity: \"atomic\""*"unitCount: 1"*"unitsIndependent: false"*"isolated"*) ;; *) err "fleet: singleton wave evidence must be atomic, dependent, and isolated" ;; esac
    case "$fleet_body" in *"Multi-item wave"*"atomicity: \"composite\""*"unitsIndependent: true"*"bounded-parallel"*) ;; *) err "fleet: multi-item wave evidence must remain composite and bounded" ;; esac
    case "$fleet_body" in *"min(available slots, effectiveParallelism)"*"excess ready item"*"queued"*) ;; *) err "fleet: effectiveParallelism does not bound and defer the ready wave" ;; esac
    case "$fleet_body" in *"postAttempt"*"child never self"*|*"postAttempt"*"child never invokes"*) ;; *) err "fleet: retry owner is not mechanically the parent" ;; esac
  fi

  rm -f "$candidates" "$skill_candidates" "$declared_skill_pairs" "$skill_pairs"

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
## Procedure
Call `resolve_routing` with `role: "demo"`, `shapeEvidence: { workSurface: "external-context", atomicity: "atomic", unitCount: 1, unitsIndependent: false, ambiguity: "none", risk: "low", toolWork: "bounded", validation: "mechanical", contextIsolation: "useful", independentReview: false, returnContract: "mechanically-judgeable", requestedParallelism: 1 }`, `supportsModelSelector: true`, and `supportsEffortSelector: false`; emit compact metadata; on `status: stop` or non-null `diagnostic`, stop. Obey `executionShape`; pass the model selector only when non-null. Invoke the **Task** tool with `subagent_type: wf:demo`.
EOF
  cat > "$tmp/pass.tsv" <<'EOF'
demo	included	plugins/wf/skills/demo/SKILL.md	wf:demo	demo	model=true;effort=false	external-context,atomic,1,false,none,low,bounded,mechanical,useful,false,mechanically-judgeable,1	parent
provider	excluded	plugins/wf/skills/**	provider	WF-400	—	registry-derived provider dispatch	—
EOF
  fail=0; scan "$tmp" "$tmp/pass.tsv" >/dev/null || rc=1
  cat > "$tmp/mediation.tsv" <<'EOF'
index-edge	included	plugins/wf/skills/demo/SKILL.md	/wf:demo	index	model=false;effort=false	index-wrapper-mediated	parent
fixed-edge	included	plugins/wf/skills/demo/SKILL.md	/wf:fixed	child	model=false;effort=false	fixed-skill-route	parent
EOF
  inventory_has_index_wrapper_target "$tmp/mediation.tsv" "plugins/wf/skills/demo/SKILL.md" "wf:demo" || rc=1
  inventory_has_index_wrapper_target "$tmp/mediation.tsv" "plugins/wf/skills/demo/SKILL.md" "wf:fixed" && rc=1
  cp "$tmp/plugins/wf/skills/demo/SKILL.md" "$tmp/one-task.bak"
  sed 's/subagent_type: wf:demo/subagent_type: wf:demo and subagent_type: wf:demo/' "$tmp/plugins/wf/skills/demo/SKILL.md" > "$tmp/plugins/wf/skills/demo/tmp" && mv "$tmp/plugins/wf/skills/demo/tmp" "$tmp/plugins/wf/skills/demo/SKILL.md"
  # Every same-line Task/Agent occurrence requires its own exact inventory row.
  fail=0; scan "$tmp" "$tmp/pass.tsv" >/dev/null 2>&1 && rc=1
  mv "$tmp/one-task.bak" "$tmp/plugins/wf/skills/demo/SKILL.md"
  cp "$tmp/pass.tsv" "$tmp/overdeclared.tsv"
  sed 's/^demo/inventory-extra/' "$tmp/pass.tsv" >> "$tmp/overdeclared.tsv"
  # A stale second row for one executable occurrence must also fail cardinality.
  fail=0; scan "$tmp" "$tmp/overdeclared.tsv" >/dev/null 2>&1 && rc=1
  cp "$tmp/pass.tsv" "$tmp/bad.tsv"; printf 'stale\tincluded\tplugins/wf/skills/missing.md\twf:missing\tindex\tmodel=false;effort=false\texternal-context,atomic,1,dependent,none,low,bounded,mechanical,useful,false,mechanically-judgeable,1\tparent\n' >> "$tmp/bad.tsv"
  fail=0; scan "$tmp" "$tmp/bad.tsv" >/dev/null 2>&1 && rc=1
  sed 's/,mechanically-judgeable,1/,1/' "$tmp/pass.tsv" > "$tmp/evidence.tsv"
  fail=0; scan "$tmp" "$tmp/evidence.tsv" >/dev/null 2>&1 && rc=1
  sed 's/compact metadata/metadata/' "$tmp/plugins/wf/skills/demo/SKILL.md" > "$tmp/plugins/wf/skills/demo/tmp" && mv "$tmp/plugins/wf/skills/demo/tmp" "$tmp/plugins/wf/skills/demo/SKILL.md"
  fail=0; scan "$tmp" "$tmp/pass.tsv" >/dev/null 2>&1 && rc=1
  rm -rf "$tmp/plugins/wf/skills/demo"

  mkdir -p "$tmp/plugins/wf/skills/fleet"
  cat > "$tmp/plugins/wf/skills/fleet/SKILL.md" <<'EOF'
Call `resolve_routing` with `role: "shipper"` and cardinality evidence.
One-item wave: `workSurface: "external-context"`, `atomicity: "atomic"`, `unitCount: 1`, `unitsIndependent: false`, `requestedParallelism: 1`; select `isolated`.
Multi-item wave: `workSurface: "external-context"`, `atomicity: "composite"`, `unitCount: <wave-size>`, `unitsIndependent: true`, `requestedParallelism: <configured-pool-bound>`; select `bounded-parallel`.
Use `supportsModelSelector: true`, `supportsEffortSelector: false`, and `invocationModel`; emit the compact operational record. On `status: stop` or `diagnostic`, stop and obey `executionShape` and `effectiveParallelism`. Parent owns `postAttempt`; child never self-replaces. Dispatch `min(available slots, effectiveParallelism)` and leave every excess ready item queued. Invoke the Agent tool with `subagent_type: general-purpose`.
EOF
  cat > "$tmp/fleet.tsv" <<'EOF'
fleet	included	plugins/wf/skills/fleet/SKILL.md	general-purpose	shipper	model=true;effort=false	fleet-cardinality-route	fleet
EOF
  fail=0; scan "$tmp" "$tmp/fleet.tsv" >/dev/null || rc=1
  cp "$tmp/plugins/wf/skills/fleet/SKILL.md" "$tmp/fleet-valid.bak"
  sed '0,/atomicity: "atomic"/s//atomicity: "composite"/' "$tmp/plugins/wf/skills/fleet/SKILL.md" > "$tmp/plugins/wf/skills/fleet/tmp" && mv "$tmp/plugins/wf/skills/fleet/tmp" "$tmp/plugins/wf/skills/fleet/SKILL.md"
  fail=0; scan "$tmp" "$tmp/fleet.tsv" >/dev/null 2>&1 && rc=1
  cp "$tmp/fleet-valid.bak" "$tmp/plugins/wf/skills/fleet/SKILL.md"
  sed 's/requestedParallelism: <configured-pool-bound>/requestedParallelism: 1/' "$tmp/plugins/wf/skills/fleet/SKILL.md" > "$tmp/plugins/wf/skills/fleet/tmp" && mv "$tmp/plugins/wf/skills/fleet/tmp" "$tmp/plugins/wf/skills/fleet/SKILL.md"
  fail=0; scan "$tmp" "$tmp/fleet.tsv" >/dev/null 2>&1 && rc=1
  rm -rf "$tmp/plugins/wf/skills/fleet"

  mkdir -p "$tmp/plugins/wf/skills/skill-edge"
  cat > "$tmp/plugins/wf/skills/skill-edge/SKILL.md" <<'EOF'
## Execute
Immediately before execution call `resolve_routing` with `role: "child"`, complete `shapeEvidence`, `supportsModelSelector: false`, and `supportsEffortSelector: false`. Include `actualModel` only when the host exposes it; emit the compact operational record. On `status: stop` or non-null `diagnostic`, stop. Obey `executionShape` inline. The parent evaluates the result and owns `postAttempt`; the child must never self-replace. Execute via the Skill tool `/wf:child`.
EOF
  cat > "$tmp/skill.tsv" <<'EOF'
child-skill	included	plugins/wf/skills/skill-edge/SKILL.md	/wf:child	child	model=false;effort=false	fixed-skill-route	parent
prose	excluded	plugins/wf/skills/**	examples	prose	—	non-executable mention	—
EOF
  fail=0; scan "$tmp" "$tmp/skill.tsv" >/dev/null || rc=1
  grep -v '^child-skill' "$tmp/skill.tsv" > "$tmp/missing-skill.tsv"
  fail=0; scan "$tmp" "$tmp/missing-skill.tsv" >/dev/null 2>&1 && rc=1
  cp "$tmp/plugins/wf/skills/skill-edge/SKILL.md" "$tmp/one-target.bak"
  sed 's#`/wf:child`#`/wf:child` then `/wf:other`#' "$tmp/plugins/wf/skills/skill-edge/SKILL.md" > "$tmp/plugins/wf/skills/skill-edge/tmp" && mv "$tmp/plugins/wf/skills/skill-edge/tmp" "$tmp/plugins/wf/skills/skill-edge/SKILL.md"
  # The second same-line target must not be laundered by the first target's row.
  fail=0; scan "$tmp" "$tmp/skill.tsv" >/dev/null 2>&1 && rc=1
  mv "$tmp/one-target.bak" "$tmp/plugins/wf/skills/skill-edge/SKILL.md"
  cp "$tmp/plugins/wf/skills/skill-edge/SKILL.md" "$tmp/exact-target.bak"
  printf '\nNext: `/wf:child2`\n' >> "$tmp/plugins/wf/skills/skill-edge/SKILL.md"
  sed 's#/wf:child#/wf:child2#' "$tmp/skill.tsv" > "$tmp/substring-skill.tsv"
  # A longer declared token must not cover a distinct shorter executable target.
  fail=0; scan "$tmp" "$tmp/substring-skill.tsv" >/dev/null 2>&1 && rc=1
  mv "$tmp/exact-target.bak" "$tmp/plugins/wf/skills/skill-edge/SKILL.md"
  sed 's/owns `postAttempt`; the child must never self-replace/retains the result/' "$tmp/plugins/wf/skills/skill-edge/SKILL.md" > "$tmp/plugins/wf/skills/skill-edge/tmp" && mv "$tmp/plugins/wf/skills/skill-edge/tmp" "$tmp/plugins/wf/skills/skill-edge/SKILL.md"
  fail=0; scan "$tmp" "$tmp/skill.tsv" >/dev/null 2>&1 && rc=1
  cat > "$tmp/plugins/wf/skills/skill-edge/SKILL.md" <<'EOF'
## Next
Next: `/wf:child`
Recommendation only: run `/wf:child` manually.
Example: execute `/wf:example` via the Skill tool.
Recommendation: execute `/wf:recommended` via the Skill tool.
EOF
  fail=0; scan "$tmp" "$tmp/missing-skill.tsv" >/dev/null || rc=1
  cat > "$tmp/plugins/wf/skills/skill-edge/SKILL.md" <<'EOF'
## Execute
Invoke the recommended `/wf:hidden` via the Skill tool.
EOF
  fail=0; scan "$tmp" "$tmp/missing-skill.tsv" >/dev/null 2>&1 && rc=1
  cat > "$tmp/plugins/wf/skills/skill-edge/SKILL.md" <<'EOF'
## Execute
Execute the suggested `/wf:hidden` via the Skill tool.
EOF
  fail=0; scan "$tmp" "$tmp/missing-skill.tsv" >/dev/null 2>&1 && rc=1

  local heading
  for heading in "Command Syntax" "Edge Cases" "Final Output"; do
    printf '## %s\nExecute via the Skill tool `/wf:hidden`.\n' "$heading" > "$tmp/plugins/wf/skills/skill-edge/SKILL.md"
    fail=0; scan "$tmp" "$tmp/missing-skill.tsv" >/dev/null 2>&1 && rc=1
  done
  cat > "$tmp/plugins/wf/skills/skill-edge/SKILL.md" <<'EOF'
## Safety Rules
**Allowed:**
- Invoke `/wf:hidden` through the Skill tool when the procedure calls for it.
EOF
  fail=0; scan "$tmp" "$tmp/missing-skill.tsv" >/dev/null || rc=1
  cat >> "$tmp/plugins/wf/skills/skill-edge/SKILL.md" <<'EOF'

Execute `/wf:hidden-after-permission` via the Skill tool.
EOF
  # Permission-list exclusion ends at the blank line; later operational calls are live.
  fail=0; scan "$tmp" "$tmp/missing-skill.tsv" >/dev/null 2>&1 && rc=1

  cat > "$tmp/plugins/wf/skills/skill-edge/SKILL.md" <<'EOF'
## Execute
Execute via the Skill tool.
`/wf:hidden`
EOF
  # Adjacent-line execution must be discovered even when the signal and target split.
  fail=0; scan "$tmp" "$tmp/missing-skill.tsv" >/dev/null 2>&1 && rc=1

  cat > "$tmp/plugins/wf/skills/skill-edge/SKILL.md" <<'EOF'
## Next
Next: execute via the Skill tool.
`/wf:hidden`

Example: execute via the Skill tool.
`/wf:example`

Recommendation: execute via the Skill tool.
`/wf:recommended`

Execute via the Skill tool.
A caller may invoke `/wf:optional` manually.

Execute via the Skill tool.
A child should never invoke `/wf:forbidden` itself.

Execute via the Skill tool.
If the Skill-tool invocation fails, name `/wf:failed` in the error.

Execute via the Skill tool.
Report the caller that invoked `/wf:historical`.

Report the caller that invoked the Skill tool.
`/wf:historical-signal`
EOF
  fail=0; scan "$tmp" "$tmp/missing-skill.tsv" >/dev/null || rc=1
  cat > "$tmp/plugins/wf/skills/skill-edge/SKILL.md" <<'EOF'
## Safety Rules
**Allowed:**
- Execute via the Skill tool.
  `/wf:hidden`
**Forbidden:**
- Execute `/wf:forbidden-permission` via the Skill tool.
EOF
  fail=0; scan "$tmp" "$tmp/missing-skill.tsv" >/dev/null || rc=1

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
