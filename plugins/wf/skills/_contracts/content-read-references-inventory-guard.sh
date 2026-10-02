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
# from the token to the first closing `)` or `}` outside a backtick span (backtick
# list) or a quoted value (object literal and prose), bounded — names a `ref:`
# ending in `.md`. The ref's stop set is chosen by call form. Whole-token parsing
# is guaranteed for the backtick-list form (`ref: …`, up to the closing backtick —
# the same set a §4.4 token admits) and for a quoted value in EVERY form (up to its
# closing quote, escaped quotes honoured): there `sub/my template.md`,
# `sub/a (b).md` and `sub/a,b.md` are each one ref. A quote opens a value only
# where a value begins — after `:`, `,`, `(`, `{` or `[` (whitespace between
# allowed) — so an apostrophe inside a word or an unquoted value is a literal
# character (`ref: it's.md` is `it's.md`). An UNQUOTED object-literal or prose ref
# ends at `,`, `"`, a backtick, `)`, `}` or line end, so a file name holding one of
# those must be quoted in those forms. A ref holding a backtick or `|`, which no
# §4.4 cell can carry, is a violation. It is a relative path and may nest under `references/` (`sub/t.md`), judged whole by the
# resolver's `isSafeRelPath` rules: backslashes normalise to `/`, and a ref the
# resolver refuses (empty, `/`- or drive-rooted, or a `.`, `..` or empty segment)
# is not a read — nor is any suffix of it. The
# `skill:` key names the owning skill; `plugin:` (omitted for core) must equal the
# consumer's own plugin. Both syntaxes the tree uses are parsed — backtick lists
# and object literals, wrapped across lines or not. A mention that names no `.md`
# ref (contract prose, an interface permission statement, a never-read rationale
# pointer) is not a call site.
#
# WHAT A CONSUMER IS. The owning skill (`<plugin>/skills/<skill>`, including a
# call written in that skill's own `references/*` files, which run in the skill's
# context) or agent (`<plugin>/agents/<agent>`).
#
# §4.4 ROW SHAPE. `| \`<consumer>\` | \`a.md\`, \`b.md\` (<owner-skill>) |` — a
# template without a parenthesised owner belongs to the consumer skill itself; an
# agent row, or a read of another skill's template, must name the owner. Every
# backtick token in the cell is a template, taken whole; it may be a nested path
# (`sub/t.md`) or hold a space. A token that is not a `.md` path, or that the
# resolver's path rules refuse, is a violation — never skipped or partly matched.
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
# `plugin:` and `skill:` are single segments. `ref:` is a relative path that may
# nest (`sub/t.md`). ref_value() chooses its stop set by the call form
# call_window() reads off the class token, and takes the WHOLE token in the two
# forms that delimit it:
#   - backtick list (`ref: …`): up to its span's closing backtick or line end —
#     exactly the set a §4.4 backtick token admits (bar `|`, reported below);
#   - literal, quoted value ("…", '…' or `…`): up to its closing quote, `\` +
#     that quote or `\` + `\` read as the escaped character.
# An UNQUOTED literal or prose value is not delimited, so it ends at `,`, `"`, a
# backtick, `)`, `}` or line end: a file name holding one of those must be quoted
# in those forms (the self-test pins this). An apostrophe inside an unquoted value
# is part of it. The call window ends at the first `)`/`}` outside a span or a
# quoted value, in every form, so a paren or brace inside a quoted ref never
# truncates it. The token's safety is judged
# afterwards by safe_ref(); a token holding a character no §4.4 cell can carry
# (a backtick or `|`) is reported, never silently left unmatched.
KEY = re.compile(r"\b(plugin|skill):\s*[\"'`]?\s*([A-Za-z0-9_.-]+)")
REF = re.compile(r"\bref:\s*")
QUOTES = "\"'`"
ROW_INEXPRESSIBLE = "`|"
# Outside a span or string, a quote opens a value only after one of these (the
# previous non-space character; "" is the window start). Mid-word it is literal.
VALUE_START = ("", ":", ",", "(", "{", "[")
# A §4.4 cell is parsed as WHOLE backtick tokens, each optionally followed by its
# `(owner)`; every token is judged whole by parse_doc(), never a matched suffix. A
# token admits every character but a backtick, a newline and `|` (the row is split
# into cells on `|` first) — the backtick-list set ref_value() admits, less `|`,
# which scan() therefore reports on the call-site side instead of dropping.
ITEM = re.compile(r"`([^`\n]*)`(?:\s*\(([A-Za-z0-9_-]+)\))?")
DRIVE = re.compile(r"[A-Za-z]:")
COUNTS = re.compile(r"(\d+)\s+templates\s*\|\s*(\d+)\s+consumers\s*\((\d+)\s+template reads\)")
WINDOW = 400


class Harness(Exception):
    pass


def norm_ref(ref):
    """The resolver's normalizeSlashes: every backslash becomes `/`."""
    return ref.replace("\\", "/")


def safe_ref(ref):
    """Mirror the resolver's isSafeRelPath: non-empty; after backslash
    normalisation neither `/`-rooted nor drive-letter-rooted (`C:`); and no `.`,
    `..` or empty segment."""
    n = norm_ref(ref)
    if not n or n.startswith("/") or DRIVE.match(n):
        return False
    return all(s not in ("", ".", "..") for s in n.split("/"))


def call_window(text, start):
    """(window, form): the call text after the class token and the call's form,
    read off the character that closes the token itself.
      - `list`    — a backtick closes it (`class: references-template`, …): the
                    call ends at the first `)`/`}` outside a backtick span, so a
                    paren or brace inside a span is part of the call;
      - `literal` — a quote closes it (class: "references-template", …);
      - `prose`   — anything else.
    In the literal and prose forms the call ends at the first `)`/`}` outside a
    quoted value. A quote opens one only where a value begins (VALUE_START), so an
    apostrophe inside a word or an unquoted ref (`ref: it's.md`) opens nothing;
    backslash escapes are honoured inside a quoted value.
    Only characters after the token are read, so nothing before it on the line
    (an apostrophe, an earlier span) can shift the window. Bounded by WINDOW."""
    win = text[start:start + WINDOW]
    head = win[:1]
    form = "list" if head == "`" else "literal" if head in ("\"", "'") else "prose"
    # The head character closes the token's own span, so scanning starts outside
    # any span, just past it.
    state, esc, skip = None, False, (1 if form != "prose" else 0)
    prev = ""  # the last non-space character outside a span or quoted value
    for i, c in enumerate(win[skip:], skip):
        if state is None:
            if c in ")}":
                return win[:i], form
            if form == "list":
                if c == "`":
                    state = c
            elif c in QUOTES and prev in VALUE_START:
                state = c
            if not c.isspace():
                prev = c
        elif form != "list" and esc:
            esc = False
        elif form != "list" and c == "\\":
            esc = True
        elif c == state:
            state = None
            prev = c
    return win, form


def ref_value(win, form):
    """The ref token of a call window, surrounding whitespace trimmed — whole in
    the backtick-list and quoted forms; an unquoted value ends at its first stop
    character (see the REF comment above)."""
    m = REF.search(win)
    if not m:
        return ""
    i = m.end()
    if form == "list":
        # `ref: …` sits inside its own backtick span: up to that span's close.
        j = i
        while j < len(win) and win[j] not in "`\n":
            j += 1
        value = win[i:j].strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1].strip()
        return value
    if i < len(win) and win[i] in QUOTES:
        q, out, j = win[i], [], i + 1
        while j < len(win) and win[j] not in (q, "\n"):
            if win[j] == "\\" and j + 1 < len(win) and win[j + 1] in (q, "\\"):
                j += 1
            out.append(win[j])
            j += 1
        return "".join(out).strip()
    j = i
    while j < len(win) and win[j] not in ",\"`\n":
        j += 1
    return win[i:j].strip()


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
                win, form = call_window(text, start)
                keys = {}
                for k, v in KEY.findall(win):
                    keys.setdefault(k, v)
                ref = ref_value(win, form)
                if not ref.endswith(".md") or not safe_ref(ref):
                    # Not a template read: no `.md` ref, or a path the resolver
                    # refuses — judged on the whole token, never a suffix of it.
                    continue
                ref = norm_ref(ref)
                line = text.count("\n", 0, m.start()) + 1
                if any(ch in ref for ch in ROW_INEXPRESSIBLE):
                    errors.append(f"{rel}:{line}: call site names ref {ref!r} holding a backtick or `|`, which a §4.4 row cannot express")
                    continue
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
            ref = ref.strip()
            if not ref.endswith(".md"):
                errors.append(f"§4.4 row names a token that is not a .md template: {consumer} → `{ref}`")
                continue
            if not safe_ref(ref):
                errors.append(f"§4.4 row names an unsafe template path (absolute, drive-rooted, or a '.', '..' or empty segment): {consumer} → {ref}")
                continue
            ref = norm_ref(ref)
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


def evaluate(root, doc, quiet=False, sink=None):
    def say(msg):
        if sink is not None:
            sink.append(msg)
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

        def run(cases):
            # Each case is (doc, want[, remove[, expect]]): `expect`, when given, is
            # the substring the ONLY violation reported must carry, so the case
            # fails on its own condition alone rather than on a side effect.
            nonlocal failed
            for name, case in cases.items():
                body, want, remove, expect = (tuple(case) + (None, None))[:4]
                put(f"{name}.md", body)
                moved = None
                if remove:
                    moved = os.path.join(tmp, remove) + ".away"
                    os.rename(os.path.join(tmp, remove), moved)
                said = []
                try:
                    got = evaluate(tmp, os.path.join(tmp, f"{name}.md"), quiet=True, sink=said)
                except Harness as e:
                    got = f"harness error ({e})"
                if moved:
                    os.rename(moved, os.path.join(tmp, remove))
                if got != want:
                    print(f"SELFTEST FAIL — '{name}' returned {got}, expected {want}: {said}", file=sys.stderr)
                    failed += 1
                elif expect is not None and (len(said) != 1 or expect not in said[0]):
                    print(f"SELFTEST FAIL — '{name}' reported {said}, expected exactly one violation naming '{expect}'", file=sys.stderr)
                    failed += 1

        run(cases)

        # Nested refs (WF-897): a skill reading its own template one level down
        # (backtick form), a pack agent reading another skill's template two levels
        # down (wrapped object literal, owner-suffixed row), and two refs the
        # resolver refuses — a `..` escape and an absolute path — which must not
        # count as reads.
        put("plugins/wf/skills/epsilon/SKILL.md",
            "Obtain it via (`class: references-template`, `skill: epsilon`, `ref: sub/nested.md`).\n"
            "Never (`class: references-template`, `skill: epsilon`, `ref: ../escape.md`).\n"
            "Nor (`class: references-template`, `skill: epsilon`, `ref: /abs/x.md`).\n")
        put("plugins/wf/skills/epsilon/references/sub/nested.md", "t\n")
        put("plugins/wf-x/agents/zeta.md",
            "resolve_content({ workspaceRoot, class: \"references-template\", plugin: \"wf-x\",\nskill: \"delta\", ref: \"deep/er/z.md\" })\n")
        put("plugins/wf-x/skills/delta/references/deep/er/z.md", "t\n")

        tree, _ = scan(tmp)
        if ("wf/skills/epsilon", "epsilon", "sub/nested.md") not in tree \
                or ("wf-x/agents/zeta", "delta", "deep/er/z.md") not in tree \
                or any(not safe_ref(r) for _, _, r in tree):
            print(f"SELFTEST FAIL — nested scan derived {sorted(tree)}", file=sys.stderr)
            failed += 1

        eps = "| `wf/skills/epsilon` | `sub/nested.md` |"
        zeta = "| `wf-x/agents/zeta` | `deep/er/z.md` (delta) |"
        run({
            "nested-sound": (doc([alpha, gamma, eps, zeta], "5 templates | 4 consumers (5 template reads)"), 0, None),
            "nested-missing-row": (doc([alpha, gamma, zeta], "4 templates | 3 consumers (4 template reads)"), 1, None),
            "nested-mismatched-row": (doc([alpha, gamma, zeta, "| `wf/skills/epsilon` | `sub/other.md` |"],
                                          "5 templates | 4 consumers (5 template reads)"), 1, None),
            "nested-absent-template": (doc([alpha, gamma, eps, zeta], "5 templates | 4 consumers (5 template reads)"), 1,
                                       "plugins/wf-x/skills/delta/references/deep/er/z.md"),
            "unsafe-row": (doc([alpha, gamma, "| `wf/skills/epsilon` | `sub/nested.md`, `../escape.md` |", zeta],
                               "5 templates | 4 consumers (5 template reads)"), 1, None),
        })

        # Whole ref tokens (WF-936). safe_ref() first, one assertion per
        # isSafeRelPath rule: accepted shapes, then each refusal on its own.
        for ref, want in (("t.md", True), ("sub/t.md", True), ("sub/my template.md", True),
                          ("sub\\t.md", True), ("", False), ("/abs.md", False), ("\\abs.md", False),
                          ("C:x.md", False), ("c:/x.md", False), ("./t.md", False), ("a/../t.md", False),
                          ("..\\t.md", False), ("a//t.md", False), ("sub/", False)):
            if safe_ref(ref) != want:
                print(f"SELFTEST FAIL — safe_ref({ref!r}) returned {not want}, expected {want}", file=sys.stderr)
                failed += 1

        # Call sites whose ref holds a space — backtick-list form, a double-quoted
        # object literal, and a single-quoted one — must be derived WHOLE; a
        # backslash-separated ref normalises onto the same read. A drive-rooted
        # and a backslash-escape ref are refused whole — neither they nor any
        # suffix of them (`x.md`) may count as a read.
        put("plugins/wf/skills/eta/SKILL.md",
            "Obtain it via (`class: references-template`, `skill: eta`, `ref: sub/my template.md`).\n"
            "Or (`class: references-template`, `skill: eta`, `ref: sub\\my template.md`).\n"
            "Never (`class: references-template`, `skill: eta`, `ref: C:x.md`).\n"
            "Nor (`class: references-template`, `skill: eta`, `ref: ..\\x.md`).\n")
        put("plugins/wf/skills/eta/references/sub/my template.md", "t\n")
        put("plugins/wf-x/agents/theta.md",
            "resolve_content({ workspaceRoot, class: \"references-template\", plugin: \"wf-x\",\nskill: \"delta\", ref: \"spaced dir/t t.md\" })\n"
            "resolve_content({ workspaceRoot, class: 'references-template', plugin: 'wf-x', skill: 'delta', ref: 'single q.md' })\n")
        put("plugins/wf-x/skills/delta/references/spaced dir/t t.md", "t\n")
        put("plugins/wf-x/skills/delta/references/single q.md", "t\n")

        tree, _ = scan(tmp)
        want_in = {("wf/skills/eta", "eta", "sub/my template.md"),
                   ("wf-x/agents/theta", "delta", "spaced dir/t t.md"),
                   ("wf-x/agents/theta", "delta", "single q.md")}
        eta_reads = {r for c, _, r in tree if c == "wf/skills/eta"}
        if not want_in <= tree or eta_reads != {"sub/my template.md"}:
            print(f"SELFTEST FAIL — whole-token scan derived {sorted(tree)}", file=sys.stderr)
            failed += 1

        eta = "| `wf/skills/eta` | `sub/my template.md` |"
        theta = "| `wf-x/agents/theta` | `single q.md` (delta), `spaced dir/t t.md` (delta) |"
        whole = "8 templates | 6 consumers (8 template reads)"
        run({
            "spaced-sound": (doc([alpha, gamma, eps, zeta, eta, theta], whole), 0),
            "spaced-backslash-row-sound": (doc([alpha, gamma, eps, zeta, "| `wf/skills/eta` | `sub\\my template.md` |",
                                                theta], whole), 0),
            "spaced-missing-row": (doc([alpha, gamma, eps, zeta, theta], "7 templates | 5 consumers (7 template reads)"),
                                   1, None, "TREE ⊄ DOC: wf/skills/eta reads eta/references/sub/my template.md"),
            "spaced-missing-agent-row": (doc([alpha, gamma, eps, zeta, eta], "6 templates | 5 consumers (6 template reads)"),
                                         1, None, None),
            "drive-letter-row": (doc([alpha, gamma, eps, zeta, "| `wf/skills/eta` | `sub/my template.md`, `C:x.md` |",
                                      theta], whole), 1, None, "unsafe template path"),
            "backslash-row": (doc([alpha, gamma, eps, zeta, "| `wf/skills/eta` | `sub/my template.md`, `a\\..\\b.md` |",
                                   theta], whole), 1, None, "unsafe template path"),
            "non-md-row": (doc([alpha, gamma, eps, zeta, "| `wf/skills/eta` | `sub/my template.md`, `notes.txt` |",
                                theta], whole), 1, None, "not a .md template"),
        })

        # Quote-aware call window: a `)` or `}` inside a quoted span must not end
        # the call — a backtick-list ref holding parens and an object-literal ref
        # holding parens and braces are derived whole. Text before the class token
        # (an apostrophe in a word, or one right after a closing backtick) must not
        # shift the window: the ref-less pointer's window has to end at its own
        # `)`, or it would swallow the next line's `ref:` and derive a read iota
        # never makes.
        put("plugins/wf/skills/iota/SKILL.md",
            "The skill's `iota`'s rationale lives in (`class: references-template`, `skill: iota`) — never read here.\n"
            "Obtain (`class: references-template`, `skill: beta`, `ref: shared.md`) and "
            "(`class: references-template`, `skill: iota`, `ref: sub/paren (x).md`).\n")
        put("plugins/wf/skills/iota/references/sub/paren (x).md", "t\n")
        put("plugins/wf-x/agents/kappa.md",
            "resolve_content({ workspaceRoot, class: \"references-template\", plugin: \"wf-x\", "
            "skill: \"delta\", ref: \"q (1) {b}.md\" })\n")
        put("plugins/wf-x/skills/delta/references/q (1) {b}.md", "t\n")

        tree, _ = scan(tmp)
        iota_reads = {(o, r) for c, o, r in tree if c == "wf/skills/iota"}
        if iota_reads != {("beta", "shared.md"), ("iota", "sub/paren (x).md")} \
                or ("wf-x/agents/kappa", "delta", "q (1) {b}.md") not in tree:
            print(f"SELFTEST FAIL — quote-aware window derived {sorted(tree)}", file=sys.stderr)
            failed += 1

        iota = "| `wf/skills/iota` | `sub/paren (x).md`, `shared.md` (beta) |"
        kappa = "| `wf-x/agents/kappa` | `q (1) {b}.md` (delta) |"
        base6 = [alpha, gamma, eps, zeta, eta, theta]
        run({
            "paren-sound": (doc(base6 + [iota, kappa], "10 templates | 8 consumers (11 template reads)"), 0),
            "paren-missing-row": (doc(base6 + ["| `wf/skills/iota` | `shared.md` (beta) |", kappa],
                                      "9 templates | 8 consumers (10 template reads)"),
                                  1, None, "TREE ⊄ DOC: wf/skills/iota reads iota/references/sub/paren (x).md"),
            "brace-missing-row": (doc(base6 + [iota], "9 templates | 7 consumers (10 template reads)"),
                                  1, None, "TREE ⊄ DOC: wf-x/agents/kappa reads delta/references/q (1) {b}.md"),
        })

        # REF/ITEM stop-set parity: a backtick-list ref holding a comma (with and
        # without a following space) ends only at its closing backtick, and a
        # double-quoted ref honours an escaped quote — each derived whole and
        # matched by the row token naming it. A quoted ref holding `|` or a
        # backtick, which no §4.4 cell can carry, is reported, never dropped.
        put("plugins/wf/skills/lambda/SKILL.md",
            "Obtain (`class: references-template`, `skill: lambda`, `ref: sub/a,b.md`) and "
            "(`class: references-template`, `skill: lambda`, `ref: sub/a, b.md`).\n")
        put("plugins/wf/skills/lambda/references/sub/a,b.md", "t\n")
        put("plugins/wf/skills/lambda/references/sub/a, b.md", "t\n")
        put("plugins/wf-x/agents/mu.md",
            'resolve_content({ workspaceRoot, class: "references-template", plugin: "wf-x", '
            'skill: "delta", ref: "q\\"t.md" })\n')
        put("plugins/wf-x/skills/delta/references/q\"t.md", "t\n")

        tree, _ = scan(tmp)
        if {r for c, _, r in tree if c == "wf/skills/lambda"} != {"sub/a,b.md", "sub/a, b.md"} \
                or ("wf-x/agents/mu", "delta", "q\"t.md") not in tree:
            print(f"SELFTEST FAIL — stop-set parity scan derived {sorted(tree)}", file=sys.stderr)
            failed += 1

        lam = "| `wf/skills/lambda` | `sub/a, b.md`, `sub/a,b.md` |"
        mu = "| `wf-x/agents/mu` | `q\"t.md` (delta) |"
        base8 = base6 + [iota, kappa]
        parity = "13 templates | 10 consumers (14 template reads)"
        run({
            "comma-sound": (doc(base8 + [lam, mu], parity), 0),
            "comma-missing-row": (doc(base8 + ["| `wf/skills/lambda` | `sub/a, b.md` |", mu],
                                      "12 templates | 10 consumers (13 template reads)"),
                                  1, None, "TREE ⊄ DOC: wf/skills/lambda reads lambda/references/sub/a,b.md"),
            "escaped-quote-missing-row": (doc(base8 + [lam], "12 templates | 9 consumers (13 template reads)"),
                                          1, None, "TREE ⊄ DOC: wf-x/agents/mu reads delta/references/q\"t.md"),
        })
        for name, ref in (("pipe-ref", "p|q.md"), ("backtick-ref", "b`t.md")):
            put("plugins/wf-x/agents/nu.md",
                'resolve_content({ workspaceRoot, class: "references-template", plugin: "wf-x", '
                f'skill: "delta", ref: "{ref}" }})\n')
            run({name: (doc(base8 + [lam, mu], parity), 1, None, "which a §4.4 row cannot express")})
        os.remove(os.path.join(tmp, "plugins/wf-x/agents/nu.md"))

        # An object literal written inside an inline-code span that wraps across
        # lines is still the literal form: its string quotes delimit the ref, and
        # the span's backticks do not swallow them.
        put("plugins/wf/skills/omicron/SKILL.md",
            "The content lives at `o t.md`, obtained via\n"
            "`resolve_content({ workspaceRoot, class: \"references-template\", skill:\n"
            "\"omicron\", ref: \"o t.md\" })` — never a raw read.\n")
        put("plugins/wf/skills/omicron/references/o t.md", "t\n")
        omi = "| `wf/skills/omicron` | `o t.md` |"
        run({
            "code-span-literal-sound": (doc(base8 + [lam, mu, omi], "14 templates | 11 consumers (15 template reads)"), 0),
            "code-span-literal-missing-row": (doc(base8 + [lam, mu], parity), 1, None,
                                              "TREE ⊄ DOC: wf/skills/omicron reads omicron/references/o t.md"),
        })

        # The documented unquoted contract: an UNQUOTED object-literal ref is not
        # delimited, so it ends at `,` or at the call's `)` — `sub/a,b.md` and
        # `sub/a (b).md` written unquoted are not derived as reads (neither whole
        # nor as a prefix), which is why the header requires quoting them there.
        put("plugins/wf/skills/pi/SKILL.md",
            "resolve_content({ workspaceRoot, class: \"references-template\", skill: \"pi\", ref: sub/a,b.md })\n"
            "resolve_content({ workspaceRoot, class: \"references-template\", skill: \"pi\", ref: sub/a (b).md })\n")
        tree, _ = scan(tmp)
        if any(c == "wf/skills/pi" for c, _, _ in tree):
            print(f"SELFTEST FAIL — unquoted literal refs derived {sorted(r for c, _, r in tree if c == 'wf/skills/pi')}; "
                  "the documented contract says an unquoted ref ends at `,` / `)`", file=sys.stderr)
            failed += 1

        # A quoted value is whole in every form, prose included, and a quote opens
        # a value only where one begins: a quoted prose ref holding parens is
        # derived whole; an unquoted ref holding an apostrophe (object literal and
        # prose) is derived whole, the apostrophe opening no string; and a
        # mid-word apostrophe before the call's `)` must not swallow it.
        put("plugins/wf/skills/rho/SKILL.md",
            "Obtain it (class: references-template, skill: rho, ref: \"a (b).md\").\n"
            "resolve_content({ workspaceRoot, class: \"references-template\", skill: \"rho\", ref: it's.md })\n"
            "Then (class: references-template, skill: rho, ref: o'k.md).\n"
            "Read (class: references-template, skill: rho, ref: w.md, the template's copy) and "
            "(class: references-template, skill: rho, ref: x.md).\n")
        tree, _ = scan(tmp)
        rho = {r for c, _, r in tree if c == "wf/skills/rho"}
        if rho != {"a (b).md", "it's.md", "o'k.md", "w.md", "x.md"}:
            print(f"SELFTEST FAIL — quoted-prose and apostrophe refs derived {sorted(rho)}", file=sys.stderr)
            failed += 1
        if failed:
            print(f"content-read-references-inventory-guard: self-test FAILED ({failed} case(s))", file=sys.stderr)
            return 1
        print("content-read-references-inventory-guard: self-test passed — four planted drifts rejected "
              "(missing row, stale row, absent template, wrong §5 count), the sound fixture accepted, "
              "and the ref-less pointer ignored; nested refs derived whole, a nested row's absence, "
              "mismatch or missing template rejected, an unsafe row rejected, and unsafe refs ignored; "
              "safe_ref() agrees with isSafeRelPath on every rule, spaced and quoted refs derived whole "
              "and matched, a missing spaced row rejected, drive-rooted and backslash refs refused whole, "
              "and drive-rooted, backslash-escape and non-.md row tokens each rejected on their own; "
              "quoted refs holding parens or braces derived whole and their missing rows rejected, "
              "and text before the class token kept from shifting the window; comma-bearing backtick-list "
              "refs, an escaped-quote ref and an object literal inside a wrapped code span derived whole and "
              "their missing rows rejected, refs holding `|` or a backtick reported as inexpressible, and "
              "the documented unquoted-literal stop at `,` / `)` pinned; a quoted prose ref holding parens "
              "and unquoted refs holding an apostrophe derived whole, a mid-word apostrophe opening no string.")
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
