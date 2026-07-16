// wf resolver — filesystem + CLI wiring around the pure builder.
//
// Gathers the deterministic inputs from a real workspace: reads wf.config.js
// (for the optional `registryPath`, default `_local/config.md`), the registry
// file, the core config file, and runs `claude plugin list --json` for installed
// plugin metadata (the ONLY source of installed-pack facts — never a private
// Claude install manifest). Then calls buildSnapshot and persists it atomically.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { normalizeSlashes } from "./paths.js";
import { buildSnapshot, type BuildSnapshotInputs, type ResolverIO } from "./resolve.js";
import { writeSnapshot } from "./snapshot-store.js";
import type { ResolverSnapshot } from "./types.js";

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

/** Real read-only IO port backed by the filesystem. */
export const fsIO: ResolverIO = { readFile: readOrNull };

/** Extract `registryPath` from wf.config.js text without evaluating the module
 *  (mirrors validate-registry.sh CHECK 1: a single quoted value, first hit). The
 *  value is forward-slash normalized so both the read path and the recorded
 *  `snapshot.registryPath` / registry source-fingerprint honor the documented
 *  "normalized (forward-slash), workspace-relative" contract (see types.ts). */
export function extractRegistryPath(wfConfig: string | null): string {
  if (!wfConfig) return DEFAULT_REGISTRY_RELPATH;
  const m = /^\s*registryPath\s*:\s*["']([^"']*)["']/m.exec(wfConfig);
  const v = m?.[1]?.trim();
  return v && v.length > 0 ? normalizeSlashes(v) : DEFAULT_REGISTRY_RELPATH;
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
  /** Override the plugin-list source (tests inject fixtures). A provided
   *  override is always REAL CLI output — never a failure; the CLI-unavailable
   *  (null) path is reached only when the real `runPluginList` errors. */
  pluginListRaw?: string;
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

  const pluginListRaw = opts.pluginListRaw ?? runPluginList();
  const now = (opts.now ?? (() => new Date()))();

  const inputs: BuildSnapshotInputs = {
    workspaceRoot,
    registryPathValue,
    registryContent,
    wfConfigContent,
    coreConfigContent,
    pluginListRaw,
    generatedAt: now.toISOString(),
    generator: opts.generator ?? { name: "wf-resolver", version: "0.1.0" },
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
