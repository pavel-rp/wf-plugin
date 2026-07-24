// wf resolver — core config value extraction from the registry/config markdown.
//
// The downstream `_local/config.md` carries project values as `| **Key** |
// value |` table rows (template:
// plugins/wf/skills/init/references/config-template.md). This reader pulls the
// core config VALUES the snapshot records (consumer inventory §7 field #3). An
// unset value — `<none>`, `<auto-detect>`, or any `<…>` placeholder — resolves
// to `null`.

import type { CoreConfig, RoutingProjectConfig } from "./types.js";

/** Extract every `| **Key** | value |` pair, keyed by the lowercased key. */
function extractKeyValues(markdown: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.replace(/\r$/, "").trim();
    if (!line.startsWith("|")) continue;
    const cells = line
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => c.trim());
    if (cells.length < 2) continue;
    const keyMatch = /^\*\*(.+?)\*\*$/.exec(cells[0]);
    if (!keyMatch) continue;
    const key = keyMatch[1].trim().toLowerCase();
    map.set(key, cells[1]);
  }
  return map;
}

/** Unwrap a backticked value and treat placeholders/`<none>` as unset. */
function normalizeValue(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  let v = raw.trim();
  // Strip a single wrapping pair of backticks.
  const bt = /^`(.*)`$/.exec(v);
  if (bt) v = bt[1].trim();
  if (v === "" || v === "—") return null;
  // Any angle-bracketed placeholder (e.g. <none>, <auto-detect>, <FILL: …>).
  if (/^<.*>$/.test(v)) return null;
  return v;
}

/** Parse `## Routing` rows: `| Role | Model | Effort |`. */
export function parseRoutingConfig(markdown: string): RoutingProjectConfig {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => /^##\s+Routing\s*$/.test(line.trim()));
  if (start < 0) return {};
  const out: RoutingProjectConfig = {};
  for (const raw of lines.slice(start + 1)) {
    const line = raw.trim();
    if (/^##\s+/.test(line)) break;
    if (!line.startsWith("|")) continue;
    const cells = line.replace(/^\|/, "").replace(/\|$/, "").split("|").map((v) => v.trim());
    if (cells.length < 3 || /^(role|-+)$/i.test(cells[0])) continue;
    const role = cells[0].replace(/^`|`$/g, "").trim();
    if (!/^[a-z][a-z0-9-]*$/.test(role)) continue;
    out[role] = { model: normalizeValue(cells[1]), effort: normalizeValue(cells[2]) };
  }
  return out;
}

/** Parse the core config values map from the config/registry markdown. */
export function parseCoreConfig(markdown: string): CoreConfig {
  const kv = extractKeyValues(markdown);
  return {
    taskRoot: normalizeValue(kv.get("task root")),
    verifyCommand: normalizeValue(kv.get("verify command")),
    qaRules: normalizeValue(kv.get("qa rules")),
    qaBaselineIgnore: normalizeValue(kv.get("qa baseline ignore")),
    seedArchitectureDoc: normalizeValue(kv.get("architecture doc")),
    seedBacklogPath: normalizeValue(kv.get("backlog path")),
    standupStatuses: normalizeValue(kv.get("standup statuses")),
    contextCeiling: normalizeValue(kv.get("context ceiling")),
  };
}
