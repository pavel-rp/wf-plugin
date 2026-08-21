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
import {
  CAPABILITY_ARTICLES_HEADING,
  PROJECT_CLAUSES_HEADING,
  articlesByCapability,
  composeConstitutionRecord,
  type ConstitutionCapabilityArticles,
} from "../src/resolver/constitution-compose.js";
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

const ARTICLES_SECTION = [
  CAPABILITY_ARTICLES_HEADING,
  "",
  "### sr",
  "",
  "- **precommit-self-review:** required",
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
  assert.ok(result.ok && result.content.includes("- **k:** v"));
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
