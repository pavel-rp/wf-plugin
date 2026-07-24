// wf resolver — atomic snapshot persistence (project-local, gitignored).
//
// The snapshot is written to SNAPSHOT_CACHE_RELPATH under the workspace root
// (`_local/…`, already gitignored). Writes are ATOMIC: the JSON is written to a
// unique temp file in the same directory, then renamed over the target — a
// reader never observes a half-written snapshot. Reads validate the schema
// version and reject a snapshot from an incompatible schema.

import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import {
  SNAPSHOT_CACHE_RELPATH,
  SNAPSHOT_SCHEMA_VERSION,
  type ResolverSnapshot,
} from "./types.js";

/** Absolute OS path to the snapshot cache file for a workspace. */
export function snapshotPath(workspaceRoot: string): string {
  return join(workspaceRoot, SNAPSHOT_CACHE_RELPATH);
}

/** Atomically write a snapshot to the cache. Creates parent dirs as needed. */
export function writeSnapshot(workspaceRoot: string, snapshot: ResolverSnapshot): string {
  const target = snapshotPath(workspaceRoot);
  const dir = dirname(target);
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `.snapshot.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
  const json = `${JSON.stringify(snapshot, null, 2)}\n`;
  try {
    writeFileSync(tmp, json, { encoding: "utf8" });
    renameSync(tmp, target); // atomic on the same filesystem
  } catch (err) {
    try {
      rmSync(tmp, { force: true });
    } catch {
      /* best effort */
    }
    throw err;
  }
  return target;
}

export class SnapshotSchemaError extends Error {
  constructor(
    readonly found: unknown,
    readonly expected: number,
  ) {
    super(
      `resolver snapshot schemaVersion ${String(found)} is incompatible with this runtime (expects ${expected}); rebuild the snapshot.`,
    );
    this.name = "SnapshotSchemaError";
  }
}

/** Read + validate a persisted snapshot. Returns `null` when the cache file is
 *  absent; throws `SnapshotSchemaError` on a version mismatch. */
export function readSnapshot(workspaceRoot: string): ResolverSnapshot | null {
  const target = snapshotPath(workspaceRoot);
  let raw: string;
  try {
    raw = readFileSync(target, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  const parsed = JSON.parse(raw) as ResolverSnapshot;
  if (parsed.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) {
    throw new SnapshotSchemaError(parsed.schemaVersion, SNAPSHOT_SCHEMA_VERSION);
  }
  return parsed;
}
