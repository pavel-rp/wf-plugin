// Recovery-before-planning, and the identity that must NOT move (WF-452).
//
// The retrofit's success criterion is that NOTHING OBSERVABLE MOVES, so this
// suite is organised around proving two different things:
//
//   * the GUARD — planning acquires and releases the shared lock, creates no
//     journal and no backup, recovers before it reads any lifecycle state, and
//     refuses to produce a plan or an applicability claim when recovery did not
//     proceed. Asserted over the REAL filesystem wiring, because byte-inertness,
//     "planning never creates a journal", and concurrent-entry refusal are
//     properties of the wiring, not of the pure join.
//
//   * the NON-EFFECT — for identical recovered facts the plan schema, actions,
//     ordering, and `planId` are byte-for-byte what they were before recovery
//     was integrated. Asserted over the PURE JOIN (where the facts can be made
//     rich and held exactly constant) and again end-to-end.
//
// The five completed planner paths — registration, answer, payload-safety,
// artifact-evidence, and the complete repair-capable planner — are covered by
// ONE fixture driven twice: once proving all five fire, once proving the halt
// suppresses all five. Testing them separately would let a path silently stop
// contributing and still pass its own assertion.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDefaultPorts } from "../src/ports.js";
import {
  LIFECYCLE_BACKUP_DIR,
  LIFECYCLE_JOURNAL_PATH,
  LIFECYCLE_LOCK_PATH,
  createJournalEntry,
  createTransactionJournal,
} from "../src/resolver/lifecycle-journal.js";
import { noRecoveryReport } from "../src/resolver/lifecycle-recovery.js";
import { normalizeSlashes } from "../src/resolver/paths.js";
import { PLAN_IDENTITY_FACT_CLASSES } from "../src/resolver/plan-complete.js";
import {
  planInstall,
  type PlanCapabilityInput,
  type PlanInstallInput,
} from "../src/resolver/plan-install.js";
import type { PlanArtifactFactInput } from "../src/resolver/plan-install.js";
import type { PlanPayloadFact } from "../src/resolver/payload-plan.js";
import { ResolverService } from "../src/service.js";
import {
  PLAN_ENVELOPE_VERSION,
  type DiscoveredPack,
  type DiscoveryInventory,
  type JournalEntry,
  type MachineBindingEvidence,
  type PlanAdmissionState,
  type PlanInstallResponse,
  type PortablePackEvidence,
  type QuestionRecord,
  type RecoveryReport,
} from "../src/resolver/types.js";

// ---------------------------------------------------------------------------
// real-filesystem harness (shared shape with the WF-451 discovery suite)
// ---------------------------------------------------------------------------

const CONFIG = `# Config

## Task Folders

| Key | Value |
|-----|-------|
| **Task Root** | \`_local\` |

## Capabilities

| Capability | Path |
|---|---|
`;

function sha256(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** The resolver's OWN gitignored snapshot cache — excluded from byte-inertness
 *  evidence for exactly the reason WF-446 states: refreshing it is the shared
 *  read-query machinery every typed resolver query already runs. */
const RESOLVER_CACHE_PREFIX = "_local/resolver";

function withoutResolverCache(rows: string[]): string[] {
  return rows.filter((row) => !row.slice(2).startsWith(RESOLVER_CACHE_PREFIX));
}

/** Recursive name + kind + content listing: a run is byte-inert iff this is
 *  deep-equal before and after. */
function treeSnapshot(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const item of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const full = join(dir, item.name);
    const rel = prefix === "" ? item.name : `${prefix}/${item.name}`;
    if (item.isSymbolicLink()) {
      out.push(`l ${rel}`);
    } else if (item.isDirectory()) {
      out.push(`d ${rel}`);
      out.push(...treeSnapshot(full, rel));
    } else {
      out.push(`f ${rel} ${sha256(readFileSync(full))}`);
    }
  }
  return out;
}

function existsPath(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

function makeWorkspace(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "wf-plan-recovery-")));
  mkdirSync(join(dir, "_local"), { recursive: true });
  writeFileSync(join(dir, "_local", "config.md"), CONFIG);
  return dir;
}

function writeJournal(root: string, entries: JournalEntry[]): void {
  const journal = createTransactionJournal({
    transactionId: "t1",
    startedAt: "2026-08-21T00:00:00.000Z",
    entries,
  });
  assert.ok(journal !== null);
  mkdirSync(join(root, "_local"), { recursive: true });
  writeFileSync(join(root, LIFECYCLE_JOURNAL_PATH), JSON.stringify(journal));
}

function entryFor(over: Record<string, unknown>): JournalEntry {
  const built = createJournalEntry(over as Parameters<typeof createJournalEntry>[0]);
  assert.ok(built !== null, `entry fixture must be constructible: ${JSON.stringify(over)}`);
  return built;
}

function service(root: string): ResolverService {
  return new ResolverService(createDefaultPorts(normalizeSlashes(root), "/core/plugins/wf"));
}

function admittedAt(root: string): PlanAdmissionState {
  return {
    admitted: true,
    root: normalizeSlashes(root),
    source: "explicit",
    reason: null,
    diagnostic: null,
  };
}

const NO_SELECTION = { desired: [], deregister: [], answers: [] };

/** The plan with its recovery envelope stripped. The criterion is "byte-for-byte
 *  unchanged APART FROM the separate recovery envelope", so this is the exact
 *  comparison surface that claim names. */
function planWithoutRecovery(out: PlanInstallResponse): Omit<PlanInstallResponse, "recovery"> {
  const { recovery: _ignored, ...rest } = out;
  return rest;
}

// ---------------------------------------------------------------------------
// SC-1 / SC-5 / the journal-free property — the guard, over the real wiring
// ---------------------------------------------------------------------------

test("with no journal, planning acquires and releases the lock and is BYTE-INERT", () => {
  const root = makeWorkspace();
  try {
    const before = treeSnapshot(root);
    const out = service(root).planInstall(admittedAt(root), NO_SELECTION);

    assert.equal(out.recovery.state, "no-journal");
    assert.equal(out.recovery.proceeded, true);
    assert.equal(out.recovery.wroteBytes, false);
    assert.equal(out.byteInert, true);
    assert.equal(out.planVersion, PLAN_ENVELOPE_VERSION);

    // The lock is transient: held during the run, gone at exit, so the tree is
    // byte-identical. That is exactly what byte-inertness means here.
    assert.equal(existsPath(join(root, LIFECYCLE_LOCK_PATH)), false);
    assert.deepEqual(
      withoutResolverCache(treeSnapshot(root)),
      withoutResolverCache(before),
      "a no-journal planning run must leave the tree byte-identical",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("PLANNING NEVER CREATES A JOURNAL, a backup, or a transaction of its own", () => {
  const root = makeWorkspace();
  try {
    const svc = service(root);
    svc.planInstall(admittedAt(root), NO_SELECTION);
    svc.planInstall(admittedAt(root), NO_SELECTION);
    assert.equal(existsPath(join(root, LIFECYCLE_JOURNAL_PATH)), false);
    assert.equal(existsPath(join(root, LIFECYCLE_BACKUP_DIR)), false);
    assert.equal(existsPath(join(root, LIFECYCLE_LOCK_PATH)), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("concurrent lifecycle entry is REJECTED, with no planning writes and no plan", () => {
  const root = makeWorkspace();
  try {
    // A lock left behind by another holder.
    writeFileSync(join(root, LIFECYCLE_LOCK_PATH), "");
    writeJournal(root, [
      entryFor({
        destination: "x.md",
        priorExistence: "absent",
        priorContentHash: null,
        priorIsSymlink: false,
        backupPath: null,
        lastWritten: null,
      }),
    ]);
    const before = treeSnapshot(root);

    const out = service(root).planInstall(admittedAt(root), {
      desired: ["anything@local"],
      deregister: [],
      answers: [],
    });

    assert.equal(out.recovery.state, "lock-unavailable");
    assert.equal(out.recovery.proceeded, false);
    assert.equal(out.recovery.wroteBytes, false);

    // No plan, and no applicability claim about the selection.
    assert.equal(out.applicability, "unrecovered");
    assert.equal(out.mode, null);
    assert.deepEqual(out.actions, []);
    assert.deepEqual(out.registryDelta.additions, []);
    assert.equal(
      out.inventory.mayEstablishAbsence,
      false,
      "a halted run must never be mistakable for an observation of absence",
    );

    // The other holder's lock is NOT stolen or removed, and nothing was written.
    assert.equal(existsPath(join(root, LIFECYCLE_LOCK_PATH)), true);
    assert.deepEqual(
      withoutResolverCache(treeSnapshot(root)),
      withoutResolverCache(before),
      "a rejected concurrent entry performs no planning writes",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// SC-2 — restore first, report it SEPARATELY, then plan
// ---------------------------------------------------------------------------

test("a compatible journal restores unaffected state and reports it SEPARATELY, before the plan", () => {
  const root = makeWorkspace();
  try {
    const prior = "the bytes that were there before\n";
    const ours = "the bytes the interrupted transaction wrote\n";
    mkdirSync(join(root, LIFECYCLE_BACKUP_DIR, "t1"), { recursive: true });
    writeFileSync(join(root, LIFECYCLE_BACKUP_DIR, "t1", "0"), prior);
    writeFileSync(join(root, "managed.md"), ours);

    writeJournal(root, [
      entryFor({
        destination: "managed.md",
        priorExistence: "present",
        priorContentHash: sha256(prior),
        priorIsSymlink: false,
        backupPath: `${LIFECYCLE_BACKUP_DIR}/t1/0`,
        lastWritten: { contentHash: sha256(ours), bytes: Buffer.byteLength(ours) },
      }),
    ]);

    const out = service(root).planInstall(admittedAt(root), NO_SELECTION);

    assert.equal(out.recovery.state, "recovered");
    assert.equal(out.recovery.proceeded, true);
    assert.equal(out.recovery.wroteBytes, true);
    assert.deepEqual(out.recovery.restored.map((r) => r.destination), ["managed.md"]);
    assert.equal(readFileSync(join(root, "managed.md"), "utf8"), prior);

    // Restoration happened BEFORE planning, and planning proceeded from there.
    assert.notEqual(out.applicability, "unrecovered");
    assert.equal(out.byteInert, true);

    // The recovery write is NOT folded into the plan the maintainer asked for.
    assert.ok(
      !out.findings.some((f) => f.code.startsWith("recovery/")),
      "recovery is reported in its own envelope, never in the plan's findings",
    );
    assert.ok(
      !out.actions.some((a) => a.destination === "managed.md"),
      "a restored destination is not a previewed plan action",
    );

    // The journal and its backup are gone, so the post-recovery baseline is
    // established and the next planning run is byte-inert from THERE.
    assert.equal(existsPath(join(root, LIFECYCLE_JOURNAL_PATH)), false);
    const baseline = withoutResolverCache(treeSnapshot(root));
    const second = service(root).planInstall(admittedAt(root), NO_SELECTION);
    assert.equal(second.recovery.state, "no-journal");
    assert.equal(second.recovery.wroteBytes, false);
    assert.deepEqual(withoutResolverCache(treeSnapshot(root)), baseline);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// SC-3 — an interrupted recovery retries idempotently
// ---------------------------------------------------------------------------

test("re-entering planning after a partial restore converges to the same tree AND the same plan", () => {
  const root = makeWorkspace();
  try {
    const prior = "prior\n";
    const ours = "ours\n";
    mkdirSync(join(root, LIFECYCLE_BACKUP_DIR, "t1"), { recursive: true });
    writeFileSync(join(root, LIFECYCLE_BACKUP_DIR, "t1", "a"), prior);
    writeFileSync(join(root, LIFECYCLE_BACKUP_DIR, "t1", "b"), prior);
    writeFileSync(join(root, "a.md"), ours);
    writeFileSync(join(root, "b.md"), ours);

    const identity = { contentHash: sha256(ours), bytes: Buffer.byteLength(ours) };
    writeJournal(
      root,
      ["a", "b"].map((name) =>
        entryFor({
          destination: `${name}.md`,
          priorExistence: "present",
          priorContentHash: sha256(prior),
          priorIsSymlink: false,
          backupPath: `${LIFECYCLE_BACKUP_DIR}/t1/${name}`,
          lastWritten: identity,
        }),
      ),
    );

    // Simulate an interruption after the first destination was restored: put
    // `a.md` back by hand and leave the journal in place, exactly as a killed
    // process would.
    writeFileSync(join(root, "a.md"), prior);

    const first = service(root).planInstall(admittedAt(root), NO_SELECTION);
    assert.equal(first.recovery.state, "recovered");
    assert.deepEqual(first.recovery.alreadyRestored.map((r) => r.destination), ["a.md"]);
    assert.deepEqual(first.recovery.restored.map((r) => r.destination), ["b.md"]);
    const converged = withoutResolverCache(treeSnapshot(root));

    const second = service(root).planInstall(admittedAt(root), NO_SELECTION);
    assert.equal(second.recovery.state, "no-journal");
    assert.equal(second.recovery.wroteBytes, false);
    assert.deepEqual(withoutResolverCache(treeSnapshot(root)), converged);
    assert.equal(readFileSync(join(root, "a.md"), "utf8"), prior);
    assert.equal(readFileSync(join(root, "b.md"), "utf8"), prior);

    // The retry is idempotent in the PLAN too, not merely in the tree.
    assert.deepEqual(planWithoutRecovery(second), planWithoutRecovery(first));
    assert.equal(second.identity.planId, first.identity.planId);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// SC-4 — unresolved external interference prevents ANY plan or applicability claim
// ---------------------------------------------------------------------------

test("unresolved external interference produces NO plan and NO applicability claim", () => {
  const root = makeWorkspace();
  try {
    const prior = "prior\n";
    const ours = "ours\n";
    const theirs = "someone else's work\n";
    mkdirSync(join(root, LIFECYCLE_BACKUP_DIR, "t1"), { recursive: true });
    writeFileSync(join(root, LIFECYCLE_BACKUP_DIR, "t1", "clean"), prior);
    writeFileSync(join(root, LIFECYCLE_BACKUP_DIR, "t1", "edited"), prior);
    writeFileSync(join(root, "a-clean.md"), ours);
    writeFileSync(join(root, "b-edited.md"), theirs);

    const identity = { contentHash: sha256(ours), bytes: Buffer.byteLength(ours) };
    writeJournal(root, [
      entryFor({
        destination: "a-clean.md",
        priorExistence: "present",
        priorContentHash: sha256(prior),
        priorIsSymlink: false,
        backupPath: `${LIFECYCLE_BACKUP_DIR}/t1/clean`,
        lastWritten: identity,
      }),
      entryFor({
        destination: "b-edited.md",
        priorExistence: "present",
        priorContentHash: sha256(prior),
        priorIsSymlink: false,
        backupPath: `${LIFECYCLE_BACKUP_DIR}/t1/edited`,
        lastWritten: identity,
      }),
    ]);

    const out = service(root).planInstall(admittedAt(root), {
      desired: ["wf-demo@local"],
      deregister: ["wf-other@local"],
      answers: [{ pluginId: "wf-demo@local", questionId: "team", value: "platform" }],
    });

    // The unaffected destination still restored; the unrelated edit is untouched.
    assert.deepEqual(out.recovery.restored.map((r) => r.destination), ["a-clean.md"]);
    assert.equal(readFileSync(join(root, "b-edited.md"), "utf8"), theirs);
    assert.deepEqual(
      out.recovery.preserved.map((r) => `${r.destination}:${r.reason}`),
      ["b-edited.md:external-edit"],
    );
    assert.equal(out.recovery.state, "incomplete");
    assert.equal(out.recovery.proceeded, false);

    // NOT a degraded plan, NOT a plan with a warning — no plan at all.
    assert.equal(out.applicability, "unrecovered");
    assert.equal(out.mode, null);
    assert.deepEqual(out.actions, []);
    assert.deepEqual(out.registryDelta, { additions: [], retentions: [], deregistrations: [] });
    assert.deepEqual(out.answers, { writes: [], unresolved: [] });
    assert.deepEqual(out.evidenceSeeds, []);
    assert.deepEqual(out.repairs, []);
    assert.deepEqual(out.payloads, { actions: [], rejected: [], conflicts: [] });
    assert.deepEqual(out.inventory, {
      confidence: "unavailable",
      mayEstablishAbsence: false,
      observedCount: 0,
      issues: [],
    });

    // The halt is stated precisely, and only once.
    assert.deepEqual(out.findings.map((f) => f.code), ["plan/halted-unrecovered"]);
    assert.equal(out.findings[0].severity, "error");
    assert.equal(out.findings[0].pluginId, null);
    assert.ok(
      out.findings[0].message.includes("incomplete"),
      "the halt names the recovery state that caused it, not a plausible neighbour",
    );
    assert.equal(out.applicabilityBasis.blocked, true);
    assert.deepEqual(out.applicabilityBasis.blockingFindings, out.findings);

    // The journal is retained so a later run converges, and the lock is released.
    assert.equal(existsPath(join(root, LIFECYCLE_JOURNAL_PATH)), true);
    assert.equal(existsPath(join(root, LIFECYCLE_LOCK_PATH)), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an unsupported journal version halts planning without a best-effort plan", () => {
  const root = makeWorkspace();
  try {
    writeFileSync(
      join(root, LIFECYCLE_JOURNAL_PATH),
      JSON.stringify({ journalVersion: 2, transactionId: "t", startedAt: "n", entries: [] }),
    );
    const before = treeSnapshot(root);

    const out = service(root).planInstall(admittedAt(root), NO_SELECTION);
    assert.equal(out.recovery.state, "unsupported");
    assert.equal(out.recovery.journalVersion, 2);
    assert.equal(out.applicability, "unrecovered");
    assert.equal(out.mode, null);
    assert.deepEqual(withoutResolverCache(treeSnapshot(root)), withoutResolverCache(before));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// SC-6 — the identity that must not move, end to end
// ---------------------------------------------------------------------------

test("BYTE-STABILITY, end to end: the BEFORE plan and the AFTER-RECOVERY plan are identical, planId included", () => {
  // ONE workspace, planned twice against the SAME root — the root is itself a
  // mutation-relevant identity fact (`workspace-root`), so two temp directories
  // would differ on `planId` for a legitimate reason and prove nothing.
  //
  //   BEFORE — a settled tree with nothing to recover.
  //   AFTER  — the SAME tree, interrupted mid-transaction, then recovered back
  //            to exactly the BEFORE bytes. Recovery WROTE, and reports it.
  //
  // Identical recovered facts must therefore yield an identical plan and an
  // identical `planId`. If the recovery envelope leaked into a fact class, an
  // action, or the hash, this comparison would fail.
  const root = makeWorkspace();
  try {
    const prior = "settled content\n";
    const ours = "half-written by the interrupted transaction\n";
    writeFileSync(join(root, "managed.md"), prior);

    const before = service(root).planInstall(admittedAt(root), NO_SELECTION);
    assert.equal(before.recovery.state, "no-journal");
    assert.equal(before.recovery.wroteBytes, false);
    const settledTree = withoutResolverCache(treeSnapshot(root));

    // Interrupt: our half-written bytes at the destination, the prior bytes in a
    // backup, and a journal describing exactly that.
    mkdirSync(join(root, LIFECYCLE_BACKUP_DIR, "t1"), { recursive: true });
    writeFileSync(join(root, LIFECYCLE_BACKUP_DIR, "t1", "0"), prior);
    writeFileSync(join(root, "managed.md"), ours);
    writeJournal(root, [
      entryFor({
        destination: "managed.md",
        priorExistence: "present",
        priorContentHash: sha256(prior),
        priorIsSymlink: false,
        backupPath: `${LIFECYCLE_BACKUP_DIR}/t1/0`,
        lastWritten: { contentHash: sha256(ours), bytes: Buffer.byteLength(ours) },
      }),
    ]);

    const after = service(root).planInstall(admittedAt(root), NO_SELECTION);

    // The recovery halves genuinely differ — the AFTER run really did write.
    assert.equal(after.recovery.state, "recovered");
    assert.equal(after.recovery.wroteBytes, true);
    assert.equal(after.recovery.transactionId, "t1");
    assert.deepEqual(after.recovery.restored.map((r) => r.destination), ["managed.md"]);

    // The recovered baseline is byte-identical to the settled one. Compared over
    // FILE rows, which is what "byte-for-byte" names.
    //
    // NOTE, and this is a reported WF-451 finding rather than something this item
    // may fix (changing the recovery contracts is explicitly out of scope): the
    // complete-recovery tidy calls `rmdirSync` on the backup ROOT only, so a
    // journal whose backups live in a per-transaction SUBDIRECTORY — the shape
    // WF-451's own fixtures use — leaves that now-empty subdirectory behind, and
    // the non-empty root with it. The residue is empty directories only: no file
    // content differs, the journal and every named backup FILE are gone (asserted
    // below), and re-entry correctly sees `no-journal`.
    const files = (rows: string[]): string[] => rows.filter((row) => row.startsWith("f "));
    assert.deepEqual(
      files(withoutResolverCache(treeSnapshot(root))),
      files(settledTree),
      "recovery restored the workspace to exactly the BEFORE bytes",
    );
    assert.equal(existsPath(join(root, LIFECYCLE_JOURNAL_PATH)), false);
    assert.equal(existsPath(join(root, LIFECYCLE_BACKUP_DIR, "t1", "0")), false);

    // …and so is the plan, hash included.
    assert.deepEqual(
      planWithoutRecovery(after),
      planWithoutRecovery(before),
      "the plan is byte-for-byte unchanged apart from the separate recovery envelope",
    );
    assert.equal(
      after.identity.planId,
      before.identity.planId,
      "identical recovered facts ⇒ an identical planId",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// the pure join — rich facts held exactly constant
// ---------------------------------------------------------------------------

const ADMITTED: PlanAdmissionState = {
  admitted: true,
  root: "/ws",
  source: "explicit",
  reason: null,
  diagnostic: null,
};

const TRUSTWORTHY: DiscoveryInventory = {
  confidence: "trustworthy",
  mayEstablishAbsence: true,
  observedCount: 1,
  issues: [],
};

const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);
const LEDGER_HASH = "c".repeat(64);
const COPY = { production: "copy", refresh: "replace", removal: "delete" } as const;

function portable(over: Partial<PortablePackEvidence> = {}): PortablePackEvidence {
  return {
    pluginId: "wf-demo@local",
    version: "1.0.0",
    capabilities: ["demo"],
    manifestHashes: [{ path: "capabilities/demo/manifest.md", sha256: DIGEST_A }],
    declaredSourceHashes: [],
    ...over,
  };
}

function binding(over: Partial<MachineBindingEvidence> = {}): MachineBindingEvidence {
  return {
    pluginId: "wf-demo@local",
    canonicalRoot: "/ws/packs/wf-demo",
    cliScope: "user",
    enablement: "enabled",
    observedVersion: "1.0.0",
    localFingerprints: [],
    ...over,
  };
}

function question(over: Partial<QuestionRecord> = {}): QuestionRecord {
  return {
    pack: "demo",
    id: "team",
    destination: "team",
    prompt: "Which team owns this project?",
    schema: { type: "string", minLength: 1, maxLength: 64 },
    state: { status: "unresolved", source: null, value: null, suggestions: [] },
    ...over,
  };
}

function pack(over: Partial<DiscoveredPack> = {}): DiscoveredPack {
  return {
    pluginId: "wf-demo@local",
    pluginName: "wf-demo",
    version: "1.0.0",
    scope: "user",
    enablement: "enabled",
    installPath: "/ws/packs/wf-demo",
    state: "active",
    registeredCapabilities: ["demo"],
    diagnostics: null,
    overlay: null,
    presence: "installed",
    evidence: { comparison: "equal", portable: portable(), binding: binding() },
    seedProposal: null,
    questions: [],
    selectable: true,
    ...over,
  };
}

function capability(over: Partial<PlanCapabilityInput> = {}): PlanCapabilityInput {
  return {
    pluginId: "wf-demo@local",
    name: "demo",
    requires: [],
    conflicts: [],
    providerScopes: [],
    ...over,
  };
}

const PAYLOAD_FACT: PlanPayloadFact = {
  pluginId: "wf-drifted@local",
  capability: "drifted",
  source: "payloads/thing.md",
  destination: ".wf/thing.md",
  semantics: { ...COPY },
  target: { ok: true, canonicalTarget: "/ws/.wf/thing.md", exists: false },
  identity: { ok: true, sha256: DIGEST_B, bytes: 12 },
  current: { ok: false, status: "missing" },
  recordedContentHash: null,
};

const ARTIFACT_FACT: PlanArtifactFactInput = {
  destination: ".wf/managed.md",
  target: { ok: true, canonicalTarget: "/ws/.wf/managed.md", exists: true },
  recorded: {
    destination: ".wf/managed.md",
    owners: [{ pluginId: "wf-drifted@local", capability: "drifted", source: "payloads/managed.md" }],
    declaredSourceFingerprint: DIGEST_A,
    producedContentHash: LEDGER_HASH,
    ...COPY,
  },
  current: { ok: true, sha256: LEDGER_HASH, bytes: 10 },
  declared: null,
};

/**
 * ONE fixture exercising ALL FIVE completed planner paths at once:
 *
 *   registration      — `wf-drifted@local` is selected and unregistered ⇒ addition
 *                        (and `wf-demo@local` is retained by omission)
 *   answer            — the acted-on pack declares an unanswered question
 *   payload-safety    — the acted-on pack declares a payload row
 *   artifact-evidence — a ledger-recorded managed artifact is in scope
 *   complete/repair   — `portable-mismatch` evidence makes the plan repair-capable
 */
function fivePathInput(recovery: RecoveryReport): PlanInstallInput {
  return {
    admission: ADMITTED,
    inventory: TRUSTWORTHY,
    packs: [
      pack(),
      pack({
        pluginId: "wf-drifted@local",
        pluginName: "wf-drifted",
        installPath: "/ws/packs/wf-drifted",
        state: "installed/inactive",
        registeredCapabilities: [],
        overlay: "pack/stale(source-changed)",
        evidence: {
          comparison: "portable-mismatch",
          portable: portable({ pluginId: "wf-drifted@local" }),
          binding: binding({ pluginId: "wf-drifted@local" }),
        },
        questions: [question({ pack: "drifted" })],
      }),
    ],
    capabilities: [capability(), capability({ pluginId: "wf-drifted@local", name: "drifted" })],
    selection: { desired: ["wf-drifted@local"], deregister: [], answers: [] },
    payloads: [PAYLOAD_FACT],
    artifacts: [ARTIFACT_FACT],
    recovery,
  };
}

const HALTED: RecoveryReport = {
  state: "incomplete",
  proceeded: false,
  wroteBytes: false,
  journalVersion: 1,
  transactionId: "t1",
  restored: [],
  alreadyRestored: [],
  preserved: [
    {
      destination: "managed.md",
      disposition: "preserved",
      reason: "external-edit",
      detail: "edited after the interrupted transaction wrote it.",
    },
  ],
  unresolved: [],
  diagnostics: [],
};

/** A recovery that DID proceed and DID write bytes. Used to prove the envelope
 *  never reaches the identity. */
const RECOVERED_WITH_WRITES: RecoveryReport = {
  state: "recovered",
  proceeded: true,
  wroteBytes: true,
  journalVersion: 1,
  transactionId: "t9",
  restored: [
    {
      destination: "managed.md",
      disposition: "restored",
      reason: "restored-content",
      detail: "prior bytes restored.",
    },
  ],
  alreadyRestored: [],
  preserved: [],
  unresolved: [],
  diagnostics: [],
};

test("ALL FIVE completed planner paths fire on a proceeded recovery — the fixture is load-bearing", () => {
  const out = planInstall(fivePathInput(noRecoveryReport()));

  // registration
  assert.deepEqual(out.registryDelta.additions.map((e) => e.pluginId), ["wf-drifted@local"]);
  assert.deepEqual(out.registryDelta.retentions.map((e) => e.pluginId), ["wf-demo@local"]);
  // answer
  assert.deepEqual(out.answers.unresolved.map((q) => q.questionId), ["team"]);
  // payload-safety
  assert.equal(out.payloads.actions.length, 1);
  // artifact-evidence
  assert.equal(out.artifacts.retained.length + out.artifacts.deletable.length, 1);
  // complete, repair-capable
  assert.deepEqual(out.repairs.map((r) => r.pluginId), ["wf-drifted@local"]);
  assert.equal(out.mode, "repair");
  assert.ok(out.actions.length > 0);
});

test("a halt suppresses ALL FIVE planner paths — no plan, no applicability claim", () => {
  const out = planInstall(fivePathInput(HALTED));

  assert.equal(out.applicability, "unrecovered");
  assert.equal(out.mode, null);
  // registration
  assert.deepEqual(out.registryDelta, { additions: [], retentions: [], deregistrations: [] });
  // answer
  assert.deepEqual(out.answers, { writes: [], unresolved: [] });
  // payload-safety
  assert.deepEqual(out.payloads, { actions: [], rejected: [], conflicts: [] });
  // artifact-evidence
  assert.deepEqual(out.artifacts, {
    deletable: [],
    bootstrap: [],
    advance: [],
    retained: [],
  });
  // complete, repair-capable
  assert.deepEqual(out.repairs, []);
  assert.deepEqual(out.evidenceSeeds, []);
  assert.deepEqual(out.actions, []);

  // The halt is the ONLY finding: no path contributed a diagnosis derived from
  // state that was never read.
  assert.deepEqual(out.findings.map((f) => f.code), ["plan/halted-unrecovered"]);
  assert.equal(out.byteInert, true);
  assert.equal(out.planVersion, PLAN_ENVELOPE_VERSION);
  assert.equal(out.workspaceRoot, "/ws");
  // The envelope still carries a real identity, so a reviewer never special-cases
  // a missing authority value.
  assert.equal(out.identity.algorithm, "sha256");
  assert.equal(out.identity.planId.length, 64);
  assert.deepEqual(out.identity.coveredFactClasses, [...PLAN_IDENTITY_FACT_CLASSES]);
  // …and it is echoed verbatim, never rewritten.
  assert.deepEqual(out.recovery, HALTED);
});

test("BYTE-STABILITY over rich facts: differing recovery envelopes do not move the plan or the planId", () => {
  const reports: RecoveryReport[] = [
    noRecoveryReport(),
    RECOVERED_WITH_WRITES,
    { ...RECOVERED_WITH_WRITES, transactionId: "t-different", journalVersion: 1 },
  ];
  const plans = reports.map((recovery) => planInstall(fivePathInput(recovery)));

  for (const plan of plans.slice(1)) {
    assert.deepEqual(
      planWithoutRecovery(plan),
      planWithoutRecovery(plans[0]),
      "plan schema, actions, and ordering are unchanged by the recovery envelope",
    );
    assert.equal(
      plan.identity.planId,
      plans[0].identity.planId,
      "identical recovered facts ⇒ an identical planId",
    );
    assert.equal(plan.identity.factCount, plans[0].identity.factCount);
  }

  // Each plan still reports ITS OWN recovery, verbatim.
  for (const [i, plan] of plans.entries()) assert.deepEqual(plan.recovery, reports[i]);
});

test("the recovery envelope is NOT a plan-identity fact class — coverage is still WF-450's closed sixteen", () => {
  assert.equal(PLAN_IDENTITY_FACT_CLASSES.length, 16);
  assert.deepEqual([...PLAN_IDENTITY_FACT_CLASSES], [
    "envelope-version",
    "workspace-root",
    "mode",
    "applicability",
    "inventory-trust",
    "registry-delta",
    "answer-write",
    "answer-unresolved",
    "evidence-seed",
    "evidence-repair",
    "payload-action",
    "payload-rejection",
    "payload-conflict",
    "artifact-decision",
    "action",
    "finding",
  ]);
  assert.ok(
    !PLAN_IDENTITY_FACT_CLASSES.some((factClass) => factClass.includes("recovery")),
    "no recovery fact class was added",
  );
});

test("an inadmissible root still outranks the recovery gate and says no recovery was attempted", () => {
  const out = planInstall({
    admission: {
      admitted: false,
      root: null,
      source: "explicit",
      reason: "not-found",
      diagnostic: "explicit workspace root does not exist.",
    },
    inventory: { confidence: "unavailable", mayEstablishAbsence: false, observedCount: 0, issues: [] },
    packs: [],
    capabilities: [],
    selection: { desired: [], deregister: [], answers: [] },
    recovery: HALTED,
  });

  // `invalid-root` wins: admission fails before any root-bound — and therefore
  // any recovery — port exists.
  assert.equal(out.applicability, "invalid-root");
  assert.equal(out.mode, null);
  assert.deepEqual(out.recovery, HALTED);
});
