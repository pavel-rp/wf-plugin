// WF-832 — the worktree-family-scoped run-evidence read.
//
// The fleet layout on a real Git repository: an orchestrator worktree A and a
// linked shipper worktree B of the same family, plus a foreign repository and a
// plain directory. A shipper files its receipts from B, under B's own run identity
// and B's own machine-local issuer binding, so A's own-root read can only ever say
// `absent` — the defect. The family read proves B's membership and then judges
// every record against B's identity, so genuine receipts match while a foreign
// root, a tampered record, a hand-written record and a copied ledger all stay
// unproven.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { normalizeSlashes } from "../src/resolver/paths.js";
import { createDefaultPorts } from "../src/ports.js";
import { ResolverService, type ResolverServicePorts } from "../src/service.js";

const TASK = "WF-1";
const SPEC = "_local/WF-1/01_spec.md";

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", ["-C", cwd, ...args], { stdio: "ignore" });
}

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function initRepo(dir: string): void {
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-b", "main");
  git(dir, "config", "user.email", "test@example.invalid");
  git(dir, "config", "user.name", "Test");
  write(`${dir}/.gitignore`, "_local/\n.wf/\n");
  write(`${dir}/tracked.txt`, "fixture\n");
  git(dir, "add", ".");
  git(dir, "commit", "-m", "fixture");
}

type Fixture = {
  root: string;
  home: string;
  orchestrator: string;
  shipper: string;
  foreign: string;
  plain: string;
  cleanup: () => void;
};

function makeFixture(): Fixture {
  const root = normalizeSlashes(realpathSync(mkdtempSync(join(tmpdir(), "wf-832-"))));
  const home = `${root}/home`;
  mkdirSync(home);
  const orchestrator = `${root}/orchestrator`;
  initRepo(orchestrator);
  const shipper = `${root}/shipper`;
  git(orchestrator, "worktree", "add", "-b", "shipper", shipper);
  const foreign = `${root}/foreign`;
  initRepo(foreign);
  const plain = `${root}/plain`;
  mkdirSync(plain);
  return {
    root,
    home,
    orchestrator,
    shipper,
    foreign,
    plain,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

/** Real filesystem ports, with the machine-local home redirected into the
 *  fixture so no test ever touches the real home, and a counter on every read. */
function ports(
  workspaceRoot: string,
  home: string,
): ResolverServicePorts & { reads: () => number } {
  const base = createDefaultPorts(workspaceRoot);
  let reads = 0;
  return {
    ...base,
    machineLocalHome: () => home,
    runModeSignal: () => null,
    readFile: (p: string) => {
      reads += 1;
      return base.readFile(p);
    },
    reads: () => reads,
  };
}

function service(workspaceRoot: string, home: string): ResolverService {
  return new ResolverService(ports(workspaceRoot, home));
}

/** File a spec receipt (artifact-backed) and a ship receipt (invocation-only)
 *  from inside `root`, exactly as a shipper's own resolver would. */
function fileReceipts(root: string, home: string): void {
  write(`${root}/${SPEC}`, "# spec\n");
  const issuing = service(root, home);
  assert.equal(
    issuing.recordRunEvidence({ kind: "phase-receipt", subject: "spec", taskId: TASK, artifactPath: SPEC })
      .status,
    "recorded",
  );
  assert.equal(
    issuing.recordRunEvidence({ kind: "phase-receipt", subject: "ship", taskId: TASK }).status,
    "recorded",
  );
}

test("a sibling worktree's receipts are unreachable by the own-root read (the defect)", () => {
  const fx = makeFixture();
  try {
    fileReceipts(fx.shipper, fx.home);
    assert.equal(service(fx.orchestrator, fx.home).readRunEvidence(TASK).status, "absent");
  } finally {
    fx.cleanup();
  }
});

test("same family: the shipper's receipts verify against its own issuer binding", () => {
  const fx = makeFixture();
  try {
    fileReceipts(fx.shipper, fx.home);
    const read = service(fx.orchestrator, fx.home).readFamilyRunEvidence(fx.shipper, TASK);

    assert.equal(read.status, "ok");
    assert.equal(read.memberRoot, fx.shipper);
    assert.equal(read.diagnostic, null);
    assert.deepEqual(read.provenPhases, ["spec", "ship"]);
    assert.equal(read.unmatched.length, 0);
    assert.equal(read.unreadableRecords, 0);

    const spec = read.matched.find((m) => m.subject === "spec")!;
    assert.equal(spec.evidenceClass, "artifact-backed");
    // Freshness is re-observed inside the MEMBER's tree, not the reader's: the
    // orchestrator holds no such file, so a reader-rooted observation would say
    // `missing`.
    assert.equal(spec.artifactState, "fresh");
    const ship = read.matched.find((m) => m.subject === "ship")!;
    assert.equal(ship.evidenceClass, "invocation-only");

    // The response is the member's own read, field for field.
    const own = service(fx.shipper, fx.home).readRunEvidence(TASK);
    assert.equal(read.runId, own.runId);
    assert.equal(read.destination, own.destination);
    assert.deepEqual(read.matched, own.matched);
  } finally {
    fx.cleanup();
  }
});

test("same family: a non-canonical spelling of the member root is canonicalized", () => {
  const fx = makeFixture();
  try {
    fileReceipts(fx.shipper, fx.home);
    const alias = `${fx.root}/alias`;
    symlinkSync(fx.shipper, alias);
    const read = service(fx.orchestrator, fx.home).readFamilyRunEvidence(`${alias}/`, TASK);
    assert.equal(read.status, "ok");
    assert.equal(read.memberRoot, fx.shipper);
    assert.deepEqual(read.provenPhases, ["spec", "ship"]);
  } finally {
    fx.cleanup();
  }
});

test("same family: an artifact edited after issue reads stale in the member's tree", () => {
  const fx = makeFixture();
  try {
    fileReceipts(fx.shipper, fx.home);
    write(`${fx.shipper}/${SPEC}`, "# spec, edited\n");
    const read = service(fx.orchestrator, fx.home).readFamilyRunEvidence(fx.shipper, TASK);
    assert.equal(read.matched.find((m) => m.subject === "spec")!.artifactState, "stale");
  } finally {
    fx.cleanup();
  }
});

test("foreign root: another repository, a plain directory and a missing path read nothing", () => {
  const fx = makeFixture();
  try {
    // The foreign repository holds GENUINE receipts sealed by its own issuer on
    // this same machine — family membership, not seal validity, is what refuses it.
    fileReceipts(fx.foreign, fx.home);
    for (const memberRoot of [fx.foreign, fx.plain, `${fx.root}/does-not-exist`]) {
      const readerPorts = ports(fx.orchestrator, fx.home);
      const read = new ResolverService(readerPorts).readFamilyRunEvidence(memberRoot, TASK);
      assert.equal(read.status, "foreign-root", memberRoot);
      assert.equal(read.memberRoot, null);
      assert.equal(read.runId, null);
      assert.equal(read.destination, null);
      assert.deepEqual(read.matched, []);
      assert.deepEqual(read.unmatched, []);
      assert.deepEqual(read.provenPhases, []);
      assert.ok(read.diagnostic !== null && read.diagnostic.length > 0);
      assert.equal(readerPorts.reads(), 0, "no ledger or issuer binding is read for a foreign root");
    }
  } finally {
    fx.cleanup();
  }
});

test("tampered and hand-written records in the member's ledger stay unmatched", () => {
  const fx = makeFixture();
  try {
    fileReceipts(fx.shipper, fx.home);
    const destination = service(fx.shipper, fx.home).readRunEvidence(TASK).destination;
    const ledgerPath = `${fx.shipper}/${destination}`;
    const ledger = JSON.parse(readFileSync(ledgerPath, "utf8"));

    // Tamper: re-label the genuine `ship` receipt as `tf`, keeping its seal.
    ledger.records[1].subject = "tf";
    // Hand-write: a receipt-shaped record with no seal.
    ledger.records.push({ ...ledger.records[0], subject: "plan", seal: "" });
    writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);

    const read = service(fx.orchestrator, fx.home).readFamilyRunEvidence(fx.shipper, TASK);
    assert.equal(read.status, "ok");
    assert.deepEqual(read.provenPhases, ["spec"]);
    assert.deepEqual(
      read.unmatched.map((u) => [u.subject, u.reason]),
      [
        ["tf", "seal-mismatch"],
        ["plan", "seal-absent"],
      ],
    );
  } finally {
    fx.cleanup();
  }
});

test("a ledger copied from the shipper onto the orchestrator's destination proves nothing there", () => {
  const fx = makeFixture();
  try {
    fileReceipts(fx.shipper, fx.home);
    // Establish the orchestrator's own issuer binding, so the refusal below is the
    // run-identity check rather than a missing key.
    service(fx.orchestrator, fx.home).recordRunEvidence({
      kind: "phase-receipt",
      subject: "ship",
      taskId: "WF-2",
    });

    const shipperDestination = service(fx.shipper, fx.home).readRunEvidence(TASK).destination;
    const orchestratorDestination = service(fx.orchestrator, fx.home).readRunEvidence(TASK).destination;
    write(
      `${fx.orchestrator}/${orchestratorDestination}`,
      readFileSync(`${fx.shipper}/${shipperDestination}`, "utf8"),
    );

    // Read through the family surface with the orchestrator as its own member.
    const read = service(fx.orchestrator, fx.home).readFamilyRunEvidence(fx.orchestrator, TASK);
    assert.equal(read.status, "ok");
    assert.deepEqual(read.matched, []);
    assert.deepEqual(read.provenPhases, []);
    assert.ok(read.unmatched.length > 0);
    for (const entry of read.unmatched) assert.equal(entry.reason, "run-mismatch");
  } finally {
    fx.cleanup();
  }
});

test("the family read never mints an issuer binding for the member", () => {
  const fx = makeFixture();
  try {
    // A member with a ledger-shaped file but no issuer binding at all.
    const destination = service(fx.shipper, fx.home).readRunEvidence(TASK).destination;
    write(
      `${fx.shipper}/${destination}`,
      `${JSON.stringify({ formatVersion: 2, runId: destination.slice(-37, -5), records: [] })}\n`,
    );
    const before = JSON.stringify(readdirSafe(`${fx.home}/.wf-run-evidence`));
    service(fx.orchestrator, fx.home).readFamilyRunEvidence(fx.shipper, TASK);
    assert.equal(JSON.stringify(readdirSafe(`${fx.home}/.wf-run-evidence`)), before);
  } finally {
    fx.cleanup();
  }
});

function readdirSafe(dir: string): string[] {
  try {
    return readdirSync(dir).sort();
  } catch {
    return [];
  }
}
