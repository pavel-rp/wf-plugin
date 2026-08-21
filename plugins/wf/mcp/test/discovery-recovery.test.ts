// Recovery-before-discovery, over the REAL filesystem wiring (WF-451).
//
// The pure protocol and the driver are covered by their own suites. This file
// exercises the production ports and the guarded `discoverPacks()` entry,
// because the properties under test here are properties of the WIRING:
//
//   * byte-inertness is only meaningful against a real tree, so it is asserted
//     as a recursive name+kind+bytes snapshot taken before and after a run;
//   * "discovery never creates a journal" is only meaningful if a real journal
//     path is watched;
//   * symlink and containment behaviour is only meaningful against real links.

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
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDefaultPorts, createRecoveryPorts } from "../src/ports.js";
import {
  LIFECYCLE_BACKUP_DIR,
  LIFECYCLE_JOURNAL_PATH,
  LIFECYCLE_LOCK_PATH,
  createJournalEntry,
  createTransactionJournal,
} from "../src/resolver/lifecycle-journal.js";
import { recoverInterruptedTransaction } from "../src/resolver/lifecycle-recovery.js";
import { normalizeSlashes } from "../src/resolver/paths.js";
import { ResolverService } from "../src/service.js";
import type { JournalEntry } from "../src/resolver/types.js";

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

/** The resolver's OWN gitignored snapshot cache. Excluded from the byte-inertness
 *  evidence because refreshing it is the shared read-query machinery every typed
 *  resolver query already runs — WF-446 states this explicitly, and discovery
 *  inherits it unchanged. Everything else in the tree is in scope. */
const RESOLVER_CACHE_PREFIX = "_local/resolver";

function withoutResolverCache(rows: string[]): string[] {
  return rows.filter((row) => !row.slice(2).startsWith(RESOLVER_CACHE_PREFIX));
}

/** Recursive name + kind + content listing. The evidence for byte-inertness:
 *  a run is byte-inert iff this is deep-equal before and after. */
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

function makeWorkspace(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "wf-recovery-")));
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

// --- SC-1 / SC-6: no journal ⇒ byte-inert, and no journal is ever created -----

test("with no journal, discovery acquires and releases the lock and is BYTE-INERT", () => {
  const root = makeWorkspace();
  try {
    const before = treeSnapshot(root);
    const out = service(root).discoverPacks();

    assert.equal(out.recovery.state, "no-journal");
    assert.equal(out.recovery.proceeded, true);
    assert.equal(out.recovery.wroteBytes, false);
    assert.deepEqual(out.recovery.restored, []);

    // The lock is transient: it existed during the run and is gone at exit, so
    // the tree is byte-identical. That is exactly what byte-inertness means here.
    assert.equal(existsPath(join(root, LIFECYCLE_LOCK_PATH)), false);
    assert.deepEqual(
      withoutResolverCache(treeSnapshot(root)),
      withoutResolverCache(before),
      "a no-journal run must leave the tree byte-identical",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("DISCOVERY NEVER CREATES A JOURNAL, a backup, or a transaction of its own", () => {
  const root = makeWorkspace();
  try {
    const svc = service(root);
    svc.discoverPacks();
    svc.discoverPacks();
    assert.equal(existsPath(join(root, LIFECYCLE_JOURNAL_PATH)), false);
    assert.equal(existsPath(join(root, LIFECYCLE_BACKUP_DIR)), false);
    assert.equal(existsPath(join(root, LIFECYCLE_LOCK_PATH)), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function existsPath(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

// --- SC-2: restore to EXACT prior existence and bytes, reported separately ----

test("a compatible journal restores exact prior bytes and reports it SEPARATELY", () => {
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

    const out = service(root).discoverPacks();

    assert.equal(out.recovery.state, "recovered");
    assert.equal(out.recovery.proceeded, true);
    assert.equal(out.recovery.wroteBytes, true);
    assert.deepEqual(out.recovery.restored.map((r) => r.destination), ["managed.md"]);
    assert.equal(readFileSync(join(root, "managed.md"), "utf8"), prior);

    // The recovery write is NOT folded into discovery's own output.
    assert.ok(
      !out.diagnostics.some((d) => d.code.startsWith("recovery/")),
      "recovery is reported in its own block, never in discovery's diagnostics",
    );

    // The journal and its backup are gone, so the post-recovery baseline is
    // established and the next run is byte-inert from THERE.
    assert.equal(existsPath(join(root, LIFECYCLE_JOURNAL_PATH)), false);
    const baseline = withoutResolverCache(treeSnapshot(root));
    const second = service(root).discoverPacks();
    assert.equal(second.recovery.state, "no-journal");
    assert.equal(second.recovery.wroteBytes, false);
    assert.deepEqual(withoutResolverCache(treeSnapshot(root)), baseline);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a complete recovery leaves NO residue: the backup it named, and an emptied backup root, are both gone", () => {
  // The tidy is best-effort by contract, but "best-effort" must still mean it can
  // actually succeed. `rmSync(dir, { recursive: false })` throws EISDIR on ANY
  // directory, so a tidy written that way would be a no-op dressed as a cleanup —
  // silently leaving residue after every single complete recovery.
  const root = makeWorkspace();
  try {
    const prior = "prior\n";
    const ours = "ours\n";
    mkdirSync(join(root, LIFECYCLE_BACKUP_DIR), { recursive: true });
    writeFileSync(join(root, LIFECYCLE_BACKUP_DIR, "0"), prior);
    writeFileSync(join(root, "managed.md"), ours);

    writeJournal(root, [
      entryFor({
        destination: "managed.md",
        priorExistence: "present",
        priorContentHash: sha256(prior),
        priorIsSymlink: false,
        backupPath: `${LIFECYCLE_BACKUP_DIR}/0`,
        lastWritten: { contentHash: sha256(ours), bytes: Buffer.byteLength(ours) },
      }),
    ]);

    const out = service(root).discoverPacks();
    assert.equal(out.recovery.state, "recovered");
    assert.equal(existsPath(join(root, LIFECYCLE_BACKUP_DIR, "0")), false);
    assert.equal(
      existsPath(join(root, LIFECYCLE_BACKUP_DIR)),
      false,
      "an emptied backup root is removed, so a complete recovery leaves no residue",
    );
    assert.equal(existsPath(join(root, LIFECYCLE_JOURNAL_PATH)), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a POPULATED backup root survives the tidy — recovery never sweeps bytes it did not name", () => {
  const root = makeWorkspace();
  try {
    const prior = "prior\n";
    const ours = "ours\n";
    mkdirSync(join(root, LIFECYCLE_BACKUP_DIR), { recursive: true });
    writeFileSync(join(root, LIFECYCLE_BACKUP_DIR, "0"), prior);
    writeFileSync(join(root, LIFECYCLE_BACKUP_DIR, "unrelated"), "not this journal's\n");
    writeFileSync(join(root, "managed.md"), ours);

    writeJournal(root, [
      entryFor({
        destination: "managed.md",
        priorExistence: "present",
        priorContentHash: sha256(prior),
        priorIsSymlink: false,
        backupPath: `${LIFECYCLE_BACKUP_DIR}/0`,
        lastWritten: { contentHash: sha256(ours), bytes: Buffer.byteLength(ours) },
      }),
    ]);

    assert.equal(service(root).discoverPacks().recovery.state, "recovered");
    assert.equal(existsPath(join(root, LIFECYCLE_BACKUP_DIR, "0")), false);
    assert.equal(
      readFileSync(join(root, LIFECYCLE_BACKUP_DIR, "unrelated"), "utf8"),
      "not this journal's\n",
      "a backup this journal never named is never discarded",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a file the transaction CREATED is removed, restoring its prior absence", () => {
  const root = makeWorkspace();
  try {
    const ours = "created by the interrupted transaction\n";
    writeFileSync(join(root, "created.md"), ours);
    writeJournal(root, [
      entryFor({
        destination: "created.md",
        priorExistence: "absent",
        priorContentHash: null,
        priorIsSymlink: false,
        backupPath: null,
        lastWritten: { contentHash: sha256(ours), bytes: Buffer.byteLength(ours) },
      }),
    ]);

    const out = service(root).discoverPacks();
    assert.equal(out.recovery.state, "recovered");
    assert.deepEqual(out.recovery.restored.map((r) => r.reason), ["restored-absence"]);
    assert.equal(existsPath(join(root, "created.md")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// --- SC-4: preserve, restore the rest, stay explicit, and DO NOT PROCEED -----

test("an external edit and a symlink are PRESERVED while a clean target restores — and discovery stops", () => {
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
    writeFileSync(join(root, "link-target.md"), "target\n");
    symlinkSync(join(root, "link-target.md"), join(root, "c-link.md"));

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
      entryFor({
        destination: "c-link.md",
        priorExistence: "present",
        priorContentHash: sha256(prior),
        priorIsSymlink: false,
        backupPath: `${LIFECYCLE_BACKUP_DIR}/t1/clean`,
        lastWritten: identity,
      }),
    ]);

    const out = service(root).discoverPacks();

    // Unaffected target restored…
    assert.deepEqual(out.recovery.restored.map((r) => r.destination), ["a-clean.md"]);
    assert.equal(readFileSync(join(root, "a-clean.md"), "utf8"), prior);
    // …the unrelated edit untouched, the link untouched.
    assert.equal(readFileSync(join(root, "b-edited.md"), "utf8"), theirs);
    assert.equal(lstatSync(join(root, "c-link.md")).isSymbolicLink(), true);
    assert.equal(readFileSync(join(root, "link-target.md"), "utf8"), "target\n");

    // …unresolved work stays explicit…
    assert.deepEqual(
      out.recovery.preserved.map((r) => `${r.destination}:${r.reason}`),
      ["b-edited.md:external-edit", "c-link.md:symlink-conflict"],
    );
    assert.equal(out.recovery.state, "incomplete");

    // …and DISCOVERY DOES NOT PROCEED.
    assert.equal(out.recovery.proceeded, false);
    assert.deepEqual(out.packs, []);
    assert.equal(out.inventory.confidence, "unavailable");
    assert.equal(
      out.inventory.mayEstablishAbsence,
      false,
      "a halted run must never be mistakable for an observation of absence",
    );
    assert.equal(out.diagnostics[0]?.code, "discovery/halted-unrecovered");

    // The journal is retained so a later run converges.
    assert.equal(existsPath(join(root, LIFECYCLE_JOURNAL_PATH)), true);
    assert.equal(existsPath(join(root, LIFECYCLE_LOCK_PATH)), false, "the lock is still released");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// --- SC-3: idempotence over the real filesystem ------------------------------

test("re-entering recovery after a partial restore converges to the same tree", () => {
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
    const entries = ["a", "b"].map((name) =>
      entryFor({
        destination: `${name}.md`,
        priorExistence: "present",
        priorContentHash: sha256(prior),
        priorIsSymlink: false,
        backupPath: `${LIFECYCLE_BACKUP_DIR}/t1/${name}`,
        lastWritten: identity,
      }),
    );
    writeJournal(root, entries);

    // Simulate an interruption after the first destination was restored: put
    // `a.md` back by hand and leave the journal in place, exactly as a killed
    // process would.
    writeFileSync(join(root, "a.md"), prior);

    const ports = createRecoveryPorts(normalizeSlashes(root));
    const first = recoverInterruptedTransaction(ports);
    assert.equal(first.state, "recovered");
    assert.deepEqual(first.alreadyRestored.map((r) => r.destination), ["a.md"]);
    assert.deepEqual(first.restored.map((r) => r.destination), ["b.md"]);
    const converged = treeSnapshot(root);

    // Re-entry against the now-recovered workspace is a clean no-op that leaves
    // the tree exactly where the first pass left it.
    const second = recoverInterruptedTransaction(createRecoveryPorts(normalizeSlashes(root)));
    assert.equal(second.state, "no-journal");
    assert.equal(second.wroteBytes, false);
    assert.deepEqual(treeSnapshot(root), converged);
    assert.equal(readFileSync(join(root, "a.md"), "utf8"), prior);
    assert.equal(readFileSync(join(root, "b.md"), "utf8"), prior);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// --- SC-5 / SC-7: the hostile entries ----------------------------------------

test("concurrent entry is refused by the exclusive lock and reads no state", () => {
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

    const out = service(root).discoverPacks();
    assert.equal(out.recovery.state, "lock-unavailable");
    assert.equal(out.recovery.proceeded, false);
    assert.equal(out.recovery.wroteBytes, false);
    assert.deepEqual(out.packs, []);
    assert.equal(out.inventory.mayEstablishAbsence, false);
    // The other holder's lock is NOT stolen or removed.
    assert.equal(existsPath(join(root, LIFECYCLE_LOCK_PATH)), true);
    assert.equal(existsPath(join(root, LIFECYCLE_JOURNAL_PATH)), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an unsupported journal version is a STOP that writes nothing", () => {
  const root = makeWorkspace();
  try {
    writeFileSync(
      join(root, LIFECYCLE_JOURNAL_PATH),
      JSON.stringify({ journalVersion: 2, transactionId: "t", startedAt: "n", entries: [] }),
    );
    writeFileSync(join(root, "untouched.md"), "untouched\n");
    const before = treeSnapshot(root);

    const out = service(root).discoverPacks();
    assert.equal(out.recovery.state, "unsupported");
    assert.equal(out.recovery.journalVersion, 2);
    assert.equal(out.recovery.proceeded, false);
    assert.deepEqual(out.packs, []);
    assert.deepEqual(withoutResolverCache(treeSnapshot(root)), withoutResolverCache(before));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a malformed journal is a STOP, and the journal is retained for inspection", () => {
  const root = makeWorkspace();
  try {
    writeFileSync(join(root, LIFECYCLE_JOURNAL_PATH), "{ this is not json");
    const out = service(root).discoverPacks();
    assert.equal(out.recovery.state, "malformed");
    assert.equal(out.recovery.proceeded, false);
    assert.equal(existsPath(join(root, LIFECYCLE_JOURNAL_PATH)), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// --- SC-8: containment, tested WITHOUT creating the path ---------------------

test("an uncontained destination is refused and the path it names is never created", () => {
  const root = makeWorkspace();
  try {
    const outsideDir = realpathSync(mkdtempSync(join(tmpdir(), "wf-outside-")));
    symlinkSync(outsideDir, join(root, "escape"));
    try {
      for (const destination of ["../escaped.md", "escape/escaped.md"]) {
        writeJournal(root, [
          entryFor({
            destination,
            priorExistence: "absent",
            priorContentHash: null,
            priorIsSymlink: false,
            backupPath: null,
            lastWritten: { contentHash: sha256("x"), bytes: 1 },
          }),
        ]);

        const report = recoverInterruptedTransaction(createRecoveryPorts(normalizeSlashes(root)));
        assert.equal(report.state, "incomplete");
        assert.deepEqual(
          report.unresolved.map((r) => r.reason),
          ["target-not-contained"],
          `${destination} must be refused`,
        );
        assert.equal(report.wroteBytes, false);
      }
      // Nothing was created outside the workspace by the probe.
      assert.deepEqual(readdirSync(outsideDir), []);
    } finally {
      rmSync(outsideDir, { recursive: true, force: true });
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a backup that no longer reproduces the prior bytes never authorizes an overwrite", () => {
  const root = makeWorkspace();
  try {
    const prior = "prior\n";
    const ours = "ours\n";
    mkdirSync(join(root, LIFECYCLE_BACKUP_DIR, "t1"), { recursive: true });
    writeFileSync(join(root, LIFECYCLE_BACKUP_DIR, "t1", "0"), "TAMPERED\n");
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

    const report = recoverInterruptedTransaction(createRecoveryPorts(normalizeSlashes(root)));
    assert.deepEqual(report.unresolved.map((r) => r.reason), ["backup-mismatch"]);
    assert.equal(report.wroteBytes, false);
    assert.equal(readFileSync(join(root, "managed.md"), "utf8"), ours);

    rmSync(join(root, LIFECYCLE_BACKUP_DIR, "t1", "0"));
    const missing = recoverInterruptedTransaction(createRecoveryPorts(normalizeSlashes(root)));
    assert.deepEqual(missing.unresolved.map((r) => r.reason), ["backup-missing"]);
    assert.equal(readFileSync(join(root, "managed.md"), "utf8"), ours);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the lock is create-exclusive: a second acquire while held is refused", () => {
  const root = makeWorkspace();
  try {
    const first = createRecoveryPorts(normalizeSlashes(root));
    const second = createRecoveryPorts(normalizeSlashes(root));
    assert.deepEqual(first.acquireLock(), { ok: true });
    const held = second.acquireLock();
    assert.equal(held.ok, false);
    assert.equal(held.ok === false ? held.reason : null, "held-by-other");
    first.releaseLock();
    assert.deepEqual(second.acquireLock(), { ok: true });
    second.releaseLock();
    assert.equal(existsPath(join(root, LIFECYCLE_LOCK_PATH)), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
