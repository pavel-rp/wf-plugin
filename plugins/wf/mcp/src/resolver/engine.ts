// wf resolver — filesystem + CLI wiring around the pure builder.
//
// Gathers the deterministic inputs from a real workspace: reads wf.config.js
// (for the optional `registryPath`, default `_local/config.md`), the registry
// file, the core config file, and runs `claude plugin list --json` for installed
// plugin metadata (the ONLY source of installed-pack facts — never a private
// Claude install manifest). Then calls buildSnapshot and persists it atomically.

import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  normalizeSlashes,
  resolveContainedCapabilityPath,
  type ContainedFileReadResult,
} from "./paths.js";
import { buildSnapshot, type BuildSnapshotInputs, type ResolverIO } from "./resolve.js";
import { writeSnapshot } from "./snapshot-store.js";
import {
  RESOLVER_GENERATOR,
  type ContainedFileFingerprintResult,
  type ResolverSnapshot,
} from "./types.js";

const DEFAULT_REGISTRY_RELPATH = "_local/config.md";

/** Read a file's UTF-8 content, or null when absent. */
function readOrNull(absPath: string): string | null {
  try {
    return readFileSync(absPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

/** Read one manifest-selected capability file through a descriptor after canonical
 * containment and identity checks. The bounded descriptor loop prevents a raced
 * growth from materializing more than `maxBytes + 1` bytes. */
type ContainedBytesResult =
  | { status: "ok"; path: string; content: Buffer }
  | {
      status: "missing" | "unsafe" | "too-large" | "unsupported" | "unreadable";
      path: string | null;
      content: null;
    };

function readContainedCapabilityBytes(
  root: string,
  selectedPath: string,
  maxBytes: number,
): ContainedBytesResult {
  const lexicalPath = resolveContainedCapabilityPath(root, selectedPath);
  if (lexicalPath === null || !Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    return { status: "unsafe", path: lexicalPath, content: null };
  }

  const inside = (canonicalRoot: string, candidate: string): boolean => {
    const fromRoot = relative(canonicalRoot, candidate);
    return fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot);
  };
  const comparable = (path: string): string => {
    const normalized = normalizeSlashes(path);
    return process.platform === "win32" ? normalized.toLowerCase() : normalized;
  };
  const sameIdentity = (
    left: { dev: bigint; ino: bigint },
    right: { dev: bigint; ino: bigint },
  ): boolean => left.dev === right.dev && left.ino === right.ino;

  let fd: number | null = null;
  let targetValidated = false;
  try {
    const canonicalRoot = realpathSync(root);
    const rootStat = statSync(canonicalRoot, { bigint: true });
    if (!rootStat.isDirectory()) {
      return { status: "unsafe", path: lexicalPath, content: null };
    }

    const segments = selectedPath.split("/");
    const canonicalCandidate = resolve(canonicalRoot, ...segments);
    if (!inside(canonicalRoot, canonicalCandidate)) {
      return { status: "unsafe", path: lexicalPath, content: null };
    }

    let cursor = canonicalRoot;
    for (const segment of segments) {
      cursor = resolve(cursor, segment);
      if (lstatSync(cursor).isSymbolicLink()) {
        return { status: "unsafe", path: lexicalPath, content: null };
      }
    }

    const canonicalTarget = realpathSync(canonicalCandidate);
    if (
      !inside(canonicalRoot, canonicalTarget) ||
      comparable(canonicalTarget) !== comparable(canonicalCandidate)
    ) {
      return { status: "unsafe", path: lexicalPath, content: null };
    }

    const expected = statSync(canonicalTarget, { bigint: true });
    if (!expected.isFile()) {
      return { status: "unsafe", path: lexicalPath, content: null };
    }
    if (expected.size > BigInt(maxBytes)) {
      return { status: "too-large", path: lexicalPath, content: null };
    }
    targetValidated = true;

    if (typeof constants.O_NOFOLLOW !== "number" || constants.O_NOFOLLOW === 0) {
      return { status: "unsupported", path: lexicalPath, content: null };
    }
    const nonBlock = typeof constants.O_NONBLOCK === "number" ? constants.O_NONBLOCK : 0;
    fd = openSync(canonicalTarget, constants.O_RDONLY | constants.O_NOFOLLOW | nonBlock);
    const opened = fstatSync(fd, { bigint: true });
    if (!opened.isFile() || !sameIdentity(expected, opened)) {
      return { status: "unsafe", path: lexicalPath, content: null };
    }
    if (opened.size > BigInt(maxBytes)) {
      return { status: "too-large", path: lexicalPath, content: null };
    }

    const postOpenTarget = realpathSync(canonicalCandidate);
    const postOpenStat = statSync(canonicalCandidate, { bigint: true });
    const postOpenRoot = statSync(canonicalRoot, { bigint: true });
    if (
      comparable(postOpenTarget) !== comparable(canonicalTarget) ||
      !inside(canonicalRoot, postOpenTarget) ||
      !sameIdentity(opened, postOpenStat) ||
      !sameIdentity(rootStat, postOpenRoot)
    ) {
      return { status: "unsafe", path: lexicalPath, content: null };
    }

    const chunks: Buffer[] = [];
    let total = 0;
    while (total <= maxBytes) {
      const remaining = maxBytes + 1 - total;
      const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, remaining));
      const bytesRead = readSync(fd, buffer, 0, buffer.length, total);
      if (bytesRead === 0) break;
      chunks.push(buffer.subarray(0, bytesRead));
      total += bytesRead;
    }
    if (total > maxBytes) {
      return { status: "too-large", path: lexicalPath, content: null };
    }

    const afterRead = fstatSync(fd, { bigint: true });
    if (!sameIdentity(opened, afterRead) || afterRead.size !== opened.size) {
      return { status: "unsafe", path: lexicalPath, content: null };
    }
    return {
      status: "ok",
      path: normalizeSlashes(lexicalPath),
      content: Buffer.concat(chunks, total),
    };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ELOOP") return { status: "unsafe", path: lexicalPath, content: null };
    if (code === "ENOENT" && !targetValidated) {
      return { status: "missing", path: lexicalPath, content: null };
    }
    return {
      status: targetValidated ? "unsafe" : "unreadable",
      path: lexicalPath,
      content: null,
    };
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

export function readContainedCapabilityFile(
  root: string,
  selectedPath: string,
  maxBytes: number,
): ContainedFileReadResult {
  const result = readContainedCapabilityBytes(root, selectedPath, maxBytes);
  return result.status === "ok"
    ? { status: "ok", path: result.path, content: result.content.toString("utf8") }
    : { status: result.status, path: result.path, content: null };
}

/** Fingerprint raw bytes of one contained regular non-symlink source. No source
 * body is returned or converted through UTF-8. */
export function fingerprintContainedCapabilityFile(
  root: string,
  selectedPath: string,
  maxBytes: number,
): ContainedFileFingerprintResult {
  const result = readContainedCapabilityBytes(root, selectedPath, maxBytes);
  return result.status === "ok"
    ? {
        status: "ok",
        path: result.path,
        sha256: createHash("sha256").update(result.content).digest("hex"),
        bytes: result.content.length,
      }
    : { status: result.status, path: result.path, sha256: null, bytes: null };
}

/** List immediate file (non-directory) names of a directory, or `[]` when it is
 *  absent — the settings-validation pass enumerates `_local/profiles/` with it. */
function listFilesOrEmpty(absDir: string): string[] {
  try {
    return readdirSync(absDir, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => e.name);
  } catch {
    return [];
  }
}

/** Real read-only IO port backed by the filesystem. */
export const fsIO: ResolverIO = {
  readFile: readOrNull,
  readContainedFile: readContainedCapabilityFile,
  listFiles: listFilesOrEmpty,
};

/** Extract the configured value verbatim (apart from surrounding whitespace). */
export function extractRegistryPathRaw(wfConfig: string | null): string {
  if (!wfConfig) return DEFAULT_REGISTRY_RELPATH;
  const m = /^\s*registryPath\s*:\s*["']([^"']*)["']/m.exec(wfConfig);
  const v = m?.[1]?.trim();
  return v && v.length > 0 ? v : DEFAULT_REGISTRY_RELPATH;
}

/** Extract `registryPath` from wf.config.js text without evaluating the module
 *  (mirrors validate-registry.sh CHECK 1: a single quoted value, first hit). The
 *  value is forward-slash normalized so both the read path and the recorded
 *  `snapshot.registryPath` / registry source-fingerprint honor the documented
 *  "normalized (forward-slash), workspace-relative" contract (see types.ts). */
export function extractRegistryPath(wfConfig: string | null): string {
  return normalizeSlashes(extractRegistryPathRaw(wfConfig));
}

/** Run `claude plugin list --json`. Returns raw stdout on success, or `null`
 *  when the CLI is unavailable or errors — a genuine failure that the builder
 *  records as an ABSENT plugin-list source (with a diagnostic), never masked as
 *  an empty `"[]"` that would falsely read as "no plugins installed". */
export function runPluginList(): string | null {
  try {
    return execFileSync("claude", ["plugin", "list", "--json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}

export interface ResolveOptions {
  workspaceRoot: string;
  /** Normalized absolute core `wf` plugin root — the anchor for locating a core
   *  skill's `interface.md` in the settings-validation pass (WF-328). Omitted in
   *  tests that drive only pack-skill interfaces. */
  corePluginRoot?: string | null;
  /** Override the plugin-list source (tests inject fixtures), aligning with the
   *  builder's `string | null` contract: a `string` is REAL CLI output (including
   *  an empty `"[]"`); `null` is an injected CLI-unavailable signal (recorded as
   *  an ABSENT plugin-list source, deterministic — never a shell-out). Only
   *  OMITTING the override (`undefined`) falls through to the real
   *  `runPluginList()`. This lets a test model "CLI unavailable" without ever
   *  invoking the real `claude` CLI. */
  pluginListRaw?: string | null;
  io?: ResolverIO;
  now?: () => Date;
  generator?: { name: string; version: string };
}

/** Gather inputs, build the snapshot (does not persist). */
export function resolveSnapshot(opts: ResolveOptions): ResolverSnapshot {
  const workspaceRoot = normalizeSlashes(opts.workspaceRoot);
  const io = opts.io ?? fsIO;

  const wfConfigContent = io.readFile(join(opts.workspaceRoot, "wf.config.js"));
  const registryPathValue = extractRegistryPath(wfConfigContent);

  const registryAbs = join(opts.workspaceRoot, registryPathValue);
  const registryContent = io.readFile(registryAbs);

  const coreConfigAbs = join(opts.workspaceRoot, DEFAULT_REGISTRY_RELPATH);
  const coreConfigContent =
    registryPathValue === DEFAULT_REGISTRY_RELPATH
      ? registryContent
      : io.readFile(coreConfigAbs);

  // Distinguish an omitted override (undefined → run the real CLI) from an
  // injected CLI-unavailable signal (null → honored verbatim, no shell-out). A
  // plain `?? runPluginList()` is nullish-coalescing, so it would shell out for
  // BOTH null and undefined — dropping an injected null and reaching the real CLI.
  const pluginListRaw =
    opts.pluginListRaw !== undefined ? opts.pluginListRaw : runPluginList();
  const now = (opts.now ?? (() => new Date()))();

  const inputs: BuildSnapshotInputs = {
    workspaceRoot,
    registryPathValue,
    registryContent,
    wfConfigContent,
    coreConfigContent,
    pluginListRaw,
    generatedAt: now.toISOString(),
    generator: opts.generator ?? { ...RESOLVER_GENERATOR },
    corePluginRoot: opts.corePluginRoot ?? null,
  };

  return buildSnapshot(inputs, io);
}

/** Gather inputs, build the snapshot, and persist it atomically. Returns the
 *  snapshot plus the absolute cache path it was written to. */
export function resolveAndPersist(opts: ResolveOptions): {
  snapshot: ResolverSnapshot;
  cachePath: string;
} {
  const snapshot = resolveSnapshot(opts);
  const cachePath = writeSnapshot(opts.workspaceRoot, snapshot);
  return { snapshot, cachePath };
}
