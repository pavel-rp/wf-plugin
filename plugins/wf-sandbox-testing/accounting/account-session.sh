#!/usr/bin/env bash
# Strict, derived-only accounting for one complete Claude Code session bundle.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../runner/fingerprint.sh
source "$SCRIPT_DIR/../runner/fingerprint.sh"

usage() {
  cat <<'EOF'
Usage: account-session.sh --source-root DIR --session-id ID [options]

Options:
  --pricing FILE       exact-model pricing schedule (default: accounting/pricing.json)
  --attribution FILE   JSON object mapping agent id or filename to {phase,role}
  --output FILE        atomically write JSON to FILE (default: stdout)
  -h, --help           show this help
EOF
}

die() { printf 'account-session: %s\n' "$*" >&2; exit 1; }
need_arg() { [ "$#" -ge 2 ] && [ -n "$2" ] || die "$1 requires a value"; }

source_root=""; session_id=""; pricing="$SCRIPT_DIR/pricing.json"; attribution=""; output=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --source-root) need_arg "$@"; source_root="$2"; shift 2 ;;
    --session-id) need_arg "$@"; session_id="$2"; shift 2 ;;
    --pricing) need_arg "$@"; pricing="$2"; shift 2 ;;
    --attribution) need_arg "$@"; attribution="$2"; shift 2 ;;
    --output) need_arg "$@"; output="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done
[ -n "$source_root" ] || die "--source-root is required"
[ -n "$session_id" ] || die "--session-id is required"
[[ "$session_id" =~ ^[A-Za-z0-9._-]+$ ]] || die "invalid session id: $session_id"
[ -d "$source_root" ] || die "source root is not a directory: $source_root"
[ -f "$pricing" ] || die "pricing file not found: $pricing"
jq -e 'type=="object" and (.models|type=="object") and (.source|type=="string") and (.effective_date|type=="string")' "$pricing" >/dev/null 2>&1 || die "invalid pricing file: $pricing"
if [ -n "$attribution" ]; then
  [ -f "$attribution" ] || die "attribution file not found: $attribution"
  jq -e 'type=="object" and all(.[]; (.phase|type)=="string" and (.role|type)=="string")' "$attribution" >/dev/null 2>&1 || die "invalid attribution file: $attribution"
fi

main="$source_root/$session_id.jsonl"
bundle="$source_root/$session_id"
subdir="$bundle/subagents"
[ -f "$main" ] || die "missing main transcript: $main"
[ -d "$subdir" ] || die "missing subagents directory: $subdir"

mapfile -d '' transcripts < <(find "$subdir" -maxdepth 1 -type f -name 'agent-*.jsonl' -print0 | LC_ALL=C sort -z)
mapfile -d '' metas < <(find "$subdir" -maxdepth 1 -type f -name 'agent-*.meta.json' -print0 | LC_ALL=C sort -z)

# Validate the entire bundle before creating output. Every failure is path-specific.
for transcript in "${transcripts[@]}"; do
  meta="${transcript%.jsonl}.meta.json"
  [ -f "$meta" ] || die "missing metadata sibling for $transcript: $meta"
done
for meta in "${metas[@]}"; do
  transcript="${meta%.meta.json}.jsonl"
  [ -f "$transcript" ] || die "orphan metadata without transcript: $meta"
done
all_transcripts=("$main" "${transcripts[@]}")
for transcript in "${all_transcripts[@]}"; do
  jq -e -s '
    length > 0 and all(.[]; type=="object") and
    ([.[] | select(.type=="assistant" and .message.usage != null)] | length > 0) and
    all(.[] | select(.type=="assistant" and .message.usage != null);
      (.message.id|type)=="string" and (.message.id|length)>0 and
      (.message.model|type)=="string" and (.message.model|length)>0 and
      (.message.usage.input_tokens|type)=="number" and .message.usage.input_tokens>=0 and
      (.message.usage.cache_creation_input_tokens|type)=="number" and .message.usage.cache_creation_input_tokens>=0 and
      (.message.usage.cache_read_input_tokens|type)=="number" and .message.usage.cache_read_input_tokens>=0 and
      (.message.usage.output_tokens|type)=="number" and .message.usage.output_tokens>=0 and
      all(.message.content[]? | select(.type=="tool_use");
        (.id|type)=="string" and (.id|length)>0 and (.name|type)=="string"))
  ' "$transcript" >/dev/null 2>&1 || die "corrupt or invalid transcript record: $transcript"
done
for meta in "${metas[@]}"; do
  jq -e 'type=="object" and (.description|type)=="string" and (.description|length)>0 and (.agentType|type)=="string" and (.agentType|length)>0' "$meta" >/dev/null 2>&1 || die "invalid agent metadata: $meta"
done

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT
agents_jsonl="$tmpdir/agents.jsonl"
tools_jsonl="$tmpdir/tools.jsonl"

map_attribution() {
  local id="$1" file="$2" description="$3" agent_type="$4" found
  if [ -n "$attribution" ]; then
    found="$(jq -c --arg id "$id" --arg file "$file" '.[$id] // .[$file] // empty' "$attribution")"
    if [ -n "$found" ]; then printf '%s\n' "$found"; return 0; fi
  fi
  local text="${description,,}" type="${agent_type,,}" phase="" role=""
  if [[ "$text" =~ ^ship[[:space:]] ]]; then phase="ship orchestration"; role="ship orchestrator"
  elif [[ "$type" == *auditor* || "$text" == *" lens"* || "$text" == *"lens "* ]]; then phase="verify"; role="audit lens"
  elif [[ "$text" == *verify-spec* || "$text" == *verify-fix* || "$text" == "write verify artifact"* ]]; then phase="verify"; role="verify-spec/fix"
  elif [[ "$text" == implement* ]]; then phase="implement"; role="implement"
  elif [[ "$text" == *qa-auto* || "$text" == *qa-gen* ]]; then phase="qa"; role="qa"
  elif [[ "$text" == *"spec phase"* ]]; then phase="spec"; role="spec/plan/triage"
  elif [[ "$text" == *"plan phase"* ]]; then phase="plan"; role="spec/plan/triage"
  elif [[ "$text" == *"tasks phase"* || "$text" == "run tasks"* ]]; then phase="tasks"; role="tasks"
  elif [[ "$text" == *"implement phase"* ]]; then phase="implement"; role="implement"
  elif [[ "$text" == *"qa phase"* ]]; then phase="qa"; role="qa"
  elif [[ "$text" == *"triage phase"* ]]; then phase="triage"; role="spec/plan/triage"
  elif [[ "$type" == "wf:classify" || "$text" == classify* ]]; then phase="classify"; role="bookkeeping"
  elif [[ "$type" == "wf:pr" || "$text" == *"open pr"* || "$text" == *"pr row"* ]]; then phase="pr"; role="bookkeeping"
  elif [[ "$text" == *finalize* ]]; then phase="finalize"; role="bookkeeping"
  elif [[ "$type" == "wf:index" || "$text" == *"index"* ]]; then
    role="bookkeeping"
    if [[ "$text" == *verify* ]]; then phase="verify"
    elif [[ "$text" == *qa* ]]; then phase="qa"
    elif [[ "$text" == *spec* ]]; then phase="spec"
    elif [[ "$text" == *triage* ]]; then phase="triage"
    elif [[ "$text" == *plan* ]]; then phase="plan"
    elif [[ "$text" == *pr* ]]; then phase="pr"
    elif [[ "$text" == *finalize* ]]; then phase="finalize"
    fi
  fi
  [ -n "$phase" ] && [ -n "$role" ] || return 1
  jq -cn --arg phase "$phase" --arg role "$role" '{phase:$phase,role:$role}'
}

# The per-transcript jq operation preserves first-message order while independently
# maximizing every usage field in duplicate records of the same message id.
account_one() {
  local transcript="$1" transcript_label="$2" id="$3" kind="$4" description="$5" agent_type="$6" phase="$7" role="$8"
  local data="$tmpdir/$id.json"
  jq -s --arg transcript "$transcript" --arg agent "$id" '
    [ .[] | select(.type=="assistant" and .message.usage != null) |
      {id:.message.id, model:.message.model,
       usage:{input_tokens:.message.usage.input_tokens,
              cache_creation_input_tokens:.message.usage.cache_creation_input_tokens,
              cache_read_input_tokens:.message.usage.cache_read_input_tokens,
              output_tokens:.message.usage.output_tokens}} ] as $raw |
    reduce range(0; $raw|length) as $i
      ({order:[], messages:{}};
       ($raw[$i]) as $m | if .messages[$m.id] == null then
         .order += [$m.id] | .messages[$m.id]={model:$m.model,usage:$m.usage}
       else
         if .messages[$m.id].model != $m.model then error("message model changed for "+$m.id) else . end |
         .messages[$m.id].usage |=
           . as $old | reduce ["input_tokens","cache_creation_input_tokens","cache_read_input_tokens","output_tokens"][] as $k
             ($old; .[$k]=([.[$k],$m.usage[$k]]|max))
       end) |
    [.order[] as $id | {id:$id,model:.messages[$id].model,usage:.messages[$id].usage,
      context_tokens:(.messages[$id].usage.input_tokens + .messages[$id].usage.cache_creation_input_tokens + .messages[$id].usage.cache_read_input_tokens)}]
  ' "$transcript" >"$data" 2>"$tmpdir/jq-error" || die "cannot deduplicate transcript $transcript: $(<"$tmpdir/jq-error")"

  # Every exact model id must resolve before any report is emitted.
  while IFS= read -r model; do
    jq -e --arg model "$model" '.models[$model] != null' "$pricing" >/dev/null || die "unknown model '$model' in $transcript"
  done < <(jq -r '.[].model' "$data" | LC_ALL=C sort -u)

  jq -c --arg id "$id" --arg kind "$kind" --arg transcript "$transcript_label" \
    --arg description "$description" --arg agent_type "$agent_type" --arg phase "$phase" --arg role "$role" \
    --slurpfile rates "$pricing" '
      def add_usage: reduce .[] as $m
        ({input_tokens:0,cache_creation_input_tokens:0,cache_read_input_tokens:0,output_tokens:0};
         .input_tokens += $m.usage.input_tokens |
         .cache_creation_input_tokens += $m.usage.cache_creation_input_tokens |
         .cache_read_input_tokens += $m.usage.cache_read_input_tokens |
         .output_tokens += $m.usage.output_tokens);
      def message_cost($m): ($rates[0].models[$m.model]) as $r |
        (($m.usage.input_tokens*$r.input_tokens +
          $m.usage.cache_creation_input_tokens*$r.cache_creation_input_tokens +
          $m.usage.cache_read_input_tokens*$r.cache_read_input_tokens +
          $m.usage.output_tokens*$r.output_tokens)/1000000);
      . as $messages | ($messages|add_usage) as $usage |
      {agent_id:$id,kind:$kind,transcript:$transcript,description:$description,agent_type:$agent_type,
       phase:$phase,role:$role,message_count:($messages|length),models:([$messages[].model]|unique),usage:$usage,
       cost_usd:([$messages[]|message_cost(.)]|add),
       context:{first:$messages[0].context_tokens,last:$messages[-1].context_tokens,
                peak:([$messages[].context_tokens]|max),growth:($messages[-1].context_tokens-$messages[0].context_tokens)}}
  ' "$data" >>"$agents_jsonl"

  jq -c --arg agent "$id" --arg transcript "$transcript_label" '
    select(.type=="assistant") | .message.content[]? | select(.type=="tool_use") |
    {id:.id,name:.name,agent_id:$agent,transcript:$transcript}
  ' "$transcript" >>"$tools_jsonl"
}

account_one "$main" "main.jsonl" "main:$session_id" "main" "Fleet orchestrator" "wf:fleet" "fleet orchestration" "fleet orchestrator"
for transcript in "${transcripts[@]}"; do
  file="$(basename "$transcript")"; id="${file#agent-}"; id="${id%.jsonl}"
  meta="${transcript%.jsonl}.meta.json"
  description="$(jq -r '.description' "$meta")"; agent_type="$(jq -r '.agentType' "$meta")"
  mapping="$(map_attribution "$id" "$file" "$description" "$agent_type")" || die "unmappable agent metadata: $meta"
  phase="$(jq -r '.phase' <<<"$mapping")"; role="$(jq -r '.role' <<<"$mapping")"
  account_one "$transcript" "subagents/$file" "$id" "subagent" "$description" "$agent_type" "$phase" "$role"
done

fingerprint="$(fingerprint_session_bundle "$source_root" "$session_id")" || die "cannot fingerprint bundle: $bundle"
capture_date="$(jq -rs '[.[] | .timestamp? // empty] | min // "" | split("T")[0]' "$main")"
report="$tmpdir/report.json"
jq -s --arg schema "wf-session-accounting/v1" --arg derivation "message-id-max-fields/tool-use-id-dedup/v1" \
  --arg session "$session_id" --arg capture_date "$capture_date" --arg fingerprint "$fingerprint" \
  --argjson transcript_count "${#all_transcripts[@]}" --argjson subagent_count "${#transcripts[@]}" \
  --slurpfile price "$pricing" --slurpfile tools "$tools_jsonl" '
  def usage_sum($xs): reduce $xs[] as $a
    ({input_tokens:0,cache_creation_input_tokens:0,cache_read_input_tokens:0,output_tokens:0};
     .input_tokens += $a.usage.input_tokens |
     .cache_creation_input_tokens += $a.usage.cache_creation_input_tokens |
     .cache_read_input_tokens += $a.usage.cache_read_input_tokens |
     .output_tokens += $a.usage.output_tokens);
  def rows($xs;$key): [$xs|group_by(.[$key])[] | . as $g |
    {($key):$g[0][$key],agent_count:($g|length),message_count:([$g[].message_count]|add),
     usage:usage_sum($g),cost_usd:([$g[].cost_usd]|add)}];
  . as $agents | (usage_sum($agents)) as $usage | ([$agents[].cost_usd]|add) as $cost |
  ($tools | group_by(.id) | map({id:.[0].id,name:.[0].name,agent_id:.[0].agent_id,transcript:.[0].transcript})) as $dedup_tools |
  {schema:$schema,derivation:$derivation,
   provenance:{session_id:$session,capture_date:$capture_date,main_transcript_count:1,subagent_count:$subagent_count,
               transcript_count:$transcript_count,metadata_count:$subagent_count,input_fingerprint_sha256:$fingerprint},
   pricing:{schema:$price[0].schema,effective_date:$price[0].effective_date,source:$price[0].source,
            unit:$price[0].unit,models:$price[0].models},
   totals:{agent_count:($agents|length),message_count:([$agents[].message_count]|add),usage:$usage,cost_usd:$cost},
   by_phase:rows($agents;"phase"),by_role:rows($agents;"role"),by_agent:$agents,
   tool_inventory:$dedup_tools,
   reconciliation:{phase_usage_matches:(usage_sum(rows($agents;"phase"))==$usage),
                   role_usage_matches:(usage_sum(rows($agents;"role"))==$usage),
                   agent_usage_matches:(usage_sum($agents)==$usage),
                   phase_cost_delta:((([rows($agents;"phase")[].cost_usd]|add)-$cost)|fabs),
                   role_cost_delta:((([rows($agents;"role")[].cost_usd]|add)-$cost)|fabs),
                   status:"reconciled"}}
' "$agents_jsonl" >"$report"
jq -e '.reconciliation.phase_usage_matches and .reconciliation.role_usage_matches and .reconciliation.agent_usage_matches and .reconciliation.phase_cost_delta < 1e-9 and .reconciliation.role_cost_delta < 1e-9' "$report" >/dev/null || die "internal reconciliation failure"

if [ -n "$output" ]; then
  mkdir -p "$(dirname "$output")"
  out_tmp="$(mktemp "${output}.tmp.XXXXXX")"
  cp "$report" "$out_tmp"
  mv -f "$out_tmp" "$output"
else
  jq . "$report"
fi
