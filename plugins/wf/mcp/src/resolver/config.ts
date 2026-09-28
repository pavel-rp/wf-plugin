// wf resolver — core config value extraction from the registry/config markdown.
//
// The downstream `_local/config.md` carries project values as `| **Key** |
// value |` table rows (template:
// plugins/wf/skills/init/references/config-template.md). This reader pulls the
// core config VALUES the snapshot records (consumer inventory §7 field #3). An
// unset value — `<none>`, `<auto-detect>`, or any `<…>` placeholder — resolves
// to `null`.

import type { CoreConfig, RoutingProjectConfig } from "./types.js";

/** Length of the run of backticks starting at `i`. */
function backtickRun(text: string, i: number): number {
  let n = 0;
  while (text[i + n] === "`") n += 1;
  return n;
}

/**
 * Split one `| a | b | … |` table row into trimmed cells (WF-871).
 *
 * The rule, documented for projects in the config template:
 *   - a `|` inside a backtick code span (an opening run of N backticks closed
 *     by the next run of exactly N) belongs to the cell, verbatim;
 *   - `\|` outside a code span is an escaped, literal `|`;
 *   - any other `|` ends the cell.
 * An unmatched backtick run is literal text. The leading `|` is required and a
 * trailing `|` closes the last cell; text after the final `|` that is not blank
 * forms one more cell.
 */
export function splitTableRow(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let i = line.startsWith("|") ? 1 : 0;
  while (i < line.length) {
    const ch = line[i];
    if (ch === "\\" && line[i + 1] === "|") {
      current += "|";
      i += 2;
      continue;
    }
    if (ch === "`") {
      const n = backtickRun(line, i);
      let j = i + n;
      let close = -1;
      while (j < line.length) {
        if (line[j] === "`") {
          const m = backtickRun(line, j);
          if (m === n) {
            close = j;
            break;
          }
          j += m;
        } else {
          j += 1;
        }
      }
      if (close >= 0) {
        current += line.slice(i, close + n);
        i = close + n;
      } else {
        current += line.slice(i, i + n);
        i += n;
      }
      continue;
    }
    if (ch === "|") {
      cells.push(current.trim());
      current = "";
      i += 1;
      continue;
    }
    current += ch;
    i += 1;
  }
  if (current.trim() !== "") cells.push(current.trim());
  return cells;
}

/** Extract every `| **Key** | value |` pair, keyed by the lowercased key. The
 *  value is the whole second cell under `splitTableRow`'s rule, so a shell
 *  pipeline inside a code span (or written with `\|`) is kept complete. */
function extractKeyValues(markdown: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.replace(/\r$/, "").trim();
    if (!line.startsWith("|")) continue;
    const cells = splitTableRow(line);
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
    versionDeclaration: normalizeValue(kv.get("version declaration")),
    dependencySetupCommand: normalizeValue(kv.get("dependency setup command")),
    dependencySetupTimeout: normalizeValue(kv.get("dependency setup timeout")),
  };
}
