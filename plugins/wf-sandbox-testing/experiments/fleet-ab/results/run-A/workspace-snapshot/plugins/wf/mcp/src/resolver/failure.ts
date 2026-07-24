// wf resolver — surface-specific failure semantics (WF-272).
//
// Turns a broken resolver state into a PREDICTABLE, SAFE decision, without ever
// falling back to folder-walking or environment probing. Two moving parts:
//
//   1. CATEGORIZATION — map a diagnostic code (or a caught throw) to one of the
//      fixed `ResolverErrorCategory` values, each with a recovery path that
//      names `/wf:resolve refresh` or `/wf:resolve invalidate`.
//   2. SURFACE BINDING — bind a failure to the EXISTING core degradation policy
//      by surface class: a local-only read CONTINUES (best-effort, with
//      diagnostics + recovery), a tracker write WARNS and continues, a delivery
//      write BLOCKS before any mutation. Identical to the delivery-block /
//      tracker-warn / silent-local-read policy already documented in
//      `_contracts/capability-registry.ops.md` — this only re-expresses it for
//      resolver failures.
//
// This module reads nothing and probes nothing: it classifies already-collected
// diagnostics / a caught throw and returns a decision. The "no fallback to
// folder/environment probing on the failure path" invariant (C008) is upheld
// structurally — there is no filesystem/CLI access anywhere in here.

import type { Diagnostic, ResolverErrorCategory } from "./types.js";

/** The three surface classes a resolver failure is bound against. */
export type SurfaceClass = "local-read" | "tracker-write" | "delivery-write";

/** The reaction a surface takes when the resolver is unhealthy. */
export type FailureReaction = "continue" | "warn" | "block";

/** A hard resolver failure (a caught throw), classified into the taxonomy. */
export interface ResolverFailure {
  category: ResolverErrorCategory;
  /** The failed input / state, echoed so the caller can see WHAT broke. */
  failedInput: string;
  message: string;
}

/**
 * Map a diagnostic `code` to its failure category, or `null` when the code is
 * not a failure signal (an ordinary info/deferred note). Prefix-based so a new
 * code in an existing family classifies without a table edit.
 */
export function categorizeCode(code: string): ResolverErrorCategory | null {
  if (code === "plugin-list/cli-unavailable") return "cli-unavailable";
  if (code.startsWith("snapshot/missing")) return "snapshot-missing";
  if (code.startsWith("snapshot/malformed")) return "snapshot-malformed";
  if (code.startsWith("schema/")) return "schema-incompatible";
  if (code.startsWith("resolver/version")) return "schema-incompatible";
  if (code.startsWith("fingerprint/")) return "fingerprint-unresolvable";
  // Registry / manifest / profile / settings / plugin-list contract problems.
  if (
    code.startsWith("registry/") ||
    code.startsWith("capability/") ||
    code.startsWith("profile/") ||
    code.startsWith("settings/") ||
    code.startsWith("manifest/") ||
    code.startsWith("plugin-list/")
  ) {
    return "registry-invalid";
  }
  return null;
}

/** True when a snapshot diagnostic signals a resolver failure (error severity
 *  OR a categorizable warning like cli-unavailable). Info notes are ignored. */
export function isFailureSignal(d: Diagnostic): boolean {
  if (d.severity === "error") return true;
  return categorizeCode(d.code) !== null;
}

/** The recovery path for a category — always names a `/wf:resolve` action so a
 *  broken state is never a dead end. */
export function recoveryFor(category: ResolverErrorCategory): string {
  switch (category) {
    case "snapshot-missing":
      return "No resolution snapshot exists yet. Run `/wf:resolve refresh` to build it.";
    case "snapshot-malformed":
      return "The cached snapshot is unreadable. Run `/wf:resolve refresh` to rebuild it, or `/wf:resolve invalidate` to force a rebuild on the next query.";
    case "schema-incompatible":
      return "The snapshot schema is incompatible with this runtime. Run `/wf:resolve refresh` to rebuild it under the current schema.";
    case "fingerprint-unresolvable":
      return "A recorded source input could not be re-read to validate freshness. Restore the missing input, then run `/wf:resolve refresh` (or `/wf:resolve invalidate`).";
    case "cli-unavailable":
      return "`claude plugin list --json` could not run, so installed-pack facts are unknown. Ensure the `claude` CLI is on PATH, then run `/wf:resolve refresh`.";
    case "registry-invalid":
      return "The capability registry or a manifest/profile is invalid. Fix the registry or re-run the owning pack's init, then run `/wf:resolve refresh`.";
    case "ref-not-found":
      return "The root resolved fine but no file exists at the joined path — the ref shape is likely wrong. A ref is relative to its root including any subfolder (a capability fragment ref is e.g. `fragments/tracker.ops.md`, never the bare filename; the provider record's `fragmentPath` shows the exact shape). Fix the ref and retry; run `/wf:resolve refresh` only if the pack was genuinely relocated.";
  }
}

/** Attach `category` + `recovery` to a failure-signal diagnostic (idempotent —
 *  a diagnostic that already carries a category keeps it). Non-failure
 *  diagnostics are returned unchanged. */
export function annotate(d: Diagnostic): Diagnostic {
  if (d.category) return d.recovery ? d : { ...d, recovery: recoveryFor(d.category) };
  const category = categorizeCode(d.code);
  if (!category) return d;
  return { ...d, category, recovery: recoveryFor(category) };
}

/**
 * Classify a caught throw (from a snapshot build / cache read) into a failure
 * category by its message. Deterministic and probe-free: it inspects only the
 * error text, never the filesystem.
 */
export function classifyThrow(err: unknown): ResolverFailure {
  const message = err instanceof Error ? err.message : String(err);
  let category: ResolverErrorCategory;
  if (/schema\s*version|schemaversion|incompatible schema|schema is incompatible/i.test(message)) {
    category = "schema-incompatible";
  } else if (/fingerprint|re-?read|unresolvable source/i.test(message)) {
    category = "fingerprint-unresolvable";
  } else if (/malformed|corrupt|unparse|json|parse error|invalid snapshot/i.test(message)) {
    category = "snapshot-malformed";
  } else {
    category = "snapshot-missing";
  }
  return { category, failedInput: "resolution snapshot", message };
}

/**
 * Bind (un)healthy resolver state to a surface's reaction — THE surface-specific
 * failure policy. A healthy resolver never degrades any surface. An unhealthy
 * resolver reproduces the existing core degradation policy:
 *   - local-read    → continue (best-effort, with diagnostics + recovery);
 *   - tracker-write → warn (surface diagnostics + recovery, then continue);
 *   - delivery-write→ block (before any mutation, with diagnostics + recovery).
 */
export function reactionFor(surface: SurfaceClass, healthy: boolean): FailureReaction {
  if (healthy) return "continue";
  switch (surface) {
    case "local-read":
      return "continue";
    case "tracker-write":
      return "warn";
    case "delivery-write":
      return "block";
  }
}
