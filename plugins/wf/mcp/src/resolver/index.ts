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
  categorizeCode,
  isFailureSignal,
  recoveryFor,
  annotate,
  classifyThrow,
  reactionFor,
} from "./failure.js";
export type {
  SurfaceClass,
  FailureReaction,
  ResolverFailure,
} from "./failure.js";
export {
  normalizeSlashes,
  joinSlash,
  parsePluginAnchor,
  resolveCapabilityPath,
} from "./paths.js";
export { resolveContentRef, CONTENT_REF_CLASSES } from "./content.js";
export {
  SETTINGS_STORAGE_DIR,
  SETTINGS_OVERRIDE_SUFFIX,
  isSkillSlug,
  settingsOverrideRelPath,
  skillFromSettingsFilename,
  parseSettingsDeclaration,
  parseSettingsOverride,
  mergeSettings,
  locateInterface,
} from "./settings.js";
export type {
  SettingsDeclaration,
  ParsedOverride,
  SettingsMerge,
  LocatedInterface,
} from "./settings.js";
export type {
  ContentRef,
  ContentRefClass,
  ContentPlan,
  ContentResolveContext,
} from "./content.js";
export {
  parseSlotScope,
  parseSlotDeclaration,
  locateSlotInterface,
  slotPointFromOverrideFilename,
  composeSlotBody,
  planSlot,
  OVERRIDE_DIR,
} from "./slot.js";
export type {
  MergePolicy,
  SlotPlan,
  LocatedSlotInterface,
} from "./slot.js";
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
export {
  SESSION_START_EVENT,
  CONSTITUTION_RELPATH,
  shouldEmitForSource,
  parseSessionSource,
  composeConstitutionContext,
  sessionStartPayload,
  composeSessionStartStdout,
} from "./constitution.js";
export type { SessionStartSource } from "./constitution.js";
