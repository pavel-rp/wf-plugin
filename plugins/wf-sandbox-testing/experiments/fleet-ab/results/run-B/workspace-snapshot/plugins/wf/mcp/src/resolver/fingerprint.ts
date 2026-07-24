// wf resolver — source fingerprints.
//
// A fingerprint is a content hash of a deterministic input — the basis for the
// freshness/recovery facts the snapshot records. WF-269 only RECORDS these; the
// refresh/invalidation policy that consumes them is WF-271. Content-based (not
// mtime-based) so a snapshot rebuild from identical inputs is reproducible.

import { createHash } from "node:crypto";
import type { SourceFingerprint } from "./types.js";

/** sha256 hex of a UTF-8 string. */
export function sha256Hex(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/** Build a fingerprint record for a present-or-absent source. */
export function fingerprint(
  kind: SourceFingerprint["kind"],
  path: string,
  content: string | null,
): SourceFingerprint {
  if (content === null) {
    return { kind, path, sha256: null, bytes: null, present: false };
  }
  return {
    kind,
    path,
    sha256: sha256Hex(content),
    bytes: Buffer.byteLength(content, "utf8"),
    present: true,
  };
}
