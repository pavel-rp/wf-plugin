// WF-490 — the resolver-issued phase-completion receipt.
//
// The acceptance properties, proved mechanically rather than asserted in prose:
//
//   1. POSITIVE — a receipt-bearing phase that completes yields a receipt a later
//      reader matches to that phase, that task, and that run.
//   2. FORGERY — a receipt-shaped artifact written by hand at the declared
//      destination is reported `unmatched` with a stated reason, and is never
//      counted as a receipt. This is the acceptance test for the whole mechanism:
//      if it passes only because the reader is lenient, the mechanism is theatre.
//   3. VERSION REFUSAL — a ledger declaring an unrecognised version, and one
//      declaring none, both make the reader REFUSE rather than improvise a match.
//      The `lifecycle-journal.ts` precedent, applied on the read AND write sides.
//   4. NON-COMPLETION — a phase that never records leaves no receipt, and a phase
//      that names an artifact it did not write is refused rather than issued one.
//   5. CLOSED SET — the seven receipt-bearing phases are the whole set; an eighth
//      subject is refused at the issuing boundary, so "no eighth skill is
//      instrumented" is a property of the mechanism, not a convention.
//   6. DECLARED CLASS — the destination predicate admits only this class's own
//      well-formed destinations, so authority never comes from the `.wf/` prefix.
//
// The ports double's `resolveFresh` THROWS on purpose: the run-evidence path must
// perform no capability resolution at all, so a call would be a real defect and
// fails the test loudly rather than passing quietly.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeSlashes } from "../src/resolver/paths.js";
import { createDefaultPorts } from "../src/ports.js";
import { ResolverService, type ResolverServicePorts } from "../src/service.js";
import {
  MAX_RUN_EVIDENCE_RECORDS,
  RECEIPT_BEARING_PHASES,
  RUN_EVIDENCE_FORMAT_VERSION,
  canonicalRunEvidenceBody,
  classifyArtifactState,
  isDeclaredRunEvidenceArtifact,
  matchRunEvidence,
  normalizeRunModeSignal,
  parseRunEvidenceLedger,
  runEvidenceDestination,
  sealRunEvidenceBody,
  workspaceFingerprint,
} from "../src/resolver/run-evidence.js";

const WS = "/ws";
const TASK = "WF-490";

function makePorts(): ResolverServicePorts & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    workspaceRoot: WS,
    corePluginRoot: "/core/plugins/wf",
    resolveFresh: () => {
      throw new Error("run-evidence must not trigger capability resolution");
    },
    persist() {
      throw new Error("run-evidence must not persist a snapshot");
    },
    readCache: () => null,
    readFile: (p) => files.get(normalizeSlashes(p)) ?? null,
    writeFile(p, content) {
      files.set(normalizeSlashes(p), content);
    },
    listDirs: () => [],
    listPlugins: () => ({ plugins: [], ok: true, contractOk: true, issues: [] }),
    registryRelPath: () => "_local/config.md",
  };
}

/** Seed an artifact the phase "wrote", so a receipt has something to attest. */
function seedArtifact(ports: { files: Map<string, string> }, rel: string, body: string): void {
  ports.files.set(normalizeSlashes(`${WS}/${rel}`), body);
}

function ledgerPathFor(service: ResolverService): string {
  // The destination is derived, never spelled out at a call site.
  return service.readRunEvidence(TASK).destination;
}

// ---------------------------------------------------------------------------
// 1. Positive
// ---------------------------------------------------------------------------

test("a completed receipt-bearing phase yields a matchable receipt", () => {
  const ports = makePorts();
  const service = new ResolverService(ports);
  seedArtifact(ports, "_local/WF-490/01_spec.md", "# spec\n");

  const recorded = service.recordRunEvidence({
    kind: "phase-receipt",
    subject: "spec",
    taskId: TASK,
    artifactPath: "_local/WF-490/01_spec.md",
  });

  assert.equal(recorded.status, "recorded");
  assert.equal(recorded.subject, "spec");
  assert.equal(recorded.sequence, 0);
  assert.ok(recorded.artifact, "the resolver digested the named artifact itself");
  assert.match(recorded.artifact!.sha256, /^[a-f0-9]{64}$/);

  const read = service.readRunEvidence(TASK);
  assert.equal(read.status, "ok");
  assert.equal(read.matched.length, 1);
  assert.equal(read.unmatched.length, 0);
  assert.equal(read.matched[0].subject, "spec");
  assert.equal(read.matched[0].taskId, TASK);
  assert.deepEqual(read.provenPhases, ["spec"]);
  assert.deepEqual(read.receiptBearingPhases, [...RECEIPT_BEARING_PHASES]);
});

test("the run identity joins every phase of one run and is never a caller input", () => {
  const ports = makePorts();
  const service = new ResolverService(ports);
  seedArtifact(ports, "_local/WF-490/01_spec.md", "# spec\n");
  seedArtifact(ports, "_local/WF-490/02_plan.md", "# plan\n");

  service.recordRunEvidence({
    kind: "phase-receipt",
    subject: "spec",
    taskId: TASK,
    artifactPath: "_local/WF-490/01_spec.md",
  });
  service.recordRunEvidence({
    kind: "phase-receipt",
    subject: "plan",
    taskId: TASK,
    artifactPath: "_local/WF-490/02_plan.md",
  });
  // The two delivery-ceremony skills produce no artifact of their own.
  const ship = service.recordRunEvidence({ kind: "phase-receipt", subject: "ship", taskId: TASK });
  assert.equal(ship.status, "recorded");
  assert.equal(ship.artifact, null);

  const read = service.readRunEvidence(TASK);
  assert.equal(read.matched.length, 3);
  // Reported in the closed set's own order, not arrival order.
  assert.deepEqual(read.provenPhases, ["spec", "plan", "ship"]);
  // One ledger for the run — the three phases joined.
  assert.equal(read.matched.every((m) => m.taskId === TASK), true);
});

// ---------------------------------------------------------------------------
// 2. Forgery — the acceptance test for the mechanism
// ---------------------------------------------------------------------------

test("a hand-written receipt-shaped artifact does not match and is never a receipt", () => {
  const ports = makePorts();
  const service = new ResolverService(ports);

  // An agent writes a well-formed, entirely plausible receipt at the declared
  // destination — every field present, every field believable.
  const destination = runEvidenceDestination(
    service.readRunEvidence(TASK).runId,
  );
  ports.files.set(
    normalizeSlashes(`${WS}/${destination}`),
    `${JSON.stringify(
      {
        formatVersion: RUN_EVIDENCE_FORMAT_VERSION,
        runId: service.readRunEvidence(TASK).runId,
        records: [
          {
            kind: "phase-receipt",
            subject: "ship",
            taskId: TASK,
            runId: service.readRunEvidence(TASK).runId,
            workspaceRoot: WS,
            issuedAt: "2026-08-28T00:00:00.000Z",
            sequence: 0,
            artifact: null,
            seal: "f".repeat(64),
          },
        ],
      },
      null,
      2,
    )}\n`,
  );

  const read = service.readRunEvidence(TASK);
  assert.equal(read.status, "ok");
  assert.equal(read.matched.length, 0, "a hand-written entry is never matched");
  assert.equal(read.unmatched.length, 1);
  assert.equal(read.unmatched[0].subject, "ship");
  assert.deepEqual(read.provenPhases, [], "and it proves no phase");
});

test("a genuine receipt tampered with after issue fails on its seal", () => {
  const ports = makePorts();
  const service = new ResolverService(ports);
  seedArtifact(ports, "_local/WF-490/01_spec.md", "# spec\n");
  service.recordRunEvidence({
    kind: "phase-receipt",
    subject: "spec",
    taskId: TASK,
    artifactPath: "_local/WF-490/01_spec.md",
  });

  const path = normalizeSlashes(`${WS}/${ledgerPathFor(service)}`);
  const ledger = JSON.parse(ports.files.get(path)!);
  // Keep the real seal, change what it attests — the upgrade-a-receipt attack.
  ledger.records[0].subject = "ship";
  ports.files.set(path, `${JSON.stringify(ledger, null, 2)}\n`);

  const read = service.readRunEvidence(TASK);
  assert.equal(read.matched.length, 0);
  assert.equal(read.unmatched[0].reason, "seal-mismatch");
  assert.deepEqual(read.provenPhases, []);
});

test("with no issuer binding, nothing is proved rather than everything assumed", () => {
  const ports = makePorts();
  const service = new ResolverService(ports);
  seedArtifact(ports, "_local/WF-490/01_spec.md", "# spec\n");
  service.recordRunEvidence({
    kind: "phase-receipt",
    subject: "spec",
    taskId: TASK,
    artifactPath: "_local/WF-490/01_spec.md",
  });

  // Remove the machine-local binding, leaving the portable evidence intact. The
  // binding is keyed on the workspace, so find it rather than spelling its path.
  for (const key of [...ports.files.keys()]) {
    if (key.includes("issuer-")) ports.files.delete(key);
  }

  const read = service.readRunEvidence(TASK);
  assert.equal(read.matched.length, 0);
  assert.equal(read.unmatched[0].reason, "issuer-unavailable");
});

test("a present but untrusted issuer binding is refused, never overwritten", () => {
  const ports = makePorts();
  const service = new ResolverService(ports);
  service.recordRunEvidence({ kind: "phase-receipt", subject: "spec", taskId: TASK });

  const issuerPath = [...ports.files.keys()].find((k) => k.includes("issuer-"))!;
  const original = ports.files.get(issuerPath)!;
  // A binding from a future release: present, parseable, but not this version.
  ports.files.set(issuerPath, JSON.stringify({ issuerVersion: 99, key: "a".repeat(64) }));

  const recorded = service.recordRunEvidence({
    kind: "phase-receipt",
    subject: "ship",
    taskId: TASK,
  });
  assert.equal(recorded.status, "refused");
  assert.match(recorded.diagnostic ?? "", /never overwritten/);
  // Minting over it would destroy the key proving every receipt already issued.
  assert.notEqual(ports.files.get(issuerPath), original);
  assert.equal(ports.files.get(issuerPath), JSON.stringify({ issuerVersion: 99, key: "a".repeat(64) }));
});

// ---------------------------------------------------------------------------
// 7. MINT-ONCE (WF-504)
//
// "The key is minted once and never rewritten" was a comment, not an enforced
// property: the mint read absence and then wrote with a plain `writeFileSync`,
// so a second mint reaching the write TRUNCATED the key the first had already
// sealed receipts with — silently reclassifying every one of them from genuine
// to tampered. These two tests pin the guarantee at both levels it lives at: the
// port, where the kernel arbitrates (the concurrent path), and the service,
// where the refusal has to surface as a stated `refused` (the repeat path).
// ---------------------------------------------------------------------------

test("the private write is create-exclusive: a second mint refuses and never truncates", () => {
  const dir = mkdtempSync(join(tmpdir(), "wf-504-issuer-"));
  try {
    const ports = createDefaultPorts(normalizeSlashes(dir));
    // A nested destination, because the real binding lives one level down and the
    // port is responsible for creating that directory privately.
    const target = normalizeSlashes(join(dir, "run-evidence", "issuer-key.json"));

    ports.writePrivateFile!(target, "first");
    assert.equal(readFileSync(target, "utf8"), "first");
    // The security property the mode exists for: nothing outside the owner.
    assert.equal(statSync(target).mode & 0o077, 0);

    // THE FILESYSTEM DECIDES THE SINGLE HOLDER, not a prior read. This is the
    // concurrent path: a second process that observed the same absence still
    // loses, because `wx` fails on an existing path rather than truncating it.
    assert.throws(
      () => ports.writePrivateFile!(target, "second"),
      (err: unknown) => (err as NodeJS.ErrnoException).code === "EEXIST",
    );
    assert.equal(readFileSync(target, "utf8"), "first");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a mint that loses the create race refuses, and the established binding is untouched", () => {
  // A binding a first run established, and the path it landed at — derived, never
  // spelled out at a call site.
  const first = makePorts();
  new ResolverService(first).recordRunEvidence({
    kind: "phase-receipt",
    subject: "spec",
    taskId: TASK,
  });
  const issuerPath = [...first.files.keys()].find((k) => k.includes("issuer-"))!;
  const established = first.files.get(issuerPath)!;

  // A second run that enters the mint path because its READ of the binding comes
  // back empty, while the binding is in fact already present — precisely the
  // read-then-write window. Its private write is create-exclusive, as the real
  // port now is.
  const ports = makePorts();
  ports.files.set(issuerPath, established);
  ports.readFile = (p) =>
    normalizeSlashes(p) === issuerPath ? null : (ports.files.get(normalizeSlashes(p)) ?? null);
  ports.writePrivateFile = (p, content) => {
    const abs = normalizeSlashes(p);
    if (ports.files.has(abs)) {
      const err: NodeJS.ErrnoException = new Error("EEXIST: file already exists");
      err.code = "EEXIST";
      throw err;
    }
    ports.files.set(abs, content);
  };

  const recorded = new ResolverService(ports).recordRunEvidence({
    kind: "phase-receipt",
    subject: "ship",
    taskId: TASK,
  });

  // It proves nothing rather than sealing with an issuer that displaced its
  // predecessor — and it says so.
  assert.equal(recorded.status, "refused");
  assert.match(recorded.diagnostic ?? "", /NOT overwritten/);
  assert.equal(ports.files.get(issuerPath), established);
});

// ---------------------------------------------------------------------------
// 8. AN EMPTY ARTIFACT PATH IS A CALLER BUG, NOT AN OMISSION (WF-504)
// ---------------------------------------------------------------------------

test("an empty artifactPath is refused, never silently downgraded to an omission", () => {
  const ports = makePorts();
  const recorded = new ResolverService(ports).recordRunEvidence({
    kind: "phase-receipt",
    subject: "spec",
    taskId: TASK,
    artifactPath: "",
  });

  assert.equal(recorded.status, "refused");
  assert.match(recorded.diagnostic ?? "", /empty string/);
  // Nothing was filed: an under-claiming receipt is still a wrong one.
  assert.equal(new ResolverService(ports).readRunEvidence(TASK).matched.length, 0);
});

test("evidenceClass follows the call, not the subject", () => {
  const ports = makePorts();
  const service = new ResolverService(ports);
  seedArtifact(ports, "_local/WF-490/01_spec.md", "# spec\n");

  // `spec` is one of the five phases that conventionally name an artifact...
  service.recordRunEvidence({
    kind: "phase-receipt",
    subject: "spec",
    taskId: TASK,
    artifactPath: "_local/WF-490/01_spec.md",
  });
  // ...but the class is derived from what the resolver observed ON THAT CALL, so
  // the same phase filing without one is `invocation-only`. A consumer that
  // inferred the class from the subject would be silently wrong here.
  service.recordRunEvidence({ kind: "phase-receipt", subject: "spec", taskId: TASK });

  const read = service.readRunEvidence(TASK);
  assert.equal(read.matched.length, 2);
  assert.equal(read.matched[0].evidenceClass, "artifact-backed");
  assert.equal(read.matched[1].evidenceClass, "invocation-only");
});

test("a ledger copied from another task proves nothing for the task asked about", () => {
  const ports = makePorts();
  const service = new ResolverService(ports);
  seedArtifact(ports, "_local/WF-490/01_spec.md", "# spec\n");
  // A wholly GENUINE ledger — every record correctly sealed — for task A.
  service.recordRunEvidence({
    kind: "phase-receipt",
    subject: "spec",
    taskId: TASK,
    artifactPath: "_local/WF-490/01_spec.md",
  });
  const sourcePath = normalizeSlashes(`${WS}/${ledgerPathFor(service)}`);
  const genuine = ports.files.get(sourcePath)!;

  // Copy it onto task B's destination, which anyone who can read the source can
  // derive. Every seal in it is real; only the question being asked has changed.
  const otherTask = "WF-999";
  const otherDestination = service.readRunEvidence(otherTask).destination;
  ports.files.set(normalizeSlashes(`${WS}/${otherDestination}`), genuine);

  const read = service.readRunEvidence(otherTask);
  assert.equal(read.matched.length, 0, "a genuine seal does not answer a different question");
  assert.equal(read.unmatched[0].reason, "run-mismatch");
  assert.deepEqual(read.provenPhases, []);
  // And the original still proves what it always did.
  assert.deepEqual(service.readRunEvidence(TASK).provenPhases, ["spec"]);
});

test("an append over an unreadable record refuses rather than erasing it", () => {
  const ports = makePorts();
  const service = new ResolverService(ports);
  service.recordRunEvidence({ kind: "phase-receipt", subject: "spec", taskId: TASK });

  const path = normalizeSlashes(`${WS}/${ledgerPathFor(service)}`);
  const ledger = JSON.parse(ports.files.get(path)!);
  ledger.records.push({ garbage: true });
  const tampered = `${JSON.stringify(ledger, null, 2)}\n`;
  ports.files.set(path, tampered);

  const recorded = service.recordRunEvidence({
    kind: "phase-receipt",
    subject: "ship",
    taskId: TASK,
  });
  assert.equal(recorded.status, "refused");
  assert.match(recorded.diagnostic ?? "", /unreadable record/);
  // The forgery signal is preserved, not laundered by the next legitimate append.
  assert.equal(ports.files.get(path), tampered);
  assert.equal(service.readRunEvidence(TASK).unreadableRecords, 1);
});

test("an artifact-backed receipt is distinguished from an invocation-only one", () => {
  const ports = makePorts();
  const service = new ResolverService(ports);
  seedArtifact(ports, "_local/WF-490/01_spec.md", "# spec\n");
  service.recordRunEvidence({
    kind: "phase-receipt",
    subject: "spec",
    taskId: TASK,
    artifactPath: "_local/WF-490/01_spec.md",
  });
  service.recordRunEvidence({ kind: "phase-receipt", subject: "ship", taskId: TASK });

  const read = service.readRunEvidence(TASK);
  const bySubject = new Map(read.matched.map((m) => [m.subject, m.evidenceClass]));
  // The resolver observed an artifact for one and nothing for the other; saying so
  // is what stops a consumer treating the weaker claim as the stronger one.
  assert.equal(bySubject.get("spec"), "artifact-backed");
  assert.equal(bySubject.get("ship"), "invocation-only");
});

test("the ledger append is bounded rather than unbounded", () => {
  const ports = makePorts();
  const service = new ResolverService(ports);
  for (let i = 0; i < MAX_RUN_EVIDENCE_RECORDS; i += 1) {
    assert.equal(
      service.recordRunEvidence({ kind: "gate-approval", subject: `g${i}`, taskId: TASK }).status,
      "recorded",
    );
  }
  const overflow = service.recordRunEvidence({
    kind: "gate-approval",
    subject: "one-too-many",
    taskId: TASK,
  });
  assert.equal(overflow.status, "refused");
  assert.match(overflow.diagnostic ?? "", /the bound is/);
});

test("a forged record beside a genuine one loses, and the genuine one survives", () => {
  const ports = makePorts();
  const service = new ResolverService(ports);
  seedArtifact(ports, "_local/WF-490/01_spec.md", "# spec\n");
  service.recordRunEvidence({
    kind: "phase-receipt",
    subject: "spec",
    taskId: TASK,
    artifactPath: "_local/WF-490/01_spec.md",
  });

  const path = normalizeSlashes(`${WS}/${ledgerPathFor(service)}`);
  const ledger = JSON.parse(ports.files.get(path)!);
  ledger.records.push({
    kind: "phase-receipt",
    subject: "ship",
    taskId: TASK,
    runId: ledger.runId,
    workspaceRoot: WS,
    issuedAt: "2026-08-28T00:00:00.000Z",
    sequence: 1,
    artifact: null,
    seal: "a".repeat(64),
  });
  ports.files.set(path, `${JSON.stringify(ledger, null, 2)}\n`);

  const read = service.readRunEvidence(TASK);
  // The whole point of per-record tolerance: one forged line must not erase the
  // genuine receipts beside it, which is what an attacker would want.
  assert.deepEqual(read.provenPhases, ["spec"]);
  assert.equal(read.unmatched.length, 1);
  assert.equal(read.unmatched[0].subject, "ship");
});

// ---------------------------------------------------------------------------
// 3. Version refusal
// ---------------------------------------------------------------------------

test("an unrecognised ledger version makes the reader refuse, not improvise", () => {
  const ports = makePorts();
  const service = new ResolverService(ports);
  const runId = service.readRunEvidence(TASK).runId;
  // Derived from the constant, never a literal: a hardcoded "unrecognised"
  // version silently becomes the SUPPORTED one the next time the format is
  // bumped, and this test would then assert the opposite of its own name.
  const unrecognised = RUN_EVIDENCE_FORMAT_VERSION + 1;
  ports.files.set(
    normalizeSlashes(`${WS}/${runEvidenceDestination(runId)}`),
    JSON.stringify({ formatVersion: unrecognised, runId, records: [] }),
  );

  const read = service.readRunEvidence(TASK);
  assert.equal(read.status, "unsupported");
  assert.equal(read.observedVersion, unrecognised);
  assert.match(read.diagnostic ?? "", new RegExp(`understands only ${RUN_EVIDENCE_FORMAT_VERSION}`));
  assert.deepEqual(read.provenPhases, []);
});

test("a ledger declaring no version is never assumed to be the current one", () => {
  const ports = makePorts();
  const service = new ResolverService(ports);
  const runId = service.readRunEvidence(TASK).runId;
  ports.files.set(
    normalizeSlashes(`${WS}/${runEvidenceDestination(runId)}`),
    JSON.stringify({ runId, records: [] }),
  );

  const read = service.readRunEvidence(TASK);
  assert.equal(read.status, "unsupported");
  assert.equal(read.observedVersion, null);
  assert.deepEqual(read.provenPhases, []);
});

test("the write side refuses an unreadable ledger rather than clobbering it", () => {
  const ports = makePorts();
  const service = new ResolverService(ports);
  const runId = service.readRunEvidence(TASK).runId;
  const path = normalizeSlashes(`${WS}/${runEvidenceDestination(runId)}`);
  const original = JSON.stringify({
    formatVersion: RUN_EVIDENCE_FORMAT_VERSION + 1,
    runId,
    records: [],
  });
  ports.files.set(path, original);

  const recorded = service.recordRunEvidence({
    kind: "phase-receipt",
    subject: "spec",
    taskId: TASK,
  });
  assert.equal(recorded.status, "refused");
  assert.equal(ports.files.get(path), original, "the unreadable ledger is left untouched");
});

test("parseRunEvidenceLedger reports absence separately from every failure", () => {
  assert.equal(parseRunEvidenceLedger(null).status, "absent");
  assert.equal(parseRunEvidenceLedger("{").status, "malformed");
  assert.equal(parseRunEvidenceLedger("[]").status, "malformed");
});

// ---------------------------------------------------------------------------
// 4. Non-completion
// ---------------------------------------------------------------------------

test("a phase that never completes leaves no receipt", () => {
  const service = new ResolverService(makePorts());
  const read = service.readRunEvidence(TASK);
  assert.equal(read.status, "absent");
  assert.equal(read.matched.length, 0);
  assert.deepEqual(read.provenPhases, []);
  // Absence is reported as absence — never as an error and never as a receipt.
  assert.equal(read.diagnostic, null);
});

test("a phase naming an artifact it did not write is refused, not issued a receipt", () => {
  const ports = makePorts();
  const service = new ResolverService(ports);
  const recorded = service.recordRunEvidence({
    kind: "phase-receipt",
    subject: "verify-spec",
    taskId: TASK,
    artifactPath: "_local/WF-490/04_verify.md",
  });
  assert.equal(recorded.status, "refused");
  assert.match(recorded.diagnostic ?? "", /does not exist/);
  assert.equal(service.readRunEvidence(TASK).status, "absent");
});

test("a receipt never names an artifact outside the workspace", () => {
  const service = new ResolverService(makePorts());
  for (const bad of ["/etc/passwd", "../outside.md", "_local/../../x.md"]) {
    const recorded = service.recordRunEvidence({
      kind: "phase-receipt",
      subject: "spec",
      taskId: TASK,
      artifactPath: bad,
    });
    assert.equal(recorded.status, "refused", `${bad} must be refused`);
  }
});

// ---------------------------------------------------------------------------
// 4b. Non-blocking is a property of the mechanism, not of the prose
// ---------------------------------------------------------------------------
//
// Every call site promises that a failure is reported in one line and never
// becomes a stop, a gate, or an error terminal. That promise is only real if the
// service REFUSES on an I/O failure instead of throwing into a phase whose actual
// work already succeeded — a read-only filesystem or a full disk must not turn a
// completed phase into a failed one.

test("a failing write is a stated refusal, never a throw", () => {
  const ports = makePorts();
  ports.writeFile = () => {
    throw new Error("EROFS: read-only file system");
  };
  const service = new ResolverService(ports);

  // The issuer binding is the first thing a cold run writes, so this exercises the
  // earliest write on the path; the point is that it REFUSES with a stated reason.
  const recorded = service.recordRunEvidence({
    kind: "phase-receipt",
    subject: "ship",
    taskId: TASK,
  });
  assert.equal(recorded.status, "refused");
  assert.ok((recorded.diagnostic ?? "").length > 0, "the refusal states a reason");
});

test("a failing ledger write, with the issuer already established, also refuses", () => {
  const ports = makePorts();
  const service = new ResolverService(ports);
  // Establish the issuer binding through a successful record first.
  assert.equal(
    service.recordRunEvidence({ kind: "phase-receipt", subject: "spec", taskId: TASK }).status,
    "recorded",
  );
  ports.writeFile = () => {
    // A real Node fs error: the message carries the absolute path it failed on.
    const err = new Error(
      "ENOSPC: no space left on device, open '/home/someone/proj/.wf/run-evidence/x.json'",
    ) as NodeJS.ErrnoException;
    err.code = "ENOSPC";
    throw err;
  };
  const recorded = service.recordRunEvidence({
    kind: "phase-receipt",
    subject: "ship",
    taskId: TASK,
  });
  assert.equal(recorded.status, "refused");
  // The FAILURE CLASS travels so the refusal is triageable...
  assert.match(recorded.diagnostic ?? "", /ENOSPC/);
  // ...and the path does NOT. This diagnostic reaches a user-visible terminal
  // block, and the same sanitizer guards the issuer binding's own write, whose
  // path is the location of the key the whole forgery boundary rests on.
  assert.equal(
    (recorded.diagnostic ?? "").includes("/home/someone/proj"),
    false,
    "a write failure must not disclose the host path it failed on",
  );
});

test("a failing read is treated as absence, never a throw", () => {
  const ports = makePorts();
  ports.readFile = () => {
    throw new Error("EIO");
  };
  const service = new ResolverService(ports);

  // An unreadable ledger proves nothing, which is the same answer as a missing
  // one — and neither is a reason to fail the phase.
  const read = service.readRunEvidence(TASK);
  assert.equal(read.status, "absent");
  assert.deepEqual(read.provenPhases, []);
});

// ---------------------------------------------------------------------------
// 5. The closed receipt-bearing set
// ---------------------------------------------------------------------------

test("the receipt-bearing set is exactly the charter's seven", () => {
  assert.deepEqual(
    [...RECEIPT_BEARING_PHASES],
    ["spec", "plan", "implement", "verify-spec", "qa-gen", "ship", "tf"],
  );
});

test("every one of the seven can issue a receipt", () => {
  const ports = makePorts();
  const service = new ResolverService(ports);
  for (const phase of RECEIPT_BEARING_PHASES) {
    const recorded = service.recordRunEvidence({
      kind: "phase-receipt",
      subject: phase,
      taskId: TASK,
    });
    assert.equal(recorded.status, "recorded", `${phase} must be able to issue a receipt`);
  }
  assert.deepEqual(service.readRunEvidence(TASK).provenPhases, [...RECEIPT_BEARING_PHASES]);
});

test("a subject outside the closed set is refused at the issuing boundary", () => {
  const service = new ResolverService(makePorts());
  // `tasks` is the charter's named escalation case; the rest are the pipeline
  // driver's differently-defined "gated phase" list, which is NOT this set.
  for (const outside of ["tasks", "lite", "triage", "verify-fix", "qa-followup", "qa-auto"]) {
    const recorded = service.recordRunEvidence({
      kind: "phase-receipt",
      subject: outside,
      taskId: TASK,
    });
    assert.equal(recorded.status, "refused", `${outside} is not receipt-bearing`);
    assert.match(recorded.diagnostic ?? "", /set is closed/);
  }
  assert.equal(service.readRunEvidence(TASK).status, "absent");
});

test("an unknown kind is refused, and the reserved gate-approval kind is admitted", () => {
  const service = new ResolverService(makePorts());
  assert.equal(
    service.recordRunEvidence({ kind: "invented", subject: "spec", taskId: TASK }).status,
    "refused",
  );
  // The self-approval records travel this same emission path; a gate is not a
  // phase, so its subject is not constrained to the receipt-bearing set.
  assert.equal(
    service.recordRunEvidence({ kind: "gate-approval", subject: "implement", taskId: TASK })
      .status,
    "recorded",
  );
});

test("a gate approval is not a phase receipt and proves no phase", () => {
  const service = new ResolverService(makePorts());
  service.recordRunEvidence({ kind: "gate-approval", subject: "implement", taskId: TASK });
  const read = service.readRunEvidence(TASK);
  assert.equal(read.matched.length, 1);
  assert.deepEqual(read.provenPhases, [], "a gate approval never counts as a phase receipt");
});

// ---------------------------------------------------------------------------
// 6. The declared artifact class
// ---------------------------------------------------------------------------

test("the declared class admits only its own well-formed destinations", () => {
  const runId = "a".repeat(32);
  assert.equal(isDeclaredRunEvidenceArtifact(runEvidenceDestination(runId)), true);

  for (const outside of [
    ".wf/run-evidence",
    ".wf/run-evidence/",
    ".wf/run-evidence/nested/a.json",
    ".wf/run-evidence/not-a-run-id.json",
    `.wf/run-evidence/${runId}.txt`,
    ".wf/install-state.json",
    ".wf/slots/ship.review.md",
    ".wf/anything.json",
  ]) {
    assert.equal(
      isDeclaredRunEvidenceArtifact(outside),
      false,
      `${outside} is outside the declared class`,
    );
  }
});

test("authority never comes from the .wf/ prefix", () => {
  // The prefix is present in every one of these and admits none of them.
  assert.equal(isDeclaredRunEvidenceArtifact(".wf/run-evidence/../install-state.json"), false);
  assert.equal(isDeclaredRunEvidenceArtifact("run-evidence/" + "a".repeat(32) + ".json"), false);
});

// ---------------------------------------------------------------------------
// Canonicalization — the seal's foundation
// ---------------------------------------------------------------------------

test("the canonical body is stable under object key order", () => {
  const a = {
    kind: "phase-receipt" as const,
    subject: "spec",
    taskId: TASK,
    runId: "b".repeat(32),
    workspaceFingerprint: workspaceFingerprint(WS),
    issuedAt: "2026-08-28T00:00:00.000Z",
    sequence: 0,
    artifact: null,
    evidenceClass: "invocation-only" as const,
    runMode: "unestablished" as const,
  };
  const b = {
    runMode: "unestablished" as const,
    evidenceClass: "invocation-only" as const,
    artifact: null,
    sequence: 0,
    issuedAt: "2026-08-28T00:00:00.000Z",
    workspaceFingerprint: workspaceFingerprint(WS),
    runId: "b".repeat(32),
    taskId: TASK,
    subject: "spec",
    kind: "phase-receipt" as const,
  };
  assert.equal(canonicalRunEvidenceBody(a), canonicalRunEvidenceBody(b));
  const key = "c".repeat(64);
  assert.equal(sealRunEvidenceBody(a, key), sealRunEvidenceBody(b, key));
});

test("the workspace binding is a digest, never the host path", () => {
  const fingerprint = workspaceFingerprint(WS);
  assert.match(fingerprint, /^[a-f0-9]{64}$/);
  assert.notEqual(fingerprint, WS);
  // Two workspaces bind differently; the same one binds identically.
  assert.notEqual(fingerprint, workspaceFingerprint("/other"));
  assert.equal(fingerprint, workspaceFingerprint(WS));
});

test("a receipt never persists the absolute host path", () => {
  const ports = makePorts();
  const service = new ResolverService(ports);
  service.recordRunEvidence({ kind: "phase-receipt", subject: "ship", taskId: TASK });
  const written = ports.files.get(normalizeSlashes(`${WS}/${ledgerPathFor(service)}`))!;
  assert.equal(
    written.includes(`"${WS}"`),
    false,
    "the sealed record binds a digest, so no local username or directory layout is written",
  );
});

test("a malformed issuer key seals nothing", () => {
  const body = {
    kind: "phase-receipt" as const,
    subject: "spec",
    taskId: TASK,
    runId: "b".repeat(32),
    workspaceFingerprint: workspaceFingerprint(WS),
    issuedAt: "2026-08-28T00:00:00.000Z",
    sequence: 0,
    artifact: null,
    evidenceClass: "invocation-only" as const,
    runMode: "unestablished" as const,
  };
  assert.equal(sealRunEvidenceBody(body, "short"), null);
  assert.equal(
    matchRunEvidence(
      { formatVersion: RUN_EVIDENCE_FORMAT_VERSION, runId: "b".repeat(32), records: [] },
      "short",
      { runId: "b".repeat(32), taskId: TASK },
    ).length,
    0,
  );
});

// ---------------------------------------------------------------------------
// WF-493 — the per-gate self-approval: separability, staleness, and run mode
//
// Three properties the amended process article needs and WF-490 could not yet
// answer:
//
//   A. SEPARABILITY — a `gate-approval` is a claim about a GATE and a
//      `phase-receipt` is a claim about a PHASE. Neither may satisfy the other's
//      requirement. Asserted from the EMITTING side here; the consuming side
//      asserts its own half.
//   B. STALENESS — an approval "whose approved artifact has since changed" is
//      detected by the resolver re-digesting the artifact at read time, not by a
//      caller saying so.
//   C. RUN MODE — the mode is the resolver's observation, sealed into the record,
//      and an absent or unrecognized signal is `unestablished` rather than a
//      guess in either direction.
// ---------------------------------------------------------------------------

/** Ports whose run-mode signal is whatever the launcher declared to this process. */
function makePortsWithRunMode(
  signal: string | null,
): ResolverServicePorts & { files: Map<string, string> } {
  const ports = makePorts();
  return { ...ports, runModeSignal: () => signal };
}

test("a gate approval is artifact-backed, matchable, and never counted as a phase receipt", () => {
  const ports = makePorts();
  const service = new ResolverService(ports);
  seedArtifact(ports, "_local/WF-490/01_spec.md", "# spec\n");

  const recorded = service.recordRunEvidence({
    kind: "gate-approval",
    subject: "gate:spec",
    taskId: TASK,
    artifactPath: "_local/WF-490/01_spec.md",
  });
  assert.equal(recorded.status, "recorded");
  assert.ok(recorded.artifact, "the resolver digested the gated artifact itself");

  const read = service.readRunEvidence(TASK);
  assert.equal(read.matched.length, 1);
  assert.equal(read.matched[0].kind, "gate-approval");
  assert.equal(read.matched[0].subject, "gate:spec");
  assert.equal(read.matched[0].evidenceClass, "artifact-backed");
  assert.equal(read.matched[0].artifactState, "fresh");
  // The whole point of the separation: a gate approval proves a GATE, never a
  // phase. Counting one as the other would readmit the evidence this mechanism
  // exists to exclude.
  assert.deepEqual(read.provenPhases, []);
});

test("an approval whose artifact has since changed reads stale, and a deleted one reads missing", () => {
  const ports = makePorts();
  const service = new ResolverService(ports);
  const rel = "_local/WF-490/02_plan.md";
  seedArtifact(ports, rel, "# plan\n");
  service.recordRunEvidence({
    kind: "gate-approval",
    subject: "gate:plan",
    taskId: TASK,
    artifactPath: rel,
  });
  assert.equal(service.readRunEvidence(TASK).matched[0].artifactState, "fresh");

  // The artifact changes AFTER the approval was filed. The record itself is
  // untouched and still matches — staleness is a separate fact from forgery, and
  // conflating them would report a legitimate edit as tampering.
  seedArtifact(ports, rel, "# plan, edited after approval\n");
  const afterEdit = service.readRunEvidence(TASK);
  assert.equal(afterEdit.matched.length, 1, "the record still matches; only its artifact moved");
  assert.equal(afterEdit.matched[0].artifactState, "stale");

  ports.files.delete(normalizeSlashes(`${WS}/${rel}`));
  assert.equal(service.readRunEvidence(TASK).matched[0].artifactState, "missing");
});

test("an artifact-less record reports n/a rather than being rounded up to fresh", () => {
  const ports = makePorts();
  const service = new ResolverService(ports);
  service.recordRunEvidence({ kind: "phase-receipt", subject: "ship", taskId: TASK });
  const read = service.readRunEvidence(TASK);
  assert.equal(read.matched[0].evidenceClass, "invocation-only");
  assert.equal(read.matched[0].artifactState, "n/a");
});

test("the run mode is the resolver's observation, sealed into the record", () => {
  const ports = makePortsWithRunMode("unattended");
  const service = new ResolverService(ports);
  seedArtifact(ports, "_local/WF-490/01_spec.md", "# spec\n");

  const recorded = service.recordRunEvidence({
    kind: "gate-approval",
    subject: "gate:spec",
    taskId: TASK,
    artifactPath: "_local/WF-490/01_spec.md",
  });
  assert.equal(recorded.runMode, "unattended");
  assert.equal(service.readRunEvidence(TASK).matched[0].runMode, "unattended");

  // Sealed, not merely reported: editing the mode on disk invalidates the seal,
  // so a record cannot be re-labelled `unattended` after the fact.
  const path = normalizeSlashes(`${WS}/${ledgerPathFor(service)}`);
  const ledger = JSON.parse(ports.files.get(path)!);
  ledger.records[0].runMode = "attended";
  ports.files.set(path, JSON.stringify(ledger));

  const tampered = service.readRunEvidence(TASK);
  assert.equal(tampered.matched.length, 0);
  assert.equal(tampered.unmatched[0].reason, "seal-mismatch");
});

test("an absent or unrecognized run-mode signal is unestablished, never a guess", () => {
  for (const signal of [null, "", "   ", "yes", "true", "UNATTENDED-ish"]) {
    const ports = makePortsWithRunMode(signal);
    const service = new ResolverService(ports);
    const recorded = service.recordRunEvidence({
      kind: "gate-approval",
      subject: "gate:spec",
      taskId: TASK,
    });
    assert.equal(
      recorded.runMode,
      "unestablished",
      `signal ${JSON.stringify(signal)} must not be read as a mode`,
    );
  }

  // A port set that omits the signal entirely behaves exactly like an absent
  // signal — the optional port never changes the answer's direction.
  const bare = new ResolverService(makePorts());
  assert.equal(
    bare.recordRunEvidence({ kind: "gate-approval", subject: "gate:spec", taskId: TASK }).runMode,
    "unestablished",
  );
});

test("the declared mode is honoured case- and whitespace-insensitively, and only for the closed set", () => {
  const service = new ResolverService(makePortsWithRunMode("  Unattended \n"));
  assert.equal(
    service.recordRunEvidence({ kind: "gate-approval", subject: "gate:spec", taskId: TASK })
      .runMode,
    "unattended",
  );

  const attended = new ResolverService(makePortsWithRunMode("ATTENDED"));
  assert.equal(
    attended.recordRunEvidence({ kind: "gate-approval", subject: "gate:spec", taskId: TASK })
      .runMode,
    "attended",
  );
});

test("classifyArtifactState is total over the four outcomes", () => {
  const artifact = { path: "a.md", sha256: "a".repeat(64), bytes: 1 };
  assert.equal(classifyArtifactState(null, null), "n/a");
  assert.equal(classifyArtifactState(null, "a".repeat(64)), "n/a");
  assert.equal(classifyArtifactState(artifact, null), "missing");
  assert.equal(classifyArtifactState(artifact, "not-a-digest"), "missing");
  assert.equal(classifyArtifactState(artifact, "a".repeat(64)), "fresh");
  assert.equal(classifyArtifactState(artifact, "b".repeat(64)), "stale");
});

test("normalizeRunModeSignal never invents a mode", () => {
  assert.equal(normalizeRunModeSignal(null), "unestablished");
  // `undefined` is deliberately NOT asserted: the signature is `string | null`,
  // matching the port contract, so an `undefined` case would test a value no
  // caller can produce and would only pin down a widening nobody wants.
  assert.equal(normalizeRunModeSignal("unattended"), "unattended");
  assert.equal(normalizeRunModeSignal("attended"), "attended");
  assert.equal(normalizeRunModeSignal("1"), "unestablished");
  assert.equal(normalizeRunModeSignal("unattended run"), "unestablished");
});

// ---------------------------------------------------------------------------
// The artifact observation — one path, byte-exact, contained, memoized
// ---------------------------------------------------------------------------

test("the artifact digest is taken over raw bytes, so byte-distinct files never collide", () => {
  // Two DIFFERENT byte sequences that both decode to the same replacement
  // character under UTF-8. A text digest cannot tell them apart; a byte digest
  // must. This is the property that keeps an approval bound to one exact file.
  const ports = makePorts();
  const bytes = new Map<string, Uint8Array>();
  const bytePorts: ResolverServicePorts & { files: Map<string, string> } = {
    ...ports,
    readFileBytes: (p) => bytes.get(normalizeSlashes(p)) ?? null,
    canonicalizeRoot: (root) => normalizeSlashes(root),
  };
  const rel = "_local/WF-490/01_spec.md";
  const abs = normalizeSlashes(`${WS}/${rel}`);

  bytes.set(abs, Uint8Array.from([0xff, 0xfe]));
  ports.files.set(abs, "placeholder");
  const first = new ResolverService(bytePorts).recordRunEvidence({
    kind: "gate-approval",
    subject: "gate:spec",
    taskId: TASK,
    artifactPath: rel,
  });

  bytes.set(abs, Uint8Array.from([0xfe, 0xff]));
  const secondPorts: ResolverServicePorts & { files: Map<string, string> } = {
    ...makePorts(),
    readFileBytes: (p) => bytes.get(normalizeSlashes(p)) ?? null,
    canonicalizeRoot: (root) => normalizeSlashes(root),
  };
  secondPorts.files.set(abs, "placeholder");
  const second = new ResolverService(secondPorts).recordRunEvidence({
    kind: "gate-approval",
    subject: "gate:spec",
    taskId: TASK,
    artifactPath: rel,
  });

  assert.equal(first.status, "recorded");
  assert.equal(second.status, "recorded");
  assert.notEqual(
    first.artifact!.sha256,
    second.artifact!.sha256,
    "a UTF-8 decode would collapse both to U+FFFD and make these equal",
  );
  assert.equal(first.artifact!.bytes, 2, "the byte count is the file's, not a re-encoded length");
});

test("an artifact resolving outside the workspace is refused, never followed", () => {
  const ports = makePorts();
  // Lexically contained, but canonicalization lands outside the root — the
  // symlink shape. `containedRelPath` alone would admit it.
  const escaping: ResolverServicePorts & { files: Map<string, string> } = {
    ...ports,
    canonicalizeRoot: (root) =>
      normalizeSlashes(root).endsWith("01_spec.md") ? "/elsewhere/01_spec.md" : normalizeSlashes(root),
  };
  seedArtifact(ports, "_local/WF-490/01_spec.md", "# spec\n");

  const recorded = new ResolverService(escaping).recordRunEvidence({
    kind: "gate-approval",
    subject: "gate:spec",
    taskId: TASK,
    artifactPath: "_local/WF-490/01_spec.md",
  });
  assert.equal(recorded.status, "refused");
  assert.match(recorded.diagnostic ?? "", /does not resolve inside the workspace/);
});

test("repeated records naming one artifact are observed once per read, with no change in verdict", () => {
  const ports = makePorts();
  let reads = 0;
  const counting: ResolverServicePorts & { files: Map<string, string> } = {
    ...ports,
    readFileBytes: (p) => {
      const text = ports.files.get(normalizeSlashes(p));
      if (text === undefined) return null;
      reads += 1;
      return Buffer.from(text, "utf8");
    },
  };
  const service = new ResolverService(counting);
  seedArtifact(ports, "_local/WF-490/01_spec.md", "# spec\n");

  for (const subject of ["gate:spec", "gate:plan", "gate:implement"]) {
    service.recordRunEvidence({
      kind: "gate-approval",
      subject,
      taskId: TASK,
      artifactPath: "_local/WF-490/01_spec.md",
    });
  }

  reads = 0;
  const read = service.readRunEvidence(TASK);
  assert.equal(read.matched.length, 3);
  for (const entry of read.matched) assert.equal(entry.artifactState, "fresh");
  assert.equal(reads, 1, "three records naming one artifact cost one observation, not three");
});

test("the reading session's observed mode is reported separately from each record's sealed mode", () => {
  const issuing = new ResolverService(makePortsWithRunMode("unattended"));
  const ports = makePorts();
  seedArtifact(ports, "_local/WF-490/01_spec.md", "# spec\n");
  // Issue under `unattended`, then read from a session declaring nothing. The
  // sealed mode is a fact about the record; the observed mode is a fact about
  // the reader, and neither is corrected against the other.
  const issuingPorts = { ...ports, runModeSignal: () => "unattended" };
  const issuer = new ResolverService(issuingPorts);
  issuer.recordRunEvidence({
    kind: "gate-approval",
    subject: "gate:spec",
    taskId: TASK,
    artifactPath: "_local/WF-490/01_spec.md",
  });
  void issuing;

  const reader = new ResolverService({ ...issuingPorts, runModeSignal: () => null });
  const read = reader.readRunEvidence(TASK);
  assert.equal(read.observedRunMode, "unestablished");
  assert.equal(read.matched[0].runMode, "unattended");
});
