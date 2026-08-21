// wf resolver — production side-effect ports for the typed service.
//
// Wires ResolverServicePorts to the real world: the deterministic resolver
// engine (WF-269) for snapshot builds, the filesystem for the project-local
// cache + registry edits, and `claude plugin list --json` for installed-pack
// facts. Kept apart from service.ts so the service logic stays a pure function
// of its ports and can be tested with in-memory doubles.

import {
  closeSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  rmdirSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { createHash } from "node:crypto";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  extractRegistryPathRaw,
  fingerprintContainedCapabilityFile,
  fsIO,
  resolveSnapshot,
  readSnapshot,
  writeSnapshot,
  runPluginList,
} from "./resolver/index.js";
import { parsePluginList } from "./resolver/plugin-list.js";
import { joinSlash, normalizeSlashes } from "./resolver/paths.js";
import type { PayloadTargetResolution } from "./resolver/payload-plan.js";
import {
  LIFECYCLE_BACKUP_DIR,
  LIFECYCLE_JOURNAL_PATH,
  LIFECYCLE_LOCK_PATH,
  type DestinationObservation,
} from "./resolver/lifecycle-journal.js";
import type {
  BackupIdentity,
  LockAcquisition,
  RecoveryPorts,
  WriteOutcome,
} from "./resolver/lifecycle-recovery.js";
import type {
  ApplyPorts,
  SelfCheckExpectation,
  SelfCheckOutcome,
} from "./resolver/apply-transaction.js";
import type { JournalEntry, TransactionJournal } from "./resolver/types.js";
import type { ResolverServicePorts, PluginListResult } from "./service.js";

const DEFAULT_REGISTRY_RELPATH = "_local/config.md";

/** Resolve the core `wf` plugin root — the anchor for `contract` / `shared` /
 *  core `references-template` content refs. This module is bundled into
 *  `<coreRoot>/mcp/dist/runtime.mjs`, so `import.meta.url` locates the server's
 *  own install and two directory levels up is the core plugin root — no registry
 *  or CLI dependency, correct in-tree and out-of-tree, and it moves with the
 *  install (so a version bump never re-prompts). `WF_CORE_PLUGIN_ROOT` overrides
 *  it (tests / non-standard hosts). */
export function resolveCorePluginRoot(): string {
  if (process.env.WF_CORE_PLUGIN_ROOT) {
    return normalizeSlashes(process.env.WF_CORE_PLUGIN_ROOT);
  }
  const here = fileURLToPath(import.meta.url); // .../plugins/wf/mcp/dist/runtime.mjs
  return normalizeSlashes(resolve(dirname(here), "..", "..")); // .../plugins/wf
}

/** Resolve a write target only when its existing path chain stays in the workspace. */
export function resolveContainedRegistryWritePath(
  workspaceRoot: string,
  registryRelPath: string,
): string {
  const canonicalRoot = realpathSync(workspaceRoot);
  const target = resolve(workspaceRoot, registryRelPath);
  let existing = target;
  while (true) {
    try {
      lstatSync(existing);
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      const parent = dirname(existing);
      if (parent === existing) throw err;
      existing = parent;
    }
  }
  const canonicalExisting = realpathSync(existing);
  const fromRoot = relative(canonicalRoot, canonicalExisting);
  if (
    fromRoot === "" ||
    (fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot))
  ) {
    return normalizeSlashes(target);
  }
  throw new Error(`resolved path leaves workspace root \`${normalizeSlashes(canonicalRoot)}\`.`);
}

/** Lexical rejection of a declared payload destination, applied BEFORE any
 *  filesystem access. Mirrors the declaration-time grammar `payloads.ts` already
 *  enforces, so a destination that somehow reached here unvalidated is still
 *  refused rather than probed. */
function lexicalPayloadRejection(
  destination: string,
): PayloadTargetResolution | null {
  if (destination.length === 0 || destination.includes("\0") || destination.includes("\\")) {
    return { ok: false, rejection: "malformed" };
  }
  if (destination.startsWith("/") || /^[A-Za-z]:/.test(destination)) {
    return { ok: false, rejection: "absolute" };
  }
  const segments = destination.split("/");
  if (segments.some((segment) => segment === "..")) {
    return { ok: false, rejection: "traversal" };
  }
  if (segments.some((segment) => segment === "" || segment === "." || segment.includes(":"))) {
    return { ok: false, rejection: "malformed" };
  }
  return null;
}

/**
 * Resolve one declared payload destination to a canonical workspace-contained
 * target — WITHOUT creating anything.
 *
 * The probe walks up to the deepest ancestor that already exists and
 * canonicalizes THAT, so it never has to materialize the path it is testing.
 * Canonicalization happens before the containment decision, which is what makes
 * an escaping symlink caught rather than followed: `realpathSync` resolves the
 * link and the resolved location is then measured against the canonical root.
 *
 * The root is passed in rather than closed over, because containment is measured
 * against the ONE admitted workspace root (WF-445) — a different question from
 * plugin-root validation, which this never performs.
 */
export function resolveContainedPayloadTarget(
  workspaceRoot: string,
  destination: string,
): PayloadTargetResolution {
  const lexical = lexicalPayloadRejection(destination);
  if (lexical !== null) return lexical;

  let canonicalRoot: string;
  try {
    canonicalRoot = realpathSync(workspaceRoot);
  } catch {
    return { ok: false, rejection: "unresolvable" };
  }

  const target = resolve(canonicalRoot, destination);

  // Walk up to the deepest EXISTING node. `lstatSync` does not follow a terminal
  // symlink, so a dangling link is still "existing" and is canonicalized below.
  let existing = target;
  const trailing: string[] = [];
  while (true) {
    try {
      lstatSync(existing);
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        return { ok: false, rejection: "unresolvable" };
      }
      const parent = dirname(existing);
      if (parent === existing) return { ok: false, rejection: "unresolvable" };
      trailing.unshift(basename(existing));
      existing = parent;
    }
  }

  let canonicalExisting: string;
  try {
    canonicalExisting = realpathSync(existing);
  } catch {
    // A dangling symlink cannot be canonicalized, so containment of whatever it
    // points at cannot be established. Fail closed rather than guess.
    return { ok: false, rejection: "symlink-escape" };
  }

  const fromRoot = relative(canonicalRoot, canonicalExisting);
  const contained =
    fromRoot === "" ||
    (fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot));
  if (!contained) {
    // A link was resolved iff canonicalization moved the path. That distinction
    // is what separates "escaped through a symlink" from "was simply outside".
    return {
      ok: false,
      rejection: canonicalExisting === existing ? "out-of-workspace" : "symlink-escape",
    };
  }

  const exists = trailing.length === 0;
  if (exists && !lstatSync(canonicalExisting).isFile()) {
    return { ok: false, rejection: "target-not-a-file" };
  }

  const canonicalTarget = joinSlash(normalizeSlashes(canonicalExisting), ...trailing);
  // Belt and braces: the composed target must still sit under the canonical root.
  const rootPrefix = normalizeSlashes(canonicalRoot).replace(/\/+$/, "");
  if (
    canonicalTarget !== rootPrefix &&
    !canonicalTarget.startsWith(rootPrefix === "/" ? "/" : `${rootPrefix}/`)
  ) {
    return { ok: false, rejection: "out-of-workspace" };
  }

  return { ok: true, canonicalTarget, exists };
}

export function createDefaultPorts(workspaceRoot: string): ResolverServicePorts {
  const registryRelPath = (): string => {
    const wfConfig = fsIO.readFile(joinSlash(workspaceRoot, "wf.config.js"));
    return extractRegistryPathRaw(wfConfig);
  };

  return {
    workspaceRoot,
    corePluginRoot: resolveCorePluginRoot(),

    resolveFresh: () =>
      resolveSnapshot({ workspaceRoot, corePluginRoot: resolveCorePluginRoot() }),

    persist: (snapshot) => {
      writeSnapshot(workspaceRoot, snapshot);
    },

    readCache: () => {
      try {
        return readSnapshot(workspaceRoot);
      } catch {
        // An incompatible/corrupt cache is treated as "no cache" so the next
        // ensure() rebuilds cleanly rather than surfacing a read error.
        return null;
      }
    },

    readFile: (absPath) => fsIO.readFile(absPath),
    readContainedFile: (capabilityRoot, selectedPath, maxBytes) =>
      fsIO.readContainedFile!(capabilityRoot, selectedPath, maxBytes),
    fingerprintContainedFile: (capabilityRoot, selectedPath, maxBytes) =>
      fingerprintContainedCapabilityFile(capabilityRoot, selectedPath, maxBytes),
    resolvePayloadTarget: (admittedRoot, destination) =>
      resolveContainedPayloadTarget(admittedRoot, destination),
    canonicalizeRoot: (root) => {
      try {
        return normalizeSlashes(realpathSync(root));
      } catch {
        return null;
      }
    },

    writeFile: (absPath, content) => {
      mkdirSync(dirname(absPath), { recursive: true });
      writeFileSync(absPath, content, { encoding: "utf8" });
    },

    listDirs: (absDir) => {
      try {
        return readdirSync(absDir, { withFileTypes: true })
          .filter((e) => e.isDirectory())
          .map((e) => e.name);
      } catch {
        return [];
      }
    },

    listFiles: (absDir) => {
      try {
        return readdirSync(absDir, { withFileTypes: true })
          .filter((e) => e.isFile())
          .map((e) => e.name);
      } catch {
        return [];
      }
    },

    listPlugins: (): PluginListResult => {
      const raw = runPluginList();
      // The CLI never ran (or errored). Nothing was parsed, so there is no
      // contract verdict to report — `contractOk: true` with no issues means
      // "no drift observed", not "the output was fine".
      if (raw === null) return { plugins: [], ok: false, contractOk: true, issues: [] };
      const parsed = parsePluginList(raw);
      return {
        plugins: parsed.plugins,
        ok: true,
        contractOk: parsed.contractOk,
        issues: parsed.issues,
      };
    },

    registryRelPath: () => registryRelPath() || DEFAULT_REGISTRY_RELPATH,
    resolveRegistryWritePath: (registryRelPath) =>
      resolveContainedRegistryWritePath(workspaceRoot, registryRelPath),
    recovery: createRecoveryPorts(workspaceRoot),
  };
}

// ---------------------------------------------------------------------------
// Recovery ports (WF-451)
// ---------------------------------------------------------------------------
//
// The ONE place in the runtime that writes a byte outside the resolver's own
// gitignored snapshot cache and the registry edit — and it writes only to
// restore a destination an interrupted transaction had already changed.
//
// Containment is not re-implemented here: every destination and every backup is
// measured through `resolveContainedPayloadTarget` (WF-448), which canonicalizes
// before deciding and never creates the path it tests. A destination whose
// containment cannot be established is refused, never probed further and never
// written.

function errno(err: unknown): string | undefined {
  return (err as NodeJS.ErrnoException | undefined)?.code;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function sha256Bytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Build the production recovery ports for one ADMITTED workspace root.
 *
 * The root is passed in rather than re-derived: WF-445's `selectWorkspaceRoot`
 * is the single admission authority, and re-deriving a root here would be a
 * second, divergent answer to a question that already has one.
 */
export function createRecoveryPorts(workspaceRoot: string): RecoveryPorts {
  const lockPath = joinSlash(workspaceRoot, LIFECYCLE_LOCK_PATH);
  const journalPath = joinSlash(workspaceRoot, LIFECYCLE_JOURNAL_PATH);

  /** Resolve one workspace-relative path to a canonical contained target, or
   *  report why it was refused. */
  const contained = (
    relPath: string,
  ): { ok: true; target: string; exists: boolean } | { ok: false; rejection: string } => {
    const resolved = resolveContainedPayloadTarget(workspaceRoot, relPath);
    if (!resolved.ok) return { ok: false, rejection: resolved.rejection };
    return { ok: true, target: resolved.canonicalTarget, exists: resolved.exists };
  };

  return {
    acquireLock: (): LockAcquisition => {
      try {
        mkdirSync(dirname(lockPath), { recursive: true });
        // `wx` is create-exclusive: the FILESYSTEM decides the single holder, so
        // two concurrent entrants can never both observe "no lock" and proceed.
        closeSync(openSync(lockPath, "wx"));
        return { ok: true };
      } catch (err) {
        if (errno(err) === "EEXIST") {
          return {
            ok: false,
            reason: "held-by-other",
            diagnostic: `another lifecycle run holds \`${LIFECYCLE_LOCK_PATH}\`; this run stops without reading or writing lifecycle state.`,
          };
        }
        return {
          ok: false,
          reason: "unavailable",
          diagnostic: `the lifecycle lock \`${LIFECYCLE_LOCK_PATH}\` could not be acquired: ${message(err)}`,
        };
      }
    },

    // Tolerant by contract: the driver calls this on every exit path, including
    // ones where the lock may already be gone.
    releaseLock: (): void => {
      try {
        rmSync(lockPath, { force: true });
      } catch {
        /* a lock that cannot be removed is reported by the next run's acquire */
      }
    },

    readJournal: (): string | null => {
      try {
        return readFileSync(journalPath, "utf8");
      } catch (err) {
        if (errno(err) === "ENOENT") return null;
        // An unreadable journal is NOT "no journal" — reporting it as absent
        // would let a caller proceed over state it never managed to read. The
        // empty string parses as malformed, which is a fail-safe stop.
        return "";
      }
    },

    observeDestination: (destination: string): DestinationObservation => {
      const target = contained(destination);
      if (!target.ok) return { kind: "not-contained", rejection: target.rejection };

      // The LITERAL path, not the canonical one: `lstatSync` does not follow a
      // terminal symlink, so a destination that IS a link is detected as one
      // rather than silently resolved to whatever it points at.
      const literal = resolve(realpathSync(workspaceRoot), destination);
      let stat;
      try {
        stat = lstatSync(literal);
      } catch (err) {
        if (errno(err) === "ENOENT") return { kind: "absent" };
        return { kind: "observation-failed", diagnostic: message(err) };
      }
      if (stat.isSymbolicLink()) return { kind: "symlink" };
      if (!stat.isFile()) {
        return {
          kind: "observation-failed",
          diagnostic: `\`${destination}\` is not a regular file.`,
        };
      }
      try {
        const bytes = readFileSync(literal);
        return { kind: "file", contentHash: sha256Bytes(bytes), bytes: bytes.byteLength };
      } catch (err) {
        return { kind: "observation-failed", diagnostic: message(err) };
      }
    },

    hashBackup: (backupPath: string): BackupIdentity => {
      const target = contained(backupPath);
      if (!target.ok) {
        return {
          ok: false,
          reason: "not-contained",
          diagnostic: `the backup \`${backupPath}\` does not resolve to a workspace-contained file (${target.rejection}).`,
        };
      }
      try {
        return { ok: true, contentHash: sha256Bytes(readFileSync(target.target)) };
      } catch (err) {
        if (errno(err) === "ENOENT") {
          return {
            ok: false,
            reason: "missing",
            diagnostic: `the backup \`${backupPath}\` no longer exists, so the prior bytes cannot be proven.`,
          };
        }
        return {
          ok: false,
          reason: "unreadable",
          diagnostic: `the backup \`${backupPath}\` could not be read: ${message(err)}`,
        };
      }
    },

    restoreBytes: (destination: string, backupPath: string): WriteOutcome => {
      const targetPath = contained(destination);
      const backup = contained(backupPath);
      if (!targetPath.ok || !backup.ok) {
        return {
          ok: false,
          diagnostic: `\`${destination}\` or its backup does not resolve to a workspace-contained target; nothing was written.`,
        };
      }
      try {
        const bytes = readFileSync(backup.target);
        mkdirSync(dirname(targetPath.target), { recursive: true });
        writeFileSync(targetPath.target, bytes);
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          diagnostic: `\`${destination}\` could not be restored: ${message(err)}`,
        };
      }
    },

    removeDestination: (destination: string): WriteOutcome => {
      const target = contained(destination);
      if (!target.ok) {
        return {
          ok: false,
          diagnostic: `\`${destination}\` does not resolve to a workspace-contained target; nothing was removed.`,
        };
      }
      try {
        rmSync(target.target, { force: true });
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          diagnostic: `\`${destination}\` could not be removed: ${message(err)}`,
        };
      }
    },

    // Called ONLY on a complete recovery. Removes exactly the backups the
    // journal named — never a recursive sweep of the backup root, which could
    // discard bytes this journal never claimed.
    discardJournal: (entries: readonly JournalEntry[]): void => {
      for (const entry of entries) {
        if (entry.backupPath === null) continue;
        const backup = contained(entry.backupPath);
        if (!backup.ok) continue;
        try {
          rmSync(backup.target, { force: true });
        } catch {
          /* a stranded backup is inert; the journal below is what matters */
        }
      }
      try {
        rmSync(journalPath, { force: true });
      } catch {
        /* a journal that survives is re-read (and re-converges) next run */
      }
      // Best-effort tidy, bounded at the backup root. `rmdirSync` is the
      // deliberate primitive — it removes an EMPTY directory and fails on a
      // populated one, which is exactly the semantics wanted here.
      // `rmSync(dir, { recursive: false })` would be a no-op dressed as a tidy:
      // it throws `EISDIR` on any directory, so the branch could never succeed.
      //
      // WF-453: the tidy now prunes the emptied ANCESTORS of each discarded
      // backup, not just the root. WF-453 is the first item that creates a backup
      // path at all, and it creates a NESTED one
      // (`<backup-root>/<transactionId>/<n>`) so two transactions can never
      // collide on one file. Pruning only the root left that subdirectory behind
      // after an otherwise complete recovery — an incomplete best-effort tidy
      // leaving directory residue. Every removal is still `rmdirSync`, so a
      // directory another transaction still occupies is left strictly alone.
      pruneEmptyBackupDirs(
        workspaceRoot,
        entries
          .map((entry) => entry.backupPath)
          .filter((path): path is string => path !== null),
      );
    },
  };
}

// ---------------------------------------------------------------------------
// Apply-transaction ports (WF-453)
// ---------------------------------------------------------------------------
//
// The production side of the FIRST PUBLIC MUTATOR. Containment is not
// re-implemented here either: every path — the destination, the backup, and the
// sibling temp file — is measured through `resolveContainedPayloadTarget`
// (WF-448), which canonicalizes before deciding and never creates the path it
// tests. Nothing is resolved against `process.cwd()`: every path is composed from
// the ADMITTED workspace root (WF-445), which is what makes the mutator correct
// against a non-cwd admitted workspace.

/**
 * Build the production apply ports for one ADMITTED workspace root and one
 * registry destination.
 *
 * `refreshAndSelfCheck` is injected rather than reached for: the snapshot rebuild
 * and the registry self-check belong to the service, and wiring them in here
 * would make this module depend on the thing that depends on it.
 */
export function createApplyPorts(
  workspaceRoot: string,
  registryRelPath: string,
  refreshAndSelfCheck: (expectation: SelfCheckExpectation) => SelfCheckOutcome,
): ApplyPorts {
  const journalPath = joinSlash(workspaceRoot, LIFECYCLE_JOURNAL_PATH);
  const backupRoot = joinSlash(workspaceRoot, LIFECYCLE_BACKUP_DIR);
  const recoveryPorts = createRecoveryPorts(workspaceRoot);

  /** Resolve one workspace-relative path to a canonical contained target. */
  const contained = (relPath: string): string | null => {
    const resolved = resolveContainedPayloadTarget(workspaceRoot, relPath);
    return resolved.ok ? resolved.canonicalTarget : null;
  };

  /** Write `bytes` to `absPath` atomically: a create-exclusive sibling temp file,
   *  durably flushed with `fsync`, then renamed over the target.
   *
   *  `rename` is what makes the destination never observable in a third state —
   *  it holds either the prior bytes or the complete new bytes, which is exactly
   *  the property the pre-recorded `lastWritten` identity depends on. `wx` is
   *  what stops the temp file itself being a symlink an attacker planted. */
  const atomicWrite = (absPath: string, bytes: Buffer): WriteOutcome => {
    const dir = dirname(absPath);
    const temp = joinSlash(
      normalizeSlashes(dir),
      `.${basename(absPath)}.wf-apply-${randomBytes(8).toString("hex")}.tmp`,
    );
    let fd: number | null = null;
    try {
      mkdirSync(dir, { recursive: true });
      fd = openSync(temp, "wx", 0o600);
      writeSync(fd, bytes);
      fsyncSync(fd);
      closeSync(fd);
      fd = null;
      renameSync(temp, absPath);
      return { ok: true };
    } catch (err) {
      if (fd !== null) {
        try {
          closeSync(fd);
        } catch {
          /* the unlink below is what matters */
        }
      }
      try {
        rmSync(temp, { force: true });
      } catch {
        /* a stranded temp file is inert and named for this run */
      }
      return { ok: false, diagnostic: message(err) };
    }
  };

  return {
    destination: registryRelPath,

    // Nested per transaction so two transactions can never collide on one backup
    // file. That nesting is what made the WF-451 root-only tidy reachable, which
    // is why `pruneEmptyBackupDirs` above now prunes ancestors.
    backupPathFor: (transactionId: string): string =>
      joinSlash(LIFECYCLE_BACKUP_DIR, transactionId, "registry"),

    newTransactionId: (): string => randomBytes(16).toString("hex"),
    now: (): string => new Date().toISOString(),

    journalPresent: (): boolean => {
      try {
        lstatSync(journalPath);
        return true;
      } catch {
        return false;
      }
    },

    backupsPresent: (): boolean => {
      try {
        return readdirSync(backupRoot).length > 0;
      } catch {
        return false;
      }
    },

    // Delegated to the recovery ports VERBATIM. One observation implementation,
    // one containment decision, one no-follow rule — a second one here would be a
    // divergent answer to a question that already has one.
    observeDestination: (): DestinationObservation =>
      recoveryPorts.observeDestination(registryRelPath),

    destinationInode: (): number | null => {
      try {
        // The LITERAL path and `lstatSync`, so a terminal symlink is stat'd as
        // the link itself and never followed.
        return lstatSync(resolve(realpathSync(workspaceRoot), registryRelPath)).ino;
      } catch {
        return null;
      }
    },

    identify: (content: string) => {
      const bytes = Buffer.from(content, "utf8");
      return { contentHash: sha256Bytes(bytes), bytes: bytes.byteLength };
    },

    writeJournal: (journal: TransactionJournal): WriteOutcome =>
      atomicWrite(journalPath, Buffer.from(`${JSON.stringify(journal, null, 2)}\n`, "utf8")),

    writeBackup: (backupPath: string): WriteOutcome => {
      const source = contained(registryRelPath);
      const target = contained(backupPath);
      if (source === null || target === null) {
        return {
          ok: false,
          diagnostic: `\`${registryRelPath}\` or its backup \`${backupPath}\` does not resolve to a workspace-contained target; nothing was backed up.`,
        };
      }
      try {
        return atomicWrite(target, readFileSync(source));
      } catch (err) {
        return {
          ok: false,
          diagnostic: `the prior bytes of \`${registryRelPath}\` could not be read: ${message(err)}`,
        };
      }
    },

    hashBackup: (backupPath: string): BackupIdentity => recoveryPorts.hashBackup(backupPath),

    atomicReplace: (content: string): WriteOutcome => {
      const target = contained(registryRelPath);
      if (target === null) {
        return {
          ok: false,
          diagnostic: `\`${registryRelPath}\` does not resolve to a workspace-contained target; nothing was written.`,
        };
      }
      return atomicWrite(target, Buffer.from(content, "utf8"));
    },

    refreshAndSelfCheck,

    // DURABLE COMPLETION — the JOURNAL FIRST. See the `apply-transaction.ts`
    // header: at this call site the destination is at its NEW state, so a kill
    // between "backups removed" and "journal removed" would leave a journal
    // demanding a restore from a backup that no longer exists. Removing the
    // journal first makes the transaction durably complete at that instant; the
    // worst remaining outcome is an orphan backup, which the prune reclaims.
    discardTransaction: (entries: readonly JournalEntry[]): void => {
      try {
        rmSync(journalPath, { force: true });
      } catch {
        /* a journal that survives is re-read (and re-converges) next run */
      }
      const backupPaths: string[] = [];
      for (const entry of entries) {
        if (entry.backupPath === null) continue;
        backupPaths.push(entry.backupPath);
        const target = contained(entry.backupPath);
        if (target === null) continue;
        try {
          rmSync(target, { force: true });
        } catch {
          /* a stranded backup is inert; the prune below reclaims what it can */
        }
      }
      pruneEmptyBackupDirs(workspaceRoot, backupPaths);
    },

    rollbackPorts: (): RecoveryPorts => recoveryPorts,
  };
}

/**
 * Remove every directory that a discarded backup emptied, walking up from each
 * backup's own parent and stopping AT the backup root — never above it.
 *
 * Bounded three ways, because a directory prune that escapes is strictly worse
 * than the residue it removes: it only ever calls `rmdirSync` (which fails on a
 * populated directory), it only visits ancestors of a path the journal itself
 * named, and it refuses any candidate that is not a proper descendant of — or
 * exactly — the backup root.
 */
export function pruneEmptyBackupDirs(
  workspaceRoot: string,
  backupPaths: readonly string[],
): void {
  const root = joinSlash(workspaceRoot, LIFECYCLE_BACKUP_DIR);
  const rootPrefix = root.replace(/\/+$/, "");

  const candidates = new Set<string>();
  for (const backupPath of backupPaths) {
    let current = normalizeSlashes(resolve(workspaceRoot, backupPath));
    // Walk up from the backup file's parent to the root.
    for (let guard = 0; guard < 64; guard++) {
      const parent = normalizeSlashes(dirname(current));
      if (parent === current) break;
      current = parent;
      if (current === rootPrefix) {
        candidates.add(current);
        break;
      }
      if (!current.startsWith(`${rootPrefix}/`)) break;
      candidates.add(current);
    }
  }
  candidates.add(rootPrefix);

  // Deepest first, so a parent becomes empty only after its children are gone.
  for (const dir of [...candidates].sort((left, right) => right.length - left.length)) {
    try {
      rmdirSync(dir);
    } catch {
      /* non-empty or absent — both fine, and both mean STOP for this branch */
    }
  }
}
