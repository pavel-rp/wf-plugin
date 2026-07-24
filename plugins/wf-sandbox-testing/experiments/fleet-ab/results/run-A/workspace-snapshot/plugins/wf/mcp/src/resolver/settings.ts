// wf resolver — per-skill settings resolution (WF-328, C014 SUB-5).
//
// A slotted skill may declare scalar SETTINGS keys in its interface sidecar
// (`skills/<skill>/interface.md`, WF-326) — the project-tunable inputs of its
// behaviour. This module resolves those keys through the SAME seeded-override
// pattern as capability profiles (`capability-registry.contract.md` §profiles:
// hybrid precedence override > default, seeded only on divergence), re-keyed per
// SKILL under the existing `_local/profiles/` storage — no new storage mechanism.
//
// Precedence, per key (mirrors the profile hybrid precedence exactly):
//   personal `_local/profiles/<skill>.settings.json` override value  (wins)
//   > the declared default from the skill's `## Settings` interface table
// Where the project does not diverge, no override is written and the declared
// default applies (so a fully-default project keeps an empty override set).
//
// Loud rejection of an UNDECLARED key: an override carrying a key the skill's
// interface does not declare is a `registry-invalid` failure — the refresh names
// the offending key AND the skill and never silently ignores or accepts it. The
// check homes at snapshot refresh (see resolve.ts), not `validate-registry.sh`,
// because it depends on the interface declarations WF-326 defines — which the
// registry validator runs without (the same rationale that homes orphan
// detection at refresh in SUB-6).
//
// This module is PURE: the parse/merge helpers read only their string inputs;
// `locateInterface` reads through an injected `readFile` probe (no direct fs, no
// environment probing), so the whole surface is driven by fixtures in tests.

/** The gitignored storage directory for per-skill settings overrides — the SAME
 *  `_local/profiles/` folder capability profiles use (re-keyed per skill, not a
 *  parallel store). `_local/` is gitignored wholesale, so nothing is committed. */
export const SETTINGS_STORAGE_DIR = "_local/profiles";

/** The filename suffix of a per-skill settings override — `<skill>.settings.json`.
 *  Distinct from a capability profile's `<capability>.profile.json` stem so the
 *  two never collide in the shared `_local/profiles/` folder. */
export const SETTINGS_OVERRIDE_SUFFIX = ".settings.json";

/** A skill slug / settings-key SEGMENT: lowercase letters, digits, hyphens. */
const SEGMENT = /^[a-z0-9][a-z0-9-]*$/;

/** A settings key: one or more dot-joined segments (`review`, `review.depth`). */
const SETTINGS_KEY = /^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)*$/;

/** True for a valid skill slug (a single safe segment, no dots/separators). */
export function isSkillSlug(s: string | undefined): s is string {
  return typeof s === "string" && SEGMENT.test(s);
}

/** The workspace-relative override path for a skill's settings. */
export function settingsOverrideRelPath(skill: string): string {
  return `${SETTINGS_STORAGE_DIR}/${skill}${SETTINGS_OVERRIDE_SUFFIX}`;
}

/** Extract the skill slug from a settings override filename, or `null` when the
 *  name is not a `<skill>.settings.json` with a well-formed slug. */
export function skillFromSettingsFilename(filename: string): string | null {
  if (!filename.endsWith(SETTINGS_OVERRIDE_SUFFIX)) return null;
  const stem = filename.slice(0, -SETTINGS_OVERRIDE_SUFFIX.length);
  return isSkillSlug(stem) ? stem : null;
}

/** Strip a single wrapping pair of backticks and trim. */
function unquote(cell: string): string {
  return cell.trim().replace(/^`/, "").replace(/`$/, "").trim();
}

/** A declared settings key → its declared default value (the raw string from the
 *  interface `## Settings` table, backticks stripped). */
export type SettingsDeclaration = Map<string, string>;

/**
 * Parse a skill's `interface.md` `## Settings` section into its declared keys →
 * defaults. Grep-parsable, mirroring the WF-326 `## Slots` table shape:
 *
 *   ## Settings
 *
 *   | key          | default | purpose                    |
 *   |--------------|---------|----------------------------|
 *   | review.depth | 2       | number of review passes    |
 *
 * A `## Settings` section that carries only `_(none)_` (or no table) declares no
 * keys → an empty map. Returns `null` ONLY when the document has no `## Settings`
 * section at all — a skill that exposes nothing settings-bindable, indistinct
 * from every skill today. A row whose first cell is not a well-formed settings
 * key (the header `key` row, a malformed line) is skipped.
 */
export function parseSettingsDeclaration(interfaceMd: string): SettingsDeclaration | null {
  const lines = interfaceMd.split(/\r?\n/);
  let inSection = false;
  let sawSection = false;
  const decl: SettingsDeclaration = new Map();
  for (const line of lines) {
    const heading = /^\s*##\s+(.+?)\s*$/.exec(line);
    if (heading) {
      // A new heading ends the Settings section.
      inSection = /^settings$/i.test(heading[1].trim());
      if (inSection) sawSection = true;
      continue;
    }
    if (!inSection) continue;
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) continue;
    // A table row: split on `|`, dropping the leading/trailing empties.
    const cells = trimmed.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length < 2) continue;
    // Skip the separator row (all cells are dashes/colons).
    if (cells.every((c) => /^:?-+:?$/.test(c) || c === "")) continue;
    const key = unquote(cells[0]);
    if (key === "key" || !SETTINGS_KEY.test(key)) continue; // header / malformed
    decl.set(key, unquote(cells[1]));
  }
  return sawSection ? decl : null;
}

/** The parsed content of a settings override file. */
export type ParsedOverride =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: string };

/** Parse a settings override JSON file into a flat key→value object. Rejects
 *  non-object JSON (an array, a scalar) and unparseable text with a message. */
export function parseSettingsOverride(jsonText: string): ParsedOverride {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "a settings override must be a JSON object of key → value" };
  }
  return { ok: true, value: parsed as Record<string, unknown> };
}

/** The outcome of merging a declaration with an override. */
export interface SettingsMerge {
  /** The resolved per-key values: the override value where present, else the
   *  declared default. Only DECLARED keys appear (an undeclared override key is
   *  never silently merged in). */
  values: Record<string, unknown>;
  /** Override keys the skill's interface does not declare — the loud-rejection
   *  set. Empty on a clean resolution. Sorted for deterministic messages. */
  undeclared: string[];
}

/**
 * Merge a skill's declared settings with a personal override under the hybrid
 * precedence (override value wins per key; a non-overridden key keeps its
 * declared default). Any override key the declaration does not carry is collected
 * into `undeclared` — never merged into `values` — so the caller rejects it
 * loudly rather than silently accepting an unknown key.
 */
export function mergeSettings(
  declared: SettingsDeclaration,
  override: Record<string, unknown> | null,
): SettingsMerge {
  const values: Record<string, unknown> = {};
  for (const [key, def] of declared) {
    values[key] = override && Object.prototype.hasOwnProperty.call(override, key)
      ? override[key]
      : def;
  }
  const undeclared: string[] = [];
  if (override) {
    for (const key of Object.keys(override)) {
      if (!declared.has(key)) undeclared.push(key);
    }
  }
  undeclared.sort();
  return { values, undeclared };
}

/** A located skill interface — the root it was found under + its declared keys. */
export interface LocatedInterface {
  root: string;
  path: string;
  declared: SettingsDeclaration;
}

/**
 * Locate a skill's `interface.md` by probing each candidate plugin root for
 * `<root>/skills/<skill>/interface.md` (core root first, then pack roots), in
 * order, returning the first readable one that carries a `## Settings` section.
 * Reads only through the injected `readFile` probe — no direct fs, no env probe.
 * Returns `null` when no candidate root holds a settings-declaring interface for
 * the skill.
 */
export function locateInterface(
  skill: string,
  roots: readonly string[],
  readFile: (absPath: string) => string | null,
  joinSlash: (...parts: string[]) => string,
): LocatedInterface | null {
  for (const root of roots) {
    const path = joinSlash(root, "skills", skill, "interface.md");
    const content = readFile(path);
    if (content === null) continue;
    const declared = parseSettingsDeclaration(content);
    if (declared === null) continue; // interface exists but declares no settings
    return { root, path, declared };
  }
  return null;
}
