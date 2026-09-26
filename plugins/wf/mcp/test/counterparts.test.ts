// WF-758 — deterministic counterpart listing.
//
// Proves, with in-memory data only:
//   1. LISTING — a changed declared key lists every declared location, tagged.
//   2. NO COUNTERPARTS — an undeclared key, or one whose copies all changed, lists nothing.
//   3. DISTINCTIVENESS — a too-short key is suppressed; a very common one is summarised.
//   4. MAP HYGIENE — malformed rows become diagnostics, never guesses.
//   5. REPLAY — five one-copy-fix shapes, each listing the sibling left unchanged.
//   6. SERVICE — the tool path is inert without a map and reports an unavailable diff honestly.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeSlashes } from "../src/resolver/paths.js";
import { createDefaultPorts } from "../src/ports.js";
import { ResolverService, type ResolverServicePorts } from "../src/service.js";
import {
  MIN_KEY_LENGTH,
  SUMMARY_KEEP,
  SUMMARY_THRESHOLD,
  computeCounterparts,
  parseCounterpartMap,
  parseUnifiedDiff,
} from "../src/resolver/counterparts.js";

/** Build a `git diff --unified=0` fragment for one file. */
function fileDiff(path: string, hunks: Array<{ start: number; removed?: string[]; added?: string[] }>): string {
  const out = [`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`];
  for (const h of hunks) {
    const r = h.removed ?? [];
    const a = h.added ?? [];
    out.push(`@@ -${h.start},${r.length} +${h.start},${a.length} @@`);
    for (const l of r) out.push(`-${l}`);
    for (const l of a) out.push(`+${l}`);
  }
  return out.join("\n");
}

const map = (rows: string[]): string =>
  ["# Counterparts", "", "| Key | Kind | Locations |", "|---|---|---|", ...rows].join("\n");

function run(mapText: string, diff: string, files: Record<string, string>) {
  const { entries, diagnostics } = parseCounterpartMap(mapText);
  const result = computeCounterparts({
    entries,
    changes: parseUnifiedDiff(diff),
    readLocation: (p) => (p in files ? files[p] : null),
  });
  return { ...result, diagnostics };
}

test("listing: a changed declared key lists every declared location, tagged changed/unchanged", () => {
  const files = {
    "docs/a.md": "intro\nThe retry limit is 3.\n",
    "docs/b.md": "x\ny\nThe retry limit is 3.\n",
  };
  const r = run(
    map(["| `retry limit` | mirror | docs/a.md, docs/b.md |"]),
    fileDiff("docs/a.md", [{ start: 2, removed: ["The retry limit is 2."], added: ["The retry limit is 3."] }]),
    files,
  );
  assert.equal(r.listings.length, 1);
  const l = r.listings[0];
  assert.equal(l.key, "retry limit");
  assert.deepEqual(l.changedAt, ["docs/a.md:2"]);
  assert.deepEqual(
    l.locations.map((x) => [x.path, x.changed, x.lines]),
    [
      ["docs/a.md", true, [2]],
      ["docs/b.md", false, [3]],
    ],
  );
  assert.equal(l.total, 1);
  assert.equal(l.summarized, false);
});

test("no counterparts: an undeclared key lists nothing", () => {
  const r = run(
    map(["| `retry limit` | mirror | docs/a.md, docs/b.md |"]),
    fileDiff("docs/c.md", [{ start: 1, added: ["something else entirely"] }]),
    {},
  );
  assert.deepEqual(r.listings, []);
  assert.deepEqual(r.suppressed, []);
});

test("no counterparts: every declared copy changed together lists nothing", () => {
  const diff = [
    fileDiff("docs/a.md", [{ start: 1, added: ["retry limit 3"] }]),
    fileDiff("docs/b.md", [{ start: 1, added: ["retry limit 3"] }]),
  ].join("\n");
  const r = run(map(["| retry limit | mirror | docs/a.md, docs/b.md |"]), diff, {
    "docs/a.md": "retry limit 3",
    "docs/b.md": "retry limit 3",
  });
  assert.deepEqual(r.listings, []);
});

test("a removal alone marks a key changed and names the file without a line", () => {
  const r = run(
    map(["| `**Stamp:**` | writer-parser | out/writer.md, in/parser.md |"]),
    fileDiff("out/writer.md", [{ start: 4, removed: ["**Stamp:** <date>"] }]),
    { "out/writer.md": "", "in/parser.md": "read **Stamp:** here" },
  );
  assert.equal(r.listings.length, 1);
  assert.deepEqual(r.listings[0].changedAt, ["out/writer.md"]);
  assert.deepEqual(
    r.listings[0].locations.find((x) => x.path === "in/parser.md"),
    { path: "in/parser.md", lines: [1], changed: false, missing: false },
  );
});

test("a declared location missing from the working tree is listed as missing, not dropped", () => {
  const r = run(
    map(["| `retry limit` | mirror | docs/a.md, docs/gone.md |"]),
    fileDiff("docs/a.md", [{ start: 1, added: ["retry limit 4"] }]),
    { "docs/a.md": "retry limit 4" },
  );
  const gone = r.listings[0].locations.find((x) => x.path === "docs/gone.md");
  assert.deepEqual(gone, { path: "docs/gone.md", lines: [], changed: false, missing: true });
});

test("distinctiveness: a key shorter than the minimum is suppressed, never listed", () => {
  const short = "x".repeat(MIN_KEY_LENGTH - 1);
  const r = run(
    map([`| ${short} | mirror | docs/a.md, docs/b.md |`]),
    fileDiff("docs/a.md", [{ start: 1, added: [`${short} changed`] }]),
    { "docs/a.md": short, "docs/b.md": short },
  );
  assert.deepEqual(r.listings, []);
  assert.deepEqual(r.suppressed, [{ key: short, reason: "too-short" }]);
});

test("distinctiveness: a very common key is summarised, never listed in full", () => {
  const many = Array.from({ length: SUMMARY_THRESHOLD + 5 }, () => "common-token").join("\n");
  const r = run(
    map(["| common-token | reference | src/def.md, src/uses.md |"]),
    fileDiff("src/def.md", [{ start: 1, added: ["common-token = 2"] }]),
    { "src/def.md": "common-token = 2", "src/uses.md": many },
  );
  const l = r.listings[0];
  assert.equal(l.summarized, true);
  assert.equal(l.total, SUMMARY_THRESHOLD + 5);
  const listed = l.locations.filter((x) => !x.changed).reduce((n, x) => n + x.lines.length, 0);
  assert.equal(listed, SUMMARY_KEEP);
});

test("map hygiene: malformed rows are diagnosed and skipped", () => {
  const { entries, diagnostics } = parseCounterpartMap(
    map([
      "| `ok key` | mirror | a.md, b.md |",
      "| `bad kind` | twin | a.md |",
      "| `escape` | mirror | ../outside.md |",
      "| `abs` | mirror | /etc/passwd |",
      "| only two | cells |",
      "| `` | mirror | a.md |",
    ]),
  );
  assert.deepEqual(entries.map((e) => e.key), ["ok key"]);
  assert.equal(diagnostics.length, 5);
  assert.ok(diagnostics.some((d) => d.includes('unknown kind "twin"')));
  assert.ok(diagnostics.some((d) => d.includes("escapes the workspace")));
  assert.ok(diagnostics.some((d) => d.includes("absolute location")));
});

test("diff parsing: a removed line beginning with dashes is content, not a header", () => {
  const diff = fileDiff("docs/a.md", [{ start: 3, removed: ["-- retry limit note"], added: ["kept"] }]);
  const changes = parseUnifiedDiff(diff);
  assert.deepEqual(changes.get("docs/a.md")?.removed, ["-- retry limit note"]);
  assert.deepEqual(changes.get("docs/a.md")?.added, [{ line: 3, text: "kept" }]);
});

test("diff parsing: a deleted file is keyed by its old path", () => {
  const diff = ["diff --git a/old.md b/old.md", "--- a/old.md", "+++ /dev/null", "@@ -1,1 +0,0 @@", "-retry limit"].join(
    "\n",
  );
  assert.deepEqual(parseUnifiedDiff(diff).get("old.md")?.removed, ["retry limit"]);
});

// The five one-copy-fix shapes: in each, the fix landed in one copy of a
// mirrored rule and the sibling was left stale. Every row must list its sibling.
test("replay: five one-copy-fix shapes each list the unchanged sibling", () => {
  const rows = [
    { key: "Step 4 — confirm the anchor", kind: "mirror", a: "agents/auditor.md", b: "skills/audit/references/auditor.md" },
    { key: "Mechanical-first ordering", kind: "mirror", a: "skills/audit/SKILL.md", b: "skills/audit/references/report-template.md" },
    { key: "**Audited at:**", kind: "writer-parser", a: "skills/audit/references/report-template.md", b: "skills/fix/SKILL.md" },
    { key: "loop:l<L>:r<N>:extend", kind: "mirror", a: "skills/run/SKILL.md", b: "skills/ship/SKILL.md" },
    { key: "Recorded-root-first resolution", kind: "reference", a: "contracts/registry.ops.md", b: "contracts/registry.contract.md" },
  ];
  const files: Record<string, string> = {};
  for (const r of rows) {
    files[r.a] = `${files[r.a] ?? ""}\nnew ${r.key}\n`;
    files[r.b] = `${files[r.b] ?? ""}\nold ${r.key}\n`;
  }
  const diff = rows
    .map((r) => fileDiff(r.a, [{ start: 2, removed: [`old ${r.key}`], added: [`new ${r.key}`] }]))
    .join("\n");
  const result = run(map(rows.map((r) => `| \`${r.key}\` | ${r.kind} | ${r.a}, ${r.b} |`)), diff, files);

  assert.equal(result.diagnostics.length, 0);
  assert.equal(result.listings.length, 5);
  for (const r of rows) {
    const l = result.listings.find((x) => x.key === r.key);
    assert.ok(l, `row "${r.key}" produced no listing`);
    const unchanged = l.locations.filter((x) => !x.changed).map((x) => x.path);
    assert.ok(unchanged.includes(r.b), `row "${r.key}" did not list its unchanged sibling ${r.b}`);
    assert.ok(l.locations.some((x) => x.path === r.b && x.lines.length > 0));
  }
});

// --- service path ----------------------------------------------------------

const WS = "/ws";

function makePorts(opts: { map?: string; diff?: string | null; noDiffPort?: boolean; files?: Record<string, string> }) {
  const files = new Map<string, string>();
  if (opts.map !== undefined) files.set(`${WS}/_local/counterparts.md`, opts.map);
  for (const [k, v] of Object.entries(opts.files ?? {})) files.set(`${WS}/${k}`, v);
  const diffCalls: string[] = [];
  const ports: ResolverServicePorts = {
    workspaceRoot: WS,
    corePluginRoot: "/core/plugins/wf",
    resolveFresh: () => {
      throw new Error("counterpart listing must not trigger capability resolution");
    },
    persist() {
      throw new Error("counterpart listing must not persist a snapshot");
    },
    readCache: () => null,
    readFile: (p) => files.get(normalizeSlashes(p)) ?? null,
    writeFile() {
      throw new Error("counterpart listing must not write");
    },
    listDirs: () => [],
    listPlugins: () => ({ plugins: [], ok: true, contractOk: true, issues: [] }),
    registryRelPath: () => "_local/config.md",
  };
  if (!opts.noDiffPort) {
    ports.workspaceDiff = (ref: string) => {
      diffCalls.push(ref);
      return opts.diff === undefined ? "" : opts.diff;
    };
  }
  return { ports, diffCalls };
}

test("service: no map means no-map, no listing, and no diff is taken (inert default)", () => {
  const { ports, diffCalls } = makePorts({ diff: fileDiff("a.md", [{ start: 1, added: ["retry limit"] }]) });
  const res = new ResolverService(ports).listCounterparts("main");
  assert.equal(res.status, "no-map");
  assert.equal(res.mapPath, "_local/counterparts.md");
  assert.deepEqual(res.listings, []);
  assert.deepEqual(diffCalls, []);
});

test("service: a map and a diff yield listed", () => {
  const { ports, diffCalls } = makePorts({
    map: map(["| retry limit | mirror | a.md, b.md |"]),
    diff: fileDiff("a.md", [{ start: 1, added: ["retry limit 3"] }]),
    files: { "a.md": "retry limit 3", "b.md": "retry limit 2" },
  });
  const res = new ResolverService(ports).listCounterparts("main");
  assert.equal(res.status, "listed");
  assert.deepEqual(diffCalls, ["main"]);
  assert.equal(res.listings.length, 1);
  assert.equal(res.listings[0].locations.find((l) => l.path === "b.md")?.changed, false);
});

test("service: an empty diff is no-diff", () => {
  const { ports } = makePorts({ map: map(["| retry limit | mirror | a.md, b.md |"]), diff: "" });
  assert.equal(new ResolverService(ports).listCounterparts("main").status, "no-diff");
});

test("service: a failed diff or a missing diff port is unavailable, never an empty success", () => {
  const failed = makePorts({ map: map(["| retry limit | mirror | a.md |"]), diff: null });
  const r1 = new ResolverService(failed.ports).listCounterparts("main");
  assert.equal(r1.status, "unavailable");
  assert.ok(r1.diagnostics.length > 0);

  const noPort = makePorts({ map: map(["| retry limit | mirror | a.md |"]), noDiffPort: true });
  assert.equal(new ResolverService(noPort.ports).listCounterparts("main").status, "unavailable");
});

test("real port: the git-backed diff lists a dirty working-tree change against HEAD", () => {
  const root = normalizeSlashes(realpathSync(mkdtempSync(join(tmpdir(), "wf-counterparts-"))));
  const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { stdio: "ignore" });
  try {
    git("init", "-q");
    git("config", "user.email", "t@example.invalid");
    git("config", "user.name", "t");
    mkdirSync(join(root, "_local"));
    mkdirSync(join(root, "docs"));
    writeFileSync(join(root, "_local", "counterparts.md"), map(["| `retry limit` | mirror | docs/a.md, docs/b.md |"]));
    writeFileSync(join(root, "docs", "a.md"), "The retry limit is 2.\n");
    writeFileSync(join(root, "docs", "b.md"), "intro\nThe retry limit is 2.\n");
    git("add", "docs");
    git("commit", "-q", "-m", "seed");
    writeFileSync(join(root, "docs", "a.md"), "The retry limit is 3.\n");

    const ports = { ...createDefaultPorts(root), registryRelPath: () => "_local/config.md" };
    const res = new ResolverService(ports).listCounterparts("HEAD");
    assert.equal(res.status, "listed");
    assert.deepEqual(res.listings[0].changedAt, ["docs/a.md:1"]);
    assert.deepEqual(res.listings[0].locations.find((l) => l.path === "docs/b.md")?.lines, [2]);

    assert.equal(new ResolverService(ports).listCounterparts("no-such-ref").status, "unavailable");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("service: an unsafe base ref is refused before any diff is taken", () => {
  const { ports, diffCalls } = makePorts({ map: map(["| retry limit | mirror | a.md |"]), diff: "" });
  const svc = new ResolverService(ports);
  for (const bad of ["--output=/tmp/x", "-p", "main..other", "a b", ""]) {
    const res = svc.listCounterparts(bad);
    assert.equal(res.status, "unavailable", bad);
  }
  assert.deepEqual(diffCalls, []);
});
