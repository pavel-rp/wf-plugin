#!/usr/bin/env bash
# core-dispatch-routing-guard.sh — enforce WF-399 fixed core dispatch adoption.
# Model: gpt-5.6-sol[1m]
set -u

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$DIR/../../../.." && pwd)"
DEFAULT_INVENTORY="$DIR/core-dispatch-inventory.tsv"

fail=0
err() {
  local safe
  safe="$(printf '%s' "$*" | LC_ALL=C tr -c '[:print:]\t' '?')"
  printf 'core-dispatch-routing-guard: %s\n' "$safe" >&2
  fail=$((fail + 1))
}

is_prose_only_skill_line() {
  local line="$1"
  while case "$line" in [[:space:]\>\*-]*) true ;; *) false ;; esac; do
    line="${line:1}"
  done
  case "$line" in Next:*|Example:*|example:*|Recommendation:*|recommendation:*|"Recommendation only:"*|"recommendation only:"*|Suggestion:*|suggestion:*|"2. The invoked skill runs"*) return 0 ;; esac
  case "$line" in "A caller may invoke "*" manually."|"The caller may invoke "*" manually."|*"should never invoke"*|*"that invoked"*|*"If the Skill-tool invocation fails"*) return 0 ;; esac
  return 1
}

permission_list_context() {
  local file="$1" line="$2"
  awk -v stop="$line" '
    NR>stop{exit}
    /^## /{active=0; started=0}
    /^\*\*Allowed:\*\*/ || /^\*\*Forbidden:\*\*/ || /^### Allowed$/ || /^### Forbidden$/{active=1; started=0; next}
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

MAX_INVENTORY_FILE_BYTES=1048576
MAX_SOURCE_DEPTH=16
MAX_SOURCE_ENTRIES=8192
MAX_SOURCE_TOTAL_BYTES=67108864
MAX_DISCOVERY_HITS=16384

read_inventory_file() {
  local root="$1" relative="$2"
  python3 - "$root" "$relative" "$MAX_INVENTORY_FILE_BYTES" <<'PY'
import os, stat, sys
root, relative, maximum = sys.argv[1], sys.argv[2], int(sys.argv[3])
if (not relative or relative.startswith("/") or "\\" in relative or "//" in relative):
    raise SystemExit(1)
parts = relative.split("/")
if any(part in ("", ".", "..") for part in parts):
    raise SystemExit(1)
flags = os.O_RDONLY | getattr(os, "O_NONBLOCK", 0) | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
dir_flags = flags | getattr(os, "O_DIRECTORY", 0)
fd = os.open(root, dir_flags)
try:
    for part in parts[:-1]:
        next_fd = os.open(part, dir_flags, dir_fd=fd)
        os.close(fd)
        fd = next_fd
    file_fd = os.open(parts[-1], flags, dir_fd=fd)
    try:
        info = os.fstat(file_fd)
        if not stat.S_ISREG(info.st_mode) or info.st_size > maximum:
            raise SystemExit(1)
        chunks, total = [], 0
        while True:
            chunk = os.read(file_fd, min(65536, maximum + 1 - total))
            if not chunk:
                break
            chunks.append(chunk); total += len(chunk)
            if total > maximum:
                raise SystemExit(1)
        sys.stdout.buffer.write(b"".join(chunks))
    finally:
        os.close(file_fd)
finally:
    os.close(fd)
PY
}

discover_dispatch_lines() {
  local root="$1" mode="$2" snapshot_root="${3:-}"
  python3 - "$root" "$mode" "$MAX_INVENTORY_FILE_BYTES" "$MAX_SOURCE_DEPTH" "$MAX_SOURCE_ENTRIES" "$MAX_SOURCE_TOTAL_BYTES" "$MAX_DISCOVERY_HITS" "$snapshot_root" <<'PY'
import os, re, stat, sys, unicodedata
root, mode = os.path.realpath(sys.argv[1]), sys.argv[2]
maximum, max_depth, max_entries, max_total, max_hits = map(int, sys.argv[3:8])
snapshot_root = sys.argv[8]
patterns = {
    "task": re.compile(r"subagent_type: (?:wf:[a-z0-9-]+|general-purpose)"),
    "skill": re.compile(r"(?:[Ss]kill tool|Skill-tool).*/(?:wf:[a-z0-9-]+|<skill>|wf:<phase>)|/(?:wf:[a-z0-9-]+|<skill>|wf:<phase>).*?(?:[Ss]kill tool|Skill-tool)|(?:^|\s)(?:invoke|re-invoke|execute|call).*/wf:index"),
    "signal": re.compile(r"(?:[Ss]kill tool|Skill-tool)"),
}
pattern = patterns[mode]
base_flags = os.O_RDONLY | getattr(os, "O_NONBLOCK", 0) | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
dir_flags = base_flags | getattr(os, "O_DIRECTORY", 0)

def open_dir_at(fd, parts):
    current = os.dup(fd)
    try:
        for part in parts:
            nxt = os.open(part, dir_flags, dir_fd=current)
            os.close(current); current = nxt
        return current
    except Exception:
        os.close(current); raise

budget = {"entries": 0, "bytes": 0, "hits": 0}
def walk(start_fd, relative):
    stack = [(os.dup(start_fd), relative, None)]
    try:
        while stack:
            fd, current, iterator = stack[-1]
            if iterator is None:
                iterator = os.scandir(fd)
                stack[-1] = (fd, current, iterator)
            try:
                entry = next(iterator)
            except StopIteration:
                iterator.close(); os.close(fd); stack.pop()
                continue
            budget["entries"] += 1
            if budget["entries"] > max_entries:
                raise RuntimeError("source path count exceeds limit")
            name = entry.name
            if ":" in name or any(unicodedata.category(ch).startswith("C") for ch in name):
                raise RuntimeError("unsupported source path character")
            info = entry.stat(follow_symlinks=False)
            child = f"{current}/{name}"
            if stat.S_ISLNK(info.st_mode):
                raise RuntimeError(f"symlinked source path: {child}")
            if stat.S_ISDIR(info.st_mode):
                if len(stack) >= max_depth:
                    raise RuntimeError(f"source depth exceeds limit: {child}")
                child_fd = os.open(name, dir_flags, dir_fd=fd)
                stack.append((child_fd, child, None))
            elif name.endswith(".md"):
                if not stat.S_ISREG(info.st_mode) or info.st_size > maximum:
                    raise RuntimeError(f"unsafe source file: {child}")
                file_fd = os.open(name, base_flags, dir_fd=fd)
                try:
                    opened = os.fstat(file_fd)
                    if not stat.S_ISREG(opened.st_mode) or opened.st_size > maximum:
                        raise RuntimeError(f"unsafe opened source file: {child}")
                    data = b""
                    while len(data) <= maximum:
                        chunk = os.read(file_fd, min(65536, maximum + 1 - len(data)))
                        if not chunk: break
                        data += chunk
                    if len(data) > maximum: raise RuntimeError(f"oversized source file: {child}")
                    budget["bytes"] += len(data)
                    if budget["bytes"] > max_total: raise RuntimeError("aggregate source bytes exceed limit")
                finally: os.close(file_fd)
                text = data.decode("utf-8")
                if snapshot_root:
                    destination = os.path.join(snapshot_root, *child.split("/"))
                    os.makedirs(os.path.dirname(destination), mode=0o700, exist_ok=True)
                    snapshot_fd = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_CLOEXEC", 0), 0o600)
                    try:
                        view = memoryview(data)
                        while view:
                            written = os.write(snapshot_fd, view)
                            if written <= 0: raise RuntimeError(f"cannot snapshot source file: {child}")
                            view = view[written:]
                    finally: os.close(snapshot_fd)
                    absolute = destination
                else:
                    absolute = f"{root}/{child}"
                for number, line in enumerate(text.splitlines(), 1):
                    if pattern.search(line):
                        budget["hits"] += 1
                        if budget["hits"] > max_hits: raise RuntimeError("dispatch hit count exceeds limit")
                        print(f"{absolute}:{number}:{line}")
    finally:
        for fd, _, iterator in stack:
            if iterator is not None: iterator.close()
            try: os.close(fd)
            except OSError: pass

root_fd = os.open(root, dir_flags)
try:
    for parts in (("plugins","wf","skills"), ("plugins","wf","agents")):
        subtree = open_dir_at(root_fd, parts)
        try: walk(subtree, "/".join(parts))
        finally: os.close(subtree)
finally:
    os.close(root_fd)
PY
}

inventory_target_present() {
  local path="$1" raw="$2"
  awk -v raw="$raw" '
    BEGIN {
      if (match(raw, /\/(wf:[a-z0-9-]+|<skill>|wf:<phase>)/)) {
        wanted=substr(raw,RSTART,RLENGTH); slash=1
      } else if (match(raw, /(^|[^a-z0-9-])(wf:[a-z0-9-]+|general-purpose)([^a-z0-9-]|$)/)) {
        token=substr(raw,RSTART,RLENGTH)
        sub(/^[^a-z0-9-]/,"",token); sub(/[^a-z0-9-]$/,"",token)
        wanted=token; slash=0
      } else literal=1
    }
    {
      if (literal && index($0,raw)) found=1
      line=$0
      while (match(line, /\/(wf:[a-z0-9-]+|<skill>|wf:<phase>)|wf:[a-z0-9-]+|general-purpose/)) {
        token=substr(line,RSTART,RLENGTH)
        if ((slash && token==wanted) || (!slash && token==wanted)) found=1
        line=substr(line,RSTART+RLENGTH)
      }
    }
    END{exit !found}
  ' "$path"
}

extract_routed_block() {
  local path="$1" role="$2" target="$3" mode="$4"
  awk -v role="$role" -v target="$target" -v mode="$mode" '
    function reset(){buf=""; start=0; matched_role=0; role_ok=0; waiting_role=0; matched=0}
    {
      trigger=(mode=="agent" && index($0,"resolve_routing")) ||
        (mode=="fixed" && match($0, /role:[[:space:]]*"[a-z0-9-]+"/))
      if (trigger) {
        if (start && matched) {print buf; exit}
        start=NR; buf=""; matched_role=0; role_ok=0; waiting_role=0; matched=0
      }
      if (start) {
        buf=buf $0 "\n"
        if (!matched_role) {
          candidate=""
          if (match($0, /role:[[:space:]]*"[a-z0-9-]+"/)) {
            candidate=substr($0,RSTART,RLENGTH); sub(/^role:[[:space:]]*"/,"",candidate); sub(/"$/,"",candidate)
          } else if (waiting_role && match($0, /^[[:space:]]*"[a-z0-9-]+"/)) {
            candidate=substr($0,RSTART,RLENGTH); gsub(/^[[:space:]]*"|"$/,"",candidate)
          }
          if (candidate != "") {matched_role=1; role_ok=(candidate==role)}
          waiting_role=($0 ~ /role:[[:space:]]*$/)
        }
        if (!matched && matched_role && role_ok && index($0,target)) {matched=1; match_line=NR}
        if (matched && NR-match_line>=30) {print buf; matched=0; exit}
        if (!matched && NR-start>160) reset()
      }
    }
    END{if (matched) print buf}
  ' "$path"
}

inventory_count_task_target() {
  local inventory="$1" file="$2" target="$3"
  awk -F '\t' -v f="$file" -v t="$target" '
    $2=="included" && $3==f && $7!="index-wrapper-mediated" && $7!="fixed-skill-route" && $7!="shipper-path-complexity-route" {
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

inventory_task_roles() {
  local inventory="$1" file="$2" target="$3"
  awk -F '\t' -v f="$file" -v t="$target" '
    $2=="included" && $3==f {
      s=$4; matched=0
      while (match(s, /\/?wf:[a-z0-9-]+|general-purpose/)) {
        token=substr(s,RSTART,RLENGTH); sub(/^\//,"",token)
        if (token==t) matched=1
        s=substr(s,RSTART+RLENGTH)
      }
      if (matched && !seen[$5]++) ordered[++n]=$5
    }
    END{for(i=1;i<=n;i++) printf "%s%s", (i>1 ? "," : ""), ordered[i]}
  ' "$inventory"
}

task_occurrence_routed() {
  local file="$1" line="$2" target="$3" roles="$4"
  [ -n "$roles" ] || return 1
  python3 - "$file" "$line" "$target" "$roles" <<'PY'
import re, sys
path, stop_raw, target, roles_raw = sys.argv[1:]
stop = int(stop_raw)
roles = set(roles_raw.split(","))
lines = open(path, encoding="utf-8").read().splitlines()
if stop < 1 or stop > len(lines):
    raise SystemExit(1)
prefix = "\n".join(lines[:stop])
dispatch_line = lines[stop - 1]
if target not in dispatch_line:
    raise SystemExit(1)
routes = list(re.finditer(r"resolve_routing", prefix))
if not routes:
    raise SystemExit(1)
route = routes[-1]
route_line = prefix.count("\n", 0, route.start()) + 1
# One decision may bind only the next intended dispatch. Any earlier executable
# dispatch between it and this occurrence consumes that decision.
intervening = "\n".join(lines[route_line:stop - 1])
if re.search(r"subagent_type:\s*(?:wf:[a-z0-9-]+|general-purpose)", intervening):
    raise SystemExit(1)
segment = "\n".join(lines[route_line - 1:stop])
role_match = re.search(r"role:\s*(?:`?\"([a-z][a-z0-9-]{0,63})\"|\n\s*\"([a-z][a-z0-9-]{0,63})\")", segment)
role = next((value for value in role_match.groups() if value), None) if role_match else None
if role not in roles:
    raise SystemExit(1)
for required in ("shapeEvidence", "supportsModelSelector", "supportsEffortSelector"):
    if required not in segment:
        raise SystemExit(1)
# workspaceRoot must be bound no later than the role field. A later mention in
# the same paragraph cannot backfill this call.
start = max(
    prefix.rfind("\n\n", 0, route.start()),
    prefix.rfind("\n## ", 0, route.start()),
    prefix.rfind("resolve_routing", 0, route.start()),
)
local_through_role = prefix[start + 1:route.start()] + segment[:role_match.end()]
if "workspaceRoot" not in local_through_role:
    raise SystemExit(1)
# Formatting continuations may span paragraphs only when each intermediate
# paragraph is still routing-contract material. Arbitrary prose breaks the
# one-to-one route→dispatch binding.
parts = [part.strip() for part in re.split(r"\n\s*\n", segment) if part.strip()]
for part in parts[1:-1]:
    if not re.search(
        r"shapeEvidence|unitIds|supportsModelSelector|supportsEffortSelector|"
        r"executionShape|effectiveParallelism|status:\s*stop|diagnostic|"
        r"model selector|effort|postAttempt|routing|retry|dispatch|spawn",
        part,
        re.I,
    ):
        raise SystemExit(1)
raise SystemExit(0)
PY
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
    $2=="included" && $3==f && ($7=="fixed-skill-route" || $7=="shipper-path-complexity-route") {
      s=$4
      while (match(s, /\/(wf:[a-z0-9-]+|<skill>|wf:<phase>)/)) {
        if (substr(s, RSTART, RLENGTH)==t) n++
        s=substr(s, RSTART+RLENGTH)
      }
    }
    END{print n+0}
  ' "$inventory"
}

validate_routing_root_blocks() {
  local snapshot_root="$1"
  python3 - "$snapshot_root" <<'PY'
import pathlib, re, sys
root = pathlib.Path(sys.argv[1])
for base in (root / "plugins/wf/skills", root / "plugins/wf/agents"):
    paths = sorted(base.glob("*/SKILL.md")) if base.name == "skills" else sorted(base.glob("*.md"))
    for path in paths:
        text = path.read_text(encoding="utf-8")
        routing = []
        for occurrence in re.finditer(r"resolve_routing", text):
            line_start = text.rfind("\n", 0, occurrence.start()) + 1
            line_prefix = text[line_start:occurrence.start()].lower()
            if "never" in line_prefix:
                continue
            routing.append(occurrence)
        if not routing:
            continue
        # Every occurrence in this scan is an executable routing instruction; prose-only
        # resolver mentions are outside this validator's call surface.
        first_resolver = routing[0]
        prefix = text[:first_resolver.start()]
        prefix_capture = re.search(r"pwd -P(?:(?!\n[ \t]*\n)[\s\S])*(?:workspaceRoot|workspace-root)", prefix)
        if not prefix_capture:
            line = text.count("\n", 0, routing[0].start()) + 1
            print(f"{path.relative_to(root)}:{line}: capture absolute pwd -P as workspaceRoot before the first bundled resolver call")
        for index, occurrence in enumerate(routing):
            next_start = routing[index + 1].start() if index + 1 < len(routing) else len(text)
            tail = text[occurrence.start():min(next_start, occurrence.start() + 2500)]
            role_match = re.search(r"role:\s*(?:`?\"[a-z][a-z0-9-]{0,63}\"|\n\s*\"[a-z][a-z0-9-]{0,63}\")", tail)
            # Generic references to a routing operation are not executable call
            # blocks; concrete calls carry a typed role field.
            if not role_match:
                continue
            previous_dispatch = max(
                text.rfind("subagent_type:", 0, occurrence.start()),
                text.rfind("via the Skill tool", 0, occurrence.start()),
            )
            block_start = max(
                text.rfind("\n\n", 0, occurrence.start()),
                text.rfind("\n## ", 0, occurrence.start()),
                text.rfind("resolve_routing", 0, occurrence.start()),
                previous_dispatch,
            )
            call_through_role = text[block_start + 1:occurrence.start()] + tail[:role_match.end()]
            line = text.count("\n", 0, occurrence.start()) + 1
            if "workspaceRoot" not in call_through_role:
                print(f"{path.relative_to(root)}:{line}: resolve_routing call must explicitly bind captured workspaceRoot before its role field")
PY
}

scan() {
  local root="$1" inventory="$2" id class file target role selectors evidence retry path body
  command -v python3 >/dev/null 2>&1 || { err "python3 is required for race-safe file validation"; return 1; }
  local safe_sources inventory_relative inventory_snapshot source_snapshot task_hits
  safe_sources="$(mktemp -d)" || { err "cannot create validated-source directory"; return 1; }
  case "$inventory" in
    "$root"/*) inventory_relative="${inventory#"$root"/}" ;;
    *) err "inventory must be contained under the scan root: $inventory"; rm -rf "$safe_sources"; return 1 ;;
  esac
  inventory_snapshot="$safe_sources/inventory.tsv"
  if ! read_inventory_file "$root" "$inventory_relative" > "$inventory_snapshot"; then
    err "inventory is unsafe, non-regular, or exceeds ${MAX_INVENTORY_FILE_BYTES} bytes: $inventory_relative"
    rm -rf "$safe_sources"
    return 1
  fi
  if ! python3 - "$inventory_snapshot" <<'PY'
import sys, unicodedata
try:
    text = open(sys.argv[1], "r", encoding="utf-8").read()
except (OSError, UnicodeError):
    raise SystemExit(1)
for char in text:
    if char not in "\n\t" and unicodedata.category(char).startswith("C"):
        raise SystemExit(1)
PY
  then
    err "inventory contains invalid encoding or control characters"
    rm -rf "$safe_sources"
    return 1
  fi
  inventory="$inventory_snapshot"
  source_snapshot="$safe_sources/tree"
  task_hits="$safe_sources/task-hits"
  mkdir -p "$source_snapshot" || { err "cannot create source snapshot directory"; rm -rf "$safe_sources"; return 1; }
  if ! discover_dispatch_lines "$root" task "$source_snapshot" > "$task_hits"; then
    err "Task/Agent source discovery failed"
    rm -rf "$safe_sources"
    return 1
  fi
  mkdir -p "$source_snapshot/plugins/wf/skills" "$source_snapshot/plugins/wf/agents" || {
    err "cannot complete source snapshot structure"
    rm -rf "$safe_sources"
    return 1
  }
  local routing_root_problems
  routing_root_problems="$(validate_routing_root_blocks "$source_snapshot")"
  if [ -n "$routing_root_problems" ]; then
    while IFS= read -r problem; do err "$problem"; done <<< "$routing_root_problems"
  fi
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
      included)
        case "$role" in [a-z]*) ;; *) err "$id: included role must match ^[a-z][a-z0-9-]{0,63}$: $role"; continue ;; esac
        case "$role" in *[!a-z0-9-]*) err "$id: included role must match ^[a-z][a-z0-9-]{0,63}$: $role"; continue ;; esac
        [ "${#role}" -le 64 ] || { err "$id: included role must match ^[a-z][a-z0-9-]{0,63}$: $role"; continue; }
        ;;
      *) err "$id: classification must be included or excluded"; continue ;;
    esac
    case "$file" in /*|*\\*|..|../*|*/..|*/../*) err "$id: inventory path is unsafe: $file"; continue ;; esac
    path="$source_snapshot/$file"
    if [ ! -f "$path" ]; then
      err "$id: inventory path is absent from the validated source snapshot: $file"
      continue
    fi
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
        local shared_branch_body="$(<"$source_snapshot/plugins/wf/skills/_shared/pipeline-conventions.md")"
        case "$shared_branch_body" in *"unitIds"*) ;; *) err "$id: shared branch route omits stable singleton unitIds" ;; esac
        continue
        ;;
      index-wrapper-mediated)
        case "$body" in *"/wf:index"*) ;; *) err "$id: index wrapper invocation missing in $file" ;; esac
        local index_wrapper_body="$(<"$source_snapshot/plugins/wf/skills/index/SKILL.md")"
        case "$index_wrapper_body" in *"unitIds"*) ;; *) err "$id: index wrapper omits stable singleton unitIds" ;; esac
        continue
        ;;
      fixed-skill-route)
        local skill_block
        skill_block="$(extract_routed_block "$path" "$role" "$target" fixed)"
        [ -n "$skill_block" ] || { err "$id: no nearby role $role decision precedes Skill target $target in $file"; continue; }
        case "$body" in *"resolve_routing"*) ;; *) err "$id: fixed Skill edge lacks resolve_routing in $file" ;; esac
        case "$body" in *"role: \"$role\""*) ;; *) err "$id: fixed Skill role is not stated in $file" ;; esac
        case "$body" in *"shapeEvidence"*"supportsModelSelector: false"*"supportsEffortSelector: false"*) ;; *) err "$id: fixed Skill selector/shape facts are incomplete in $file" ;; esac
        case "$body" in *"actualModel"*"compact operational record"*) ;; *) err "$id: optional actualModel or compact record handling is absent in $file" ;; esac
        case "$body" in *"status: stop"*"diagnostic"*) ;; *) err "$id: fixed Skill stop/diagnostic behavior is absent in $file" ;; esac
        case "$body" in *"executionShape"*|*"inline"*"shape"*) ;; *) err "$id: fixed Skill shape obedience is absent in $file" ;; esac
        case "$body" in *"$target"*) ;; *) err "$id: fixed Skill target is absent in $file" ;; esac
        case "$skill_block" in *"workspaceRoot"*) ;; *) err "$id: fixed Skill route omits explicit workspaceRoot in $file" ;; esac
        case "$skill_block" in *"unitIds"*) ;; *) err "$id: fixed singleton Skill route omits stable unitIds in $file" ;; esac
        if [ "$retry" != "—" ]; then
          case "$body" in *"postAttempt"*"never self"*|*"postAttempt"*"never invokes its own replacement"*) ;; *) err "$id: parent retry ownership is not explicit in $file" ;; esac
        fi
        continue
        ;;
      shipper-path-complexity-route)
        # WF-498. The shipper-path sibling-Skill edges. Everything `fixed-skill-route`
        # requires, with two deliberate differences: BOTH selectors are open, so a
        # complexity-derived selection reaches the edge unmasked instead of coming
        # back with `fallback: "selector-unsupported"`; and the evidence is stated
        # PER EDGE rather than as one literal reused for every edge. The varying
        # dimension is asserted by name — an edge set that collapses back to a single
        # constant fails here rather than silently re-becoming a fixed route.
        local complexity_block
        complexity_block="$(extract_routed_block "$path" "$role" "$target" fixed)"
        [ -n "$complexity_block" ] || { err "$id: no nearby role $role decision precedes Skill target $target in $file"; continue; }
        case "$body" in *"resolve_routing"*) ;; *) err "$id: shipper-path Skill edge lacks resolve_routing in $file" ;; esac
        case "$body" in *"role: \"$role\""*) ;; *) err "$id: shipper-path Skill role is not stated in $file" ;; esac
        case "$body" in *"shapeEvidence"*"supportsModelSelector: true"*"supportsEffortSelector: true"*) ;; *) err "$id: shipper-path selector/shape facts are incomplete in $file" ;; esac
        case "$body" in *"per edge"*"returnContract"*) ;; *) err "$id: shipper-path evidence is not stated per edge in $file" ;; esac
        case "$body" in *"returnContract: \"judgment\""*) ;; *) err "$id: shipper-path evidence does not vary returnContract in $file" ;; esac
        case "$body" in *"actualModel"*"compact operational record"*) ;; *) err "$id: optional actualModel or compact record handling is absent in $file" ;; esac
        case "$body" in *"status: stop"*"diagnostic"*) ;; *) err "$id: shipper-path stop/diagnostic behavior is absent in $file" ;; esac
        case "$body" in *"executionShape"*|*"inline"*"shape"*) ;; *) err "$id: shipper-path shape obedience is absent in $file" ;; esac
        case "$body" in *"$target"*) ;; *) err "$id: shipper-path Skill target is absent in $file" ;; esac
        case "$complexity_block" in *"workspaceRoot"*) ;; *) err "$id: shipper-path route omits explicit workspaceRoot in $file" ;; esac
        case "$complexity_block" in *"unitIds"*) ;; *) err "$id: shipper-path route omits stable unitIds in $file" ;; esac
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
        case "$target" in
          SendMessage)
            case "$body" in *"Preserve the activation"*"SendMessage"*"retained routing decision"*"Do not "*"TaskStop"*"elapsed silence"*) ;; *) err "$id: fleet probe must preserve the activation without a fresh routing call or silence-based stop in $file" ;; esac
            ;;
          *"fresh"*"agent"*)
            case "$body" in *"isolated"*"singleton"*"repeated-failure"*"omit "*"postAttempt.units"*) ;; *) err "$id: fleet replacement lacks shape-valid isolated-singleton postAttempt in $file" ;; esac
            case "$body" in *"bounded-parallel"*"wave"*"complete retained launch wave"*"postAttempt.units"*"queued"*"not included"*"repeated-failure"*"retry.unitIds"*) ;; *) err "$id: fleet replacement lacks exact bounded parent-owned launch-wave evaluation in $file" ;; esac
            case "$body" in *"dispatch a **fresh** agent"*) ;; *) err "$id: fleet replacement target is missing in $file" ;; esac
            case "$body" in *"exact resolver-returned next-tier model/effort"*) ;; *) err "$id: fleet replacement model is not resolver-owned in $file" ;; esac
            ;;
          *) err "$id: unknown fleet recovery target $target" ;;
        esac
        continue
        ;;
    esac
    local block
    block="$(extract_routed_block "$path" "$role" "$target" agent)"
    [ -n "$block" ] || { err "$id: no routed block associates role $role with target $target in $file"; continue; }
    case "$block" in *"resolve_routing"*) ;; *) err "$id: missing resolve_routing in $file" ;; esac
    case "$block" in *"shapeEvidence"*) ;; *) err "$id: missing shapeEvidence in $file" ;; esac
    case "$block" in *"status:"*"diagnostic"*) ;; *) err "$id: missing stop/diagnostic handling in $file" ;; esac
    case "$block" in *"executionShape"*) ;; *) err "$id: selected shape not obeyed in $file" ;; esac
    case "$block" in *"compact"*"record"*|*"compact"*"metadata"*) ;; *) err "$id: compact routing metadata dropped in $file" ;; esac
    case "$block" in *"workspaceRoot"*) ;; *) err "$id: fixed route omits explicit workspaceRoot in $file" ;; esac
    case "$block" in *"unitIds"*) ;; *) err "$id: fixed singleton route omits stable unitIds in $file" ;; esac
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
  candidates="$(mktemp)" || { err "cannot create Task/Agent discovery file"; rm -rf "$safe_sources"; return 1; }
  while IFS=: read -r file line text; do
    [ -n "$file" ] || continue
    case "$file" in *"/_contracts/"*|*"/references/"*) continue ;; esac
    local task_permission task_heading task_routed task_roles task_targets task_target_count
    task_permission="$(permission_list_context "$file" "$line")"
    task_heading="$(awk -v stop="$line" 'NR>stop{exit} /^## /{heading=$0} END{print heading}' "$file")"
    [ "$task_permission" -eq 1 ] && continue
    case "$task_heading" in ""|*" contract"*) continue ;; esac
    is_prose_only_skill_line "$text" && continue
    case "$text" in *"registered"*"provider"*|*"fragment"*"subagent"*) continue ;; esac
    task_targets="$(printf '%s' "$text" | grep -oE 'subagent_type: (wf:[a-z0-9-]+|general-purpose)' || true)"
    task_target_count="$(printf '%s\n' "$task_targets" | awk 'NF{n++} END{print n+0}')"
    if [ "$task_target_count" -gt 1 ]; then
      err "multiple Task/Agent dispatches share one operational line $file:$line"
    fi
    while IFS= read -r target; do
      [ -n "$target" ] || continue
      target="${target#subagent_type: }"
      task_roles="$(inventory_task_roles "$inventory" "${file#$source_snapshot/}" "$target")"
      if [ "$task_target_count" -eq 1 ] && task_occurrence_routed "$file" "$line" "$target" "$task_roles"; then task_routed=1; else task_routed=0; fi
      printf '%s\t%s\t%s\t%s\n' "${file#$source_snapshot/}" "$line" "$target" "$task_routed" >> "$candidates"
    done <<< "$task_targets"
  done < "$task_hits"

  while IFS=$'\t' read -r file line target routed; do
    if [ "$routed" -ne 1 ]; then
      err "unrouted live Task/Agent dispatch $file:$line ($target)"
      continue
    fi
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

  local skill_candidates declared_skill_pairs skill_pairs skill_hits signal_hits
  skill_candidates="$(mktemp)" || { err "cannot create Skill discovery file"; rm -rf "$safe_sources"; rm -f "$candidates" "$task_hits"; return 1; }
  declared_skill_pairs="$(mktemp)" || { err "cannot create declared-Skill file"; rm -rf "$safe_sources"; rm -f "$candidates" "$task_hits" "$skill_candidates"; return 1; }
  skill_pairs="$(mktemp)" || { err "cannot create Skill-pair file"; rm -rf "$safe_sources"; rm -f "$candidates" "$task_hits" "$skill_candidates" "$declared_skill_pairs"; return 1; }
  skill_hits="$(mktemp)" || { err "cannot create Skill hit file"; rm -rf "$safe_sources"; rm -f "$candidates" "$task_hits" "$skill_candidates" "$declared_skill_pairs" "$skill_pairs"; return 1; }
  signal_hits="$(mktemp)" || { err "cannot create Skill signal file"; rm -rf "$safe_sources"; rm -f "$candidates" "$task_hits" "$skill_candidates" "$declared_skill_pairs" "$skill_pairs" "$skill_hits"; return 1; }
  if ! discover_dispatch_lines "$source_snapshot" skill > "$skill_hits" || ! discover_dispatch_lines "$source_snapshot" signal > "$signal_hits"; then
    err "Skill source discovery failed"
    rm -rf "$safe_sources"; rm -f "$candidates" "$task_hits" "$skill_candidates" "$declared_skill_pairs" "$skill_pairs" "$skill_hits" "$signal_hits"
    return 1
  fi
  while IFS=: read -r file line text; do
    [ -n "$file" ] || continue
    case "$file" in *"/_contracts/"*|*"/references/"*) continue ;; esac
    local permission
    permission="$(permission_list_context "$file" "$line")"
    # Only contiguous Allowed/Forbidden list prose is non-executable. Headings such
    # as Edge Cases or Final Output receive no blanket exemption.
    [ "$permission" -eq 1 ] && continue
    is_prose_only_skill_line "$text" && continue
    file="${file#$source_snapshot/}"
    while IFS= read -r target; do
      [ -n "$target" ] || continue
      printf '%s\t%s\t%s\n' "$file" "$line" "$target" >> "$skill_candidates"
      if ! inventory_has_skill_target "$inventory" "$file" "$target"; then
        err "unlisted live Skill dispatch $file:$line ($target)"
      fi
    done < <(printf '%s' "$text" | grep -oE '/(wf:[a-z0-9-]+|<skill>|wf:<phase>)' || true)
  done < "$skill_hits"

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
    file="${file#$source_snapshot/}"
    while IFS= read -r target; do
      [ -n "$target" ] || continue
      printf '%s\t%s\t%s\n' "$file" "$next_line" "$target" >> "$skill_candidates"
      if ! inventory_has_skill_target "$inventory" "$file" "$target"; then
        err "unlisted adjacent-line Skill dispatch $file:$next_line ($target)"
      fi
    done < <(printf '%s' "$next_text" | grep -oE '/(wf:[a-z0-9-]+|<skill>|wf:<phase>)' || true)
  done < "$signal_hits"

  # A fixed Skill target cannot disappear or be laundered by another occurrence in
  # the same file. Compare the union of declared and discovered file+target pairs;
  # every discovered occurrence consumes exactly one fixed-route inventory row.
  while IFS=$'\t' read -r id class file target role selectors evidence retry; do
    [ "$class" = "included" ] && { [ "$evidence" = "fixed-skill-route" ] || [ "$evidence" = "shipper-path-complexity-route" ]; } || continue
    while IFS= read -r target_part; do
      [ -n "$target_part" ] && printf '%s\t%s\n' "$file" "$target_part" >> "$declared_skill_pairs"
    done < <(printf '%s' "$target" | grep -oE '/(wf:[a-z0-9-]+|<skill>|wf:<phase>)' || true)
  done < "$inventory"
  if ! { cut -f1,3 "$skill_candidates"; cat "$declared_skill_pairs"; } | sort -u > "$skill_pairs"; then
    err "cannot compose declared/discovered Skill pairs"
    rm -rf "$safe_sources"
    rm -f "$candidates" "$task_hits" "$skill_candidates" "$declared_skill_pairs" "$skill_pairs" "$skill_hits" "$signal_hits"
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

  # Fleet's selected wave bound and parent-owned retries are behavior, not inventory
  # metadata: fail if either contract disappears from the executable skill body.
  local fleet="$source_snapshot/plugins/wf/skills/fleet/SKILL.md"
  if awk -F '\t' '$2=="included" && $3=="plugins/wf/skills/fleet/SKILL.md"{found=1} END{exit !found}' "$inventory"; then
    local fleet_body="$(<"$fleet")"
    case "$fleet_body" in *"One-item wave"*"atomicity: \"atomic\""*"unitCount: 1"*"unitsIndependent: false"*"isolated"*) ;; *) err "fleet: singleton wave evidence must be atomic, dependent, and isolated" ;; esac
    case "$fleet_body" in *"Multi-item wave"*"atomicity: \"composite\""*"unitsIndependent: true"*"bounded-parallel"*) ;; *) err "fleet: multi-item wave evidence must remain composite and bounded" ;; esac
    case "$fleet_body" in *"candidate launch wave"*"ordered canonical identity tokens"*"unitIds"*"token→item-id map"*"effectiveParallelism"*"exact launch wave"*"outside the decision"*"queued"*"fresh initial routing"*) ;; *) err "fleet: effectiveParallelism does not produce an identity-bound exact launch decision with queued excess excluded" ;; esac
    case "$fleet_body" in *"postAttempt"*"child never self"*|*"postAttempt"*"child never invokes"*) ;; *) err "fleet: retry owner is not mechanically the parent" ;; esac
    case "$fleet_body" in *"Preserve the activation"*"SendMessage"*"retained routing decision"*"Do not "*"TaskStop"*"elapsed silence"*"explicit terminal/idle child response"*"awaiting-confirmation"*"re-arm supervision"*"never mark it "*"blocked"*"child may still run"*) ;; *) err "fleet: silence can terminally block, stop, or replace a live child without proof" ;; esac
    case "$fleet_body" in *"Reconcile each persisted activation intent deterministically"*"Never infer absence from a missing "*"agentId"*"never spawn the item again until absence or termination is conclusively proved"*) ;; *) err "fleet: resume can duplicate or strand a persisted activation intent" ;; esac
    case "$fleet_body" in *"correlates that token to an active agent"*"awaiting-confirmation"*) ;; *) err "fleet: resume lacks authoritative activation-intent correlation" ;; esac
    case "$fleet_body" in *"activationIntent | routingAttempt | agentId | worktree | branch | PR"*"atomically persist that token with status "*"dispatched"*"crash between spawn and response persistence"*) ;; *) err "fleet: activation intent is not durable across spawn-before-persist interruption" ;; esac
    case "$fleet_body" in *"written before spawn"*|*"before every spawn"*) ;; *) err "fleet: activation intent is not persisted before spawn" ;; esac
    case "$fleet_body" in *"awaiting-confirmation"*"occupies an in-flight pool slot"*"never satisfies a dependency blocker or closeout"*"re-arm supervision"*"After a successful spawn response, persist "*"agentId"*"worktree, and branch"*) ;; *) err "fleet: nonterminal activation state can escape capacity, dependency, supervision, or closeout accounting" ;; esac
    case "$fleet_body" in *"bounded-parallel"*"do not submit "*"postAttempt"*"every launched sibling"*"still-running siblings remain "*"in-flight"*"unknown siblings remain "*"awaiting-confirmation"*"Only terminal/idle failed activations"*"TaskStop"*) ;; *) err "fleet: bounded recovery can stop or evaluate a partial live wave" ;; esac
    case "$fleet_body" in *"unit-a1"*"maps to opaque item id"*"TASK@42"*"spawn "*"/wf:ship TASK@42"*"never "*"/wf:ship unit-a1"*) ;; *) err "fleet: canonical retry tokens can be dispatched as opaque task ids" ;; esac
    case "$fleet_body" in *"missing, ambiguous, stale, or duplicate mapping hard-stops that dispatch"*) ;; *) err "fleet: invalid canonical-to-task mapping does not stop dispatch" ;; esac
    case "$fleet_body" in *"complete retained launch-wave evaluation"*"successful siblings as "*"sufficient"*"limit only the fresh replacement Agent dispatch"*"retry.unitIds"*) ;; *) err "fleet: bounded recovery submits only failures instead of the complete retained evaluation" ;; esac
    case "$fleet_body" in *"isolated"*"singleton"*"signals: [\"repeated-failure\"]"*"omit "*"postAttempt.units"*"retry.unitIds"*"retained decision order"*) ;; *) err "fleet: isolated singleton recovery is not shape-valid and identity-bound" ;; esac
    case "$fleet_body" in *"bounded-parallel"*"wave"*"complete retained launch wave"*"postAttempt.units"*"queued"*"not included"*"successful launched siblings"*"sufficient"*"repeated-failure"*"retry.unitIds"*) ;; *) err "fleet: bounded replacement lacks exact selective-retry launch-wave evaluation" ;; esac
    case "$fleet_body" in *"exact resolver-returned next-tier model/effort"*"never the original "*"invocationModel"*) ;; *) err "fleet: replacement model is not resolver-owned" ;; esac
    case "$fleet_body" in *"durable routing ledger"*"ordered "*"unitIds"*"bijective canonical token→opaque-item-id map"*"normalized shape evidence"*"effectiveParallelism"*"selector values"*"source, fallback, and masked state"*"basis"*"attempt"*"escalation origin"*"actualModel"*"disposition"*"retry.unitIds"*"retained unit ids"*"terminal outcome"*"complete ordered evaluation"*) ;; *) err "fleet: durable routing ledger omits required decision or recovery state" ;; esac
    case "$fleet_body" in *"Boundary 1 — before spawn"*"persist"*"Boundary 2 — before "*"postAttempt"*"persist"*"Boundary 3 — before replacement spawn"*"persist"*) ;; *) err "fleet: routing state is not persisted at all three interruption boundaries" ;; esac
    case "$fleet_body" in *"persisted decision with no spawn"*"persisted terminal outcome and complete evaluation"*"persisted retry disposition with no replacement spawn"*"Never issue a fresh initial "*"resolve_routing"*"never reset the retry cap"*"preserve the recorded attempt"*"across "*"/clear"*) ;; *) err "fleet: interrupted routing operations cannot resume from retained state" ;; esac
    case "$fleet_body" in *"awaiting-confirmation"*"cannot substitute for a missing routing-ledger record"*) ;; *) err "fleet: activation state can substitute for durable routing state" ;; esac
  fi

  local included_count excluded_count
  included_count="$(awk -F '\t' '$2=="included"{n++} END{print n+0}' "$inventory")"
  excluded_count="$(awk -F '\t' '$2=="excluded"{n++} END{print n+0}' "$inventory")"
  rm -rf "$safe_sources"
  rm -f "$candidates" "$task_hits" "$skill_candidates" "$declared_skill_pairs" "$skill_pairs" "$skill_hits" "$signal_hits"

  [ "$fail" -eq 0 ] && printf 'Core dispatch routing guard passed: %s included, %s explicit exclusions.\n' "$included_count" "$excluded_count"
  [ "$fail" -eq 0 ]
}

selftest() {
  local tmp rc=0
  tmp="$(mktemp -d)"
  mkdir -p "$tmp/plugins/wf/skills/demo" "$tmp/plugins/wf/agents"
  cat > "$tmp/plugins/wf/skills/demo/SKILL.md" <<'EOF'
## Procedure
Before the first bundled resolver MCP call, run `pwd -P` and retain it as `workspaceRoot`.
Call `resolve_routing` with `workspaceRoot: workspaceRoot`, `role: "demo"`, `unitIds: ["demo:single"]`, `shapeEvidence: { workSurface: "external-context", atomicity: "atomic", unitCount: 1, unitsIndependent: false, ambiguity: "none", risk: "low", toolWork: "bounded", validation: "mechanical", contextIsolation: "useful", independentReview: false, returnContract: "mechanically-judgeable", requestedParallelism: 1 }`, `supportsModelSelector: true`, and `supportsEffortSelector: false`; emit compact metadata; on `status: stop` or non-null `diagnostic`, stop. Obey `executionShape`; pass the model selector only when non-null. Invoke the **Task** tool with `subagent_type: wf:demo`.
EOF
  cat > "$tmp/pass.tsv" <<'EOF'
demo	included	plugins/wf/skills/demo/SKILL.md	wf:demo	demo	model=true;effort=false	external-context,atomic,1,false,none,low,bounded,mechanical,useful,false,mechanically-judgeable,1	parent
provider	excluded	plugins/wf/skills/**	provider	WF-400	—	registry-derived provider dispatch	—
EOF
  fail=0; scan "$tmp" "$tmp/pass.tsv" >/dev/null || rc=1
  cp "$tmp/plugins/wf/skills/demo/SKILL.md" "$tmp/demo-with-identity.bak"
  sed 's/, `unitIds: \["demo:single"\]`//' "$tmp/plugins/wf/skills/demo/SKILL.md" > "$tmp/plugins/wf/skills/demo/tmp" && mv "$tmp/plugins/wf/skills/demo/tmp" "$tmp/plugins/wf/skills/demo/SKILL.md"
  # Every fixed singleton route must carry one stable initial identity.
  fail=0; scan "$tmp" "$tmp/pass.tsv" >/dev/null 2>&1 && rc=1
  mv "$tmp/demo-with-identity.bak" "$tmp/plugins/wf/skills/demo/SKILL.md"
  cp "$tmp/plugins/wf/skills/demo/SKILL.md" "$tmp/demo-with-root.bak"
  sed 's/`workspaceRoot: workspaceRoot`, //' "$tmp/plugins/wf/skills/demo/SKILL.md" > "$tmp/plugins/wf/skills/demo/tmp" && mv "$tmp/plugins/wf/skills/demo/tmp" "$tmp/plugins/wf/skills/demo/SKILL.md"
  # Every fixed route must explicitly pass its current workspace root.
  fail=0; scan "$tmp" "$tmp/pass.tsv" >/dev/null 2>&1 && rc=1
  mv "$tmp/demo-with-root.bak" "$tmp/plugins/wf/skills/demo/SKILL.md"
  cp "$tmp/plugins/wf/skills/demo/SKILL.md" "$tmp/demo-capture-before.bak"
  grep -v 'Before the first bundled resolver MCP call' "$tmp/plugins/wf/skills/demo/SKILL.md" > "$tmp/plugins/wf/skills/demo/tmp" && mv "$tmp/plugins/wf/skills/demo/tmp" "$tmp/plugins/wf/skills/demo/SKILL.md"
  printf '\nLater unrelated prose says to run `pwd -P` and retain it as `workspaceRoot`.\n' >> "$tmp/plugins/wf/skills/demo/SKILL.md"
  # A later root mention cannot launder a call that ran before the capture.
  fail=0; scan "$tmp" "$tmp/pass.tsv" >/dev/null 2>&1 && rc=1
  mv "$tmp/demo-capture-before.bak" "$tmp/plugins/wf/skills/demo/SKILL.md"

  cp "$tmp/plugins/wf/skills/demo/SKILL.md" "$tmp/demo-single-line-route.bak"
  cat > "$tmp/plugins/wf/skills/demo/SKILL.md" <<'EOF'
## Procedure
Before the first bundled resolver MCP call, run `pwd -P` and retain it as `workspaceRoot`.
Call `resolve_routing` with
`workspaceRoot: workspaceRoot`,
`role: "demo"`,
`unitIds: ["demo:single"]`,
`shapeEvidence: { workSurface: "external-context", atomicity: "atomic", unitCount: 1, unitsIndependent: false, ambiguity: "none", risk: "low", toolWork: "bounded", validation: "mechanical", contextIsolation: "useful", independentReview: false, returnContract: "mechanically-judgeable", requestedParallelism: 1 }`,
`supportsModelSelector: true`, and
`supportsEffortSelector: false`; emit compact metadata; on `status: stop` or non-null `diagnostic`, stop. Obey `executionShape`; pass the model selector only when non-null.
Invoke the **Task** tool with `subagent_type: wf:demo`.
EOF
  # A documented multiline call continuation binds to its immediate dispatch.
  fail=0; scan "$tmp" "$tmp/pass.tsv" >/dev/null || rc=1

  cat > "$tmp/plugins/wf/skills/demo/SKILL.md" <<'EOF'
## Procedure
Call `resolve_routing` with `role: "demo"`, `unitIds: ["demo:single"]`, `shapeEvidence: { workSurface: "external-context", atomicity: "atomic", unitCount: 1, unitsIndependent: false, ambiguity: "none", risk: "low", toolWork: "bounded", validation: "mechanical", contextIsolation: "useful", independentReview: false, returnContract: "mechanically-judgeable", requestedParallelism: 1 }`, `supportsModelSelector: true`, and `supportsEffortSelector: false`; later in the same paragraph say `workspaceRoot: workspaceRoot`. Invoke the **Task** tool with `subagent_type: wf:demo`.
EOF
  # A workspaceRoot mention after the role/call cannot backfill that invocation.
  fail=0; scan "$tmp" "$tmp/pass.tsv" >/dev/null 2>&1 && rc=1

  cat > "$tmp/plugins/wf/skills/demo/SKILL.md" <<'EOF'
## Procedure
Before the first bundled resolver MCP call, run `pwd -P` and retain it as `workspaceRoot`.
Call `resolve_routing` with `workspaceRoot: workspaceRoot`, `role: "demo"`, `unitIds: ["demo:single"]`, `shapeEvidence: { workSurface: "external-context", atomicity: "atomic", unitCount: 1, unitsIndependent: false, ambiguity: "none", risk: "low", toolWork: "bounded", validation: "mechanical", contextIsolation: "useful", independentReview: false, returnContract: "mechanically-judgeable", requestedParallelism: 1 }`, `supportsModelSelector: true`, and `supportsEffortSelector: false`; emit compact metadata.

This unrelated prose discusses another operation and carries no routing continuation.

Invoke the **Task** tool with `subagent_type: wf:demo`.
EOF
  # Arbitrary prose consumes the decision; it cannot authorize a later dispatch.
  fail=0; scan "$tmp" "$tmp/pass.tsv" >/dev/null 2>&1 && rc=1
  mv "$tmp/demo-single-line-route.bak" "$tmp/plugins/wf/skills/demo/SKILL.md"

  cp "$tmp/plugins/wf/skills/demo/SKILL.md" "$tmp/demo-routed.bak"
  printf '\nYou may invoke the **Task** tool with `subagent_type: wf:demo`.\n' >> "$tmp/plugins/wf/skills/demo/SKILL.md"
  cp "$tmp/pass.tsv" "$tmp/two-task-rows.tsv"
  sed 's/^demo/inventory-second/' "$tmp/pass.tsv" >> "$tmp/two-task-rows.tsv"
  # A same-heading sibling Task occurrence needs its own local routing decision.
  fail=0; scan "$tmp" "$tmp/two-task-rows.tsv" >/dev/null 2>&1 && rc=1
  mv "$tmp/demo-routed.bak" "$tmp/plugins/wf/skills/demo/SKILL.md"
  cp "$tmp/plugins/wf/skills/demo/SKILL.md" "$tmp/demo-wrong-role.bak"
  cat >> "$tmp/plugins/wf/skills/demo/SKILL.md" <<'EOF'
Call `resolve_routing` with top-level `role: "wrong"` and nested context `{ role: "demo" }`, complete evidence, and normal stop handling. Invoke the **Task** tool with `subagent_type: wf:demo`.
EOF
  # A target token after an unrelated decision cannot launder that decision's wrong role.
  fail=0; scan "$tmp" "$tmp/two-task-rows.tsv" >/dev/null 2>&1 && rc=1
  mv "$tmp/demo-wrong-role.bak" "$tmp/plugins/wf/skills/demo/SKILL.md"
  cp "$tmp/plugins/wf/skills/demo/SKILL.md" "$tmp/demo-single-line.bak"
  sed 's/subagent_type: wf:demo/subagent_type: wf:demo and subagent_type: wf:demo/' "$tmp/plugins/wf/skills/demo/SKILL.md" > "$tmp/plugins/wf/skills/demo/tmp" && mv "$tmp/plugins/wf/skills/demo/tmp" "$tmp/plugins/wf/skills/demo/SKILL.md"
  # Even two inventory rows cannot authorize two Task dispatches from one routing decision.
  fail=0; scan "$tmp" "$tmp/two-task-rows.tsv" >/dev/null 2>&1 && rc=1
  mv "$tmp/demo-single-line.bak" "$tmp/plugins/wf/skills/demo/SKILL.md"

  cat > "$tmp/exclusions-only.tsv" <<'EOF'
prose	excluded	plugins/wf/skills/**	examples	prose	—	non-executable mention	—
EOF
  cp "$tmp/plugins/wf/skills/demo/SKILL.md" "$tmp/demo-valid.bak"
  cat > "$tmp/plugins/wf/skills/demo/SKILL.md" <<'EOF'
## Execute
You may invoke the **Task** tool with `subagent_type: wf:hidden`.
EOF
  fail=0; scan "$tmp" "$tmp/exclusions-only.tsv" >/dev/null 2>&1 && rc=1
  cat > "$tmp/plugins/wf/skills/demo/SKILL.md" <<'EOF'
## Execute
You may invoke `/wf:hidden` via the Skill tool.
EOF
  fail=0; scan "$tmp" "$tmp/exclusions-only.tsv" >/dev/null 2>&1 && rc=1
  cat > "$tmp/plugins/wf/skills/demo/SKILL.md" <<'EOF'
## Execute
You may invoke the **Task** tool manually with `subagent_type: wf:hidden`.
EOF
  fail=0; scan "$tmp" "$tmp/exclusions-only.tsv" >/dev/null 2>&1 && rc=1
  cat > "$tmp/plugins/wf/skills/demo/SKILL.md" <<'EOF'
## Execute
Invoke the **Task** tool manually with `subagent_type: wf:hidden`.
EOF
  fail=0; scan "$tmp" "$tmp/exclusions-only.tsv" >/dev/null 2>&1 && rc=1
  cat > "$tmp/plugins/wf/skills/demo/SKILL.md" <<'EOF'
## Execute
You may invoke `/wf:hidden` manually via the Skill tool.
EOF
  fail=0; scan "$tmp" "$tmp/exclusions-only.tsv" >/dev/null 2>&1 && rc=1
  cat > "$tmp/plugins/wf/skills/demo/SKILL.md" <<'EOF'
## Execute
Invoke `/wf:hidden` manually via the Skill tool.
EOF
  fail=0; scan "$tmp" "$tmp/exclusions-only.tsv" >/dev/null 2>&1 && rc=1
  mv "$tmp/demo-valid.bak" "$tmp/plugins/wf/skills/demo/SKILL.md"

  sed 's#plugins/wf/skills/demo/SKILL.md#../outside.md#' "$tmp/pass.tsv" > "$tmp/traversal.tsv"
  fail=0; scan "$tmp" "$tmp/traversal.tsv" >/dev/null 2>&1 && rc=1
  ln -s demo/SKILL.md "$tmp/plugins/wf/skills/demo-link.md"
  sed 's#plugins/wf/skills/demo/SKILL.md#plugins/wf/skills/demo-link.md#' "$tmp/pass.tsv" > "$tmp/final-symlink.tsv"
  fail=0; scan "$tmp" "$tmp/final-symlink.tsv" >/dev/null 2>&1 && rc=1
  rm -f "$tmp/plugins/wf/skills/demo-link.md"
  ln -s demo "$tmp/plugins/wf/skills/demo-dir-link"
  sed 's#plugins/wf/skills/demo/SKILL.md#plugins/wf/skills/demo-dir-link/SKILL.md#' "$tmp/pass.tsv" > "$tmp/intermediate-symlink.tsv"
  fail=0; scan "$tmp" "$tmp/intermediate-symlink.tsv" >/dev/null 2>&1 && rc=1
  rm -f "$tmp/plugins/wf/skills/demo-dir-link"
  mkfifo "$tmp/nonregular"
  sed 's#plugins/wf/skills/demo/SKILL.md#nonregular#' "$tmp/pass.tsv" > "$tmp/nonregular.tsv"
  fail=0; scan "$tmp" "$tmp/nonregular.tsv" >/dev/null 2>&1 && rc=1
  truncate -s $((MAX_INVENTORY_FILE_BYTES + 1)) "$tmp/oversized"
  sed 's#plugins/wf/skills/demo/SKILL.md#oversized#' "$tmp/pass.tsv" > "$tmp/oversized.tsv"
  fail=0; scan "$tmp" "$tmp/oversized.tsv" >/dev/null 2>&1 && rc=1

  ln -s pass.tsv "$tmp/inventory-link.tsv"
  fail=0; scan "$tmp" "$tmp/inventory-link.tsv" >/dev/null 2>&1 && rc=1
  rm -f "$tmp/inventory-link.tsv"
  mkfifo "$tmp/inventory-fifo.tsv"
  fail=0; scan "$tmp" "$tmp/inventory-fifo.tsv" >/dev/null 2>&1 && rc=1
  rm -f "$tmp/inventory-fifo.tsv"
  local outside_inventory
  outside_inventory="$(mktemp)"; cp "$tmp/pass.tsv" "$outside_inventory"
  fail=0; scan "$tmp" "$outside_inventory" >/dev/null 2>&1 && rc=1
  rm -f "$outside_inventory"
  sed 's/\tdemo\tmodel=/\tdemo.*\tmodel=/' "$tmp/pass.tsv" > "$tmp/bad-role.tsv"
  fail=0; scan "$tmp" "$tmp/bad-role.tsv" >/dev/null 2>&1 && rc=1
  sed 's/\tdemo\tmodel=/\t9demo\tmodel=/' "$tmp/pass.tsv" > "$tmp/digit-role.tsv"
  fail=0; scan "$tmp" "$tmp/digit-role.tsv" >/dev/null 2>&1 && rc=1
  sed 's/\tdemo\tmodel=/\t-demo\tmodel=/' "$tmp/pass.tsv" > "$tmp/hyphen-role.tsv"
  fail=0; scan "$tmp" "$tmp/hyphen-role.tsv" >/dev/null 2>&1 && rc=1
  local long_role="a$(printf '%064d' 0)"
  sed "s/\tdemo\tmodel=/\t${long_role}\tmodel=/" "$tmp/pass.tsv" > "$tmp/long-role.tsv"
  fail=0; scan "$tmp" "$tmp/long-role.tsv" >/dev/null 2>&1 && rc=1
  cp "$tmp/pass.tsv" "$tmp/control-inventory.tsv"
  printf '\033malicious\tincluded\tplugins/wf/skills/demo/SKILL.md\tgeneral-purpose\tdemo\tmodel=true;effort=false\tcaller-context,atomic,1,false,none,low,none,mechanical,none,false,mechanically-judgeable,1\tparent\n' >> "$tmp/control-inventory.tsv"
  fail=0; scan "$tmp" "$tmp/control-inventory.tsv" >/dev/null 2>&1 && rc=1
  printf 'subagent_type: wf:demo\n' > "$tmp/plugins/wf/skills/"$'control\033'".md"
  discover_dispatch_lines "$tmp" task >/dev/null 2>&1 && rc=1
  rm -f "$tmp/plugins/wf/skills/"$'control\033'".md"

  local saved_depth="$MAX_SOURCE_DEPTH" saved_entries="$MAX_SOURCE_ENTRIES" saved_total="$MAX_SOURCE_TOTAL_BYTES" saved_hits="$MAX_DISCOVERY_HITS"
  local resource="$tmp/resource"
  mkdir -p "$resource/plugins/wf/skills/a/b" "$resource/plugins/wf/agents"
  printf 'subagent_type: wf:demo\n' > "$resource/plugins/wf/skills/a/b/deep.md"
  MAX_SOURCE_DEPTH=2
  discover_dispatch_lines "$resource" task >/dev/null 2>&1 && rc=1
  MAX_SOURCE_DEPTH="$saved_depth"
  MAX_SOURCE_ENTRIES=2
  discover_dispatch_lines "$resource" task >/dev/null 2>&1 && rc=1
  MAX_SOURCE_ENTRIES="$saved_entries"
  MAX_SOURCE_TOTAL_BYTES=8
  discover_dispatch_lines "$resource" task >/dev/null 2>&1 && rc=1
  MAX_SOURCE_TOTAL_BYTES="$saved_total"
  MAX_DISCOVERY_HITS=0
  discover_dispatch_lines "$resource" task >/dev/null 2>&1 && rc=1
  MAX_DISCOVERY_HITS="$saved_hits"

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
Before the first bundled resolver MCP call, run `pwd -P` and retain it as `workspaceRoot`.
Call `resolve_routing` with `workspaceRoot: workspaceRoot`, `role: "shipper"` and cardinality evidence.
One-item wave: `workSurface: "external-context"`, `atomicity: "atomic"`, `unitCount: 1`, `unitsIndependent: false`, `requestedParallelism: 1`; select `isolated`.
Multi-item wave: `workSurface: "external-context"`, `atomicity: "composite"`, `unitCount: <wave-size>`, `unitsIndependent: true`, `requestedParallelism: <configured-pool-bound>`; select `bounded-parallel`.
Reconcile each persisted activation intent deterministically: Never infer absence from a missing `agentId`; authoritative runtime state correlates that token to an active agent, otherwise use `awaiting-confirmation` and never spawn the item again until absence or termination is conclusively proved.
Scoreboard columns include activationIntent | routingAttempt | agentId | worktree | branch | PR. The token is written before spawn: atomically persist that token with status `dispatched`; a crash between spawn and response persistence remains correlatable.
Use `supportsModelSelector: true`, `supportsEffortSelector: false`, and `invocationModel`; emit the compact operational record. On `status: stop` or `diagnostic`, stop and obey `executionShape` and `effectiveParallelism`. Parent owns `postAttempt`; child never self-replaces. Select a candidate launch wave, pass its ordered canonical identity tokens as `unitIds` with a retained token→item-id map. Token `unit-a1` maps to opaque item id `TASK@42`: spawn `/wf:ship TASK@42`, never `/wf:ship unit-a1`; a missing, ambiguous, stale, or duplicate mapping hard-stops that dispatch. Use `effectiveParallelism` to narrow it to the exact launch wave when smaller, retain only that decision, and leave excess outside the decision queued for fresh initial routing. Preserve the activation and use `SendMessage` under the retained routing decision. Do not `TaskStop` on elapsed silence; require an explicit terminal/idle child response or a conclusive documented runtime terminal state. Until then keep `awaiting-confirmation`, which occupies an in-flight pool slot, never satisfies a dependency blocker or closeout, and must re-arm supervision; After a successful spawn response, persist `agentId`, worktree, and branch; never mark it `blocked` while the child may still run. For `bounded-parallel`, do not submit `postAttempt` until every launched sibling is conclusive: still-running siblings remain `in-flight`, unknown siblings remain `awaiting-confirmation`, and Only terminal/idle failed activations may be `TaskStop`ped. Submit the complete retained launch-wave evaluation with successful siblings as `sufficient`; limit only the fresh replacement Agent dispatch to `retry.unitIds`. For an `isolated` singleton submit signals: ["repeated-failure"] and omit `postAttempt.units`; dispatch only the returned `retry.unitIds` in retained decision order. For a `bounded-parallel` wave evaluate the complete retained launch wave in `postAttempt.units`; queued excess is not included; mark successful launched siblings `sufficient`, failed units `repeated-failure`, and dispatch only `retry.unitIds` with the exact resolver-returned next-tier model/effort, never the original `invocationModel`. Invoke the Agent tool with `subagent_type: general-purpose`.
The durable routing ledger persists ordered `unitIds`, a bijective canonical token→opaque-item-id map, normalized shape evidence, execution shape, `effectiveParallelism`, selector values with source, fallback, and masked state, basis, attempt, escalation origin, optional `actualModel`, disposition, `retry.unitIds`, retained unit ids, terminal outcome, and complete ordered evaluation.
Boundary 1 — before spawn: persist the decision. Boundary 2 — before `postAttempt`: persist terminal outcomes and evaluation. Boundary 3 — before replacement spawn: persist disposition and retry.
Resume a persisted decision with no spawn, a persisted terminal outcome and complete evaluation, or a persisted retry disposition with no replacement spawn. Never issue a fresh initial `resolve_routing` call, never reset the retry cap, and preserve the recorded attempt across `/clear`. `awaiting-confirmation` cannot substitute for a missing routing-ledger record.
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
  cp "$tmp/fleet-valid.bak" "$tmp/plugins/wf/skills/fleet/SKILL.md"
  sed 's/Do not `TaskStop` on elapsed silence/`TaskStop` after two silent ticks/' "$tmp/plugins/wf/skills/fleet/SKILL.md" > "$tmp/plugins/wf/skills/fleet/tmp" && mv "$tmp/plugins/wf/skills/fleet/tmp" "$tmp/plugins/wf/skills/fleet/SKILL.md"
  fail=0; scan "$tmp" "$tmp/fleet.tsv" >/dev/null 2>&1 && rc=1
  cp "$tmp/fleet-valid.bak" "$tmp/plugins/wf/skills/fleet/SKILL.md"
  sed 's/postAttempt.units/partial units/' "$tmp/plugins/wf/skills/fleet/SKILL.md" > "$tmp/plugins/wf/skills/fleet/tmp" && mv "$tmp/plugins/wf/skills/fleet/tmp" "$tmp/plugins/wf/skills/fleet/SKILL.md"
  fail=0; scan "$tmp" "$tmp/fleet.tsv" >/dev/null 2>&1 && rc=1
  rm -rf "$tmp/plugins/wf/skills/fleet"

  mkdir -p "$tmp/plugins/wf/skills/skill-edge"
  cat > "$tmp/plugins/wf/skills/skill-edge/SKILL.md" <<'EOF'
## Execute
Before the first bundled resolver MCP call, run `pwd -P` and retain it as `workspaceRoot`.
Immediately before execution call `resolve_routing` with `workspaceRoot: workspaceRoot`, `role: "child"`, `unitIds: ["child:single"]`, complete `shapeEvidence`, `supportsModelSelector: false`, and `supportsEffortSelector: false`. Include `actualModel` only when the host exposes it; emit the compact operational record. On `status: stop` or non-null `diagnostic`, stop. Obey `executionShape` inline. The parent evaluates the result and owns `postAttempt`; the child must never self-replace. Execute via the Skill tool `/wf:child`.
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
