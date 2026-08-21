// wf resolver — registry-file markdown editing for the pack register write-path.
//
// register_pack (WF-270 / R6) is the ONLY resolver operation that mutates the
// discovery substrate. It owns the write to the registry file (default
// `_local/config.md`): a `## Plugin Roots` row (plugin -> install root) and a
// `## Capabilities` row per capability the pack provides. These helpers perform
// a deterministic, idempotent UPSERT of a single row under a named `##` section,
// creating the section + table when absent and updating an existing row in place
// otherwise. Nothing else in the file is touched (other sections/prose survive
// byte-for-byte apart from the edited table).

/** Split a markdown table row into trimmed cells (drops the border pipes), or
 *  `null` for a non-row line. Mirrors the tolerant reader in registry.ts. */
function splitRow(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) return null;
  return trimmed
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

function isSeparatorRow(cells: string[]): boolean {
  return cells.every((c) => /^:?-{1,}:?$/.test(c) || c === "");
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function renderRow(cells: string[]): string {
  return `| ${cells.join(" | ")} |`;
}

/**
 * Idempotently upsert a two-column row under the `## <heading>` section of a
 * markdown document. `key` is matched against the first column (case-sensitive,
 * exact). When the section is absent it is appended with a header row, a
 * separator, and the new data row. When present, an existing matching row is
 * replaced (only when its value differs); a non-matching set gets the row
 * appended after the last data row of the table.
 *
 * Returns `{ content, changed }` — `changed:false` means the row already existed
 * with the identical value, so the caller can skip a no-op write.
 */
export function upsertSectionRow(
  markdown: string,
  heading: string,
  columns: [string, string],
  key: string,
  value: string,
): { content: string; changed: boolean } {
  const eol = markdown.includes("\r\n") ? "\r\n" : "\n";
  const lines = markdown.split(/\r?\n/);
  const headingRe = new RegExp(`^#{1,6}\\s+${escapeRegex(heading)}\\s*$`, "i");

  let sectionStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (headingRe.test(lines[i])) {
      sectionStart = i;
      break;
    }
  }

  // Section absent -> append a fresh section with the row.
  if (sectionStart === -1) {
    const block = [
      "",
      `## ${heading}`,
      "",
      renderRow(columns),
      renderRow(["------", "------"]),
      renderRow([key, value]),
    ];
    const base = markdown.replace(/\s*$/, "");
    return { content: `${base}${eol}${block.join(eol)}${eol}`, changed: true };
  }

  // Locate the section's extent (up to the next `#` heading or EOF).
  let sectionEnd = lines.length;
  for (let i = sectionStart + 1; i < lines.length; i++) {
    if (/^#{1,6}\s+/.test(lines[i])) {
      sectionEnd = i;
      break;
    }
  }

  // Walk the table rows inside the section.
  let headerIdx = -1;
  let lastDataIdx = -1;
  let matchIdx = -1;
  let sawHeader = false;
  for (let i = sectionStart + 1; i < sectionEnd; i++) {
    const cells = splitRow(lines[i]);
    if (!cells) continue;
    if (!sawHeader) {
      sawHeader = true;
      headerIdx = i;
      continue;
    }
    if (isSeparatorRow(cells)) continue;
    lastDataIdx = i;
    if (cells[0] === key) matchIdx = i;
  }

  // No table under the heading yet -> insert one right after the heading line.
  if (headerIdx === -1) {
    const insertAt = sectionStart + 1;
    const tableBlock = [
      "",
      renderRow(columns),
      renderRow(["------", "------"]),
      renderRow([key, value]),
    ];
    const next = [...lines.slice(0, insertAt), ...tableBlock, ...lines.slice(insertAt)];
    return { content: next.join(eol), changed: true };
  }

  // Existing matching row -> replace only if the value differs.
  if (matchIdx !== -1) {
    const existing = splitRow(lines[matchIdx])!;
    if ((existing[1] ?? "") === value) {
      return { content: markdown, changed: false };
    }
    const next = [...lines];
    next[matchIdx] = renderRow([key, value]);
    return { content: next.join(eol), changed: true };
  }

  // No matching row -> append after the last data row (or the separator).
  const appendAfter = lastDataIdx !== -1 ? lastDataIdx : headerIdx + 1;
  const next = [
    ...lines.slice(0, appendAfter + 1),
    renderRow([key, value]),
    ...lines.slice(appendAfter + 1),
  ];
  return { content: next.join(eol), changed: true };
}

/**
 * Idempotently REMOVE a two-column row from the `## <heading>` section of a
 * markdown document (WF-453). `key` is matched against the first column exactly,
 * the same case-sensitive comparison `upsertSectionRow` uses — the two halves of
 * one edit must agree on what "the same row" means.
 *
 * NARROW BY CONSTRUCTION. It removes matching DATA rows and nothing else: the
 * heading, the header row, the separator, an emptied table, and every other
 * section survive byte-for-byte. An emptied table is deliberately LEFT IN PLACE
 * rather than tidied away — a header-only `## Capabilities` table is the
 * contract's own "fully generic core" state, and reconstructing it later is a
 * strictly larger edit than leaving it.
 *
 * Returns `{ content, changed }` — `changed:false` means no such row existed, so
 * the caller can skip a no-op write. Removing an absent row is a no-op rather
 * than an error, which is what makes a re-entered transaction converge.
 */
export function removeSectionRow(
  markdown: string,
  heading: string,
  key: string,
): { content: string; changed: boolean } {
  const eol = markdown.includes("\r\n") ? "\r\n" : "\n";
  const lines = markdown.split(/\r?\n/);
  const headingRe = new RegExp(`^#{1,6}\\s+${escapeRegex(heading)}\\s*$`, "i");

  let sectionStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (headingRe.test(lines[i])) {
      sectionStart = i;
      break;
    }
  }
  if (sectionStart === -1) return { content: markdown, changed: false };

  let sectionEnd = lines.length;
  for (let i = sectionStart + 1; i < lines.length; i++) {
    if (/^#{1,6}\s+/.test(lines[i])) {
      sectionEnd = i;
      break;
    }
  }

  const drop = new Set<number>();
  let sawHeader = false;
  for (let i = sectionStart + 1; i < sectionEnd; i++) {
    const cells = splitRow(lines[i]);
    if (!cells) continue;
    if (!sawHeader) {
      sawHeader = true;
      continue;
    }
    if (isSeparatorRow(cells)) continue;
    if (cells[0] === key) drop.add(i);
  }

  if (drop.size === 0) return { content: markdown, changed: false };
  const next = lines.filter((_, index) => !drop.has(index));
  return { content: next.join(eol), changed: true };
}
