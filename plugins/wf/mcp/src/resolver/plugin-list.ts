// wf resolver — `claude plugin list --json` parsing + CLI-output contract.
//
// Installed plugin metadata (id, version, scope, enablement, installPath) comes
// EXCLUSIVELY from `claude plugin list --json` (WF-269 scope boundary — never a
// private Claude install manifest / cache index). This module both parses that
// output and enforces a CLI-OUTPUT CONTRACT: the shape the resolver depends on.
// A drift from that shape (a renamed/removed/retyped required field, or a
// top-level shape change) is surfaced as an error diagnostic so an incompatible
// CLI upgrade fails loudly instead of silently producing an empty/wrong
// snapshot. The fixtures under test/fixtures/plugin-list/ pin this contract.

import { normalizeSlashes } from "./paths.js";

/** One installed plugin as reported by the CLI, after contract validation. */
export interface InstalledPlugin {
  /** `<name>@<marketplace>`. */
  id: string;
  /** Left-of-`@` plugin name. */
  name: string;
  version: string;
  scope: string;
  enabled: boolean;
  /** Normalized (forward-slash) install path. */
  installPath: string;
}

export interface PluginListContractIssue {
  code: string;
  message: string;
}

export interface ParsedPluginList {
  plugins: InstalledPlugin[];
  /** True when every record matched the CLI-output contract. */
  contractOk: boolean;
  /** Non-empty when the CLI output drifted from the expected shape. */
  issues: PluginListContractIssue[];
}

/** The required fields + expected JS types the resolver depends on. A change to
 *  this set is the deliberate contract surface the fixtures guard. */
const REQUIRED_FIELDS: Array<{ field: string; type: "string" | "boolean" }> = [
  { field: "id", type: "string" },
  { field: "version", type: "string" },
  { field: "scope", type: "string" },
  { field: "enabled", type: "boolean" },
  { field: "installPath", type: "string" },
];

/**
 * Parse the raw stdout of `claude plugin list --json`. Returns the validated
 * records plus a contract verdict. Malformed JSON or a non-array top level is a
 * contract failure (empty `plugins`, `contractOk: false`), never a throw — the
 * caller records the diagnostic and degrades to "no installed packs known".
 */
export function parsePluginList(raw: string): ParsedPluginList {
  const issues: PluginListContractIssue[] = [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    return {
      plugins: [],
      contractOk: false,
      issues: [
        {
          code: "plugin-list/unparseable",
          message: `\`claude plugin list --json\` output is not valid JSON: ${
            err instanceof Error ? err.message : String(err)
          }`,
        },
      ],
    };
  }

  if (!Array.isArray(data)) {
    return {
      plugins: [],
      contractOk: false,
      issues: [
        {
          code: "plugin-list/not-an-array",
          message:
            "`claude plugin list --json` must return a JSON array of plugin records; got " +
            `${data === null ? "null" : typeof data} — incompatible CLI output schema.`,
        },
      ],
    };
  }

  const plugins: InstalledPlugin[] = [];
  data.forEach((entry, i) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      issues.push({
        code: "plugin-list/record-not-an-object",
        message: `plugin record ${i} is not an object — incompatible CLI output schema.`,
      });
      return;
    }
    const rec = entry as Record<string, unknown>;
    let recOk = true;
    for (const { field, type } of REQUIRED_FIELDS) {
      if (!(field in rec)) {
        issues.push({
          code: "plugin-list/missing-field",
          message: `plugin record ${i} is missing required field \`${field}\` — incompatible CLI output schema.`,
        });
        recOk = false;
      } else if (typeof rec[field] !== type) {
        issues.push({
          code: "plugin-list/wrong-type",
          message: `plugin record ${i} field \`${field}\` should be a ${type}, got ${typeof rec[field]} — incompatible CLI output schema.`,
        });
        recOk = false;
      }
    }
    if (!recOk) return;

    const id = rec.id as string;
    const atIndex = id.indexOf("@");
    const name = atIndex > 0 ? id.slice(0, atIndex) : id;
    plugins.push({
      id,
      name,
      version: rec.version as string,
      scope: rec.scope as string,
      enabled: rec.enabled as boolean,
      installPath: normalizeSlashes(rec.installPath as string),
    });
  });

  return { plugins, contractOk: issues.length === 0, issues };
}
