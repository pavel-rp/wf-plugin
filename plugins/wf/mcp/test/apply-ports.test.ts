// The production apply ports, over the REAL filesystem (WF-453).
//
// The driver's own contract is covered in `apply-transaction.test.ts` against
// in-memory doubles. The properties here are properties of the WIRING, and are
// only meaningful against a real tree:
//
//   * atomicity — the destination is never observable in a third state, and a
//     failed write leaves no temp file behind;
//   * no-follow — a real symlink is observed as a link and never traversed;
//   * NO RECOVERY RESIDUE — a completed transaction leaves no journal, no backup
//     bytes, and no emptied backup DIRECTORY, which is what made the WF-451
//     root-only tidy reachable once backups became nested;
//   * non-cwd correctness — every path is composed from the ADMITTED root, so a
//     run whose `process.cwd()` is somewhere else entirely still behaves.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApplyPorts, pruneEmptyBackupDirs } from "../src/ports.js";
import { applyTransaction, type SelfCheckOutcome } from "../src/resolver/apply-transaction.js";
import {
  LIFECYCLE_BACKUP_DIR,
  LIFECYCLE_JOURNAL_PATH,
} from "../src/resolver/lifecycle-journal.js";
import { recoverInterruptedTransaction } from "../src/resolver/lifecycle-recovery.js";
import { normalizeSlashes } from "../src/resolver/paths.js";
import { createRecoveryPorts } from "../src/ports.js";

const REGISTRY_REL = "_local/config.md";
const PRIOR = "# Config\n\n## Capabilities\n\n| Capability | Path |\n| ------ | ------ |\n";
const NEXT = `${PRIOR}| beta | plugin:beta/capabilities/one |\n`;

function sha256(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function makeWorkspace(withRegistry = true): string {
  const dir = normalizeSlashes(realpathSync(mkdtempSync(join(tmpdir(), "wf-apply-"))));
  mkdirSync(join(dir, "_local"), { recursive: true });
  if (withRegistry) writeFileSync(join(dir, REGISTRY_REL), PRIOR);
  return dir;
}

const ok = (): SelfCheckOutcome => ({ ok: true });

function ports(root: string, selfCheck: () => SelfCheckOutcome = ok) {
  return createApplyPorts(root, REGISTRY_REL, selfCheck);
}

/** Every path under the backup root, files and directories alike. The evidence
 *  for "no recovery residue": a completed transaction leaves this EMPTY, and the
 *  backup root itself gone. */
function backupResidue(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const item of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const rel = prefix === "" ? item.name : `${prefix}/${item.name}`;
      out.push(rel);
      if (item.isDirectory()) walk(join(dir, item.name), rel);
    }
  };
  const backupRoot = join(root, LIFECYCLE_BACKUP_DIR);
  if (existsSync(backupRoot)) walk(backupRoot, "");
  return out;
}

/** Anything the atomic writer could have stranded. A `.tmp` survivor would mean
 *  the "create-exclusive sibling temp, fsync, rename" sequence leaked. */
function tempResidue(root: string): string[] {
  return readdirSync(join(root, "_local")).filter((name) => name.endsWith(".tmp"));
}

// ---------------------------------------------------------------------------
// Observation and identity
// ---------------------------------------------------------------------------

test("the destination is observed with its real bytes, and identified without touching disk", () => {
  const root = makeWorkspace();
  try {
    const p = ports(root);
    const observed = p.observeDestination();
    assert.equal(observed.kind, "file");
    assert.equal(observed.kind === "file" && observed.contentHash, sha256(PRIOR));
    assert.equal(p.identify(NEXT).contentHash, sha256(NEXT));
    assert.equal(p.identify(NEXT).bytes, Buffer.byteLength(NEXT, "utf8"));
    assert.ok((p.destinationInode() ?? 0) > 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a symlink destination is observed as a LINK and never followed", () => {
  const root = makeWorkspace(false);
  try {
    writeFileSync(join(root, "_local", "elsewhere.md"), "# not the registry\n");
    symlinkSync(join(root, "_local", "elsewhere.md"), join(root, REGISTRY_REL));
    const p = ports(root);
    assert.equal(p.observeDestination().kind, "symlink");
    // The inode is the LINK's own, not its target's — the proof it was `lstat`ed.
    assert.equal(
      p.destinationInode(),
      lstatSync(join(root, REGISTRY_REL)).ino,
      "the link itself is stat'd",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an absent destination observes as absent, and identity still resolves", () => {
  const root = makeWorkspace(false);
  try {
    const p = ports(root);
    assert.equal(p.observeDestination().kind, "absent");
    assert.equal(p.destinationInode(), null);
    assert.equal(p.journalPresent(), false);
    assert.equal(p.backupsPresent(), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// The atomic writer
// ---------------------------------------------------------------------------

test("the replacement lands the exact bytes and strands no temp file", () => {
  const root = makeWorkspace();
  try {
    const p = ports(root);
    assert.equal(p.atomicReplace(NEXT).ok, true);
    assert.equal(readFileSync(join(root, REGISTRY_REL), "utf8"), NEXT);
    assert.deepEqual(tempResidue(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the backup reproduces the destination's prior bytes at a per-transaction NESTED path", () => {
  const root = makeWorkspace();
  try {
    const p = ports(root);
    const backupPath = p.backupPathFor("tx-abc");
    assert.equal(
      backupPath,
      `${LIFECYCLE_BACKUP_DIR}/tx-abc/registry`,
      "backups nest per transaction so two transactions cannot collide",
    );
    assert.equal(p.writeBackup(backupPath).ok, true);
    const proof = p.hashBackup(backupPath);
    assert.equal(proof.ok, true);
    assert.equal(proof.ok && proof.contentHash, sha256(PRIOR));
    assert.equal(p.backupsPresent(), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("two transactions produce two distinct backup paths", () => {
  const root = makeWorkspace();
  try {
    const p = ports(root);
    const first = p.newTransactionId();
    const second = p.newTransactionId();
    assert.notEqual(first, second);
    assert.notEqual(p.backupPathFor(first), p.backupPathFor(second));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Durable completion and the residue property (SC-2)
// ---------------------------------------------------------------------------

test("a completed transaction leaves NO journal, NO backup bytes, and NO emptied backup directory", () => {
  const root = makeWorkspace();
  try {
    const p = ports(root);
    const result = applyTransaction(p, {
      newContent: NEXT,
      expectation: { present: ["beta"], absent: [] },
    });

    assert.equal(result.status, "applied");
    assert.equal(readFileSync(join(root, REGISTRY_REL), "utf8"), NEXT);
    assert.equal(existsSync(join(root, LIFECYCLE_JOURNAL_PATH)), false, "no journal survives");
    assert.deepEqual(
      backupResidue(root),
      [],
      "no backup file AND no emptied backup directory survives",
    );
    assert.equal(
      existsSync(join(root, LIFECYCLE_BACKUP_DIR)),
      false,
      "the backup root itself is pruned",
    );
    assert.deepEqual(tempResidue(root), []);
    assert.equal(result.residue.clean, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a transaction over an ABSENT registry applies and still leaves no residue", () => {
  const root = makeWorkspace(false);
  try {
    const result = applyTransaction(ports(root), {
      newContent: NEXT,
      expectation: { present: ["beta"], absent: [] },
    });
    assert.equal(result.status, "applied");
    assert.equal(readFileSync(join(root, REGISTRY_REL), "utf8"), NEXT);
    assert.equal(existsSync(join(root, LIFECYCLE_JOURNAL_PATH)), false);
    assert.deepEqual(backupResidue(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a failed self-check rolls the REAL file back to its exact prior bytes, leaving no residue", () => {
  const root = makeWorkspace();
  try {
    const result = applyTransaction(
      ports(root, () => ({ ok: false, diagnostic: "`beta` did not resolve" })),
      { newContent: NEXT, expectation: { present: ["beta"], absent: [] } },
    );
    assert.equal(result.status, "rolled-back");
    assert.equal(result.reason, "apply/self-check-failed");
    assert.equal(readFileSync(join(root, REGISTRY_REL), "utf8"), PRIOR, "byte-identical restore");
    assert.equal(existsSync(join(root, LIFECYCLE_JOURNAL_PATH)), false);
    assert.deepEqual(backupResidue(root), []);
    assert.deepEqual(tempResidue(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a real interrupted transaction is recovered from disk, idempotently", () => {
  // The kill is modelled by a port that throws mid-transaction — the driver does
  // not catch it, so the tree is left exactly as a killed process would leave it.
  const root = makeWorkspace();
  try {
    const p = ports(root, () => {
      throw new Error("process killed after the write");
    });
    assert.throws(
      () => applyTransaction(p, { newContent: NEXT, expectation: { present: [], absent: [] } }),
      /process killed/,
    );
    // The kill landed after the replacement: the registry holds the NEW bytes and
    // a journal survives naming the prior ones.
    assert.equal(readFileSync(join(root, REGISTRY_REL), "utf8"), NEXT);
    assert.equal(existsSync(join(root, LIFECYCLE_JOURNAL_PATH)), true);

    const first = recoverInterruptedTransaction(createRecoveryPorts(root));
    assert.equal(first.state, "recovered");
    assert.equal(readFileSync(join(root, REGISTRY_REL), "utf8"), PRIOR);
    assert.equal(existsSync(join(root, LIFECYCLE_JOURNAL_PATH)), false);
    assert.deepEqual(backupResidue(root), [], "recovery prunes the nested backup directory too");

    const second = recoverInterruptedTransaction(createRecoveryPorts(root));
    assert.equal(second.state, "no-journal");
    assert.equal(readFileSync(join(root, REGISTRY_REL), "utf8"), PRIOR);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// The backup-directory prune
// ---------------------------------------------------------------------------

test("the prune stops AT the backup root and never removes a directory above it", () => {
  const root = makeWorkspace();
  try {
    mkdirSync(join(root, LIFECYCLE_BACKUP_DIR, "tx1"), { recursive: true });
    pruneEmptyBackupDirs(root, [`${LIFECYCLE_BACKUP_DIR}/tx1/registry`]);
    assert.equal(existsSync(join(root, LIFECYCLE_BACKUP_DIR)), false, "the empty root is pruned");
    assert.equal(existsSync(join(root, "_local")), true, "`_local` is NEVER touched");
    assert.equal(existsSync(join(root, REGISTRY_REL)), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the prune leaves a backup directory another transaction still occupies strictly alone", () => {
  const root = makeWorkspace();
  try {
    mkdirSync(join(root, LIFECYCLE_BACKUP_DIR, "tx1"), { recursive: true });
    mkdirSync(join(root, LIFECYCLE_BACKUP_DIR, "tx2"), { recursive: true });
    writeFileSync(join(root, LIFECYCLE_BACKUP_DIR, "tx2", "registry"), "other transaction\n");

    pruneEmptyBackupDirs(root, [`${LIFECYCLE_BACKUP_DIR}/tx1/registry`]);

    assert.equal(existsSync(join(root, LIFECYCLE_BACKUP_DIR, "tx1")), false, "the emptied one goes");
    assert.equal(
      readFileSync(join(root, LIFECYCLE_BACKUP_DIR, "tx2", "registry"), "utf8"),
      "other transaction\n",
      "the occupied one is untouched",
    );
    assert.equal(existsSync(join(root, LIFECYCLE_BACKUP_DIR)), true, "a populated root survives");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the prune refuses a backup path that escapes the backup root", () => {
  const root = makeWorkspace();
  try {
    mkdirSync(join(root, "_local", "keepme"), { recursive: true });
    pruneEmptyBackupDirs(root, ["_local/keepme/whatever", "../../etc/whatever"]);
    assert.equal(existsSync(join(root, "_local", "keepme")), true, "an out-of-root path is ignored");
    assert.equal(existsSync(join(root, "_local")), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Non-cwd correctness (SC-2)
// ---------------------------------------------------------------------------

test("the transaction applies against a NON-CWD admitted workspace", () => {
  // Every path is composed from the admitted root, never from `process.cwd()`.
  // Running with the cwd pointed at an unrelated directory is what proves it.
  const root = makeWorkspace();
  const elsewhere = normalizeSlashes(realpathSync(mkdtempSync(join(tmpdir(), "wf-cwd-"))));
  const original = process.cwd();
  try {
    process.chdir(elsewhere);
    const result = applyTransaction(ports(root), {
      newContent: NEXT,
      expectation: { present: [], absent: [] },
    });
    assert.equal(result.status, "applied");
    assert.equal(readFileSync(join(root, REGISTRY_REL), "utf8"), NEXT);
    // Nothing was created in the cwd — not a journal, not a backup, not a temp.
    assert.deepEqual(readdirSync(elsewhere), []);
    assert.deepEqual(backupResidue(root), []);
  } finally {
    process.chdir(original);
    rmSync(root, { recursive: true, force: true });
    rmSync(elsewhere, { recursive: true, force: true });
  }
});
