#!/usr/bin/env bash
# capability-dispatch-routing-guard.sh — enforce WF-400 capability dispatch adoption.
# Model: gpt-5.6-sol[1m]
set -u

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${CAPABILITY_DISPATCH_ROOT:-$(cd "$DIR/../../../.." && pwd)}"
INVENTORY="${CAPABILITY_DISPATCH_INVENTORY:-$DIR/capability-dispatch-inventory.tsv}"

run_guard() {
local active_root="${CAPABILITY_DISPATCH_ROOT:-$ROOT}"
local active_inventory="${CAPABILITY_DISPATCH_INVENTORY:-$INVENTORY}"
python3 - "$active_root" "$active_inventory" <<'PY'
import os, pathlib, re, stat, sys
root = pathlib.Path(sys.argv[1]).resolve()
inv = pathlib.Path(sys.argv[2])
errors = []

def fail(message): errors.append(message)

def safe_file(path, maximum=1_048_576):
    try:
        st = path.lstat()
        if not stat.S_ISREG(st.st_mode) or stat.S_ISLNK(st.st_mode) or st.st_size > maximum:
            fail(f"unsafe file: {path}"); return None
        return path.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as exc:
        fail(f"cannot read {path}: {exc}"); return None

raw = safe_file(inv)
rows = {}
if raw is not None:
    for number, line in enumerate(raw.splitlines(), 1):
        if not line or line.startswith("#"): continue
        fields = line.split("\t")
        if len(fields) != 8:
            fail(f"inventory line {number} has {len(fields)} fields, expected 8"); continue
        ident, classification, file, target, role, selectors, evidence, owner = fields
        if not re.fullmatch(r"[a-z0-9-]+", ident): fail(f"unsafe id: {ident}")
        if ident in rows: fail(f"duplicate id: {ident}")
        if classification not in {"included", "excluded"}: fail(f"bad classification for {ident}")
        if file.startswith("/") or ".." in pathlib.PurePosixPath(file).parts or "\\" in file:
            fail(f"unsafe path for {ident}: {file}")
        rows[ident] = fields

scan_roots = [root / "plugins/wf/skills", root / "plugins/wf-audit", root / "plugins/wf-browser-qa", root / "plugins/wf-angular"]
markers = {}
texts = {}
for base in scan_roots:
    if not base.is_dir(): fail(f"missing scan root: {base}"); continue
    for path in base.rglob("*.md"):
        text = safe_file(path)
        if text is None: continue
        relative = path.relative_to(root).as_posix(); texts[relative] = text
        for match in re.finditer(r"<!-- capability-route:([a-z0-9-]+) -->", text):
            markers.setdefault(match.group(1), []).append((relative, match.start()))
        discovery_enabled = (
            relative in {
                "plugins/wf/skills/verify-spec/SKILL.md",
                "plugins/wf/skills/qa-auto/SKILL.md",
                "plugins/wf/skills/qa-followup/SKILL.md",
            }
            or (
                relative.startswith(("plugins/wf-audit/", "plugins/wf-browser-qa/", "plugins/wf-angular/"))
                and "/references/" not in relative
                and not relative.endswith("/manifest.md")
            )
        )
        for number, line in enumerate(text.splitlines(), 1):
            if not discovery_enabled: continue
            executable = (
                re.search(r"subagent_type: wf-[a-z0-9-]+:[a-z0-9-]+", line)
                or re.search(r"(?:invoke|re-invoke).*?/wf-(?:audit|browser-qa|angular):[a-z0-9-]+.*?Skill", line, re.I)
                or re.search(r"(?:invoke|dispatch).*?Task.*?subagent_type: <[^>]+>", line, re.I)
            )
            prose = re.search(r"normally invoked|caller hands|dispatch target of|fragment.*names|user-facing entry|to compose a process-retrospective", line, re.I)
            if executable and not prose and "<!-- capability-route:" not in line:
                fail(f"unregistered capability dispatch at {relative}:{number}")

included = {ident: fields for ident, fields in rows.items() if fields[1] == "included"}
for ident, occurrences in markers.items():
    if ident not in included: fail(f"unknown live marker: {ident}")
    if len(occurrences) != 1: fail(f"marker {ident} occurs {len(occurrences)} times")
for ident, fields in included.items():
    occurrences = markers.get(ident, [])
    if len(occurrences) != 1:
        fail(f"included edge {ident} has {len(occurrences)} markers"); continue
    relative, offset = occurrences[0]
    if relative != fields[2]: fail(f"edge {ident} marker is in {relative}, expected {fields[2]}")
    text = texts[relative]
    window = text[max(0, offset - 1800):offset + 2200]
    target, role, selectors, evidence, owner = fields[3:]
    if target not in window: fail(f"edge {ident} lacks declared target {target}")
    if evidence == "index-wrapper-mediated":
        for token in ("/wf:index", "Skill", "wrapper", "routing"):
            if token not in window: fail(f"edge {ident} lacks wrapper fact {token}")
        if "subagent_type: wf:index" in window: fail(f"edge {ident} bypasses the routed index wrapper")
    else:
        required = ("resolve_routing", "workspaceRoot", "unitIds", "shapeEvidence",
                    "supportsModelSelector", "supportsEffortSelector", "actualModel",
                    "status: stop", "diagnostic", "model.value", "postAttempt")
        for token in required:
            if token not in window: fail(f"edge {ident} lacks routing fact {token}")
        if selectors == "model=true;effort=false" and "supportsModelSelector: true" not in window:
            fail(f"edge {ident} loses model selector support")
        if "supportsEffortSelector: false" not in window: fail(f"edge {ident} changes effort inheritance")
        if role != "derived-final-slug" and f'role: "{role}"' not in window:
            fail(f"edge {ident} lacks role {role}")
        if owner == "parent" and not re.search(r"(?:parent|agent) (?:validates|alone owns)|parent.*owns", window, re.I | re.S):
            fail(f"edge {ident} does not preserve parent retry ownership")
        if owner != "parent": fail(f"edge {ident} has unsupported retry owner {owner}")
        for value in evidence.split(","):
            if value not in window: fail(f"edge {ident} lacks shape evidence value {value}")

for relative in (
    "plugins/wf-audit/capabilities/audit/fragments/retrospective.md",
    "plugins/wf-browser-qa/skills/qa-engine/SKILL.md",
    "plugins/wf-angular/skills/qa-host/SKILL.md",
):
    text = texts.get(relative, "")
    if "subagent_type: wf:index" in text: fail(f"direct pack-owned index Task remains in {relative}")

manifest = safe_file(root / "plugins/wf-audit/capabilities/audit/manifest.md") or ""
dispositions = safe_file(root / "docs/agent-routing-dispositions.md") or ""
for agent in re.findall(r"subagent: (wf-audit:([a-z0-9-]+))", manifest):
    if f"`{agent[1]}`" not in dispositions: fail(f"audit dispatch role lacks disposition: {agent[1]}")
for role in ("context-distiller", "index", "qa-engine", "qa-host", "audit-retrospective"):
    if f"`{role}`" not in dispositions: fail(f"capability role lacks disposition: {role}")

if errors:
    for error in errors: print(f"capability-dispatch-routing-guard: {error}", file=sys.stderr)
    raise SystemExit(1)
print(f"capability-dispatch-routing-guard: {len(included)} included edges, {len(rows)-len(included)} exclusions")
PY
}

if [ "${1:-}" = "--selftest" ]; then
  tmp="$(mktemp -d)" || exit 1
  trap 'rm -rf "$tmp"' EXIT
  cp -R "$ROOT/plugins" "$ROOT/docs" "$tmp/" || exit 1
  cp "$INVENTORY" "$tmp/inventory.tsv" || exit 1
  if ! CAPABILITY_DISPATCH_ROOT="$tmp" CAPABILITY_DISPATCH_INVENTORY="$tmp/inventory.tsv" run_guard >/dev/null; then
    printf 'capability-dispatch-routing-guard: clean fixture failed\n' >&2; exit 1
  fi
  python3 - "$tmp/plugins/wf/skills/qa-auto/SKILL.md" <<'PY'
from pathlib import Path
p=Path(__import__('sys').argv[1]); p.write_text(p.read_text().replace('<!-- capability-route:qa-engine -->',''), encoding='utf-8')
PY
  if CAPABILITY_DISPATCH_ROOT="$tmp" CAPABILITY_DISPATCH_INVENTORY="$tmp/inventory.tsv" run_guard >/dev/null 2>&1; then
    printf 'capability-dispatch-routing-guard: missing-marker fixture passed unexpectedly\n' >&2; exit 1
  fi
  cp "$ROOT/plugins/wf/skills/qa-auto/SKILL.md" "$tmp/plugins/wf/skills/qa-auto/SKILL.md" || exit 1
  printf '\nInvoke the Task tool with `subagent_type: wf-rogue:unrouted`.\n' >> "$tmp/plugins/wf-browser-qa/skills/qa-engine/SKILL.md"
  if CAPABILITY_DISPATCH_ROOT="$tmp" CAPABILITY_DISPATCH_INVENTORY="$tmp/inventory.tsv" run_guard >/dev/null 2>&1; then
    printf 'capability-dispatch-routing-guard: rogue-dispatch fixture passed unexpectedly\n' >&2; exit 1
  fi
  printf 'capability-dispatch-routing-guard: self-test passed\n'
  exit 0
fi

run_guard
