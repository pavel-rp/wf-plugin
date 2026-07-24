// wf resolver — registry parsing (`## Capabilities` + `## Plugin Roots`).
//
// Parses the two markdown tables the registry file carries (default
// _local/config.md). Shapes are defined in
// plugins/wf/skills/_contracts/capability-registry.ops.md. This reader is
// tolerant of the surrounding prose: it locates each section by heading and
// reads the first markdown table under it, skipping the header/separator rows.

export interface RegistryCapabilityRow {
  name: string;
  path: string;
}

export interface PluginRootRow {
  plugin: string;
  root: string;
}

export interface ParsedRegistry {
  capabilities: RegistryCapabilityRow[];
  pluginRoots: PluginRootRow[];
}

/** Split a markdown table row into trimmed cell values (drops leading/trailing
 *  pipe borders). Returns `null` for a non-row line. */
function splitRow(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) return null;
  const cells = trimmed
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
  return cells;
}

/** A separator row is all dashes/colons/spaces between the pipes. */
function isSeparatorRow(cells: string[]): boolean {
  return cells.every((c) => /^:?-{1,}:?$/.test(c) || c === "");
}

/**
 * Extract the rows of the first markdown table that appears under the given
 * `##` heading. The section ends at the next `#`/`##` heading. Header and
 * separator rows are dropped; only data rows are returned.
 */
function tableRowsUnderHeading(markdown: string, heading: string): string[][] {
  const lines = markdown.split(/\r?\n/);
  const rows: string[][] = [];
  let inSection = false;
  let sawHeader = false;

  const headingRe = new RegExp(`^#{1,6}\\s+${escapeRegex(heading)}\\s*$`, "i");

  for (const line of lines) {
    if (/^#{1,6}\s+/.test(line)) {
      if (headingRe.test(line)) {
        inSection = true;
        sawHeader = false;
        continue;
      }
      if (inSection) break; // next heading ends the section
      continue;
    }
    if (!inSection) continue;

    const cells = splitRow(line);
    if (!cells) {
      // A blank line after we've started reading data rows ends the table.
      if (sawHeader && rows.length > 0 && line.trim() === "") break;
      continue;
    }
    if (!sawHeader) {
      sawHeader = true; // first table row is the column header
      continue;
    }
    if (isSeparatorRow(cells)) continue;
    rows.push(cells);
  }
  return rows;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Parse a registry markdown document into its two tables. Missing sections
 *  yield empty arrays (an empty/absent registry = fully generic core). */
export function parseRegistry(markdown: string): ParsedRegistry {
  const capabilities: RegistryCapabilityRow[] = [];
  for (const cells of tableRowsUnderHeading(markdown, "Capabilities")) {
    const [name, path] = cells;
    if (name && path) capabilities.push({ name, path });
  }

  const pluginRoots: PluginRootRow[] = [];
  for (const cells of tableRowsUnderHeading(markdown, "Plugin Roots")) {
    const [plugin, root] = cells;
    if (plugin && root) pluginRoots.push({ plugin, root });
  }

  return { capabilities, pluginRoots };
}
