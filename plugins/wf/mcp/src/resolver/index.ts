// wf resolver — public surface of the deterministic resolver engine (WF-269).
//
// Scope: the resolver engine + project-local persisted snapshot. It resolves
// registry capabilities, manifests + fragment metadata, plugin-root mappings,
// installed pack metadata, and dependency facts WITHOUT reading or caching any
// prompt/fragment/skill body. It exposes NO MCP tool and NO user-facing command
// yet — those are WF-270. Consumers import from here.

export * from "./types.js";
export { parseRegistry } from "./registry.js";
export { parseManifest } from "./manifest.js";
export { parsePluginList } from "./plugin-list.js";
export { parseCoreConfig } from "./config.js";
export { fingerprint, sha256Hex } from "./fingerprint.js";
export { evaluateFreshness, normalizePluginList } from "./freshness.js";
export type { FreshnessProbe, FreshnessResult, StaleReason } from "./freshness.js";
export {
  normalizeSlashes,
  joinSlash,
  parsePluginAnchor,
  resolveCapabilityPath,
} from "./paths.js";
export { buildSnapshot } from "./resolve.js";
export type { ResolverIO, BuildSnapshotInputs } from "./resolve.js";
export {
  resolveSnapshot,
  resolveAndPersist,
  extractRegistryPath,
  runPluginList,
  fsIO,
} from "./engine.js";
export type { ResolveOptions } from "./engine.js";
export {
  snapshotPath,
  writeSnapshot,
  readSnapshot,
  SnapshotSchemaError,
} from "./snapshot-store.js";
