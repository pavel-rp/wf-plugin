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
  assert.equal(decision.model.value, "opus");
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

  // A third, materially harder shape lands on a third tier, so the ladder is a
  // real mechanism rather than a two-valued toggle.
  assert.equal(
    resolveRouting({}, {
      role: "phase-runner", shapeEvidence: runPhaseEvidence, unitIds: ["run:phase"],
      supportsModelSelector: true, supportsEffortSelector: false,
    }).model.value,
    "opus",
  );
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
  for (const role of ["pr", "commit", "shipper", "index", "context-distiller", "charter-writer"]) {
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
  assert.equal(host.model.requested, "opus");
  assert.equal(host.model.requestedSource, "complexity-derived");
});

test("WF-498: an edge that cannot honor a selector reports the derived value as unsupported, never as delivered", () => {
  const decision = resolveRouting({}, {
    role: "phase-runner", shapeEvidence: runPhaseEvidence, unitIds: ["run:phase"],
    supportsModelSelector: false, supportsEffortSelector: false,
  });
  // Honest rather than silent: the resolver still says what it would have chosen
  // and why it did not survive. This is the state the shipper path was stuck in
  // for every edge before the call sites opened their selector flags.
  assert.equal(decision.model.value, null);
  assert.equal(decision.model.requested, "opus");
  assert.equal(decision.model.requestedSource, "complexity-derived");
  assert.equal(decision.model.fallback, "selector-unsupported");
});

test("WF-498: a retry retains the derived tier rather than dropping to inheritance", () => {
  const initial = resolveRouting({}, {
    role: "phase-runner", shapeEvidence: runPhaseEvidence, unitIds: ["run:phase"],
    supportsModelSelector: true, supportsEffortSelector: false,
  });
  assert.equal(initial.model.value, "opus");

  const retry = resolveRouting({}, {
    role: "phase-runner",
    shapeEvidence: runPhaseEvidence,
    unitIds: ["run:phase"],
    supportsModelSelector: true,
    supportsEffortSelector: false,
    postAttempt: {
      sufficient: false,
      signals: ["failed-validation"],
      prior: {
        role: "phase-runner",
        attempt: 1,
        executionShape: initial.executionShape,
        shapeEvidence: runPhaseEvidence,
        unitIds: ["run:phase"],
        model: initial.model,
        effort: initial.effort,
        basis: initial.basis,
        escalationOrigin: null,
      },
    },
  });

  // The prior already sat on the top tier, so no advance is available — and the
  // retry must still re-dispatch on that same derived tier. Suppressing
  // derivation here would silently drop this attempt to bare inheritance.
  assert.equal(retry.disposition, "retry");
  assert.equal(retry.retry?.escalation, "top-tier");
  assert.equal(retry.retry?.nextTier, null);
  assert.equal(retry.model.value, "opus", "a retry must not lose the derived selection");
  assert.equal(retry.model.source, "complexity-derived");
  assert.equal(retry.basis, initial.basis, "the prior's basis carries forward unchanged");
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
