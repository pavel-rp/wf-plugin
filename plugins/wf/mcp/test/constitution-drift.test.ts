// Core-article drift detection over an already-composed record — contract tests (WF-501).
//
// THE SIGNAL IS THE COMMITTED FIXTURE, NEVER THE LIVE RECORD. `_local/constitution.md`
// is gitignored: it is untracked, invisible to CI and to every other clone, and its own
// first re-run destroys the staleness a test over it would depend on. So a live composed
// record is at most a one-shot smoke observation and never an acceptance artifact, and
// nothing in this file reads a path under `_local/`. The stale fixture already committed
// for the composer's tests carries that reasoning in its own header, and it is reused
// here rather than duplicated — one stale record, two consumers.
//
// The property these tests exist for above all others: THE CHECK NEVER WRITES. The
// fixture's bytes on disk are asserted unchanged after the call, and the one MUTABLE
// input — the core-body array — is asserted unchanged too, because a check that fixes
// what it finds is a re-composition, which already exists and is separately gated.
//
// The second property, and the one an earlier draft of this module got wrong: THE
// DETECTOR'S REFUSAL SET MATCHES THE COMPOSER'S. Reporting `current` for a record
// `/wf:constitution` would refuse is not a near-miss — it emits a remedy that cannot
// succeed. Every one of the composer's structural guards therefore has a case here.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CORE_DRIFT_CODE,
  CORE_UNRECOGNIZED_CODE,
  coreArticleDriftDiagnostic,
  detectCoreArticleDrift,
} from "../src/resolver/constitution-drift.js";
import {
  CORE_ARTICLES_BODY,
  CORE_ARTICLES_HEADING,
} from "../src/resolver/constitution-core.js";
import {
  CAPABILITY_ARTICLES_HEADING,
  PROJECT_CLAUSES_HEADING,
  composeConstitutionRecord,
  type ConstitutionCompositionInput,
} from "../src/resolver/constitution-compose.js";
import { isFailureSignal } from "../src/resolver/failure.js";
import { buildSnapshot, type BuildSnapshotInputs } from "../src/resolver/resolve.js";
import { normalizeSlashes } from "../src/resolver/paths.js";

/** Drive the composer over the same bytes, carrying the same core body, so "the
 *  composer would refuse this" is asserted against the composer itself rather than
 *  against a second opinion about it. */
const composerInput = (current: string): ConstitutionCompositionInput => ({
  current,
  capabilities: [],
  registryNames: [],
  coreArticles: CORE_ARTICLES_BODY,
});

// The suite executes from a bundled temp dir, so fixtures resolve through the runner's
// `WF_MCP_DIR` rather than `import.meta.url` — the same convention every other fixture
// consumer in this suite uses.
const MCP_DIR = process.env.WF_MCP_DIR ?? process.cwd();
const FIXTURES = join(MCP_DIR, "test/fixtures/constitution");
const STALE_PATH = join(FIXTURES, "stale-pre-amendment.md");
const UNKNOWN_PATH = join(FIXTURES, "unknown-structure.md");

const PREAMBLE = [
  "# Project Constitution",
  "",
  "**Composed:** 2026-07-21 11:38",
  "**Model:** gpt-5.6-sol[1m]",
  "**Registry:** git, audit, sr",
  "",
  "## Precedence",
  "",
  "1. **Project clauses override capability clauses.**",
  "",
];

const CAPABILITY_SECTION = [
  CAPABILITY_ARTICLES_HEADING,
  "",
  "### sr",
  "",
  "- **sr.1 — precommit-self-review:** required",
  "",
];

const PROJECT_TAIL = [
  PROJECT_CLAUSES_HEADING,
  "",
  "1. **no-vendored-forks:** a third-party dependency is upgraded, never forked in place.",
  "",
];

/** A record whose core section is exactly what this release renders — built FROM the
 *  shipped body, so it stays current by construction when the articles are next
 *  reworded, and the `current` case never rots into a false `stale`. */
const record = (coreBody: readonly string[]): string =>
  [
    ...PREAMBLE,
    CORE_ARTICLES_HEADING,
    ...coreBody,
    ...CAPABILITY_SECTION,
    ...PROJECT_TAIL,
  ].join("\n");

const CURRENT_RECORD = record(CORE_ARTICLES_BODY);

/** The nine ids the release defines, read off the shipped body rather than typed
 *  out, so adding a tenth article does not silently leave this suite testing nine. */
const RELEASE_IDS = CORE_ARTICLES_BODY.filter((line) => line.trim().length > 0).map((line) =>
  line.slice(4, line.indexOf(" —")),
);

// --- current -------------------------------------------------------------------

test("a record carrying this release's core articles reports no drift", () => {
  const report = detectCoreArticleDrift(CURRENT_RECORD, CORE_ARTICLES_BODY);
  assert.equal(report.verdict, "current");
});

test("a current record emits no diagnostic at all", () => {
  const report = detectCoreArticleDrift(CURRENT_RECORD, CORE_ARTICLES_BODY);
  assert.equal(coreArticleDriftDiagnostic(report), null);
});

test("a CRLF record that is otherwise current reports no drift", () => {
  // Line endings are not article text. A project on a CRLF checkout must not be told
  // its constitution is behind the release because of its line terminators.
  const crlf = CURRENT_RECORD.split("\n").join("\r\n");
  assert.equal(detectCoreArticleDrift(crlf, CORE_ARTICLES_BODY).verdict, "current");
});

test("blank-line layout is not drift", () => {
  const padded = record(["", "", ...CORE_ARTICLES_BODY, ""]);
  assert.equal(detectCoreArticleDrift(padded, CORE_ARTICLES_BODY).verdict, "current");
});

// --- stale ---------------------------------------------------------------------

test("the committed pre-amendment fixture is reported stale, naming every release article", () => {
  const report = detectCoreArticleDrift(readFileSync(STALE_PATH, "utf8"), CORE_ARTICLES_BODY);
  assert.equal(report.verdict, "stale");
  if (report.verdict !== "stale") return;

  // The fixture predates the ids entirely, so every article the release defines is
  // absent from it and every one of its own lines is unattributable.
  const absent = report.differences
    .filter((entry) => entry.state === "absent")
    .map((entry) => entry.id);
  assert.deepEqual(absent, RELEASE_IDS);
  assert.ok(
    report.unattributedLines > 0,
    "the pre-id fixture's own article lines must be counted, not silently dropped",
  );
});

test("a single reworded article is reported as changed, not as the whole section", () => {
  const tampered = CORE_ARTICLES_BODY.map((line) =>
    line.startsWith("- **core.6") ? `${line} And one more sentence.` : line,
  );
  const report = detectCoreArticleDrift(record(tampered), CORE_ARTICLES_BODY);
  assert.equal(report.verdict, "stale");
  if (report.verdict !== "stale") return;
  assert.deepEqual([...report.differences], [{ id: "core.6", state: "changed" }]);
  assert.equal(report.unattributedLines, 0);
});

test("an article the release no longer defines is reported as unexpected", () => {
  const withExtra = [
    ...CORE_ARTICLES_BODY,
    "- **core.10 — A retired article.** Kept by a record the release moved past.",
  ];
  const report = detectCoreArticleDrift(record(withExtra), CORE_ARTICLES_BODY);
  assert.equal(report.verdict, "stale");
  if (report.verdict !== "stale") return;
  assert.deepEqual([...report.differences], [{ id: "core.10", state: "unexpected" }]);
});

// --- unrecognized --------------------------------------------------------------

test("the committed unknown-structure fixture reports neither drift nor currency", () => {
  const report = detectCoreArticleDrift(readFileSync(UNKNOWN_PATH, "utf8"), CORE_ARTICLES_BODY);
  assert.equal(report.verdict, "unrecognized");
  if (report.verdict !== "unrecognized") return;
  assert.match(report.detail, /unrecognized section/);
});

test("a record with no core-articles heading reports unrecognized", () => {
  const headless = [...PREAMBLE, ...CAPABILITY_SECTION, ...PROJECT_TAIL].join("\n");
  const report = detectCoreArticleDrift(headless, CORE_ARTICLES_BODY);
  assert.equal(report.verdict, "unrecognized");
});

test("a record carrying the core-articles heading twice reports unrecognized", () => {
  const doubled = [
    ...PREAMBLE,
    CORE_ARTICLES_HEADING,
    ...CORE_ARTICLES_BODY,
    CORE_ARTICLES_HEADING,
    ...CORE_ARTICLES_BODY,
    ...CAPABILITY_SECTION,
    ...PROJECT_TAIL,
  ].join("\n");
  const report = detectCoreArticleDrift(doubled, CORE_ARTICLES_BODY);
  assert.equal(report.verdict, "unrecognized");
});

test("a record placing the core heading after the capability heading reports unrecognized", () => {
  const inverted = [
    ...PREAMBLE,
    ...CAPABILITY_SECTION,
    CORE_ARTICLES_HEADING,
    ...CORE_ARTICLES_BODY,
    ...PROJECT_TAIL,
  ].join("\n");
  const report = detectCoreArticleDrift(inverted, CORE_ARTICLES_BODY);
  assert.equal(report.verdict, "unrecognized");
});

test("an unrecognized structure is NEVER reported as current", () => {
  // The silent-failure mode this whole line of work exists to kill: asserting a
  // record is fine because it could not be read.
  for (const input of [
    readFileSync(UNKNOWN_PATH, "utf8"),
    [...PREAMBLE, ...CAPABILITY_SECTION, ...PROJECT_TAIL].join("\n"),
    "",
    "# Not a constitution at all",
  ]) {
    const verdict = detectCoreArticleDrift(input, CORE_ARTICLES_BODY).verdict;
    assert.notEqual(verdict, "current", `must not claim currency for:\n${input.slice(0, 60)}`);
    assert.notEqual(verdict, "stale", `must not claim drift for:\n${input.slice(0, 60)}`);
  }
});

// --- non-mutation --------------------------------------------------------------

test("the check never consumes the record it inspects", () => {
  // Only the on-disk comparison is asserted here. Comparing the passed string against
  // itself afterwards would be vacuous — JavaScript strings are immutable, so such an
  // assertion cannot fail whatever the detector does, and stating it would overclaim.
  // The mutable input is the core-body array, and it has its own test below.
  const before = readFileSync(STALE_PATH, "utf8");
  detectCoreArticleDrift(before, CORE_ARTICLES_BODY);
  assert.equal(
    readFileSync(STALE_PATH, "utf8"),
    before,
    "a check that repaired what it found would be a re-composition, which is separately gated",
  );
});

test("the shipped core body is not mutated by a comparison against it", () => {
  const snapshot = [...CORE_ARTICLES_BODY];
  detectCoreArticleDrift(readFileSync(STALE_PATH, "utf8"), CORE_ARTICLES_BODY);
  assert.deepEqual([...CORE_ARTICLES_BODY], snapshot);
});

// --- the diagnostic surface ----------------------------------------------------

test("a stale record maps to one warning diagnostic that names what differs", () => {
  const report = detectCoreArticleDrift(readFileSync(STALE_PATH, "utf8"), CORE_ARTICLES_BODY);
  const diagnostic = coreArticleDriftDiagnostic(report);
  assert.notEqual(diagnostic, null);
  if (diagnostic === null) return;
  assert.equal(diagnostic.severity, "warning");
  assert.equal(diagnostic.code, CORE_DRIFT_CODE);
  // Naming WHAT differs is half the success criterion — a bare "you are stale" is not it.
  for (const id of RELEASE_IDS) assert.ok(diagnostic.message.includes(id));
  // And it must say it changed nothing, so the message is never read as a repair.
  assert.match(diagnostic.message, /does not modify the record/);
});

test("an unrecognized record maps to an info diagnostic that claims neither state", () => {
  const report = detectCoreArticleDrift(readFileSync(UNKNOWN_PATH, "utf8"), CORE_ARTICLES_BODY);
  const diagnostic = coreArticleDriftDiagnostic(report);
  assert.notEqual(diagnostic, null);
  if (diagnostic === null) return;
  assert.equal(diagnostic.severity, "info");
  assert.equal(diagnostic.code, CORE_UNRECOGNIZED_CODE);
  assert.match(diagnostic.message, /could not be determined/);
});

test("neither diagnostic degrades resolver health", () => {
  // The deliberate carve-out: a constitution trailing the release is advisory, not a
  // resolver failure. Categorizing either one would flip `resolve_gate.healthy` and
  // escalate every delivery write to `block` until someone re-composed — which would
  // make the honest signal something projects route around.
  for (const path of [STALE_PATH, UNKNOWN_PATH]) {
    const diagnostic = coreArticleDriftDiagnostic(
      detectCoreArticleDrift(readFileSync(path, "utf8"), CORE_ARTICLES_BODY),
    );
    assert.notEqual(diagnostic, null);
    if (diagnostic === null) continue;
    assert.equal(diagnostic.category, undefined);
    assert.equal(
      isFailureSignal(diagnostic),
      false,
      `${diagnostic.code} must not be a resolve_gate failure signal`,
    );
  }
});

// --- the refusal set matches the composer's ------------------------------------
//
// These four pin the guards a first draft of this module omitted. Each input below is
// one `composeConstitutionRecord` REFUSES, so calling any of them `current` would be a
// false all-clear, and calling one `stale` would emit "re-compose it with
// `/wf:constitution`" — a remedy that path rejects.

test("a record with no project-clauses section reports unrecognized, not current", () => {
  const noClauses = [
    ...PREAMBLE,
    CORE_ARTICLES_HEADING,
    ...CORE_ARTICLES_BODY,
    ...CAPABILITY_SECTION,
  ].join("\n");
  // Its core section IS this release's, which is exactly why the naive check passed it.
  const report = detectCoreArticleDrift(noClauses, CORE_ARTICLES_BODY);
  assert.equal(report.verdict, "unrecognized");
  assert.equal(composeConstitutionRecord({ ...composerInput(noClauses) }).ok, false);
});

test("a stray section between the capability and project-clauses headings reports unrecognized", () => {
  // The committed unknown-structure fixture's defect, moved one section down.
  const strayBelow = [
    ...PREAMBLE,
    CORE_ARTICLES_HEADING,
    ...CORE_ARTICLES_BODY,
    ...CAPABILITY_SECTION,
    "## House rules",
    "",
    "Hand-added by the project, below the section the composer owns.",
    "",
    ...PROJECT_TAIL,
  ].join("\n");
  const report = detectCoreArticleDrift(strayBelow, CORE_ARTICLES_BODY);
  assert.equal(report.verdict, "unrecognized");
  assert.equal(composeConstitutionRecord({ ...composerInput(strayBelow) }).ok, false);
});

test("a record placing the project clauses before the capability articles reports unrecognized", () => {
  const inverted = [
    ...PREAMBLE,
    CORE_ARTICLES_HEADING,
    ...CORE_ARTICLES_BODY,
    ...PROJECT_TAIL,
    ...CAPABILITY_SECTION,
  ].join("\n");
  const report = detectCoreArticleDrift(inverted, CORE_ARTICLES_BODY);
  assert.equal(report.verdict, "unrecognized");
  assert.equal(composeConstitutionRecord({ ...composerInput(inverted) }).ok, false);
});

test("no record this detector calls current or stale is one the composer refuses", () => {
  // The invariant itself, over every record shape this suite builds.
  const candidates = [
    CURRENT_RECORD,
    readFileSync(STALE_PATH, "utf8"),
    readFileSync(UNKNOWN_PATH, "utf8"),
    [...PREAMBLE, CORE_ARTICLES_HEADING, ...CORE_ARTICLES_BODY, ...CAPABILITY_SECTION].join("\n"),
    [
      ...PREAMBLE,
      CORE_ARTICLES_HEADING,
      ...CORE_ARTICLES_BODY,
      ...CAPABILITY_SECTION,
      "## House rules",
      "",
      ...PROJECT_TAIL,
    ].join("\n"),
  ];
  for (const candidate of candidates) {
    const verdict = detectCoreArticleDrift(candidate, CORE_ARTICLES_BODY).verdict;
    if (verdict === "unrecognized") continue;
    assert.equal(
      composeConstitutionRecord({ ...composerInput(candidate) }).ok,
      true,
      `verdict ${verdict} was reported for a record the composer refuses`,
    );
  }
});

// --- the ordering-only stale branch --------------------------------------------

test("a reordered core section is stale, with no per-article difference to name", () => {
  const reordered = record([...CORE_ARTICLES_BODY].reverse());
  const report = detectCoreArticleDrift(reordered, CORE_ARTICLES_BODY);
  assert.equal(report.verdict, "stale");
  if (report.verdict !== "stale") return;
  assert.deepEqual([...report.differences], []);
  assert.equal(report.unattributedLines, 0);
  // The message must still say something true rather than reading as "nothing differs".
  const diagnostic = coreArticleDriftDiagnostic(report);
  assert.match(diagnostic?.message ?? "", /order or arrangement differs/);
});

// --- the empty-body guard ------------------------------------------------------

test("an empty core body is unrecognized, never 'the release defines no articles'", () => {
  // Taking `[]` as a value would report every article of every correct record as drift.
  // The composer reads an empty body as ABSENT; so does this.
  for (const empty of [[], ["", "  ", ""]]) {
    const report = detectCoreArticleDrift(CURRENT_RECORD, empty);
    assert.equal(report.verdict, "unrecognized");
  }
});

// --- the rendered message is bounded -------------------------------------------

test("the diagnostic message stays bounded no matter how large the record is", () => {
  // The message is persisted in the snapshot and re-served by every `resolve_inspect`,
  // and its inputs are ids read out of a record this module does not control.
  const hostile = Array.from(
    { length: 5000 },
    (_unused, index) => `- **${"x".repeat(500)}${index} — Injected.** body`,
  );
  const report = detectCoreArticleDrift(record(hostile), CORE_ARTICLES_BODY);
  assert.equal(report.verdict, "stale");
  const message = coreArticleDriftDiagnostic(report)?.message ?? "";
  assert.ok(
    message.length < 4000,
    `a ${record(hostile).length}-byte record produced a ${message.length}-byte message`,
  );
  assert.match(message, /and \d+ more unexpected/);
});

// --- the snapshot wiring (the branch that actually makes drift visible) ---------

const SNAPSHOT_REGISTRY = `# Skills Configuration

## Task Folders

| Key | Value |
|-----|-------|
| **Task Root** | \`_local\` |

## Capabilities

| Capability | Path |
|------------|------|
`;

function snapshotInputs(): BuildSnapshotInputs {
  return {
    workspaceRoot: "/ws",
    registryPathValue: "_local/config.md",
    registryContent: SNAPSHOT_REGISTRY,
    wfConfigContent: null,
    coreConfigContent: SNAPSHOT_REGISTRY,
    pluginListRaw: "[]",
    generatedAt: "2026-08-29T00:00:00.000Z",
    generator: { name: "wf-resolver", version: "0.5.0" },
  };
}

const snapshotIO = (constitution: string | null) => ({
  readFile: (path: string): string | null => {
    const normalized = normalizeSlashes(path);
    if (normalized === normalizeSlashes("/ws/_local/config.md")) return SNAPSHOT_REGISTRY;
    if (normalized === normalizeSlashes("/ws/_local/constitution.md")) return constitution;
    return null;
  },
});

test("a stale composed record surfaces as exactly one drift diagnostic on the snapshot", () => {
  const snap = buildSnapshot(snapshotInputs(), snapshotIO(readFileSync(STALE_PATH, "utf8")));
  const drift = snap.diagnostics.filter((entry) => entry.code === CORE_DRIFT_CODE);
  assert.equal(drift.length, 1);
  assert.equal(drift[0].severity, "warning");
});

test("a current composed record surfaces no drift diagnostic", () => {
  const snap = buildSnapshot(snapshotInputs(), snapshotIO(CURRENT_RECORD));
  assert.equal(
    snap.diagnostics.filter(
      (entry) => entry.code === CORE_DRIFT_CODE || entry.code === CORE_UNRECOGNIZED_CODE,
    ).length,
    0,
  );
});

test("an absent composed record surfaces no diagnostic — absence is not drift", () => {
  const snap = buildSnapshot(snapshotInputs(), snapshotIO(null));
  assert.equal(
    snap.diagnostics.filter(
      (entry) => entry.code === CORE_DRIFT_CODE || entry.code === CORE_UNRECOGNIZED_CODE,
    ).length,
    0,
  );
});

test("an unrecognized composed record surfaces the info diagnostic, not the drift one", () => {
  const snap = buildSnapshot(snapshotInputs(), snapshotIO(readFileSync(UNKNOWN_PATH, "utf8")));
  assert.equal(snap.diagnostics.filter((e) => e.code === CORE_DRIFT_CODE).length, 0);
  assert.equal(snap.diagnostics.filter((e) => e.code === CORE_UNRECOGNIZED_CODE).length, 1);
});

// --- the acceptance signal itself ----------------------------------------------

test("every fixture this suite reads is committed, never a gitignored live record", () => {
  for (const path of [STALE_PATH, UNKNOWN_PATH]) {
    assert.ok(path.includes("test/fixtures/constitution"), path);
    assert.ok(!path.includes("_local"), `${path} must not read the gitignored live record`);
  }
});
