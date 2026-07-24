// wf resolver — capability manifest parsing (schema v2, metadata only).
//
// Reads the `## Fragments` table and the manifest key lines (`requires:`,
// `conflicts:`, `article:`, `profile-template:`) plus the `**Kind:**` metadata
// line. NEVER follows a fragment's `dispatch` target — the fragment body stays
// out of the snapshot (charter invariant). Conventions match
// plugins/wf/skills/_contracts/validate-registry.sh so the resolver and the
// validator read the same document identically.

import type { FragmentRecord, ArticleRecord } from "./types.js";

export interface ParsedManifest {
  kind: string | null;
  fragments: FragmentRecord[];
  articles: ArticleRecord[];
  requires: string[];
  conflicts: string[];
  profileTemplate: string | null;
}

function stripCr(line: string): string {
  return line.replace(/\r$/, "");
}

function trimCell(cell: string): string {
  return cell.trim().replace(/^`/, "").replace(/`$/, "").trim();
}

function splitCommaList(rest: string): string[] {
  return rest
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

/** Parse a capability `manifest.md` body into its metadata. Tolerant of prose
 *  around the table and key lines. */
export function parseManifest(markdown: string): ParsedManifest {
  const lines = markdown.split(/\r?\n/).map(stripCr);

  let kind: string | null = null;
  const fragments: FragmentRecord[] = [];
  const articles: ArticleRecord[] = [];
  const requires: string[] = [];
  const conflicts: string[] = [];
  let profileTemplate: string | null = null;

  let inFragments = false;
  let sawFragHeader = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // `**Kind:** <token> (...)` metadata line — capture the first bare token.
    if (kind === null) {
      const km = /^\*\*Kind:\*\*\s*([A-Za-z-]+)/.exec(trimmed);
      if (km) kind = km[1];
    }

    // Manifest key lines (may appear anywhere).
    if (/^requires:/i.test(trimmed)) {
      requires.push(...splitCommaList(trimmed.replace(/^requires:/i, "")));
    } else if (/^conflicts:/i.test(trimmed)) {
      conflicts.push(...splitCommaList(trimmed.replace(/^conflicts:/i, "")));
    } else if (/^article:/i.test(trimmed)) {
      const decl = trimmed.replace(/^article:/i, "").trim();
      const eq = decl.indexOf("=");
      if (eq > 0) {
        const key = decl.slice(0, eq).trim();
        const value = decl.slice(eq + 1).trim();
        if (key) articles.push({ key, value });
      }
    } else if (/^profile-template:/i.test(trimmed)) {
      const v = trimmed.replace(/^profile-template:/i, "").trim();
      if (v) profileTemplate = v;
    }

    // `## Fragments` table.
    if (/^#{1,6}\s+/.test(line)) {
      if (/^#{1,6}\s+Fragments\s*$/i.test(trimmed)) {
        inFragments = true;
        sawFragHeader = false;
        continue;
      }
      if (inFragments) inFragments = false; // next heading closes the table
    }
    if (!inFragments) continue;
    if (!trimmed.startsWith("|")) continue;

    const cells = trimmed
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => c.trim());

    // Separator row (dashes/colons only).
    if (cells.every((c) => /^:?-{1,}:?$/.test(c) || c === "")) continue;
    if (!sawFragHeader) {
      sawFragHeader = true; // column header row
      continue;
    }

    const [phaseRaw, kindRaw, dispatchRaw, scopeRaw] = cells;
    const phase = trimCell(phaseRaw ?? "");
    const contributionKind = trimCell(kindRaw ?? "");
    if (!phase || phase === "phase") continue;
    let scope: string | null = trimCell(scopeRaw ?? "");
    if (scope === "" || scope === "—" || scope === "-") scope = null;
    fragments.push({
      phase,
      contributionKind,
      dispatch: (dispatchRaw ?? "").trim().replace(/^`/, "").replace(/`$/, "").trim(),
      scope,
    });
  }

  return { kind, fragments, articles, requires, conflicts, profileTemplate };
}
