// The pure non-registry apply-target renderers — contract tests (WF-454).
//
// Everything here runs with NO filesystem and NO ports, for the same reason
// `apply-install.test.ts` does: the module under test is structurally incapable
// of writing a byte, so its three rules are proved on their own terms.
//
//   1. A TARGET THAT WOULD NOT CHANGE IS NOT A TARGET (`changed`). This is what
//      makes "committed evidence stays byte-identical" structural rather than
//      careful: the caller drops an unchanged render, so the file never reaches
//      the transaction and can never be journalled, backed up, or replaced.
//   2. AN UNRELATED ENTRY SURVIVES.
//   3. A MALFORMED CURRENT DOCUMENT IS A REFUSAL, NEVER A SILENT RESET.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  renderLedgerMutation,
  renderProfileMutation,
  type LedgerEvidenceUpdate,
  type ProfileAnswerUpdate,
} from "../src/resolver/apply-targets.js";
import { parseEvidenceLedger } from "../src/resolver/discover-packs.js";
import type {
  MachineBindingEvidence,
  PortablePackEvidence,
} from "../src/resolver/types.js";

function portable(pluginId: string, version = "1.0.0"): PortablePackEvidence {
  return {
    pluginId,
    version,
    capabilities: ["one"],
    manifestHashes: [{ path: "manifest.md", sha256: "a".repeat(64) }],
    declaredSourceHashes: [],
  };
}

function binding(pluginId: string, root = "/packs/beta"): MachineBindingEvidence {
  return {
    pluginId,
    canonicalRoot: root,
    cliScope: null,
    enablement: "enabled",
    observedVersion: "1.0.0",
    localFingerprints: [],
  };
}

const LEDGER_LABEL = "the evidence ledger `.wf/install-state.json`";
const PROFILE_LABEL = "the capability profile `_local/profiles/beta.profile.json`";

function ledger(current: string | null, ...updates: LedgerEvidenceUpdate[]) {
  return renderLedgerMutation(current, updates, LEDGER_LABEL);
}

function profile(current: string | null, ...updates: ProfileAnswerUpdate[]) {
  return renderProfileMutation(current, updates, PROFILE_LABEL);
}

// ---------------------------------------------------------------------------
// Rule 1 — no-op detection
// ---------------------------------------------------------------------------

test("re-recording the SAME evidence reports NO CHANGE, so it never becomes a target", () => {
  const first = ledger(null, { pluginId: "beta@1", portable: portable("beta@1") });
  assert.ok(first.ok && first.changed, "the first write is a change");

  const second = ledger(first.ok ? first.content : "", {
    pluginId: "beta@1",
    portable: portable("beta@1"),
  });
  assert.ok(second.ok);
  assert.equal(second.ok && second.changed, false, "the second is not");
  assert.equal(second.ok && second.content, first.ok ? first.content : "<none>");
});

test("re-seeding the SAME answer reports NO CHANGE", () => {
  const first = profile(null, { destination: "beta.token", value: "abc" });
  assert.ok(first.ok && first.changed);
  const second = profile(first.ok ? first.content : "", {
    destination: "beta.token",
    value: "abc",
  });
  assert.equal(second.ok && second.changed, false);
});

test("`changed` compares the CURRENT BYTES, not the parsed data", () => {
  // A document holding the same DATA spelled differently would still be
  // rewritten by a write, so rule 1 must answer "would this change the file?"
  const compact = '{"portable":{"beta@1":' + JSON.stringify(portable("beta@1")) + "}}";
  const render = ledger(compact, { pluginId: "beta@1", portable: portable("beta@1") });
  assert.ok(render.ok);
  assert.equal(render.ok && render.changed, true, "a re-spelling IS a change");
});

test("rendering is deterministic — two runs over the same facts produce identical bytes", () => {
  const left = ledger(null, { pluginId: "b@1", portable: portable("b@1") }, {
    pluginId: "a@1",
    portable: portable("a@1"),
  });
  const right = ledger(null, { pluginId: "b@1", portable: portable("b@1") }, {
    pluginId: "a@1",
    portable: portable("a@1"),
  });
  assert.ok(left.ok && right.ok);
  assert.equal(left.ok && left.content, right.ok ? right.content : "<none>");
});

// ---------------------------------------------------------------------------
// Rule 2 — an unrelated entry survives
// ---------------------------------------------------------------------------

test("a pack this update says nothing about keeps its recorded evidence", () => {
  const existing = ledger(null, { pluginId: "alpha@1", portable: portable("alpha@1") });
  assert.ok(existing.ok);
  const next = ledger(existing.ok ? existing.content : "", {
    pluginId: "beta@1",
    portable: portable("beta@1"),
  });
  assert.ok(next.ok && next.changed);

  const parsed = parseEvidenceLedger(next.ok ? next.content : null);
  assert.ok(parsed.portable.has("alpha@1"), "the untouched pack survives");
  assert.ok(parsed.portable.has("beta@1"));
  assert.deepEqual(parsed.portable.get("alpha@1"), portable("alpha@1"));
});

test("a question this update does not answer keeps its persisted value", () => {
  const existing = profile(null, { destination: "beta.keep", value: "kept" });
  const next = profile(existing.ok ? existing.content : "", {
    destination: "beta.token",
    value: "new",
  });
  assert.ok(next.ok);
  const parsed = JSON.parse(next.ok ? next.content : "{}") as Record<string, unknown>;
  assert.equal(parsed["beta.keep"], "kept");
  assert.equal(parsed["beta.token"], "new");
});

test("an unrelated top-level SECTION of the ledger document survives", () => {
  const current = '{\n  "artifacts": {"x": 1},\n  "portable": {}\n}\n';
  const next = ledger(current, { pluginId: "beta@1", portable: portable("beta@1") });
  assert.ok(next.ok);
  const parsed = JSON.parse(next.ok ? next.content : "{}") as Record<string, unknown>;
  assert.deepEqual(parsed.artifacts, { x: 1 }, "the artifacts section is not dropped");
});

test("the two ledger halves are written INDEPENDENTLY into one document", () => {
  // The `local` home case: both halves land in the same file, so one render must
  // be able to carry updates for either or both sections.
  const next = ledger(
    null,
    { pluginId: "beta@1", portable: portable("beta@1") },
    { pluginId: "beta@1", binding: binding("beta@1") },
  );
  assert.ok(next.ok);
  const parsed = parseEvidenceLedger(next.ok ? next.content : null);
  assert.ok(parsed.portable.has("beta@1"));
  assert.ok(parsed.binding.has("beta@1"));
});

test("a binding-only update NEVER writes a portable section", () => {
  // The missing-binding path at the document level: only the half that was asked
  // for appears, so a binding seed cannot invent portable evidence.
  const next = ledger(null, { pluginId: "beta@1", binding: binding("beta@1") });
  assert.ok(next.ok);
  const parsed = JSON.parse(next.ok ? next.content : "{}") as Record<string, unknown>;
  assert.equal(parsed.portable, undefined, "no portable section is created");
  assert.ok(parsed.binding !== undefined);
});

test("the rendered ledger and profile READ BACK through the ordinary parsers", () => {
  // What makes a seed take effect rather than merely land: the writer's shape is
  // exactly the reader's. A profile is a FLAT object keyed by each question's
  // declared destination, which is the own-property lookup the resolver performs.
  const rendered = profile(null, { destination: "beta.token", value: 42 });
  assert.ok(rendered.ok);
  const parsed: unknown = JSON.parse(rendered.ok ? rendered.content : "null");
  assert.ok(typeof parsed === "object" && parsed !== null && !Array.isArray(parsed));
  assert.ok(Object.prototype.hasOwnProperty.call(parsed, "beta.token"));

  const ledgerRender = ledger(null, {
    pluginId: "beta@1",
    portable: portable("beta@1"),
    binding: binding("beta@1"),
  });
  assert.ok(ledgerRender.ok);
  const back = parseEvidenceLedger(ledgerRender.ok ? ledgerRender.content : null);
  assert.deepEqual(back.portable.get("beta@1"), portable("beta@1"));
  assert.deepEqual(back.binding.get("beta@1"), binding("beta@1"));
});

// ---------------------------------------------------------------------------
// Rule 3 — a malformed current document is a refusal, never a silent reset
// ---------------------------------------------------------------------------

test("an absent or empty current document is a FRESH document, not a refusal", () => {
  for (const current of [null, "", "   \n"]) {
    const render = ledger(current, { pluginId: "beta@1", portable: portable("beta@1") });
    assert.ok(render.ok, `\`${JSON.stringify(current)}\` is the ordinary first-run case`);
    assert.ok(render.ok && render.changed);
  }
});

test("an UNPARSEABLE ledger is refused, and the refusal says nothing is lost", () => {
  const render = ledger("{ this is not json", { pluginId: "beta@1", portable: portable("beta@1") });
  assert.equal(render.ok, false);
  assert.ok(!render.ok && render.detail.includes(LEDGER_LABEL));
  assert.ok(!render.ok && render.detail.includes("not rewritten"));
});

test("a ledger that is a JSON ARRAY or SCALAR is refused, not coerced", () => {
  for (const current of ["[]", '"a string"', "42", "null"]) {
    const render = ledger(current, { pluginId: "beta@1", portable: portable("beta@1") });
    assert.equal(render.ok, false, `\`${current}\` must be refused`);
  }
});

test("an unparseable PROFILE is refused, so an approved answer never destroys existing values", () => {
  const render = profile("{ oops", { destination: "beta.token", value: "abc" });
  assert.equal(render.ok, false);
  assert.ok(!render.ok && render.detail.includes(PROFILE_LABEL));
});

test("THE READ PATH IS TOLERANT WHERE THE WRITE PATH REFUSES — deliberately", () => {
  // A corrupt ledger degrades to "no evidence" on the READ path (which merely
  // re-proposes a seed) but must never be re-emitted by the WRITE path, because
  // re-emitting bytes that could not be understood would destroy whatever they
  // actually held.
  const corrupt = "{ not json at all";
  const read = parseEvidenceLedger(corrupt);
  assert.equal(read.portable.size, 0, "the read path degrades quietly");
  const write = ledger(corrupt, { pluginId: "beta@1", portable: portable("beta@1") });
  assert.equal(write.ok, false, "the write path refuses loudly");
});
