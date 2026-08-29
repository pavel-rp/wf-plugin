import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { resolveRouting, projectRoutingMeasurement } from "../src/resolver/routing.js";
import type { RoutingShapeEvidence } from "../src/resolver/types.js";

const pkgDir = process.env.WF_MCP_DIR;
if (!pkgDir) throw new Error("WF_MCP_DIR is required");
const repoRoot = resolve(pkgDir, "../../..");

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

/** The one-item wave evidence `fleet` states, deliberately CONSTANT because the
 *  wave decision describes topology and parallelism, never difficulty.
 *
 *  Field-for-field identical to `designItemEvidence`, and that is not an accident
 *  worth deduplicating away: fleet pins the wave literal at the ladder's high end,
 *  so the wave call's own evidence would derive the top tier for every item
 *  regardless of its real difficulty. That coincidence is exactly what makes the
 *  carry load-bearing — carrying a low tier here carries a value this call's own
 *  evidence would never produce. Aliased rather than restated so the two names
 *  cannot silently drift apart. */
const oneItemWaveEvidence = designItemEvidence;

const resolveItem = (shapeEvidence: RoutingShapeEvidence, unitId: string) =>
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
  // The EXHAUSTIVE cross-product of the five scored dimensions, not a sample:
  // 3 x 3 x 2 x 2 x 2 = 72 combinations covering every reachable score. A sample
  // would leave the comment above — and the one in routing.ts — overclaiming what
  // this guard proves, and a ceiling raised at an interior score would slip past.
  const dimensions = [];
  for (const ambiguity of ["none", "bounded", "material"] as const) {
    for (const toolWork of ["none", "bounded", "material"] as const) {
      for (const risk of ["low", "elevated"] as const) {
        for (const validation of ["mechanical", "judgment"] as const) {
          for (const returnContract of ["mechanically-judgeable", "judgment"] as const) {
            dimensions.push({ ambiguity, toolWork, risk, validation, returnContract });
          }
        }
      }
    }
  }
  assert.equal(dimensions.length, 72, "the ladder's scored cross-product must be covered exhaustively");

  const mintedTiers = new Set<string>();
  for (const dimension of dimensions) {
    const derived = resolveRouting({}, {
      role: "shipper",
      shapeEvidence: { ...oneItemWaveEvidence, ...dimension },
      unitIds: ["unit-a1"],
      supportsModelSelector: true,
      supportsEffortSelector: false,
    });
    assert.equal(derived.model.source, "complexity-derived");
    mintedTiers.add(derived.model.value ?? "");
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

  // BOTH DIRECTIONS, or the guard is half a guard. The loop above proves
  // ladder ⊆ bound (every minted value round-trips). This proves bound ⊆ ladder:
  // the set must admit nothing the ladder cannot produce, which is the smuggling it
  // exists to stop. A tier added to the bound but not to the ladder — the exact
  // drift the duplication risks — fails here.
  assert.deepEqual([...mintedTiers].sort(), ["haiku", "sonnet"], "the ladder's full range");
  for (const tier of ["opus", "claude-sonnet-4-6", "gpt", ""]) {
    const refused = resolveRouting({}, {
      role: "shipper", shapeEvidence: oneItemWaveEvidence, unitIds: ["unit-a1"],
      supportsModelSelector: true, supportsEffortSelector: false,
      carriedModel: tier,
    });
    assert.equal(refused.status, "stop", `the bound must refuse \`${tier}\`, which the ladder never mints`);
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

test("WF-499: a `model=false` edge derives nothing and carries nothing", () => {
  // Renamed to what it actually checks. Its old name promised a no-lever retry,
  // which for a carried prior is unreachable by construction: a carried prior's
  // model is always a tier the ladder mints, so `priorTier` always resolves and
  // `nextTier` is always non-null. The genuine retry case is the next test.
  const initial = resolveRouting({}, {
    role: "shipper", shapeEvidence: oneItemWaveEvidence, unitIds: ["unit-a1"],
    supportsModelSelector: false, supportsEffortSelector: false,
  });
  assert.equal(initial.model.value, null);
  assert.equal(initial.carried, false);
});

/** Build a post-attempt prior from a REAL decision, so the fixtures below can never
 *  assert against a prior this resolver could not have issued. */
function priorFrom(decision: ReturnType<typeof resolveRouting>) {
  return {
    role: decision.role,
    attempt: 1 as const,
    executionShape: decision.executionShape,
    shapeEvidence: decision.normalizedEvidence,
    unitIds: decision.unitIds,
    model: decision.model,
    effort: decision.effort,
    basis: decision.basis,
    escalationOrigin: null,
  };
}

test("WF-499: a carried prior escalates one tier, and the advance is not a carry", () => {
  const initial = resolveRouting({}, {
    role: "shipper", shapeEvidence: oneItemWaveEvidence, unitIds: ["unit-a1"],
    supportsModelSelector: true, supportsEffortSelector: true,
    carriedModel: "haiku",
  });
  assert.equal(initial.model.value, "haiku");
  assert.equal(initial.carried, true);

  const retry = resolveRouting({}, {
    role: "shipper", shapeEvidence: oneItemWaveEvidence, unitIds: ["unit-a1"],
    supportsModelSelector: true, supportsEffortSelector: true,
    carriedModel: "haiku",
    basis: initial.basis,
    postAttempt: { sufficient: false, signals: ["low-confidence"], prior: priorFrom(initial) },
  });

  assert.equal(retry.disposition, "retry");
  assert.equal(retry.retry?.escalation, "next-stable-tier");
  assert.equal(retry.retry?.priorTier, "haiku");
  assert.equal(retry.retry?.nextTier, "sonnet");
  assert.equal(retry.model.value, "sonnet", "the lever's tier must beat the carry");
  assert.equal(retry.model.source, "invocation", "the advance is a resolver-stated request");
  assert.equal(retry.carried, false, "an escalated retry did not act on the carry");
});

test("WF-499: `carried` never contradicts the model it is published beside", () => {
  // THE REGRESSION GUARD FOR A REAL DEFECT FOUND IN REVIEW. Every provenance field
  // on a prior-terminal record is restated from the PRIOR; taking `carried` from the
  // current inputs alone let a retain/exhausted record publish `source: "invocation"`
  // (or `"host"`, masked) together with `carried: true` — exactly the combination
  // this field's own published contract rules out.
  const pinned = resolveRouting({}, {
    role: "shipper", shapeEvidence: oneItemWaveEvidence, unitIds: ["unit-a1"],
    supportsModelSelector: true, supportsEffortSelector: true,
    invocationModel: "opus", carriedModel: "haiku",
  });
  assert.equal(pinned.model.source, "invocation");

  // The caller restates `carriedModel` on the post-attempt call — the shape that
  // triggered the defect — while the prior was actually chosen by the pin.
  const retained = resolveRouting({}, {
    role: "shipper", shapeEvidence: oneItemWaveEvidence, unitIds: ["unit-a1"],
    supportsModelSelector: true, supportsEffortSelector: true,
    invocationModel: "opus", carriedModel: "haiku",
    basis: pinned.basis,
    postAttempt: { sufficient: true, signals: [], prior: priorFrom(pinned) },
  });
  assert.equal(retained.disposition, "retain");
  assert.equal(retained.source, "invocation");
  assert.equal(retained.model.value, "opus");
  assert.equal(retained.carried, false, "a pinned prior carried nothing, whatever the caller restates");
  assert.equal(projectRoutingMeasurement(retained).carried, false);

  // The host-masked variant, which the published contract names explicitly.
  const hosted = resolveRouting({}, {
    role: "shipper", shapeEvidence: oneItemWaveEvidence, unitIds: ["unit-a1"],
    supportsModelSelector: true, supportsEffortSelector: true,
    hostModel: "sonnet", carriedModel: "haiku",
  });
  assert.equal(hosted.model.masked, true);
  const retainedHost = resolveRouting({}, {
    role: "shipper", shapeEvidence: oneItemWaveEvidence, unitIds: ["unit-a1"],
    supportsModelSelector: true, supportsEffortSelector: true,
    hostModel: "sonnet", carriedModel: "haiku",
    basis: hosted.basis,
    postAttempt: { sufficient: true, signals: [], prior: priorFrom(hosted) },
  });
  assert.equal(retainedHost.masked, true);
  assert.equal(retainedHost.carried, false, "a masked carry never reached the agent");

  // A genuinely carried prior still round-trips as carried, so the fix narrows
  // rather than blanket-falsifies.
  const carried = resolveRouting({}, {
    role: "shipper", shapeEvidence: oneItemWaveEvidence, unitIds: ["unit-a1"],
    supportsModelSelector: true, supportsEffortSelector: true,
    carriedModel: "haiku",
  });
  const retainedCarry = resolveRouting({}, {
    role: "shipper", shapeEvidence: oneItemWaveEvidence, unitIds: ["unit-a1"],
    supportsModelSelector: true, supportsEffortSelector: true,
    carriedModel: "haiku",
    basis: carried.basis,
    postAttempt: { sufficient: true, signals: [], prior: priorFrom(carried) },
  });
  assert.equal(retainedCarry.disposition, "retain");
  assert.equal(retainedCarry.carried, true);
});

test("WF-499: a forged post-attempt prior cannot claim a tier the ladder never mints", () => {
  // The sibling gate to the carry bound. Eligibility alone is not enough: an
  // eligible role could still assert a prior naming a tier outside the ladder's
  // range, and `priorTerminalDecision` copies the prior's model and source verbatim
  // onto the published record — so an unchecked value would put a selection the
  // resolver could not have produced into the ledger wearing resolver provenance,
  // and would suppress the escalation lever by making the prior look top-tier.
  const forged = resolveRouting({}, {
    role: "shipper", shapeEvidence: oneItemWaveEvidence, unitIds: ["unit-a1"],
    supportsModelSelector: true, supportsEffortSelector: true,
    postAttempt: {
      sufficient: true,
      signals: [],
      prior: {
        role: "shipper",
        attempt: 1,
        executionShape: "isolated" as const,
        shapeEvidence: oneItemWaveEvidence,
        unitIds: ["unit-a1"],
        model: {
          value: "opus", source: "complexity-derived" as const, requested: "opus",
          requestedSource: "complexity-derived" as const, masked: false, fallback: null,
        },
        effort: {
          value: null, source: "inheritance" as const, requested: null,
          requestedSource: "inheritance" as const, masked: false, fallback: null,
        },
        basis: null,
        escalationOrigin: null,
      },
    },
  });
  assert.equal(forged.status, "stop");
  assert.equal(forged.disposition, "invalid-stop");
  assert.match(forged.diagnostic ?? "", /`opus`, which is outside the range this resolver derives/);
  assert.notEqual(forged.model.value, "opus", "a forged tier must never reach the published record");
});

test("WF-499: an empty carriedModel is refused, never silently downgraded", () => {
  // `||` would map "" to null before any integrity bound could see it, and the call
  // would then deliver a FRESH derive off its own evidence — a different model than
  // the caller meant to carry, with no diagnostic and no fallback token.
  const empty = resolveRouting({}, {
    role: "shipper", shapeEvidence: oneItemWaveEvidence, unitIds: ["unit-a1"],
    supportsModelSelector: true, supportsEffortSelector: false,
    carriedModel: "",
  });
  assert.equal(empty.status, "stop", "an empty carry must not fall through to a fresh derive");
  assert.equal(empty.model.value, null);
  assert.notEqual(empty.model.value, "sonnet", "the fresh derive is exactly what must not happen");
  assert.equal(empty.carried, false);
});

test("WF-499: the MCP tool schema exposes the new input and the new ledger field", () => {
  // A REGRESSION GUARD FOR A REAL DEFECT FOUND IN REVIEW. Every other test here calls
  // `resolveRouting` directly, which bypasses the MCP boundary entirely — so a
  // decision field missing from the tool's OUTPUT schema passes the whole suite while
  // being REJECTED on the wire, where `additionalProperties: false` governs. That is
  // not a narrow miss: the field is emitted on every decision, so the failure takes
  // out every `resolve_routing` call for every role, not just a carried one.
  const tools = readFileSync(join(repoRoot, "plugins/wf/mcp/src/tools.ts"), "utf8");

  // The input side: the new channel must be declared, or a caller cannot pass it.
  assert.ok(tools.includes("carriedModel: {"), "carriedModel must be declared on the routing input schema");

  // The output side: declared AND required, since the schema is closed.
  assert.ok(tools.includes("carried: {"), "carried must be declared on the routing output schema");
  assert.ok(
    tools.includes(`"masked", "carried", "status"`),
    "carried must appear in the routing output schema's required list, beside masked",
  );

  // And the runtime must actually produce it on an ordinary decision, so the
  // schema's `required` is satisfiable rather than aspirational.
  const decision = resolveRouting({}, {
    role: "shipper", shapeEvidence: oneItemWaveEvidence, unitIds: ["unit-a1"],
    supportsModelSelector: true, supportsEffortSelector: false,
  });
  assert.equal(typeof decision.carried, "boolean");
  assert.equal(typeof projectRoutingMeasurement(decision).carried, "boolean");
});
