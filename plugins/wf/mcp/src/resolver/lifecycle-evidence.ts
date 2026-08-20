// wf resolver — pure lifecycle evidence and policy primitives (WF-442).
//
// No function in this module reads configuration, canonicalizes a workspace
// destination, writes a ledger, or maps evidence to resolver PackState. Later
// discovery and apply phases consume these deterministic body-free primitives.

import type {
  ArtifactAuthority,
  ArtifactEvidence,
  ArtifactOwner,
  LedgerHomeResolution,
  LifecycleEvidenceComparison,
  MachineBindingEvidence,
  PathHashRecord,
  PayloadSemantics,
  PortablePackEvidence,
} from "./types.js";

export const COMMITTED_LEDGER_PATH = ".wf/install-state.json" as const;
export const LOCAL_LEDGER_PATH = "_local/install-state.json" as const;
const SHA256_RE = /^[a-f0-9]{64}$/;

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function uniqueSortedStrings(values: readonly string[]): string[] | null {
  if (values.some((value) => !nonEmpty(value))) return null;
  const sorted = [...values].sort((left, right) => left.localeCompare(right));
  return new Set(sorted).size === sorted.length ? sorted : null;
}

function orderedHashes(records: readonly PathHashRecord[]): PathHashRecord[] | null {
  const normalized: PathHashRecord[] = [];
  const paths = new Set<string>();
  for (const record of records) {
    if (!nonEmpty(record.path) || !SHA256_RE.test(record.sha256) || paths.has(record.path)) {
      return null;
    }
    paths.add(record.path);
    normalized.push({ path: record.path, sha256: record.sha256 });
  }
  return normalized.sort((left, right) =>
    left.path.localeCompare(right.path) || left.sha256.localeCompare(right.sha256),
  );
}

function orderedOwners(owners: readonly ArtifactOwner[]): ArtifactOwner[] | null {
  const normalized = owners.map((owner) => ({ ...owner }));
  if (
    normalized.length === 0 ||
    normalized.some(
      (owner) =>
        !nonEmpty(owner.pluginId) || !nonEmpty(owner.capability) || !nonEmpty(owner.source),
    )
  ) {
    return null;
  }
  normalized.sort(
    (left, right) =>
      left.pluginId.localeCompare(right.pluginId) ||
      left.capability.localeCompare(right.capability) ||
      left.source.localeCompare(right.source),
  );
  const keys = normalized.map(
    (owner) => `${owner.pluginId}\0${owner.capability}\0${owner.source}`,
  );
  return new Set(keys).size === keys.length ? normalized : null;
}

/** Resolve only the declared ledger-home policy. Configuration parsing and every
 * write belong downstream. An absent value deterministically selects committed. */
export function resolveLedgerHome(value?: unknown): LedgerHomeResolution {
  const selected = value === undefined || value === null || value === "" ? "committed" : value;
  if (selected === "committed") {
    return {
      ok: true,
      home: "committed",
      portablePath: COMMITTED_LEDGER_PATH,
      bindingPath: LOCAL_LEDGER_PATH,
    };
  }
  if (selected === "local") {
    return {
      ok: true,
      home: "local",
      portablePath: LOCAL_LEDGER_PATH,
      bindingPath: LOCAL_LEDGER_PATH,
    };
  }
  return {
    ok: false,
    home: null,
    portablePath: null,
    bindingPath: LOCAL_LEDGER_PATH,
    diagnostic: "ledger home must be exactly `committed` or `local`.",
  };
}

export interface PortablePackEvidenceInputs {
  pluginId: string;
  version: string;
  capabilities: readonly string[];
  manifestHashes: readonly PathHashRecord[];
  declaredSourceHashes: readonly PathHashRecord[];
}

/** Construct exact portable evidence or fail closed. Arrays are sorted by stable
 * identity and duplicate identities are rejected. */
export function createPortablePackEvidence(
  inputs: PortablePackEvidenceInputs,
): PortablePackEvidence | null {
  if (!nonEmpty(inputs.pluginId) || !nonEmpty(inputs.version)) return null;
  const capabilities = uniqueSortedStrings(inputs.capabilities);
  const manifestHashes = orderedHashes(inputs.manifestHashes);
  const declaredSourceHashes = orderedHashes(inputs.declaredSourceHashes);
  if (capabilities === null || manifestHashes === null || declaredSourceHashes === null) {
    return null;
  }
  return {
    pluginId: inputs.pluginId,
    version: inputs.version,
    capabilities,
    manifestHashes,
    declaredSourceHashes,
  };
}

export interface MachineBindingEvidenceInputs {
  pluginId: string;
  canonicalRoot: string;
  cliScope: string | null;
  enablement: MachineBindingEvidence["enablement"];
  observedVersion: string | null;
  localFingerprints: readonly PathHashRecord[];
}

/** Construct exact machine-local evidence. It is always destined for the local
 * binding ledger selected by `resolveLedgerHome(...).bindingPath`. */
export function createMachineBindingEvidence(
  inputs: MachineBindingEvidenceInputs,
): MachineBindingEvidence | null {
  if (
    !nonEmpty(inputs.pluginId) ||
    !nonEmpty(inputs.canonicalRoot) ||
    (inputs.cliScope !== null && !nonEmpty(inputs.cliScope)) ||
    (inputs.observedVersion !== null && !nonEmpty(inputs.observedVersion))
  ) {
    return null;
  }
  const localFingerprints = orderedHashes(inputs.localFingerprints);
  if (localFingerprints === null) return null;
  return {
    pluginId: inputs.pluginId,
    canonicalRoot: inputs.canonicalRoot,
    cliScope: inputs.cliScope,
    enablement: inputs.enablement,
    observedVersion: inputs.observedVersion,
    localFingerprints,
  };
}

export interface ArtifactEvidenceInputs extends PayloadSemantics {
  destination: string;
  owners: readonly ArtifactOwner[];
  declaredSourceFingerprint: string;
  producedContentHash: string;
}

export function createArtifactEvidence(inputs: ArtifactEvidenceInputs): ArtifactEvidence | null {
  const owners = orderedOwners(inputs.owners);
  if (
    !nonEmpty(inputs.destination) ||
    owners === null ||
    !SHA256_RE.test(inputs.declaredSourceFingerprint) ||
    !SHA256_RE.test(inputs.producedContentHash) ||
    inputs.production !== "copy" ||
    (inputs.refresh !== "replace-if-unmodified" && inputs.refresh !== "retain") ||
    (inputs.removal !== "delete-if-unmodified" && inputs.removal !== "retain")
  ) {
    return null;
  }
  return {
    destination: inputs.destination,
    owners,
    declaredSourceFingerprint: inputs.declaredSourceFingerprint,
    producedContentHash: inputs.producedContentHash,
    production: inputs.production,
    refresh: inputs.refresh,
    removal: inputs.removal,
  };
}

function evidenceEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** Compare portable identity before consulting any local-root fact. An absent
 * prior binding yields a proposal only; this pure function never persists it. */
export function compareLifecycleEvidence(
  expectedPortable: PortablePackEvidence | null,
  observedPortable: PortablePackEvidence | null,
  priorBinding: MachineBindingEvidence | null,
  observedBinding: MachineBindingEvidence | null,
): LifecycleEvidenceComparison {
  if (expectedPortable === null || observedPortable === null || observedBinding === null) {
    return { state: "evidence-missing", seedProposal: null, persisted: false };
  }
  if (!evidenceEqual(expectedPortable, observedPortable)) {
    return { state: "portable-mismatch", seedProposal: null, persisted: false };
  }
  if (priorBinding === null) {
    return { state: "binding-seed", seedProposal: observedBinding, persisted: false };
  }
  if (priorBinding.canonicalRoot !== observedBinding.canonicalRoot) {
    return { state: "root-moved", seedProposal: null, persisted: false };
  }
  if (!evidenceEqual(priorBinding, observedBinding)) {
    return { state: "local-mismatch", seedProposal: null, persisted: false };
  }
  return { state: "equal", seedProposal: null, persisted: true };
}

/** Grant artifact mutation authority only when complete evidence exists and the
 * observed bytes still match the recorded produced bytes. Missing/incomplete or
 * modified proof grants no persistence, replacement, or deletion authority. */
export function resolveArtifactAuthority(
  evidence: ArtifactEvidence | null,
  observedContentHash: string | null,
): ArtifactAuthority {
  if (
    evidence === null ||
    observedContentHash === null ||
    !SHA256_RE.test(observedContentHash) ||
    evidence.owners.length === 0 ||
    observedContentHash !== evidence.producedContentHash
  ) {
    return { persist: false, replace: false, remove: false };
  }
  return {
    persist: true,
    replace: evidence.refresh === "replace-if-unmodified",
    remove: evidence.removal === "delete-if-unmodified",
  };
}
