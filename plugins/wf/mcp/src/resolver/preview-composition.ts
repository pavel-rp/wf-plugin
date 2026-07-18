// wf resolver — dry-run composition preview (WF-354).
//
// An author registering a capability today cannot see WHAT WOULD COMPOSE
// without registering it for real and running a phase. This renders that answer
// straight off the already-resolved snapshot: which fragments would fire at a
// phase, in registry order, each carrying its provenance.
//
// --- It is NOT a ValidationVerdict (D-4) ---
// A composition preview has no pass/fail semantics. Forcing it into the frozen
// verdict shape would corrupt that shape's meaning — `status: "pass"` on a
// preview asserts nothing. So it returns its own narrow read-only record, and
// ZERO ENTRIES IS A FIRST-CLASS INERT OUTCOME, never an error: a project with an
// empty `## Capabilities` table composes nothing, which is the contract's
// designed behaviour ("a phase with no attached fragments runs exactly as if
// inert"), not a fault to report.
//
// --- No new machinery ---
// `CapabilityRecord` already carries, in registry order, `name`,
// `registryPath`, `resolvedPath`, `manifestPath`, `provenance`, `validity`, and
// `fragments[]` of `FragmentRecord { phase, contributionKind, dispatch, scope }`.
// That is the whole input. Nothing here parses a manifest, resolves a path, or
// reads a fragment BODY — the preview names the dispatch target; following it
// remains the consumer's job in its own isolated context.

import type { CapabilityRecord, ResolverSnapshot } from "./types.js";

/** One fragment that would fire, with its provenance. */
export interface CompositionPreviewEntry {
  /** 0-based position in the composed order (registry order, general → specific). */
  order: number;
  /** The owning capability's registry name. */
  capability: string;
  /** The phase this fragment attaches to (`—` for a point-targeted kind). */
  phase: string;
  contributionKind: string;
  /** The raw `dispatch` token (`inline: <rel-path>` / `subagent: <agent>`) —
   *  the target, never the body it points at. */
  dispatch: string;
  /** Partition scope (`surface` token / `source→target` pair / `skill.point`
   *  plus merge policy), or `null` for an unpartitioned kind. */
  scope: string | null;
  /** Where the owning capability resolved from, for provenance. */
  registryPath: string;
  resolvedPath: string | null;
  manifestPath: string | null;
  provenance: CapabilityRecord["provenance"];
  validity: CapabilityRecord["validity"];
}

/** The preview record. Deliberately not a `ValidationVerdict` (D-4). */
export interface CompositionPreview {
  tool: "preview_composition";
  /** The phase filter that was applied, or `null` for every phase. */
  phase: string | null;
  /** Every fragment that would fire, in registry order. Empty is inert, not an error. */
  entries: CompositionPreviewEntry[];
  /** How many active registry capabilities were considered. */
  capabilitiesConsidered: number;
  /** Distinct phases present in `entries`, first-seen order. */
  phasesCovered: string[];
  /** The snapshot state this was rendered from — the preview reads, never resolves. */
  renderedFrom: {
    schemaVersion: number;
    generatedAt: string;
    generator: { name: string; version: string };
    workspaceRoot: string;
    registryPath: string;
  };
  summary: string;
}

/**
 * Render the composition preview from a resolved snapshot.
 *
 * Pure: it takes the snapshot and returns the record. It performs no I/O, so it
 * cannot write, refresh, or invalidate anything — the read-only guarantee is
 * structural rather than promised.
 *
 * @param phase optional phase filter; omit (or pass `null`) for every phase
 */
export function previewComposition(
  snapshot: ResolverSnapshot,
  phase?: string | null,
): CompositionPreview {
  const want = phase?.trim() ? phase.trim() : null;

  const entries: CompositionPreviewEntry[] = [];
  for (const cap of snapshot.capabilities) {
    for (const fragment of cap.fragments) {
      if (want !== null && fragment.phase !== want) continue;
      entries.push({
        order: entries.length,
        capability: cap.name,
        phase: fragment.phase,
        contributionKind: fragment.contributionKind,
        dispatch: fragment.dispatch,
        scope: fragment.scope,
        registryPath: cap.registryPath,
        resolvedPath: cap.resolvedPath,
        manifestPath: cap.manifestPath,
        provenance: cap.provenance,
        validity: cap.validity,
      });
    }
  }

  const phasesCovered: string[] = [];
  for (const e of entries) if (!phasesCovered.includes(e.phase)) phasesCovered.push(e.phase);

  const scope = want === null ? "every phase" : `phase \`${want}\``;
  const summary =
    entries.length === 0
      ? `nothing would compose at ${scope} — ${snapshot.capabilities.length} active capability/capabilities contribute no matching fragment (inert, not an error).`
      : `${entries.length} fragment(s) would fire at ${scope}, in registry order, from ${new Set(entries.map((e) => e.capability)).size} capability/capabilities.`;

  return {
    tool: "preview_composition",
    phase: want,
    entries,
    capabilitiesConsidered: snapshot.capabilities.length,
    phasesCovered,
    renderedFrom: {
      schemaVersion: snapshot.schemaVersion,
      generatedAt: snapshot.generatedAt,
      generator: snapshot.generator,
      workspaceRoot: snapshot.workspaceRoot,
      registryPath: snapshot.registryPath,
    },
    summary,
  };
}
