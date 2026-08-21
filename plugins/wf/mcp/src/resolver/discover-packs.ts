// wf resolver — the pure pack-discovery join (WF-446).
//
// Deterministic, body-free, and side-effect-free. Nothing here reads
// configuration, opens a file, canonicalizes a root, shells out, or writes a
// byte: every input is collected by the caller and every output is bounded
// metadata. That is what makes the release's BYTE-INERT guarantee assertable —
// discovery cannot touch `.wf/install-state.json` or `_local/install-state.json`
// because it has no write capability at all.
//
// Installed-pack facts reach this module EXCLUSIVELY through the caller's
// `parsePluginList` result (the WF-269 authoritative-metadata boundary) — never
// a private Claude install manifest or cache index.
//
// TWO ORDERINGS ARE CORRECTNESS, NOT PREFERENCE:
//
//   1. DUPLICATE REJECTION RUNS FIRST, on the raw inventory, BEFORE any plugin
//      root is consulted and before any record is classified. A duplicate stable
//      id or name invalidates the WHOLE inventory: `packs` comes back empty and
//      nothing is selectable. Classifying first and rejecting afterwards would
//      mean deciding which of two same-named packs a root belongs to — exactly
//      the ambiguity the rejection exists to refuse.
//
//   2. PORTABLE COMPARISON PRECEDES ANY LOCAL ROOT FACT. That ordering lives in
//      `compareLifecycleEvidence`, which checks portable identity before it ever
//      looks at `canonicalRoot`. This module DELEGATES to it and never re-checks
//      or reorders those conditions, so the ordering is inherited rather than
//      duplicated — a second copy could drift and silently report a moved root
//      for a pack whose source actually changed.
//
// Absence is asymmetric on purpose: only a `trustworthy` inventory may turn "not
// listed" into "orphaned". Every other confidence yields `absence-indeterminate`
// — an explicit "cannot tell" that is never silently rendered as absence.

import {
  compareLifecycleEvidence,
  createArtifactEvidence,
  createMachineBindingEvidence,
  createPortablePackEvidence,
} from "./lifecycle-evidence.js";
import type { InstalledPlugin, PluginListContractIssue } from "./plugin-list.js";
import type {
  ArtifactEvidence,
  ArtifactOwner,
  DiscoverPacksResponse,
  DiscoveredPack,
  DiscoveryConfidence,
  DiscoveryDiagnostic,
  DiscoveryInventory,
  LifecycleEvidenceComparison,
  MachineBindingEvidence,
  PackPresence,
  PackRecord,
  PackStaleOverlay,
  PortablePackEvidence,
  QuestionRecord,
  RecoveryReport,
} from "./types.js";

/** The `parsePluginList` codes that mean the output could not be read as an
 *  array of records AT ALL — as opposed to a per-record rejection, which still
 *  leaves the surviving records usable. Both yield zero records, which is why
 *  the count alone cannot distinguish `malformed` from a valid empty list. */
const WHOLE_OUTPUT_FAILURE_CODES: ReadonlySet<string> = new Set([
  "plugin-list/unparseable",
  "plugin-list/not-an-array",
]);

/**
 * The overlay mapping — a TOTAL function of the comparison state, declared as a
 * `Record` over the state union so adding a seventh comparison state fails the
 * build here instead of silently falling through to `undefined`.
 *
 * `local-mismatch` maps to `pack/stale(binding-changed)`. The four tokens the
 * tracker named cover five of the six states; folding `local-mismatch` into
 * `source-changed` would discard the root-equal/root-moved distinction the
 * comparison has already computed, so it gets its own token in the same
 * `pack/stale(...)` grammar.
 *
 * `binding-seed` and `equal` map to `null`: neither is staleness. `binding-seed`
 * means the portable evidence matches and only a machine binding has never been
 * recorded, which is a first-run fact, not a drift.
 */
const OVERLAY_BY_COMPARISON: Record<
  LifecycleEvidenceComparison["state"],
  PackStaleOverlay | null
> = {
  "portable-mismatch": "pack/stale(source-changed)",
  "root-moved": "pack/stale(root-moved)",
  "evidence-missing": "pack/stale(evidence-missing)",
  "local-mismatch": "pack/stale(binding-changed)",
  "binding-seed": null,
  equal: null,
};

// ---------------------------------------------------------------------------
// Recorded-evidence ledger — READ SIDE ONLY
// ---------------------------------------------------------------------------
//
// `compareLifecycleEvidence` needs the RECORDED portable evidence and the
// RECORDED machine binding to compare the observed ones against. Nothing in the
// runtime reads them yet, so without this parser every pack would compare as
// `evidence-missing` forever and criteria 1–3 would be unreachable.
//
// This is deliberately only the read half. No writer exists in this release —
// discovery is byte-inert, and recording evidence belongs to the lifecycle
// mutator a later item adds. The parser takes ALREADY-READ text; it opens
// nothing itself.
//
// It is TOLERANT BY DESIGN. An absent, unreadable, or shape-drifted ledger
// yields no recorded evidence rather than a throw, and each entry is re-validated
// through the frozen WF-442 constructors, so a partially corrupt ledger still
// contributes its well-formed entries. Degrading to `evidence-missing` is the
// safe direction: it reports staleness and proposes a seed, and it never
// fabricates a match that would let a genuinely drifted pack read as `equal`.

/** Recorded evidence keyed by `pluginId`. */
export interface EvidenceLedger {
  portable: Map<string, PortablePackEvidence>;
  binding: Map<string, MachineBindingEvidence>;
  /** Recorded proof for each produced workspace artifact, keyed by its declared
   *  destination (WF-449). Portable, like the `portable` section: the produced
   *  bytes and their owners are project facts, not machine facts. An entry that
   *  fails `createArtifactEvidence` is DROPPED rather than half-trusted — a
   *  malformed record must not become authority to delete the file it names. */
  artifacts: Map<string, ArtifactEvidence>;
}

function emptyLedger(): EvidenceLedger {
  return { portable: new Map(), binding: new Map(), artifacts: new Map() };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asHashRecords(value: unknown): { path: string; sha256: string }[] {
  if (!Array.isArray(value)) return [];
  const rows: { path: string; sha256: string }[] = [];
  for (const entry of value) {
    const row = asRecord(entry);
    if (row === null) continue;
    if (typeof row.path !== "string" || typeof row.sha256 !== "string") continue;
    rows.push({ path: row.path, sha256: row.sha256 });
  }
  return rows;
}

function asStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * Parse one recorded-evidence ledger. The two sections are read independently,
 * because the portable ledger may be committed while the binding ledger is
 * always machine-local — and when the declared home is `local` both sections
 * live in the SAME file, so each read takes only the section it owns.
 *
 * Returns an empty ledger for `null`, unparseable, or non-object input.
 */
export function parseEvidenceLedger(raw: string | null): EvidenceLedger {
  if (raw === null) return emptyLedger();
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return emptyLedger();
  }
  const root = asRecord(data);
  if (root === null) return emptyLedger();

  const ledger = emptyLedger();

  const portableSection = asRecord(root.portable);
  if (portableSection !== null) {
    for (const [pluginId, entry] of Object.entries(portableSection)) {
      const row = asRecord(entry);
      if (row === null) continue;
      const evidence = createPortablePackEvidence({
        pluginId: asNullableString(row.pluginId) ?? pluginId,
        version: asNullableString(row.version) ?? "",
        capabilities: asStrings(row.capabilities),
        manifestHashes: asHashRecords(row.manifestHashes),
        declaredSourceHashes: asHashRecords(row.declaredSourceHashes),
      });
      if (evidence !== null) ledger.portable.set(pluginId, evidence);
    }
  }

  const bindingSection = asRecord(root.binding);
  if (bindingSection !== null) {
    for (const [pluginId, entry] of Object.entries(bindingSection)) {
      const row = asRecord(entry);
      if (row === null) continue;
      const enablement = row.enablement;
      const evidence = createMachineBindingEvidence({
        pluginId: asNullableString(row.pluginId) ?? pluginId,
        canonicalRoot: asNullableString(row.canonicalRoot) ?? "",
        cliScope: asNullableString(row.cliScope),
        enablement:
          enablement === "enabled" || enablement === "disabled" ? enablement : "unknown",
        observedVersion: asNullableString(row.observedVersion),
        localFingerprints: asHashRecords(row.localFingerprints),
      });
      if (evidence !== null) ledger.binding.set(pluginId, evidence);
    }
  }

  // The artifact section (WF-449). Keyed by declared destination, because that is
  // what a removal or an upgrade decision is ABOUT. `createArtifactEvidence`
  // validates owners, both digests, and the full closed semantic tuple; anything
  // it rejects is dropped, so a malformed record yields "no recorded proof"
  // (retain) rather than partial authority over the file it names.
  const artifactSection = asRecord(root.artifacts);
  if (artifactSection !== null) {
    for (const [destination, entry] of Object.entries(artifactSection)) {
      const row = asRecord(entry);
      if (row === null) continue;
      const owners: ArtifactOwner[] = [];
      if (Array.isArray(row.owners)) {
        for (const candidate of row.owners) {
          const owner = asRecord(candidate);
          if (owner === null) continue;
          if (
            typeof owner.pluginId !== "string" ||
            typeof owner.capability !== "string" ||
            typeof owner.source !== "string"
          ) {
            continue;
          }
          owners.push({
            pluginId: owner.pluginId,
            capability: owner.capability,
            source: owner.source,
          });
        }
      }
      const evidence = createArtifactEvidence({
        destination: asNullableString(row.destination) ?? destination,
        owners,
        declaredSourceFingerprint: asNullableString(row.declaredSourceFingerprint) ?? "",
        producedContentHash: asNullableString(row.producedContentHash) ?? "",
        production: row.production as ArtifactEvidence["production"],
        refresh: row.refresh as ArtifactEvidence["refresh"],
        removal: row.removal as ArtifactEvidence["removal"],
      });
      if (evidence !== null) ledger.artifacts.set(destination, evidence);
    }
  }

  return ledger;
}

/** The inventory half of a discovery run, exactly as the caller's plugin-list
 *  port reported it. */
export interface DiscoveryInventoryInput {
  /** `false` when the CLI was unavailable or errored — nothing was observed. */
  ok: boolean;
  /** `false` when the output drifted from the CLI-output contract. */
  contractOk: boolean;
  /** Contract findings in reported order. */
  issues: readonly PluginListContractIssue[];
  /** The records that passed the contract. */
  plugins: readonly InstalledPlugin[];
}

/** Everything already known about ONE pack, gathered by the caller. Discovery
 *  joins these facts; it derives none of them. */
export interface DiscoveryPackInput {
  /** The snapshot's own record. Its `state`, `enablement`, and
   *  `registeredCapabilities` are consumed verbatim, never recomputed. */
  record: PackRecord;
  /** Portable evidence RECORDED in the project ledger, or `null` when none is
   *  recorded (the legacy case). */
  expectedPortable: PortablePackEvidence | null;
  /** Portable evidence OBSERVED on disk now, or `null` when it could not be
   *  derived (e.g. the pack is registered but not installed). */
  observedPortable: PortablePackEvidence | null;
  /** The machine binding RECORDED in the local binding ledger, or `null`. */
  priorBinding: MachineBindingEvidence | null;
  /** The machine binding OBSERVED now, or `null`. */
  observedBinding: MachineBindingEvidence | null;
  /** The pack's declared questions across its capabilities, in declared order. */
  questions: readonly QuestionRecord[];
  /** Whether inspection judged the pack's registerable surface valid. */
  inspectionValid: boolean;
  /** Inspection findings, in reported order. */
  inspectionIssues: readonly string[];
}

export interface DiscoveryInput {
  /** The admitted workspace root, consumed as given. */
  workspaceRoot: string;
  inventory: DiscoveryInventoryInput;
  packs: readonly DiscoveryPackInput[];
  /** The crash-recovery report for this run (WF-451), ECHOED VERBATIM into the
   *  response and never consulted by the join.
   *
   *  This module stays byte-inert and side-effect-free: recovery — the one part
   *  of a discovery run that can write — happens in the caller, BEFORE any state
   *  is read, and arrives here as a finished fact. Carrying it as its own field
   *  rather than folding it into `diagnostics` is what keeps a recovery write
   *  distinguishable from a discovery write, and it is why the response can say
   *  that discovery's byte-inertness begins at the RECOVERED baseline. */
  recovery: RecoveryReport;
}

/** Stable ids and names seen more than once in the accepted inventory. */
interface DuplicateFindings {
  ids: string[];
  names: string[];
}

function findDuplicates(plugins: readonly InstalledPlugin[]): DuplicateFindings {
  const idCounts = new Map<string, number>();
  const nameCounts = new Map<string, number>();
  for (const plugin of plugins) {
    idCounts.set(plugin.id, (idCounts.get(plugin.id) ?? 0) + 1);
    nameCounts.set(plugin.name, (nameCounts.get(plugin.name) ?? 0) + 1);
  }
  const collect = (counts: Map<string, number>): string[] =>
    [...counts.entries()]
      .filter(([, count]) => count > 1)
      .map(([key]) => key)
      .sort((left, right) => left.localeCompare(right));
  return { ids: collect(idCounts), names: collect(nameCounts) };
}

/**
 * Derive the confidence token FIRST-MATCH-WINS in the documented precedence.
 * The order is the whole point: each tier answers a strictly weaker question
 * than the one above it, and a later tier must never mask an earlier one — a
 * malformed output also has zero accepted records, and an unavailable CLI also
 * has no duplicates, so evaluating out of order would report the wrong reason.
 */
function resolveConfidence(
  inventory: DiscoveryInventoryInput,
  duplicates: DuplicateFindings,
): DiscoveryConfidence {
  // 1. The CLI never produced output.
  if (!inventory.ok) return "unavailable";

  // 2. The output could not be read as a record array at all.
  if (inventory.issues.some((issue) => WHOLE_OUTPUT_FAILURE_CODES.has(issue.code))) {
    return "malformed";
  }

  // 3. Readable but self-inconsistent. Duplicates come first (an ambiguous
  //    inventory is unusable even when every record parsed); the second clause
  //    is "a non-empty array in which every record was rejected" — per-record
  //    issues can only be raised BY records, so issues-with-no-survivors is
  //    exactly that case and needs no separate raw count.
  if (duplicates.ids.length > 0 || duplicates.names.length > 0) return "invalid";
  if (inventory.plugins.length === 0 && inventory.issues.length > 0) return "invalid";

  // 4. Some records were rejected, but at least one survived.
  if (!inventory.contractOk) return "partial";

  // 5. Read cleanly. A VALID EMPTY ARRAY lands here deliberately: observing
  //    that nothing is installed is a real observation, not a failure.
  return "trustworthy";
}

function sortDiagnostics(diagnostics: DiscoveryDiagnostic[]): DiscoveryDiagnostic[] {
  return [...diagnostics].sort(
    (left, right) =>
      (left.pluginId ?? "").localeCompare(right.pluginId ?? "") ||
      left.code.localeCompare(right.code) ||
      left.message.localeCompare(right.message),
  );
}

/**
 * Join the authoritative inventory, the snapshot's pack records, the lifecycle
 * evidence, and the declared questions into one deterministic response.
 *
 * Pure: identical inputs always produce deep-equal output, and no input object
 * is mutated.
 */
export function discoverPacks(input: DiscoveryInput): DiscoverPacksResponse {
  const diagnostics: DiscoveryDiagnostic[] = [];

  // ORDERING RULE 1 — duplicates are found on the raw inventory before any root
  // is resolved and before any record is classified.
  const duplicates = findDuplicates(input.inventory.plugins);
  const confidence = resolveConfidence(input.inventory, duplicates);

  const inventory: DiscoveryInventory = {
    confidence,
    // The one gate that turns silence into absence. Kept as a derived boolean so
    // a consumer never has to re-implement the precedence to know whether a
    // missing pack means anything.
    mayEstablishAbsence: confidence === "trustworthy",
    observedCount: input.inventory.plugins.length,
    issues: input.inventory.issues.map((issue) => ({
      code: issue.code,
      message: issue.message,
    })),
  };

  for (const issue of input.inventory.issues) {
    diagnostics.push({ pluginId: null, code: issue.code, message: issue.message });
  }
  for (const id of duplicates.ids) {
    diagnostics.push({
      pluginId: id,
      code: "discovery/duplicate-plugin-id",
      message: `plugin id \`${id}\` appears more than once in the inventory; the inventory is ambiguous and cannot be classified.`,
    });
  }
  for (const name of duplicates.names) {
    diagnostics.push({
      pluginId: null,
      code: "discovery/duplicate-plugin-name",
      message: `plugin name \`${name}\` appears more than once in the inventory; the inventory is ambiguous and cannot be classified.`,
    });
  }

  if (confidence === "invalid") {
    diagnostics.push({
      pluginId: null,
      code: "discovery/inventory-invalid",
      message:
        "the inventory is self-inconsistent, so no pack was classified and none is selectable.",
    });
    return {
      workspaceRoot: input.workspaceRoot,
      inventory,
      packs: [],
      diagnostics: sortDiagnostics(diagnostics),
      recovery: input.recovery,
    };
  }

  const installedIds = new Set(input.inventory.plugins.map((plugin) => plugin.id));
  const installedNames = new Set(input.inventory.plugins.map((plugin) => plugin.name));

  const packs: DiscoveredPack[] = input.packs.map((pack) => {
    // ORDERING RULE 2 — delegated, never re-implemented. This call compares
    // portable identity before it consults `canonicalRoot`.
    const comparison = compareLifecycleEvidence(
      pack.expectedPortable,
      pack.observedPortable,
      pack.priorBinding,
      pack.observedBinding,
    );
    const overlay = OVERLAY_BY_COMPARISON[comparison.state];

    // A legacy registration has no recorded portable evidence, so the comparison
    // short-circuits to `evidence-missing` before it can offer a seed. It still
    // gets one when a binding was actually observed: the pack stays selected and
    // operational, and the proposal is what a later mutator would record. It is
    // RETURNED, never written — this module cannot write.
    const seedProposal: MachineBindingEvidence | null =
      comparison.seedProposal ??
      (comparison.state === "evidence-missing" ? pack.observedBinding : null);

    const listed =
      installedIds.has(pack.record.pluginId) || installedNames.has(pack.record.pluginName);
    const presence: PackPresence = listed
      ? "installed"
      : inventory.mayEstablishAbsence
        ? "orphaned"
        : "absence-indeterminate";

    for (const issue of pack.inspectionIssues) {
      diagnostics.push({
        pluginId: pack.record.pluginId,
        code: "discovery/inspection-issue",
        message: issue,
      });
    }
    if (overlay !== null) {
      diagnostics.push({
        pluginId: pack.record.pluginId,
        code: "discovery/stale",
        message: `lifecycle evidence compares as \`${comparison.state}\`; overlay \`${overlay}\`.`,
      });
    }
    if (presence === "orphaned") {
      diagnostics.push({
        pluginId: pack.record.pluginId,
        code: "discovery/orphaned",
        message:
          "registered but absent from a trustworthy inventory; the pack is no longer installed.",
      });
    }

    return {
      ...pack.record,
      overlay,
      presence,
      evidence: {
        comparison: comparison.state,
        portable: pack.observedPortable,
        binding: pack.observedBinding,
      },
      seedProposal,
      questions: [...pack.questions],
      // Selectability is read off the state the snapshot already derived. A
      // staleness overlay deliberately does NOT clear it (criterion 3: a legacy
      // registration remains selected and operational), and discovery never
      // flips `enablement` — a disabled pack keeps its own state and simply is
      // not selectable, exactly as it was before this release.
      selectable: pack.record.state === "active",
    };
  });

  packs.sort((left, right) => left.pluginId.localeCompare(right.pluginId));

  return {
    workspaceRoot: input.workspaceRoot,
    inventory,
    packs,
    diagnostics: sortDiagnostics(diagnostics),
    recovery: input.recovery,
  };
}
