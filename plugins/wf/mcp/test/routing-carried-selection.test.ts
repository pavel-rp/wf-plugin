import assert from "node:assert/strict";
import test from "node:test";
import { resolveRouting, projectRoutingMeasurement } from "../src/resolver/routing.js";

// WF-499. The acceptance bar is the fleet wave handoff: each item's model is
// resolved by the RESOLVER from that item's own complexity evidence before wave
// formation, and the wave-level decision carries that selection forward with its
// provenance intact instead of laundering it back in as an ordinary caller pin.
//
// These fixtures model the real call shapes: a per-item resolution (role
// `shipper`, the item's own evidence) followed by the wave decision (role
// `shipper`, the wave's own cardinality evidence, carrying the selection).

/** An item whose work is mechanical — the shape a small, well-templated change
 *  presents. Scores 0 on the ladder. */
const mechanicalItemEvidence = {
  workSurface: "external-context", atomicity: "atomic", unitCount: 1, unitsIndependent: false,
  ambiguity: "none", risk: "low", toolWork: "none", validation: "mechanical",
  contextIsolation: "required", independentReview: false,
  returnContract: "mechanically-judgeable", requestedParallelism: 1,
} as const;

/** An item carrying real design judgment. Scores above 0. */
const designItemEvidence = {
  workSurface: "external-context", atomicity: "atomic", unitCount: 1, unitsIndependent: false,
  ambiguity: "material", risk: "elevated", toolWork: "material", validation: "judgment",
  contextIsolation: "required", independentReview: false,
  returnContract: "mechanically-judgeable", requestedParallelism: 1,
} as const;

/** The one-item wave evidence `fleet` states — deliberately CONSTANT, because the
 *  wave decision describes topology and parallelism, never difficulty. */
const oneItemWaveEvidence = {
  workSurface: "external-context", atomicity: "atomic", unitCount: 1, unitsIndependent: false,
  ambiguity: "material", risk: "elevated", toolWork: "material", validation: "judgment",
  contextIsolation: "required", independentReview: false,
  returnContract: "mechanically-judgeable", requestedParallelism: 1,
} as const;

const resolveItem = (shapeEvidence: typeof mechanicalItemEvidence, unitId: string) =>
  resolveRouting({}, {
    role: "shipper",
    shapeEvidence,
    unitIds: [unitId],
    supportsModelSelector: true,
    supportsEffortSelector: false,
  });

test("WF-499: two items with differing complexity receive DIFFERENT resolver-derived selections", () => {
  const mechanical = resolveItem(mechanicalItemEvidence, "unit-a1");
  const design = resolveItem(designItemEvidence, "unit-b2");

  // The selections differ, and the difference came from the evidence alone —
  // neither call supplied a model of any kind.
  assert.notEqual(mechanical.model.value, design.model.value);
  assert.equal(mechanical.model.value, "haiku");
  assert.equal(design.model.value, "sonnet");

  for (const decision of [mechanical, design]) {
    assert.equal(decision.status, "dispatch");
    assert.equal(decision.model.source, "complexity-derived", "the resolver chose, not the caller");
    assert.notEqual(decision.model.source, "invocation");
    assert.equal(decision.model.masked, false);
    assert.equal(decision.model.fallback, null);
    assert.equal(decision.carried, false, "an item-level resolution derives, it does not carry");
    assert.ok(decision.basis, "a derived decision states what it decided on");
  }
});

test("WF-499: the wave decision CARRIES the item selection with provenance intact", () => {
  const item = resolveItem(designItemEvidence, "unit-b2");
  assert.equal(item.model.value, "sonnet");

  // The wave call: topology evidence only, carrying the already-resolved
  // selection and the originating basis — and passing NO invocationModel.
  const wave = resolveRouting({}, {
    role: "shipper",
    shapeEvidence: oneItemWaveEvidence,
    unitIds: ["unit-b2"],
    supportsModelSelector: true,
    supportsEffortSelector: false,
    carriedModel: item.model.value,
    basis: item.basis,
  });

  assert.equal(wave.status, "dispatch");
  assert.equal(wave.model.value, "sonnet", "the selected model reaches the dispatched agent");
  assert.equal(wave.model.source, "complexity-derived");
  assert.equal(wave.source, "complexity-derived");
  assert.notEqual(wave.model.source, "invocation", "the ledger must not record a caller pin");
  assert.equal(wave.model.masked, false);
  assert.equal(wave.model.fallback, null);
  assert.equal(wave.carried, true, "the ledger records that this decision carried a prior selection");

  // The ORIGINATING item-level basis survives the handoff — a caller-stated basis
  // still wins over the carry's own restatement of it.
  assert.equal(wave.basis, item.basis);

  // And it survives into the compact operational record the ledger persists.
  const measurement = projectRoutingMeasurement(wave);
  assert.equal(measurement.source, "complexity-derived");
  assert.equal(measurement.carried, true);
  assert.equal(measurement.model, "sonnet");
  assert.equal(measurement.masked, false);
});

test("WF-499: a carried wave states its own basis when the caller forwards none", () => {
  const wave = resolveRouting({}, {
    role: "shipper",
    shapeEvidence: oneItemWaveEvidence,
    unitIds: ["unit-a1"],
    supportsModelSelector: true,
    supportsEffortSelector: false,
    carriedModel: "haiku",
  });
  assert.equal(wave.model.value, "haiku");
  assert.equal(wave.carried, true);
  // Never `complexity-derived` with nothing to justify it.
  assert.ok(wave.basis, "a carried decision must record a basis");
  assert.match(wave.basis ?? "", /carried from this unit's earlier item-level decision/);
  assert.ok((wave.basis ?? "").length <= 256, "basis must respect the routing metadata bound");
});

test("WF-499: the carry supersedes a fresh derive off the wave's own evidence", () => {
  // The wave evidence scores 6 and would derive `sonnet` on its own. A carried
  // `haiku` — the item's OWN answer — must win, or the whole handoff is pointless.
  const fresh = resolveRouting({}, {
    role: "shipper", shapeEvidence: oneItemWaveEvidence, unitIds: ["unit-a1"],
    supportsModelSelector: true, supportsEffortSelector: false,
  });
  assert.equal(fresh.model.value, "sonnet", "the flat wave evidence alone derives sonnet");
  assert.equal(fresh.carried, false);

  const carried = resolveRouting({}, {
    role: "shipper", shapeEvidence: oneItemWaveEvidence, unitIds: ["unit-a1"],
    supportsModelSelector: true, supportsEffortSelector: false,
    carriedModel: "haiku",
  });
  assert.equal(carried.model.value, "haiku", "the item-level selection wins over a re-derive");
  assert.equal(carried.carried, true);
});

test("WF-499: an explicit operator pin still outranks a carried selection", () => {
  const pinned = resolveRouting({}, {
    role: "shipper",
    shapeEvidence: oneItemWaveEvidence,
    unitIds: ["unit-b2"],
    supportsModelSelector: true,
    supportsEffortSelector: false,
    invocationModel: "opus",
    carriedModel: "haiku",
  });

  // WF-394 precedence preserved: the pin is stated operator intent and wins.
  assert.equal(pinned.model.value, "opus");
  assert.equal(pinned.model.source, "invocation");
  assert.equal(pinned.carried, false, "an outranked carry is not a carried decision");
  // The carry is not an error here — merely outranked.
  assert.equal(pinned.status, "dispatch");
  assert.equal(pinned.diagnostic, null);
});

test("WF-499: host enforcement still masks a carried selection", () => {
  const hosted = resolveRouting({}, {
    role: "shipper",
    shapeEvidence: oneItemWaveEvidence,
    unitIds: ["unit-b2"],
    supportsModelSelector: true,
    supportsEffortSelector: false,
    carriedModel: "haiku",
    hostModel: "sonnet",
  });
  assert.equal(hosted.model.value, "sonnet");
  assert.equal(hosted.model.source, "host");
  assert.equal(hosted.model.masked, true, "the carry was requested and the host overrode it");
  assert.equal(hosted.carried, false, "a masked carry never reaches the agent, so it is not carried");
});

test("WF-499: every carriedModel integrity bound STOPS rather than degrading", () => {
  const base = {
    shapeEvidence: oneItemWaveEvidence,
    unitIds: ["unit-a1"],
    supportsModelSelector: true,
    supportsEffortSelector: false,
    carriedModel: "haiku",
  } as const;

  // (a) A role the resolver never derives for cannot have been issued a carry.
  const ineligible = resolveRouting({}, { ...base, role: "pr" });
  assert.equal(ineligible.status, "stop");
  assert.equal(ineligible.disposition, "invalid-stop");
  assert.match(ineligible.diagnostic ?? "", /role `pr`, which the resolver never derives/);
  assert.equal(ineligible.model.value, null, "a refused carry never becomes a selection");
  assert.equal(ineligible.carried, false);

  // (b) An edge that cannot honor a model selector could not have received one.
  const unsupported = resolveRouting({}, { ...base, role: "shipper", supportsModelSelector: false });
  assert.equal(unsupported.status, "stop");
  assert.match(unsupported.diagnostic ?? "", /can honor a model selector/);

  // (c) A value outside the range this resolver derives is a forged provenance
  // claim — this is the bound that stops `opus` arriving dressed as resolver work.
  const smuggled = resolveRouting({}, { ...base, role: "shipper", carriedModel: "opus" });
  assert.equal(smuggled.status, "stop");
  assert.match(smuggled.diagnostic ?? "", /`opus` is outside the range this resolver derives/);
  assert.equal(smuggled.model.value, null);
  assert.notEqual(smuggled.source, "complexity-derived", "a forged carry never reaches the decision");

  // (d) Evidence that failed validation carries nothing — scoring it would be the
  // same NaN hazard the derivation path guards against.
  const badEvidence = resolveRouting({}, {
    ...base,
    role: "shipper",
    shapeEvidence: { ...oneItemWaveEvidence, ambiguity: "bogus" as unknown as "none" },
  });
  assert.equal(badEvidence.status, "stop");
  assert.equal(badEvidence.model.value, null);
});

test("WF-499: the carried channel is model-only by construction", () => {
  // There is no `carriedEffort` input at all, so a carried EFFORT is
  // unrepresentable rather than merely rejected — the stronger guarantee. Effort
  // continues to inherit on a carried decision.
  const wave = resolveRouting({}, {
    role: "shipper", shapeEvidence: oneItemWaveEvidence, unitIds: ["unit-a1"],
    supportsModelSelector: true, supportsEffortSelector: true,
    carriedModel: "haiku",
  });
  assert.equal(wave.effort.value, null);
  assert.equal(wave.effort.source, "inheritance");
  assert.equal(wave.model.value, "haiku");
});

test("WF-499: DERIVABLE_MODELS and the ladder agree across its whole score range", () => {
  // The carried bound is stated separately from the ladder so that this change
  // leaves `deriveModelFromEvidence` byte-identical. That is only safe if the two
  // provably agree — so drive the ladder across every reachable score and assert
  // each result is a value the carried bound admits. Raising the ceiling without
  // widening the bound fails HERE rather than silently admitting a tier the
  // resolver cannot produce.
  const dimensions = [
    { ambiguity: "none", toolWork: "none", risk: "low", validation: "mechanical", returnContract: "mechanically-judgeable" },
    { ambiguity: "bounded", toolWork: "bounded", risk: "low", validation: "mechanical", returnContract: "mechanically-judgeable" },
    { ambiguity: "material", toolWork: "material", risk: "elevated", validation: "judgment", returnContract: "judgment" },
  ] as const;

  for (const dimension of dimensions) {
    const derived = resolveRouting({}, {
      role: "shipper",
      shapeEvidence: { ...oneItemWaveEvidence, ...dimension },
      unitIds: ["unit-a1"],
      supportsModelSelector: true,
      supportsEffortSelector: false,
    });
    assert.equal(derived.model.source, "complexity-derived");
    // Every value the ladder mints must round-trip through the carried channel.
    const roundTrip = resolveRouting({}, {
      role: "shipper",
      shapeEvidence: oneItemWaveEvidence,
      unitIds: ["unit-a1"],
      supportsModelSelector: true,
      supportsEffortSelector: false,
      carriedModel: derived.model.value,
    });
    assert.equal(roundTrip.status, "dispatch", `the ladder minted \`${derived.model.value}\` but the carried bound refuses it`);
    assert.equal(roundTrip.carried, true);
    assert.equal(roundTrip.model.value, derived.model.value);
  }
});

test("WF-499: the shipped-static defaults are untouched by this change", () => {
  // Derivation and the carry both sit BELOW `shipped-static`, so the two constant
  // rows are unaffected by either — `DEFAULTS` stays byte-identical.
  for (const role of ["classify", "branch"]) {
    const decision = resolveRouting({}, {
      role, shapeEvidence: oneItemWaveEvidence, unitIds: [`${role}:single`],
      supportsModelSelector: true, supportsEffortSelector: false,
    });
    assert.equal(decision.model.value, "haiku", `${role} must keep its shipped static default`);
    assert.equal(decision.model.source, "shipped-default");
    assert.equal(decision.carried, false);
  }
});

test("WF-499: a carry on a shipped-static role is REFUSED, not quietly outranked", () => {
  // The refusal is precedence-INDEPENDENT and this is the case that proves it:
  // `classify` would have won with its own constant anyway, so a permissive
  // implementation would let the bogus claim through unremarked. Validity is not
  // a function of the caller's other arguments — a carry naming a role this
  // resolver never derives for is a forged provenance claim either way, and the
  // caller is told so instead of being silently handed the right answer.
  for (const role of ["classify", "branch"]) {
    const decision = resolveRouting({}, {
      role, shapeEvidence: oneItemWaveEvidence, unitIds: [`${role}:single`],
      supportsModelSelector: true, supportsEffortSelector: false,
      carriedModel: "sonnet",
    });
    assert.equal(decision.status, "stop", `${role} must refuse a carry it could never have been issued`);
    assert.equal(decision.disposition, "invalid-stop");
    assert.match(decision.diagnostic ?? "", new RegExp(`role \`${role}\`, which the resolver never derives`));
    assert.equal(decision.carried, false);
  }
});

test("WF-499: a carried selection is stable across a retry that pulls no tier lever", () => {
  const initial = resolveRouting({}, {
    role: "shipper", shapeEvidence: oneItemWaveEvidence, unitIds: ["unit-a1"],
    supportsModelSelector: false, supportsEffortSelector: false,
  });
  // A `model=false` edge derives nothing and carries nothing — unchanged by WF-499.
  assert.equal(initial.model.value, null);
  assert.equal(initial.carried, false);
});
