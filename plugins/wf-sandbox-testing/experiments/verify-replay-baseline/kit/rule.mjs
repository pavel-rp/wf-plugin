// rule.mjs — the one source of the verify⇄fix stop rule the replay kit judges against.
//
// **Model:** claude-fable-5-1
//
// Shared by derive-baseline.mjs (which records it into results/baseline.json and enforces it
// under --check) and replay-check.mjs (which applies it when judging a live arm), so the cap can
// never drift between the two.

export const RULE = {
  source: "plugins/wf/skills/run/SKILL.md §Phase 3 (verify-spec PASS → qa-gen; FAIL/PARTIAL → verify-fix; cap at 2 verify⇄fix cycles, then halt and escalate)",
  verify_fix_cycle_cap: 2,
  blocking: "plugins/wf/skills/verify-spec/SKILL.md §Fire the verify phase — `fail` blocks shipment; `warn` is non-blocking; a non-conformance finding is a FAIL like a failed requirement",
};

export function stopDecision(verdict, cyclesBefore) {
  if (verdict === "PASS") return "qa-gen";
  if (cyclesBefore < RULE.verify_fix_cycle_cap) return "verify-fix";
  return `halt — verify⇄fix cap (${RULE.verify_fix_cycle_cap}) exceeded`;
}
