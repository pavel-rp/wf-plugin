// The pure composed-constitution renderer — contract tests (WF-455).
//
// Everything here runs with NO filesystem and NO ports: the module under test
// takes the record's current bytes and returns the new ones, so "a refusal
// happens before anything is written" is proved by construction.
//
// The one property these tests exist for above all others: the PROJECT'S OWN
// WRITING SURVIVES. It is human-authored, it outranks every capability article,
// and no second copy of it exists — so it is asserted byte-for-byte, from a
// NON-EMPTY fixture, on every path that produces a document at all.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CAPABILITY_ARTICLES_HEADING,
  PROJECT_CLAUSES_HEADING,
  articlesByCapability,
  composeConstitutionRecord,
  type ConstitutionCapabilityArticles,
} from "../src/resolver/constitution-compose.js";
import {
  CORE_ARTICLES_BODY,
  CORE_ARTICLES_HEADING,
  UNATTENDED_GATE_CLAUSE,
} from "../src/resolver/constitution-core.js";
import type { ConstitutionInput } from "../src/resolver/types.js";

/** The project's own clause section, deliberately NOT the shipped placeholder:
 *  a project that has written real clauses is the case where losing them costs
 *  something, so that is the case the fixture pins. */
const PROJECT_TAIL = [
  PROJECT_CLAUSES_HEADING,
  "",
  "<!-- Add this project's own non-negotiable clauses below. -->",
  "",
  "1. **no-vendored-forks:** a third-party dependency is upgraded, never forked in place.",
  "2. **one-issue-one-branch:** every change ships on its own branch with its own check.",
  "",
  "   A trailing indented paragraph, kept to prove the tail is sliced rather than",
  "   re-rendered — a re-render would normalize this indentation away.",
  "",
];

const PREAMBLE = [
  "# Project Constitution",
  "",
  "**Composed:** 2026-07-21 11:38",
  "**Model:** gpt-5.6-sol[1m]",
  "**Registry:** git, audit",
  "",
  "The non-negotiable principles this project's workflow holds itself to.",
  "",
  "## Precedence",
  "",
  "1. **Project clauses override capability clauses.**",
  "",
  "## Core articles (provenance: core)",
  "",
  "1. **The spec is the single source of truth.**",
  "",
];

// Since WF-500 every article in the record carries its `<provenance>.<n>` id, so
// an already-composed capability section reads `- **sr.1 — <key>:** <value>`. The
// fixture states the CURRENT shape on purpose: the byte-identity tests below are
// only meaningful against a record the renderer would reproduce unchanged.
const ARTICLES_SECTION = [
  CAPABILITY_ARTICLES_HEADING,
  "",
  "### sr",
  "",
  "- **sr.1 — precommit-self-review:** required",
  "",
];

const RECORD = [...PREAMBLE, ...ARTICLES_SECTION, ...PROJECT_TAIL].join("\n");

const SR: ConstitutionCapabilityArticles = {
  capability: "sr",
  articles: [{ key: "precommit-self-review", value: "required" }],
};

/** The tail as it appears in the record, so a test can assert containment of the
 *  EXACT byte run rather than of a normalized equivalent. */
const TAIL_BYTES = PROJECT_TAIL.join("\n");

function compose(current: string, capabilities: readonly ConstitutionCapabilityArticles[] = [SR]) {
  return composeConstitutionRecord({
    current,
    capabilities,
    registryNames: ["git", "audit"],
  });
}

// ---------------------------------------------------------------------------
// Preservation — the criterion the whole module exists to protect
// ---------------------------------------------------------------------------

test("a NON-EMPTY project-clause section survives byte-for-byte", () => {
  const result = compose(RECORD, [
    SR,
    { capability: "audit", articles: [{ key: "lenses-are-advisory", value: "always" }] },
  ]);
  assert.ok(result.ok);
  assert.ok(result.ok && result.changed, "adding a capability's article must change the record");
  assert.ok(
    result.ok && result.content.endsWith(TAIL_BYTES),
    "the project's own writing must be carried across unchanged, to the last byte",
  );
  // Stated a second way, independent of position: every clause line is still there.
  for (const line of PROJECT_TAIL) {
    assert.ok(result.ok && result.content.includes(line));
  }
});

test("the preamble and the core articles are preserved too — only the derived section is rendered", () => {
  const result = compose(RECORD, [{ capability: "sr", articles: [{ key: "k", value: "v" }] }]);
  assert.ok(result.ok);
  assert.ok(result.ok && result.content.startsWith(PREAMBLE.join("\n")));
  assert.ok(result.ok && result.content.includes("1. **The spec is the single source of truth.**"));
  // The replaced section is the ONLY thing that moved.
  assert.ok(result.ok && !result.content.includes("precommit-self-review"));
  assert.ok(result.ok && result.content.includes("- **sr.1 — k:** v"));
});

test("a record with no capability articles still keeps the project's clauses", () => {
  // The worst case for a naive implementation: nothing to render, so a whole-file
  // regeneration would emit a document with the project's writing gone.
  const result = compose(RECORD, []);
  assert.ok(result.ok);
  assert.ok(result.ok && result.content.endsWith(TAIL_BYTES));
  assert.ok(
    result.ok && result.content.includes("No registered capability declares a constitution article."),
  );
});

// ---------------------------------------------------------------------------
// Rule 4: a record that would not change is not a target
// ---------------------------------------------------------------------------

test("recomposing an UNCHANGED capability set reports `changed: false` and reproduces the bytes exactly", () => {
  const result = compose(RECORD);
  assert.ok(result.ok);
  assert.equal(result.ok && result.changed, false);
  assert.equal(result.ok && result.content, RECORD);
});

test("the registry preamble line is refreshed in place", () => {
  const result = composeConstitutionRecord({
    current: RECORD,
    capabilities: [SR],
    registryNames: ["git", "audit", "linear"],
  });
  assert.ok(result.ok);
  assert.ok(result.ok && result.changed);
  assert.ok(result.ok && result.content.includes("**Registry:** git, audit, linear"));
  assert.ok(result.ok && !result.content.includes("**Registry:** git, audit\n"));
  // Refreshing one derived line must not disturb the neighbouring attribution.
  assert.ok(result.ok && result.content.includes("**Model:** gpt-5.6-sol[1m]"));
  assert.ok(result.ok && result.content.endsWith(TAIL_BYTES));
});

test("a preamble with no registry line, or with two, is left exactly as it is", () => {
  const none = [...PREAMBLE.filter((l) => !l.startsWith("**Registry:** "))];
  const noneResult = compose([...none, ...ARTICLES_SECTION, ...PROJECT_TAIL].join("\n"));
  assert.ok(noneResult.ok);
  assert.equal(noneResult.ok && noneResult.changed, false);

  const twice = [...PREAMBLE, "**Registry:** git, audit"];
  const twiceResult = compose([...twice, ...ARTICLES_SECTION, ...PROJECT_TAIL].join("\n"));
  assert.ok(twiceResult.ok);
  assert.equal(twiceResult.ok && twiceResult.changed, false);
});

// ---------------------------------------------------------------------------
// Rule 3: an unrecognized document is a refusal, never a silent reset
// ---------------------------------------------------------------------------

test("a missing capability-articles heading refuses rather than rewriting", () => {
  const result = compose([...PREAMBLE, ...PROJECT_TAIL].join("\n"));
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.detail.includes(CAPABILITY_ARTICLES_HEADING));
  assert.ok(!result.ok && result.detail.includes("nothing that is there now is lost"));
});

test("a missing project-clause heading refuses — the section this composer must never invent", () => {
  const result = compose([...PREAMBLE, ...ARTICLES_SECTION].join("\n"));
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.detail.includes(PROJECT_CLAUSES_HEADING));
});

test("a DUPLICATED heading refuses — an ambiguous boundary is not guessed at", () => {
  const doubled = [...PREAMBLE, ...ARTICLES_SECTION, ...ARTICLES_SECTION, ...PROJECT_TAIL];
  const result = compose(doubled.join("\n"));
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.detail.includes("2 `"));
});

test("clauses placed BEFORE the articles refuse — order is part of the structure", () => {
  const inverted = [...PREAMBLE, ...PROJECT_TAIL, ...ARTICLES_SECTION];
  const result = compose(inverted.join("\n"));
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.detail.includes("before"));
});

test("an unrecognized section between the two refuses rather than absorbing or displacing it", () => {
  const intruder = [
    ...PREAMBLE,
    ...ARTICLES_SECTION,
    "## Local amendments (provenance: unknown)",
    "",
    "- something a future version added.",
    "",
    ...PROJECT_TAIL,
  ];
  const result = compose(intruder.join("\n"));
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.detail.includes("unrecognized section"));
});

test("a heading QUOTED inside the document body is not mistaken for the boundary", () => {
  // Matched on the whole line, so an indented or fenced mention cannot move the
  // section boundary — and, crucially, cannot cause a duplicate-heading refusal.
  const quoted = [
    ...PREAMBLE,
    ...ARTICLES_SECTION,
    ...PROJECT_TAIL,
    "```",
    `    ${CAPABILITY_ARTICLES_HEADING}`,
    "```",
  ];
  const result = compose(quoted.join("\n"));
  assert.ok(result.ok);
  assert.equal(result.ok && result.changed, false);
});

// ---------------------------------------------------------------------------
// The snapshot projection
// ---------------------------------------------------------------------------

test("articlesByCapability preserves registry order, and each capability's own article order", () => {
  const inputs: ConstitutionInput[] = [
    { capability: "git", key: "b", value: "2" },
    { capability: "audit", key: "x", value: "9" },
    { capability: "git", key: "a", value: "1" },
  ];
  assert.deepEqual(articlesByCapability(inputs), [
    {
      capability: "git",
      articles: [
        { key: "b", value: "2" },
        { key: "a", value: "1" },
      ],
    },
    { capability: "audit", articles: [{ key: "x", value: "9" }] },
  ]);
});

test("the composer never mutates its input", () => {
  const capabilities: ConstitutionCapabilityArticles[] = [
    { capability: "sr", articles: [{ key: "precommit-self-review", value: "required" }] },
  ];
  const before = JSON.stringify(capabilities);
  const result = compose(RECORD, capabilities);
  assert.ok(result.ok);
  assert.equal(JSON.stringify(capabilities), before);
});

// ---------------------------------------------------------------------------
// WF-492 — amended core article text reaches an ALREADY-COMPOSED record
//
// Driven from COMMITTED fixtures, not from constants built in this file. A live
// `_local/constitution.md` is gitignored: untracked, unavailable to any other
// clone or to CI, and destroyed as evidence by its own first re-run. The checked-in
// fixture is the repeatable signal, and these tests assert it survives the run
// that consumes it.
// ---------------------------------------------------------------------------

// The suite runs from a bundled temp directory, so a fixture is located from the
// package root the harness exports — never from `import.meta.url`.
const MCP_DIR = process.env.WF_MCP_DIR ?? process.cwd();
const FIXTURES = join(MCP_DIR, "test/fixtures/constitution");

const STALE_PATH = join(FIXTURES, "stale-pre-amendment.md");
const UNKNOWN_PATH = join(FIXTURES, "unknown-structure.md");

const readFixture = (path: string): string => readFileSync(path, "utf8");

/** The pre-amendment Article 2 — the exact sentence the fixture is stale at. */
const PRE_AMENDMENT_ARTICLE_2 =
  "2. **No phase skips its gate.** Every phase is a human-approved artifact that feeds the next; nothing advances past an unapproved gate.";

/** Everything from the project-clause heading to end of file, sliced out of the
 *  record's own bytes rather than restated here — a second copy in this file
 *  could drift from the fixture and quietly weaken the assertion. */
function projectTail(record: string): string {
  const index = record.indexOf(`\n${PROJECT_CLAUSES_HEADING}`);
  assert.notEqual(index, -1, "the fixture must carry a project-clause section");
  return record.slice(index + 1);
}

function composeWithCore(current: string) {
  return composeConstitutionRecord({
    current,
    capabilities: [SR],
    registryNames: ["git", "audit", "sr"],
    coreArticles: CORE_ARTICLES_BODY,
  });
}

test("the committed stale fixture picks up the amended Article 2 on re-composition", () => {
  const stale = readFixture(STALE_PATH);
  assert.ok(
    stale.includes(PRE_AMENDMENT_ARTICLE_2),
    "the fixture must actually be stale, or it proves nothing",
  );

  const result = composeWithCore(stale);
  assert.ok(result.ok);
  assert.ok(result.ok && result.changed);
  assert.ok(
    result.ok && result.content.includes(UNATTENDED_GATE_CLAUSE),
    "the amended unattended-gate clause must reach the already-composed record",
  );
  assert.ok(
    result.ok && !result.content.includes(PRE_AMENDMENT_ARTICLE_2),
    "the superseded article text must be replaced, not appended alongside",
  );
});

test("the stale fixture's project clauses survive the re-composition byte-identical", () => {
  const stale = readFixture(STALE_PATH);
  const tail = projectTail(stale);
  // Non-empty, real clauses — the case where losing them costs something.
  assert.ok(tail.includes("no-vendored-forks"));
  assert.ok(tail.includes("one-issue-one-branch"));

  const result = composeWithCore(stale);
  assert.ok(result.ok);
  assert.ok(
    result.ok && result.content.endsWith(tail),
    "the project's own writing must be carried across unchanged, to the last byte",
  );
  // The indented trailing paragraph is the sharpest probe: a re-render would
  // normalize its indentation away, a slice cannot.
  assert.ok(result.ok && result.content.includes("\n   A trailing indented paragraph"));
});

test("the committed fixture is NOT consumed by the run that reads it", () => {
  const before = readFixture(STALE_PATH);
  const result = composeWithCore(before);
  assert.ok(result.ok);
  assert.equal(
    readFixture(STALE_PATH),
    before,
    "the fixture must survive on disk so the check is re-runnable, not one-shot",
  );
});

test("re-composing an ALREADY-amended record is byte-identical — the amendment is idempotent", () => {
  const stale = readFixture(STALE_PATH);
  const first = composeWithCore(stale);
  assert.ok(first.ok);
  const second = composeWithCore(first.ok ? first.content : "");
  assert.ok(second.ok);
  assert.equal(second.ok && second.changed, false);
  assert.equal(second.ok && second.content, first.ok ? first.content : "");
});

test("the unknown-structure fixture is REFUSED, never reset", () => {
  const unknown = readFixture(UNKNOWN_PATH);
  const result = composeWithCore(unknown);
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.detail.includes("unrecognized section"));
  assert.ok(!result.ok && result.detail.includes("nothing that is there now is lost"));
  assert.equal(readFixture(UNKNOWN_PATH), unknown);
});

test("omitting the core body preserves the core section exactly — the pre-WF-492 shape", () => {
  const stale = readFixture(STALE_PATH);
  const withoutCore = composeConstitutionRecord({
    current: stale,
    capabilities: [SR],
    registryNames: ["git", "audit", "sr"],
  });
  assert.ok(withoutCore.ok);
  assert.ok(
    withoutCore.ok && withoutCore.content.includes(PRE_AMENDMENT_ARTICLE_2),
    "a caller carrying no core text must not have the section rewritten under it",
  );
  assert.ok(withoutCore.ok && !withoutCore.content.includes(UNATTENDED_GATE_CLAUSE));
  // And a caller with no core text can never newly refuse a record it used to
  // compose — the unknown-structure fixture's intruder sits between the CORE and
  // capability sections, which that caller does not inspect.
  const unknown = composeConstitutionRecord({
    current: readFixture(UNKNOWN_PATH),
    capabilities: [SR],
    registryNames: ["git"],
  });
  assert.ok(unknown.ok);
});

test("the core section is held to the same structural discipline as the derived one", () => {
  const noCoreHeading = [
    "# Project Constitution",
    "",
    ...ARTICLES_SECTION,
    ...PROJECT_TAIL,
  ].join("\n");
  const missing = composeWithCore(noCoreHeading);
  assert.equal(missing.ok, false);
  assert.ok(!missing.ok && missing.detail.includes(CORE_ARTICLES_HEADING));

  // A core section sitting BETWEEN the derived section and the clauses is caught by
  // the adjacency rule that already guards the derived section — a refusal either
  // way, which is the property that matters.
  const between = [
    "# Project Constitution",
    "",
    ...ARTICLES_SECTION,
    CORE_ARTICLES_HEADING,
    "",
    "1. **Something.**",
    "",
    ...PROJECT_TAIL,
  ].join("\n");
  const betweenResult = composeWithCore(between);
  assert.equal(betweenResult.ok, false);
  assert.ok(!betweenResult.ok && betweenResult.detail.includes("unrecognized section"));

  // A core heading that surfaces only inside the project's own tail is ordering the
  // composer cannot make sense of: the section it would render sits after the
  // section it must preserve. It refuses instead of guessing which one is meant.
  const afterClauses = [
    "# Project Constitution",
    "",
    ...ARTICLES_SECTION,
    ...PROJECT_TAIL,
    CORE_ARTICLES_HEADING,
    "",
    "1. **Something the project appended.**",
    "",
  ].join("\n");
  const afterResult = composeWithCore(afterClauses);
  assert.equal(afterResult.ok, false);
  assert.ok(!afterResult.ok && afterResult.detail.includes("at or after"));
});

test("EVERY shipped core-body entry appears verbatim in the skill's own prose", () => {
  // The article's authoring source is the skill body; the constant mirrors it so a
  // re-composition can carry it. Two copies with no guard is the drift defect one
  // level up — so the agreement is asserted over the WHOLE body, not over the one
  // article this release happened to change. Pinning a single clause would leave the
  // other eight free to drift, which is exactly how the first draft of this change
  // shipped four divergences in article 9.
  const skill = readFileSync(join(MCP_DIR, "../skills/constitution/SKILL.md"), "utf8");
  const flatten = (value: string): string => value.replace(/\s+/g, " ").trim();
  const flatSkill = flatten(skill);

  const entries = CORE_ARTICLES_BODY.filter((line) => line.trim().length > 0);
  assert.ok(entries.length >= 9, "the body must carry at least the nine core articles");
  for (const entry of entries) {
    assert.ok(
      flatSkill.includes(flatten(entry)),
      `skills/constitution/SKILL.md must state this core-body entry verbatim:\n${entry}`,
    );
  }
  // And the amended clause specifically, named so a failure reads clearly.
  assert.ok(flatSkill.includes(flatten(UNATTENDED_GATE_CLAUSE)));
});

test("an EMPTY core body is treated as absent, never as 'render nothing'", () => {
  // `?? null` alone would take `[]` as a value and emit the heading with no body —
  // silently deleting the core section while reporting success.
  const stale = readFixture(STALE_PATH);
  const result = composeConstitutionRecord({
    current: stale,
    capabilities: [SR],
    registryNames: ["git", "audit", "sr"],
    coreArticles: [],
  });
  assert.ok(result.ok);
  assert.ok(
    result.ok && result.content.includes(PRE_AMENDMENT_ARTICLE_2),
    "an empty body must preserve the core section, not empty it",
  );
});

test("a duplicated core heading refuses — an ambiguous boundary is not guessed at", () => {
  const stale = readFixture(STALE_PATH);
  const doubled = stale.replace(
    `${CORE_ARTICLES_HEADING}\n`,
    `${CORE_ARTICLES_HEADING}\n\n${CORE_ARTICLES_HEADING}\n`,
  );
  const result = composeWithCore(doubled);
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.detail.includes("2 `"));
  assert.ok(!result.ok && result.detail.includes(CORE_ARTICLES_HEADING));
});

test("a CRLF record keeps CRLF throughout — a rewrite never leaves it mixed", () => {
  const stale = readFixture(STALE_PATH).replace(/\n/g, "\r\n");
  const result = composeWithCore(stale);
  assert.ok(result.ok);
  assert.ok(result.ok && result.content.includes(UNATTENDED_GATE_CLAUSE));
  assert.ok(
    result.ok && !/(^|[^\r])\n/.test(result.content),
    "no bare LF may survive in a record that arrived as CRLF",
  );
});

// ---------------------------------------------------------------------------
// WF-500 — every article carries its `<provenance>.<n>` id, and the compression
// loses no obligation
//
// The size assertions below are the ONLY mechanical guard on the compression. The
// obligation map itself lives in
// `skills/constitution/references/obligation-inventory.md` and is prose, so what is
// pinned here is the half a test can pin: that the article text a future edit might
// shorten still SAYS each of the obligations that edit could quietly drop.
// ---------------------------------------------------------------------------

test("capability articles render `<capability>.<n>`, numbered per capability from 1", () => {
  const result = compose(RECORD, [
    { capability: "sr", articles: [{ key: "a", value: "1" }] },
    {
      capability: "audit",
      articles: [
        { key: "b", value: "2" },
        { key: "c", value: "3" },
      ],
    },
  ]);
  assert.ok(result.ok);
  assert.ok(result.ok && result.content.includes("- **sr.1 — a:** 1"));
  // Numbered PER CAPABILITY, not across the section: `audit` restarts at 1 rather
  // than continuing from `sr`'s count, so gaining or losing an `sr` article never
  // renumbers `audit`'s.
  assert.ok(result.ok && result.content.includes("- **audit.1 — b:** 2"));
  assert.ok(result.ok && result.content.includes("- **audit.2 — c:** 3"));
  assert.ok(result.ok && !result.content.includes("audit.3"));
});

test("a capability's own article order is the manifest's, and the id follows it", () => {
  const result = compose(RECORD, [
    {
      capability: "sr",
      articles: [
        { key: "second-declared", value: "x" },
        { key: "first-declared", value: "y" },
      ],
    },
  ]);
  assert.ok(result.ok);
  const body = result.ok ? result.content : "";
  assert.ok(body.indexOf("sr.1 — second-declared") < body.indexOf("sr.2 — first-declared"));
});

test("the stale fixture's core section re-renders in ID'd form", () => {
  const result = composeWithCore(readFixture(STALE_PATH));
  assert.ok(result.ok);
  const body = result.ok ? result.content : "";
  for (let n = 1; n <= 9; n += 1) {
    assert.ok(body.includes(`- **core.${n} — `), `the record must render core.${n}`);
  }
  // The pre-compression numbered-list form is gone, not carried alongside.
  assert.ok(!body.includes("1. **The spec is the single source of truth.**"));
});

test("core.2 still carries WF-492's unattended-gate obligations after compression", () => {
  const result = composeWithCore(readFixture(STALE_PATH));
  assert.ok(result.ok);
  const body = result.ok ? result.content : "";
  // One probe per obligation the amendment added (inventory rows O2.4–O2.12). A
  // compression that shortened this article by dropping one would fail here rather
  // than in a prose review.
  for (const obligation of [
    "resolver-issued run-evidence record", // O2.4
    "naming the gate", // O2.5
    "binding the approved artifact by digest", // O2.6
    "filed before the next phase", // O2.7
    "valid only in its requesting run", // O2.8
    "requested by but never written by the agent it authorises", // O2.9
    "unattended mode is established independently of the agent", // O2.10
    "Absent, unmatched, unverifiable, foreign-run, or digest-stale", // O2.11
    "the run halts there, reported unproven", // O2.12
  ]) {
    assert.ok(body.includes(obligation), `core.2 must still carry: ${obligation}`);
  }
});

test("core.9 still carries both deletion obligations and the backstop rule", () => {
  const body = CORE_ARTICLES_BODY.join("\n");
  assert.ok(body.includes("(a) A scratch file's consumer deletes it")); // O9.2
  assert.ok(body.includes("(b) The run-ending skill deletes")); // O9.3
  assert.ok(body.includes("backstop that excuses neither")); // O9.4
  assert.ok(body.includes("_local/scratch/")); // O9.1
  // The two obligations are ONE article, so a record cannot carry (a) without (b).
  const nine = CORE_ARTICLES_BODY.filter((line) => line.startsWith("- **core.9 "));
  assert.equal(nine.length, 1, "core.9 is a single unwrapped line");
});

test("the compressed core body meets its measured budget", () => {
  const entries = CORE_ARTICLES_BODY.filter((line) => line.trim().length > 0);
  assert.equal(entries.length, 9, "one rendered line per article, and nine articles");

  // Every entry is a single unwrapped line — the property that makes a
  // re-composition byte-identical rather than merely equivalent (rule 4).
  for (const entry of entries) assert.ok(!entry.includes("\n"));

  // 2,439 bytes as shipped, from 4,050 before the compression. The ceiling carries
  // a little headroom so a wording fix is not a test change, and no more: its whole
  // job is to catch the body growing back, which is what happened between WF-334
  // (the record entering every session's context) and this item.
  const bytes = Buffer.byteLength(entries.join("\n"), "utf8");
  assert.ok(bytes <= 2500, `the compressed core body must stay under 2.5 KB, measured ${bytes}`);

  // The ~60-word target, with the two exceptions the inventory names by count:
  // core.2 carries 12 obligations and core.9 carries 4.
  const budget = (id: string): number => (id === "core.2" || id === "core.9" ? 85 : 60);
  for (const entry of entries) {
    const id = entry.slice(4, entry.indexOf(" —"));
    const words = entry.split(/\s+/).filter(Boolean).length;
    assert.ok(words <= budget(id), `${id} is ${words} words, over its ${budget(id)}-word budget`);
  }
});

test("a `**Registry:**` line inside the core section is still found and refreshed", () => {
  // The search region must stay the whole pre-capability span. Narrowing it to the
  // preamble would let this line fall inside the replaced region and be destroyed.
  const stale = readFixture(STALE_PATH)
    .replace("**Registry:** git, audit, sr\n", "")
    .replace(`${CORE_ARTICLES_HEADING}\n`, `${CORE_ARTICLES_HEADING}\n**Registry:** git, audit, sr\n`);
  const result = composeConstitutionRecord({
    current: stale,
    capabilities: [SR],
    registryNames: ["git", "audit", "linear"],
  });
  assert.ok(result.ok);
  assert.ok(result.ok && result.content.includes("**Registry:** git, audit, linear"));
});
