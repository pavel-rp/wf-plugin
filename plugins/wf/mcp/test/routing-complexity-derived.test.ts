import assert from "node:assert/strict";
import test from "node:test";
import { resolveRouting } from "../src/resolver/routing.js";

// WF-498. The acceptance bar for OUT-5 is behavioural, not structural: a
// shipper-path role must receive a model derived from complexity evidence ALONE
// and that value must survive UNMASKED to a dispatched agent. These tests assert
// against the shapes the real call sites pass, so a mechanism that only works in
// a synthetic fixture cannot pass them.

/** The evidence `/wf:run` passes at `run:phase` — the edge that dispatches the
 *  real `wf:phase-runner` subagent. Isolation-worthy, so it selects `isolated`. */
const runPhaseEvidence = {
  workSurface: "external-context", atomicity: "atomic", unitCount: 1, unitsIndependent: false,
  ambiguity: "material", risk: "elevated", toolWork: "material", validation: "judgment",
  contextIsolation: "required", independentReview: false,
  returnContract: "mechanically-judgeable", requestedParallelism: 1,
} as const;

/** The evidence `ship`/`fleet` pass on a fixed sibling-Skill edge. Every field is
 *  held constant except `returnContract`, which is the only dimension that does
 *  not feed the isolation predicate — so these stay `inline`. */
function shipEdgeEvidence(returnContract: "mechanically-judgeable" | "judgment") {
  return {
    workSurface: "caller-context", atomicity: "atomic", unitCount: 1, unitsIndependent: false,
    ambiguity: "none", risk: "low", toolWork: "none", validation: "mechanical",
    contextIsolation: "none", independentReview: false,
    returnContract, requestedParallelism: 1,
  } as const;
}

test("WF-498: a complexity-derived model reaches a DISPATCHED shipper-path agent unmasked", () => {
  const decision = resolveRouting({}, {
    role: "phase-runner",
    shapeEvidence: runPhaseEvidence,
    unitIds: ["run:phase"],
    supportsModelSelector: true,
    supportsEffortSelector: false,
  });

  // Bound to a real dispatch, not an inline no-op: this shape is what actually
  // spawns the phase-runner subagent.
  assert.equal(decision.executionShape, "isolated");
  assert.equal(decision.status, "dispatch");

  // Derived from evidence alone — the caller supplied no model of any kind.
  assert.equal(decision.model.value, "sonnet");
  assert.equal(decision.model.source, "complexity-derived");
  assert.equal(decision.source, "complexity-derived");

  // The whole point of OUT-5: NOT masked, and never the selector-unsupported
  // fallback that made every shipper-path decision a no-op before this change.
  assert.equal(decision.model.masked, false);
  assert.equal(decision.masked, false);
  assert.equal(decision.model.fallback, null);
  assert.notEqual(decision.model.fallback, "selector-unsupported");

  // The resolver states what it decided on, rather than agreeing with a caller.
  assert.ok(decision.basis, "a derived decision must record its basis");
  assert.match(decision.basis ?? "", /^complexity-derived score 6:/);
  assert.match(decision.basis ?? "", /ambiguity=material/);
  assert.ok((decision.basis ?? "").length <= 256, "basis must respect the routing metadata bound");
});

test("WF-498: two shipper-path edges with differing evidence receive differing selections", () => {
  const route = (returnContract: "mechanically-judgeable" | "judgment", unitId: string) =>
    resolveRouting({}, {
      role: "phase-runner",
      shapeEvidence: shipEdgeEvidence(returnContract),
      unitIds: [unitId],
      supportsModelSelector: true,
      supportsEffortSelector: true,
    });

  const runInitial = route("mechanically-judgeable", "ship:run-initial");
  const gatedPhase = route("judgment", "ship:phase");

  // Same role, same caller, same everything except the evidence — so the
  // difference can only have come from the evidence.
  assert.notEqual(runInitial.model.value, gatedPhase.model.value);
  assert.equal(runInitial.model.value, "haiku");
  assert.equal(gatedPhase.model.value, "sonnet");
  for (const decision of [runInitial, gatedPhase]) {
    assert.equal(decision.executionShape, "inline", "shipper-path sibling edges must stay inline");
    assert.equal(decision.model.source, "complexity-derived");
    assert.equal(decision.model.masked, false);
    assert.equal(decision.model.fallback, null);
  }

  // The ceiling is deliberate and asserted: a materially harder shape scores 6
  // but is still capped at `sonnet`. Nothing derives `opus`, because
  // `phase-runner` is also reached by the INTERACTIVE `/wf:run` path and no core
  // call site supplies `availableModels` to degrade against.
  const hardest = resolveRouting({}, {
    role: "phase-runner", shapeEvidence: runPhaseEvidence, unitIds: ["run:phase"],
    supportsModelSelector: true, supportsEffortSelector: false,
  });
  assert.match(hardest.basis ?? "", /score 6:/, "the score still reflects the harder evidence");
  assert.equal(hardest.model.value, "sonnet", "the ladder is capped at sonnet");
  assert.notEqual(hardest.model.value, "opus", "no evidence may derive the top tier");
});

test("WF-498: the two shipped-static defaults are unaffected by derivation", () => {
  for (const role of ["classify", "branch"]) {
    const decision = resolveRouting({}, {
      role, shapeEvidence: runPhaseEvidence, unitIds: [`${role}:single`],
      supportsModelSelector: true, supportsEffortSelector: false,
    });
    // Derivation is ranked BELOW shipped-static, so the constant still wins even
    // under evidence that would otherwise derive Opus.
    assert.equal(decision.model.value, "haiku", `${role} must keep its shipped static default`);
    assert.equal(decision.model.source, "shipped-default");
  }
});

test("WF-498: derivation reaches only the eligible roles", () => {
  // `shipper` left this list in WF-499, which published its inlined-role entry and
  // added it to the eligible set. `pr` and `commit` stay because their matrix rows
  // still read `inherit` — `pr`'s is pinned there by `CAL-pr`.
  for (const role of ["pr", "commit", "index", "context-distiller", "charter-writer"]) {
    const decision = resolveRouting({}, {
      role, shapeEvidence: runPhaseEvidence, unitIds: [`${role}:single`],
      supportsModelSelector: true, supportsEffortSelector: false,
    });
    assert.equal(decision.model.value, null, `${role} must not receive a derived model`);
    assert.equal(decision.model.source, "inheritance", `${role} must still inherit`);
    assert.equal(decision.basis, null, `${role} must not claim a derivation basis`);
  }
  // `finalize` is eligible even though it backs no agent — it is published under
  // the matrix's inlined-roles section rather than as an agent row.
  const finalize = resolveRouting({}, {
    role: "finalize", shapeEvidence: shipEdgeEvidence("mechanically-judgeable"),
    unitIds: ["ship:finalize"], supportsModelSelector: true, supportsEffortSelector: true,
  });
  assert.equal(finalize.model.value, "haiku");
  assert.equal(finalize.model.source, "complexity-derived");
});

test("WF-498: every stated choice still outranks derivation, and host enforcement still masks", () => {
  const base = {
    role: "phase-runner", shapeEvidence: runPhaseEvidence, unitIds: ["run:phase"],
    supportsModelSelector: true, supportsEffortSelector: false,
  } as const;

  // WF-394 precedence is preserved, not rewritten.
  const invocation = resolveRouting({}, { ...base, invocationModel: "sonnet" });
  assert.equal(invocation.model.value, "sonnet");
  assert.equal(invocation.model.source, "invocation");
  assert.equal(invocation.basis, null, "a stated choice derives nothing, so it reports no basis");

  const project = resolveRouting({ "phase-runner": { model: "sonnet", effort: null } }, base);
  assert.equal(project.model.value, "sonnet");
  assert.equal(project.model.source, "project");

  // The host wins outright over a derived value AND records that it masked one —
  // the derived tier must never launder itself past host enforcement.
  const host = resolveRouting({}, { ...base, hostModel: "haiku" });
  assert.equal(host.model.value, "haiku");
  assert.equal(host.model.source, "host");
  assert.equal(host.model.masked, true, "a derived request the host overrode must report masked");
  assert.equal(host.model.requested, "sonnet");
  assert.equal(host.model.requestedSource, "complexity-derived");
});

test("WF-498: an edge that cannot honor a selector is left exactly as it was", () => {
  const decision = resolveRouting({}, {
    role: "phase-runner", shapeEvidence: runPhaseEvidence, unitIds: ["run:phase"],
    supportsModelSelector: false, supportsEffortSelector: false,
  });
  // Derivation is strictly ADDITIVE to edges that can use a selector. Deriving
  // here would push this edge's record from `fallback: null` to
  // `fallback: "selector-unsupported"` — silently rewriting the compact
  // operational record of every frozen `model=false` edge, including
  // `agents/phase-runner.md`, which this change may not touch.
  assert.equal(decision.model.value, null);
  assert.equal(decision.model.requested, null, "an unsupported edge derives nothing at all");
  assert.equal(decision.model.requestedSource, "inheritance");
  assert.equal(decision.model.fallback, null, "its record must be byte-identical to before this change");
  assert.equal(decision.basis, null);
});

test("WF-498: rejected shape evidence derives nothing, and never falls through to the top tier", () => {
  // `selectShape` fills `normalizedEvidence` with `?? "none"` defaults BEFORE it
  // validates the enums, so a bogus value survives into the normalized object.
  // Scoring it would produce NaN, fail both tier comparisons, and land on the
  // most expensive tier — chosen by malformed input. Assert the rejection path
  // supplies no model at all.
  const decision = resolveRouting({}, {
    role: "phase-runner",
    shapeEvidence: { ...runPhaseEvidence, ambiguity: "bogus" as unknown as "material" },
    unitIds: ["run:phase"],
    supportsModelSelector: true,
    supportsEffortSelector: false,
  });
  assert.equal(decision.status, "stop");
  assert.match(decision.diagnostic ?? "", /ambiguity/);
  assert.equal(decision.model.value, null, "a rejected call must not carry a derived model");
  assert.notEqual(decision.model.value, "opus");
  assert.equal(decision.model.source, "inheritance");
  assert.equal(decision.basis, null, "a rejected call must not claim a derivation basis");
});

test("WF-498: a caller cannot forge complexity-derived provenance on a post-attempt prior", () => {
  // `complexity-derived` is a provenance only the resolver can mint. Widening the
  // input enum so a genuine prior can carry it forward also made the token
  // *speakable* by a caller — and `priorTerminalDecision` copies
  // `prior.model.source` straight onto the returned decision, which
  // `projectRoutingMeasurement` then publishes as the canonical operational
  // record. Admitting a forged label is the same class WF-497 removed on the
  // neighbouring path; it must be refused, not reintroduced.
  const forge = (role: string, value = "opus") => resolveRouting({}, {
    role,
    shapeEvidence: runPhaseEvidence,
    unitIds: ["run:phase"],
    supportsModelSelector: true,
    supportsEffortSelector: false,
    postAttempt: {
      sufficient: true,
      signals: [],
      prior: {
        role,
        attempt: 1,
        executionShape: "isolated" as const,
        shapeEvidence: runPhaseEvidence,
        unitIds: ["run:phase"],
        model: {
          value, source: "complexity-derived" as const, requested: value,
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

  // `pr` is deliberately outside DERIVATION_ELIGIBLE_ROLES, so the resolver could
  // never have issued this prior. It must be rejected rather than echoed.
  const forged = forge("pr");
  assert.equal(forged.status, "stop");
  assert.equal(forged.disposition, "invalid-stop");
  assert.match(forged.diagnostic ?? "", /complexity-derived provenance for role `pr`/);
  assert.notEqual(forged.source, "complexity-derived", "a forged provenance must never reach the decision");

  // WF-499 TIGHTENED THIS. An eligible role is not enough on its own: `opus` is a
  // tier the ladder cannot mint, so a prior claiming the resolver derived one is
  // forged whatever role it names. This assertion previously read `retain`, which
  // encoded exactly the gap — the role gate passed and nothing checked the value.
  const forgedTier = forge("phase-runner");
  assert.equal(forgedTier.status, "stop");
  assert.match(forgedTier.diagnostic ?? "", /`opus`, which is outside the range this resolver derives/);

  // A genuine prior — an eligible role AND a tier the ladder actually mints — still
  // round-trips, so the guard rejects forgery without breaking the seam a consumer
  // needs to carry provenance.
  assert.equal(forge("phase-runner", "sonnet").status, "retain");

  // Effort is never derived, so claiming it on the effort choice is also refused.
  const forgedEffort = resolveRouting({}, {
    role: "phase-runner",
    shapeEvidence: runPhaseEvidence,
    unitIds: ["run:phase"],
    supportsModelSelector: true,
    supportsEffortSelector: false,
    postAttempt: {
      sufficient: true,
      signals: [],
      prior: {
        role: "phase-runner",
        attempt: 1,
        executionShape: "isolated" as const,
        shapeEvidence: runPhaseEvidence,
        unitIds: ["run:phase"],
        model: {
          value: "sonnet", source: "complexity-derived" as const, requested: "sonnet",
          requestedSource: "complexity-derived" as const, masked: false, fallback: null,
        },
        effort: {
          value: "high", source: "complexity-derived" as const, requested: "high",
          requestedSource: "complexity-derived" as const, masked: false, fallback: null,
        },
        basis: null,
        escalationOrigin: null,
      },
    },
  });
  assert.equal(forgedEffort.status, "stop");
  assert.match(forgedEffort.diagnostic ?? "", /effort cannot claim complexity-derived/);
});

test("WF-498: the escalation lever still outranks derivation on a retry that can advance", () => {
  // A mid-tier prior: the ship gated-phase edge derives `sonnet`, so WF-497's
  // lever has somewhere to go and must win over a fresh derivation.
  const evidence = shipEdgeEvidence("judgment");
  const initial = resolveRouting({}, {
    role: "phase-runner", shapeEvidence: evidence, unitIds: ["ship:phase"],
    supportsModelSelector: true, supportsEffortSelector: true,
  });
  assert.equal(initial.model.value, "sonnet");

  const retry = resolveRouting({}, {
    role: "phase-runner",
    shapeEvidence: evidence,
    unitIds: ["ship:phase"],
    supportsModelSelector: true,
    supportsEffortSelector: true,
    postAttempt: {
      sufficient: false,
      signals: ["low-confidence"],
      prior: {
        role: "phase-runner",
        attempt: 1,
        executionShape: initial.executionShape,
        shapeEvidence: evidence,
        unitIds: ["ship:phase"],
        model: initial.model,
        effort: initial.effort,
        basis: initial.basis,
        escalationOrigin: null,
      },
    },
  });

  assert.equal(retry.disposition, "retry");
  assert.equal(retry.retry?.escalation, "next-stable-tier");
  assert.equal(retry.retry?.nextTier, "opus");
  assert.equal(retry.model.value, "opus", "the lever's tier must beat a fresh derivation");
  assert.equal(retry.model.source, "invocation", "the advance is a resolver-stated request, not a derivation");
});
