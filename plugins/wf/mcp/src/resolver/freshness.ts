// wf resolver — deterministic freshness evaluation (WF-271).
//
// Freshness is driven ENTIRELY by recorded input fingerprints + explicit
// requests — NEVER by elapsed time / TTL. There is no clock read, no
// `generatedAt` comparison, no expiry window anywhere in this module. A snapshot
// is stale iff one of its declared inputs changed, its schema/resolver version
// is incompatible, or a typed consumer explicitly requested invalidation.
//
// `evaluateFreshness` is a PURE function of the snapshot + a read-only probe. It
// re-reads ONLY the exact source paths the snapshot already recorded (bounded,
// deterministic) and re-hashes them — it NEVER walks capability folders / lists
// directories, so the hot path (unchanged inputs) stays cheap. Plugin-inventory
// validation is opt-in (the probe supplies a current `pluginListRaw`): the
// per-query correctness backstop validates the file fingerprints; the Session
// hook / a full refresh additionally validate the plugin inventory.

import { fingerprint } from "./fingerprint.js";
import { joinSlash, normalizeSlashes } from "./paths.js";
import { parsePluginList } from "./plugin-list.js";
import {
  RESOLVER_GENERATOR,
  SNAPSHOT_SCHEMA_VERSION,
  type ResolverSnapshot,
  type SourceFingerprint,
} from "./types.js";

/** A single reason a snapshot was judged stale — surfaced as a diagnostic so a
 *  refresh/invalidation is always explainable (never a silent rebuild). */
export interface StaleReason {
  code: string;
  message: string;
  /** The source path / id implicated, when applicable. */
  source?: string;
}

/** Read-only probe used to re-fingerprint current inputs. `readFile` re-reads a
 *  recorded source by absolute path; `pluginListRaw`, when provided, opts the
 *  plugin inventory into validation (omit it on the cheap per-query path). */
export interface FreshnessProbe {
  readFile(absPath: string): string | null;
  /** Raw `claude plugin list --json` output to validate the plugin inventory
   *  against. `undefined` = skip inventory validation (file/schema only);
   *  `null` = the CLI was unavailable (a recorded absence to compare). */
  pluginListRaw?: string | null;
  /** Current resolver generator version, to detect a runtime upgrade. Defaults
   *  to the bundled `RESOLVER_GENERATOR.version`. */
  generatorVersion?: string;
}

export interface FreshnessResult {
  fresh: boolean;
  reasons: StaleReason[];
}

/** The file-backed source kinds the cheap per-query check re-reads + re-hashes.
 *  Bounded to the exact recorded paths — never a directory walk. The
 *  `plugin-list` source is validated separately (only when the probe opts in). */
const FILE_SOURCE_KINDS: ReadonlySet<SourceFingerprint["kind"]> = new Set([
  "wf-config",
  "registry",
  "core-config",
  "manifest",
  "profile",
]);

/** True when a recorded source path is absolute (POSIX `/…` or Windows `C:/…`),
 *  in which case it is read as-is; otherwise it is workspace-relative. */
function isAbsolute(p: string): boolean {
  return p.startsWith("/") || /^[A-Za-z]:\//.test(p);
}

/** Reconstruct the absolute OS-ish path for a recorded (normalized) source. */
function absOf(workspaceRoot: string, recordedPath: string): string {
  const p = normalizeSlashes(recordedPath);
  return isAbsolute(p) ? p : joinSlash(workspaceRoot, p);
}

/**
 * Normalize `claude plugin list --json` to a stable projection for
 * fingerprinting add/remove/enable/disable — order-independent, dropping any
 * cosmetic field the resolver does not depend on. A `null` raw (CLI
 * unavailable) stays `null` (a recorded absence). Unparseable / contract-broken
 * output falls back to the raw text so a drift is still detected rather than
 * masked as an empty inventory.
 */
export function normalizePluginList(raw: string | null): string | null {
  if (raw === null) return null;
  const parsed = parsePluginList(raw);
  if (!parsed.contractOk && parsed.plugins.length === 0) {
    return raw;
  }
  const projected = parsed.plugins
    .map((p) => ({
      id: p.id,
      name: p.name,
      version: p.version,
      scope: p.scope,
      enabled: p.enabled,
      installPath: p.installPath,
    }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return JSON.stringify(projected);
}

/**
 * Evaluate whether `snapshot` is still fresh against current inputs. Pure:
 * every decision is a fingerprint / version comparison — never a time check.
 *
 * Order of checks (all accumulated, none short-circuit, so the caller gets the
 * full reason set for diagnostics):
 *   1. schema-version incompatibility (a hard reader-level mismatch);
 *   2. resolver generator-version change (a runtime upgrade);
 *   3. each recorded FILE source re-read + re-hashed by its exact path;
 *   4. the plugin inventory, only when the probe supplies a current raw.
 */
export function evaluateFreshness(
  snapshot: ResolverSnapshot,
  workspaceRoot: string,
  probe: FreshnessProbe,
): FreshnessResult {
  const reasons: StaleReason[] = [];

  if (snapshot.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) {
    reasons.push({
      code: "schema/incompatible",
      message: `snapshot schemaVersion ${String(
        snapshot.schemaVersion,
      )} is incompatible with this runtime (expects ${SNAPSHOT_SCHEMA_VERSION}).`,
    });
  }

  const currentGenVersion = probe.generatorVersion ?? RESOLVER_GENERATOR.version;
  if (snapshot.generator?.version && snapshot.generator.version !== currentGenVersion) {
    reasons.push({
      code: "resolver/version-changed",
      message: `snapshot built by resolver ${snapshot.generator.version}; runtime is ${currentGenVersion}.`,
    });
  }

  for (const src of snapshot.sources) {
    if (!FILE_SOURCE_KINDS.has(src.kind)) continue;
    const content = probe.readFile(absOf(workspaceRoot, src.path));
    const now = fingerprint(src.kind, src.path, content);
    if (now.present !== src.present || now.sha256 !== src.sha256) {
      const change = !now.present ? "was removed" : !src.present ? "appeared" : "changed";
      reasons.push({
        code: `${src.kind}/changed`,
        message: `${src.kind} source \`${src.path}\` ${change}.`,
        source: src.path,
      });
    }
  }

  if (probe.pluginListRaw !== undefined) {
    const recorded = snapshot.sources.find((s) => s.kind === "plugin-list");
    const now = fingerprint(
      "plugin-list",
      "claude plugin list --json",
      normalizePluginList(probe.pluginListRaw),
    );
    if (!recorded || now.present !== recorded.present || now.sha256 !== recorded.sha256) {
      reasons.push({
        code: "plugin-list/changed",
        message:
          "installed plugin inventory changed (add / remove / enable / disable) since the snapshot.",
        source: "claude plugin list --json",
      });
    }
  }

  return { fresh: reasons.length === 0, reasons };
}
