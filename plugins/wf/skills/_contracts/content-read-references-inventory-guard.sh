#!/usr/bin/env bash
# content-read-references-inventory-guard.sh — keep the references class of the
# content-read call-site inventory in step with the tree.
#
# docs/content-read-call-site-inventory.md §4.4 lists every runtime consumer of a
# skill `references/*` template (the `references-template` content class served
# by `resolve_content`), and its §5 ledger row counts them. Both drifted silently
# for months because nothing compared them with the tree (WF-795). This guard
# does, in four assertions:
#
#   1. TREE ⊆ DOC   — every call site in the tree is a §4.4 row.
#   2. DOC ⊆ TREE   — every §4.4 row is backed by a call site in the tree.
#   3. EXISTS       — every §4.4 template exists at
#                     plugins/<plugin>/skills/<owner-skill>/references/<ref>.
#   4. COUNTS       — the §5 `references` row states the distinct-template,
#                     consumer, and template-read counts §4.4's rows produce.
#
# WHAT A CALL SITE IS. Any occurrence of the class token `references-template` in
# a `plugins/*/skills/**/*.md` or `plugins/*/agents/*.md` file whose call text —
# from the token to the first closing `)` or `}` (bounded) — names a `ref:` ending
# in `.md`. The `skill:` key names the owning skill; `plugin:` (omitted for core)
# must equal the consumer's own plugin. Both syntaxes the tree uses are parsed —
# backtick lists and object literals, wrapped across lines or not. A mention that
# names no `.md` ref (contract prose, an interface permission statement, a
# never-read rationale pointer) is not a call site.
#
# WHAT A CONSUMER IS. The owning skill (`<plugin>/skills/<skill>`, including a
# call written in that skill's own `references/*` files, which run in the skill's
# context) or agent (`<plugin>/agents/<agent>`).
#
# §4.4 ROW SHAPE. `| \`<consumer>\` | \`a.md\`, \`b.md\` (<owner-skill>) |` — a
# template without a parenthesised owner belongs to the consumer skill itself; an
# agent row, or a read of another skill's template, must name the owner.
#
# Only the references class is enforced. The inventory's other four classes are
# the dated C011 baseline and are deliberately not checked here.
#
# Usage:  bash content-read-references-inventory-guard.sh              # live scan (what CI runs)
#         bash content-read-references-inventory-guard.sh --selftest   # seeded drifts only
#         bash content-read-references-inventory-guard.sh --print      # derived §4.4 rows
#         ... [--root <repo-root>] [--doc <inventory-path>]
#
# Exit 0 = inventory matches the tree; 1 = at least one violation; 2 = the guard
# could not run (python3 or the inventory doc is missing, or a section is absent).
#
# Model: claude-opus-5-5
set -u

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$DIR/../../../.." && pwd)"

if ! command -v python3 >/dev/null 2>&1; then
  printf 'content-read-references-inventory-guard: python3 is required\n' >&2
  exit 2
fi

python3 - "$ROOT" "$@" <<'PY'
import os, re, sys, shutil, tempfile

TOKEN = "references-template"
KEY = re.compile(r"\b(plugin|skill|ref):\s*[\"`]?\s*([A-Za-z0-9_.-]+)")
ITEM = re.compile(r"`([A-Za-z0-9_.-]+\.md)`(?:\s*\(([A-Za-z0-9_-]+)\))?")
COUNTS = re.compile(r"(\d+)\s+templates\s*\|\s*(\d+)\s+consumers\s*\((\d+)\s+template reads\)")
WINDOW = 400


class Harness(Exception):
    pass


def consumer_of(rel):
    parts = rel.split("/")
    if len(parts) >= 4 and parts[1] == "skills":
        return parts[0], "skills", parts[2]
    if len(parts) == 3 and parts[1] == "agents" and parts[2].endswith(".md"):
        return parts[0], "agents", parts[2][:-3]
    return None


def scan(root):
    """Derive {(consumer, owner-skill, ref)} from every call site under plugins/."""
    base = os.path.join(root, "plugins")
    found, errors = set(), []
    for dp, _, fns in os.walk(base):
        for fn in sorted(fns):
            if not fn.endswith(".md"):
                continue
            path = os.path.join(dp, fn)
            rel = os.path.relpath(path, base).replace(os.sep, "/")
            who = consumer_of(rel)
            if who is None:
                continue
            plugin, kind, name = who
            consumer = f"{plugin}/{kind}/{name}"
            with open(path, encoding="utf-8") as fh:
                text = fh.read()
            for m in re.finditer(re.escape(TOKEN), text):
                start = m.end()
                win = text[start:start + WINDOW]
                cut = [i for i in (win.find(")"), win.find("}")) if i >= 0]
                if cut:
                    win = win[:min(cut)]
                keys = {}
                for k, v in KEY.findall(win):
                    keys.setdefault(k, v)
                ref = keys.get("ref", "")
                if not ref.endswith(".md"):
                    continue
                line = text.count("\n", 0, m.start()) + 1
                owner = keys.get("skill")
                if not owner:
                    errors.append(f"{rel}:{line}: call site names ref {ref} but no skill")
                    continue
                if keys.get("plugin", "wf") != plugin:
                    errors.append(f"{rel}:{line}: reads another plugin's template ({keys.get('plugin', 'wf')}/{owner}/{ref}); §4.4 cannot express a cross-plugin read")
                    continue
                found.add((consumer, owner, ref))
    return found, errors


def section(lines, head, stop):
    """Lines after the first line starting with `head` up to the next `stop` heading."""
    out, inside = [], False
    for ln in lines:
        if inside and any(ln.startswith(s) for s in stop):
            break
        if inside:
            out.append(ln)
        elif ln.startswith(head):
            inside = True
    if not inside:
        raise Harness(f"inventory section '{head}' not found")
    return out


def parse_doc(doc):
    if not os.path.isfile(doc):
        raise Harness(f"inventory doc absent: {doc}")
    with open(doc, encoding="utf-8") as fh:
        lines = fh.read().splitlines()
    rows, errors = [], []
    for ln in section(lines, "### 4.4", ("### ", "## ")):
        if not ln.startswith("| `"):
            continue
        cells = [c.strip() for c in ln.strip().strip("|").split("|")]
        consumer = cells[0].strip("`")
        parts = consumer.split("/")
        if len(parts) != 3 or parts[1] not in ("skills", "agents"):
            errors.append(f"§4.4 row consumer is not <plugin>/skills|agents/<name>: {consumer}")
            continue
        items = ITEM.findall(cells[1]) if len(cells) > 1 else []
        if not items:
            errors.append(f"§4.4 row names no template: {consumer}")
        for ref, owner in items:
            if not owner:
                if parts[1] != "skills":
                    errors.append(f"§4.4 agent row must name the owning skill for {ref}: {consumer}")
                    continue
                owner = parts[2]
            rows.append((consumer, owner, ref))
    counts = None
    for ln in section(lines, "## 5.", ("## ",)):
        if ln.startswith("| references |"):
            m = COUNTS.search(ln)
            if m:
                counts = tuple(int(x) for x in m.groups())
            else:
                errors.append("§5 references row does not state '<n> templates | <m> consumers (<k> template reads)'")
    if counts is None and not any(e.startswith("§5") for e in errors):
        errors.append("§5 has no references row")
    return rows, counts, errors


def evaluate(root, doc, quiet=False):
    def say(msg):
        if not quiet:
            print(msg)

    tree, errors = scan(root)
    rows, counts, derrs = parse_doc(doc)
    errors += derrs
    seen = set()
    for r in rows:
        if r in seen:
            errors.append(f"§4.4 lists a template twice: {r[0]} → {r[1]}/{r[2]}")
        seen.add(r)
    for c, o, r in sorted(tree - seen):
        errors.append(f"TREE ⊄ DOC: {c} reads {o}/references/{r} but §4.4 does not list it")
    for c, o, r in sorted(seen - tree):
        errors.append(f"DOC ⊄ TREE: §4.4 lists {c} → {o}/references/{r} but no call site in the tree reads it")
    for c, o, r in sorted(seen):
        p = os.path.join(root, "plugins", c.split("/")[0], "skills", o, "references", r)
        if not os.path.isfile(p):
            errors.append(f"EXISTS: §4.4 template is absent on disk: plugins/{c.split('/')[0]}/skills/{o}/references/{r}")
    want = (len({(c.split("/")[0], o, r) for c, o, r in seen}), len({c for c, _, _ in seen}), len(seen))
    if counts is not None and counts != want:
        errors.append(f"COUNTS: §5 states {counts[0]} templates / {counts[1]} consumers / {counts[2]} reads, §4.4 yields {want[0]} / {want[1]} / {want[2]}")
    for e in errors:
        say(e)
    if errors:
        return 1
    say(f"content-read-references-inventory-guard: PASS — §4.4 matches the tree ({want[0]} templates, {want[1]} consumers, {want[2]} template reads) and §5 agrees.")
    return 0


def render(root):
    tree, errors = scan(root)
    for e in errors:
        print(e, file=sys.stderr)
    by = {}
    for c, o, r in tree:
        by.setdefault(c, []).append((o, r))

    def order(c):
        p, k, n = c.split("/")
        return (p != "wf", p, k, n)

    for c in sorted(by, key=order):
        own = c.split("/")[2] if c.split("/")[1] == "skills" else None
        items = sorted(by[c], key=lambda t: (t[0] != own, t[0], t[1]))
        cells = ", ".join(f"`{r}`" if o == own else f"`{r}` ({o})" for o, r in items)
        print(f"| `{c}` | {cells} |")
    templates = {(c.split("/")[0], o, r) for c, o, r in tree}
    print(f"# {len(templates)} templates | {len(by)} consumers ({len(tree)} template reads)")
    return 1 if errors else 0


def selftest():
    tmp = tempfile.mkdtemp()
    try:
        def put(rel, body):
            p = os.path.join(tmp, rel)
            os.makedirs(os.path.dirname(p), exist_ok=True)
            with open(p, "w", encoding="utf-8") as fh:
                fh.write(body)

        # A skill reading its own and a sibling skill's template (backtick form),
        # a ref-less pointer that must NOT count, and a pack agent reading its
        # skill's template through a wrapped object literal.
        put("plugins/wf/skills/alpha/SKILL.md",
            "Obtain it via `resolve_content` (`class: references-template`, `skill: alpha`, `ref: alpha-template.md`).\n"
            "Also (`class: references-template`,\n`skill: beta`, `ref: shared.md`) on the write path.\n")
        put("plugins/wf/skills/alpha/references/alpha-template.md", "t\n")
        put("plugins/wf/skills/beta/SKILL.md",
            "Rationale lives in `why.md`, obtained via (`class: references-template`, `skill: beta`) — never read here.\n")
        put("plugins/wf/skills/beta/references/shared.md", "t\n")
        put("plugins/wf-x/agents/gamma.md",
            "resolve_content({ workspaceRoot, class: \"references-template\", plugin: \"wf-x\",\nskill: \"delta\", ref: \"d.md\" })\n")
        put("plugins/wf-x/skills/delta/references/d.md", "t\n")

        def doc(rows, counts):
            return ("# Inventory\n\n### 4.4 References class\n\n| Consumer | Template(s) read |\n|---|---|\n"
                    + "".join(r + "\n" for r in rows)
                    + "\n### 4.5 Next class\n\n## 5. Coverage ledger\n\n| Class | Owner | Target docs | Call sites |\n|---|---|---:|---:|\n"
                    + f"| references | SUB-6 | {counts} |\n\n## 6. After\n")

        alpha = "| `wf/skills/alpha` | `alpha-template.md`, `shared.md` (beta) |"
        gamma = "| `wf-x/agents/gamma` | `d.md` (delta) |"
        cases = {
            "sound": (doc([alpha, gamma], "3 templates | 2 consumers (3 template reads)"), 0, None),
            "missing-row": (doc([alpha], "2 templates | 1 consumers (2 template reads)"), 1, None),
            "stale-row": (doc([alpha, gamma, "| `wf/skills/beta` | `shared.md` |"],
                              "3 templates | 3 consumers (4 template reads)"), 1, None),
            "absent-template": (doc([alpha, gamma], "3 templates | 2 consumers (3 template reads)"), 1,
                                "plugins/wf/skills/beta/references/shared.md"),
            "wrong-count": (doc([alpha, gamma], "4 templates | 2 consumers (3 template reads)"), 1, None),
        }
        failed = 0
        for name, (body, want, remove) in cases.items():
            put(f"{name}.md", body)
            moved = None
            if remove:
                moved = os.path.join(tmp, remove) + ".away"
                os.rename(os.path.join(tmp, remove), moved)
            try:
                got = evaluate(tmp, os.path.join(tmp, f"{name}.md"), quiet=True)
            except Harness as e:
                got = f"harness error ({e})"
            if moved:
                os.rename(moved, os.path.join(tmp, remove))
            if got != want:
                print(f"SELFTEST FAIL — '{name}' returned {got}, expected {want}", file=sys.stderr)
                failed += 1
        if failed:
            print(f"content-read-references-inventory-guard: self-test FAILED ({failed} case(s))", file=sys.stderr)
            return 1
        print("content-read-references-inventory-guard: self-test passed — four planted drifts rejected "
              "(missing row, stale row, absent template, wrong §5 count), the sound fixture accepted, "
              "and the ref-less pointer ignored.")
        return 0
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def main(argv):
    root, mode, doc = argv[0], "scan", None
    args = argv[1:]
    i = 0
    while i < len(args):
        a = args[i]
        if a in ("--selftest", "--print"):
            mode = a[2:]
        elif a in ("--root", "--doc") and i + 1 < len(args):
            if a == "--root":
                root = args[i + 1]
            else:
                doc = args[i + 1]
            i += 1
        else:
            print(f"content-read-references-inventory-guard: unknown argument {a}", file=sys.stderr)
            return 2
        i += 1
    if doc is None:
        doc = os.path.join(root, "docs", "content-read-call-site-inventory.md")
    try:
        if mode == "selftest":
            return selftest()
        if mode == "print":
            return render(root)
        return evaluate(root, doc)
    except Harness as e:
        print(f"content-read-references-inventory-guard: {e}", file=sys.stderr)
        return 2


sys.exit(main(sys.argv[1:]))
PY
