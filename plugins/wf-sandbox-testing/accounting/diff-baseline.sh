#!/usr/bin/env bash
# Compare two derived accounting reports without reading raw evidence.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: diff-baseline.sh --baseline FILE --current FILE [--tolerance-percent N]

Exit 0 means tolerance-equal; exit 1 means non-equal; exit 2 means invalid input.
Derivation identity, exact pricing, and input fingerprint are never tolerance-relaxed.
EOF
}
die() { printf 'diff-baseline: %s\n' "$*" >&2; exit 2; }
base=""; current=""; tolerance="1"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --baseline) [ "$#" -ge 2 ] || die "$1 requires a value"; base="$2"; shift 2 ;;
    --current) [ "$#" -ge 2 ] || die "$1 requires a value"; current="$2"; shift 2 ;;
    --tolerance-percent) [ "$#" -ge 2 ] || die "$1 requires a value"; tolerance="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done
[ -f "$base" ] || die "baseline not found: $base"
[ -f "$current" ] || die "current report not found: $current"
[[ "$tolerance" =~ ^[0-9]+([.][0-9]+)?$ ]] || die "invalid tolerance percent: $tolerance"
jq -e '.schema and .derivation and .provenance.input_fingerprint_sha256 and .pricing.models and .totals and .by_phase and .by_role and .by_agent' "$base" >/dev/null 2>&1 || die "invalid baseline: $base"
jq -e '.schema and .derivation and .provenance.input_fingerprint_sha256 and .pricing.models and .totals and .by_phase and .by_role and .by_agent' "$current" >/dev/null 2>&1 || die "invalid current report: $current"

result="$(jq -n --slurpfile b "$base" --slurpfile c "$current" --argjson pct "$tolerance" '
  def close($a;$z):
    if ($a|type)!="number" or ($z|type)!="number" then $a==$z
    elif $a==$z then true
    else (($a-$z)|fabs) <= (([$a|fabs,$z|fabs,0.000000001]|max) * $pct / 100)
    end;
  def numeric_paths($x): [$x|paths(numbers)];
  def figure_view:
    {totals:.totals,
     by_phase:[.by_phase[]|{phase,agent_count,message_count,usage,cost_usd}]|sort_by(.phase),
     by_role:[.by_role[]|{role,agent_count,message_count,usage,cost_usd}]|sort_by(.role),
     by_agent:[.by_agent[]|{agent_id,phase,role,message_count,usage,cost_usd,context}]|sort_by(.agent_id)};
  ($b[0]) as $b0 | ($c[0]) as $c0 | ($b0|figure_view) as $bf | ($c0|figure_view) as $cf |
  ([numeric_paths($bf)[] as $p | select(close($bf|getpath($p);$cf|getpath($p))|not) |
      {path:($p|map(tostring)|join(".")),baseline:($bf|getpath($p)),current:($cf|getpath($p))}]) as $figdiff |
  ([
    if $b0.schema==$c0.schema then empty else {field:"schema",baseline:$b0.schema,current:$c0.schema} end,
    if $b0.derivation==$c0.derivation then empty else {field:"derivation",baseline:$b0.derivation,current:$c0.derivation} end,
    if $b0.provenance.input_fingerprint_sha256==$c0.provenance.input_fingerprint_sha256 then empty else {field:"input_fingerprint_sha256",baseline:$b0.provenance.input_fingerprint_sha256,current:$c0.provenance.input_fingerprint_sha256} end,
    if $b0.pricing==$c0.pricing then empty else {field:"pricing",baseline:$b0.pricing,current:$c0.pricing} end,
    if (($bf|walk(if type=="number" then 0 else . end))==($cf|walk(if type=="number" then 0 else . end))) then empty else {field:"figure_shape",baseline:($bf|walk(if type=="number" then 0 else . end)),current:($cf|walk(if type=="number" then 0 else . end))} end
  ]) as $exactdiff |
  {schema:"wf-accounting-diff/v1",tolerance_percent:$pct,
   status:(if (($exactdiff|length)==0 and ($figdiff|length)==0) then "tolerance-equal" else "non-equal" end),
   equal:(($exactdiff|length)==0 and ($figdiff|length)==0),exact_differences:$exactdiff,figure_differences:$figdiff}
')" || die "comparison failed"
printf '%s\n' "$result" | jq .
[ "$(jq -r '.equal' <<<"$result")" = true ]
