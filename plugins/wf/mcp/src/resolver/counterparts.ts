// Counterpart listing (WF-758) — the deterministic half of "a changed rule has
// other copies".
//
// A project declares, as data, which locations hold the same key: the same
// statement held in two places, a format one component writes and another
// reads, or a literal defined in one place and referenced elsewhere with no
// compiler linking the two. Given the working-tree diff, this module finds every
// declared key a changed line touched and lists each declared location of that
// key, tagged changed or unchanged. It performs no IO and names no stack,
// domain, or file type: what a key is belongs to the project's map, never here.
//
// Contract: `plugins/wf/skills/_contracts/counterpart-map.contract.md`.

/** The file name of the declared map, read from the registry file's folder. */
export const COUNTERPART_MAP_FILENAME = "counterparts.md";

/** The closed set of declared counterpart kinds. Labels only — no kind changes the computation. */
export const COUNTERPART_KINDS = ["mirror", "writer-parser", "reference"] as const;
export type CounterpartKind = (typeof COUNTERPART_KINDS)[number];

/** A key shorter than this is too common to be distinctive: suppressed, never listed. */
export const MIN_KEY_LENGTH = 4;
/** Above this many unchanged occurrences a listing is summarised rather than listed in full. */
export const SUMMARY_THRESHOLD = 25;
/** How many unchanged occurrences a summarised listing still names. */
export const SUMMARY_KEEP = 10;

export type CounterpartEntry = {
  key: string;
  kind: CounterpartKind;
  locations: string[];
  /** 1-based line of the row in the map file, for diagnostics. */
  row: number;
};

export type AddedLine = { line: number; text: string };

export type FileChange = {
  path: string;
  added: AddedLine[];
  removed: string[];
};

export type CounterpartLocation = {
  path: string;
  /** 1-based lines in the current file that contain the key. */
  lines: number[];
  /** True when a key-bearing changed line sits in this location. */
  changed: boolean;
  /** True when the location cannot be read in the working tree. */
  missing: boolean;
};

export type CounterpartListing = {
  key: string;
  kind: CounterpartKind;
  /** Where the key changed: `path:line` for an added line, `path` for a removal only. */
  changedAt: string[];
  locations: CounterpartLocation[];
  /** Occurrences of the key across the unchanged locations, before any summarising. */
  total: number;
  /** True when `total` exceeded the threshold and the unchanged lines were cut to the first few. */
  summarized: boolean;
};

export type SuppressedKey = { key: string; reason: "too-short" };

const isKind = (v: string): v is CounterpartKind =>
  (COUNTERPART_KINDS as readonly string[]).includes(v);

const stripTicks = (v: string): string => v.trim().replace(/^`+/, "").replace(/`+$/, "").trim();

/** A declared location must be a forward-slash, repo-relative path that stays inside the workspace. */
export function locationShapeError(p: string): string | null {
  if (p.length === 0) return "empty location";
  if (p.includes("\\")) return "backslash in location";
  if (p.startsWith("/") || /^[A-Za-z]:/.test(p)) return "absolute location";
  if (p.split("/").some((seg) => seg === "..")) return "location escapes the workspace";
  return null;
}

/**
 * Parse the declared map: a markdown table `| Key | Kind | Locations |`, keys
 * optionally backtick-quoted, locations comma-separated. Rows outside a table,
 * the header row, and the separator row are ignored; every other malformed row
 * is skipped with a diagnostic rather than guessed at.
 */
export function parseCounterpartMap(text: string): {
  entries: CounterpartEntry[];
  diagnostics: string[];
} {
  const entries: CounterpartEntry[] = [];
  const diagnostics: string[] = [];
  const lines = text.split(/\r?\n/);

  lines.forEach((raw, idx) => {
    const row = idx + 1;
    const line = raw.trim();
    if (!line.startsWith("|")) return;
    const cells = line.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
    if (cells.every((c) => /^:?-{3,}:?$/.test(c))) return; // separator row
    if (cells[0]?.toLowerCase() === "key") return; // header row
    if (cells.length !== 3) {
      diagnostics.push(`row ${row}: expected 3 cells (Key | Kind | Locations), found ${cells.length}`);
      return;
    }
    const key = stripTicks(cells[0]);
    const kind = cells[1].toLowerCase();
    if (key.length === 0) {
      diagnostics.push(`row ${row}: empty key`);
      return;
    }
    if (!isKind(kind)) {
      diagnostics.push(`row ${row}: unknown kind "${cells[1]}" (expected ${COUNTERPART_KINDS.join(" | ")})`);
      return;
    }
    const locations: string[] = [];
    for (const part of cells[2].split(",")) {
      const loc = stripTicks(part);
      if (loc.length === 0) continue;
      const err = locationShapeError(loc);
      if (err) {
        diagnostics.push(`row ${row}: ${err}: "${loc}"`);
        continue;
      }
      if (!locations.includes(loc)) locations.push(loc);
    }
    if (locations.length === 0) {
      diagnostics.push(`row ${row}: no valid location`);
      return;
    }
    entries.push({ key, kind, locations, row });
  });

  return { entries, diagnostics };
}

const unquotePath = (p: string): string => {
  const t = p.trim();
  return t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1) : t;
};

const stripSide = (p: string): string | null => {
  const t = unquotePath(p);
  if (t === "/dev/null") return null;
  return t.replace(/^[ab]\//, "");
};

/**
 * Parse `git diff --unified=0` output into per-file added lines (with their
 * line numbers in the new file) and removed line texts. Header lines are read
 * only before a file's first hunk, so a removed line whose text happens to
 * begin with `--` is never mistaken for a header.
 */
export function parseUnifiedDiff(text: string): Map<string, FileChange> {
  const changes = new Map<string, FileChange>();
  let current: FileChange | null = null;
  let oldPath: string | null = null;
  let inHeader = false;
  let nextLine = 0;

  const ensure = (path: string): FileChange => {
    let c = changes.get(path);
    if (!c) {
      c = { path, added: [], removed: [] };
      changes.set(path, c);
    }
    return c;
  };

  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("diff --git ")) {
      current = null;
      oldPath = null;
      inHeader = true;
      continue;
    }
    if (inHeader) {
      if (line.startsWith("--- ")) {
        oldPath = stripSide(line.slice(4));
        continue;
      }
      if (line.startsWith("+++ ")) {
        const newPath = stripSide(line.slice(4)) ?? oldPath;
        current = newPath ? ensure(newPath) : null;
        continue;
      }
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      inHeader = false;
      nextLine = Number(hunk[1]);
      continue;
    }
    if (inHeader || current === null) continue;
    if (line.startsWith("+")) {
      current.added.push({ line: nextLine, text: line.slice(1) });
      nextLine += 1;
    } else if (line.startsWith("-")) {
      current.removed.push(line.slice(1));
    } else if (line.startsWith(" ")) {
      nextLine += 1;
    }
  }

  return changes;
}

const occurrenceLines = (content: string, key: string): number[] => {
  const out: number[] = [];
  content.split(/\r?\n/).forEach((l, i) => {
    if (l.includes(key)) out.push(i + 1);
  });
  return out;
};

/**
 * Compute the listings. An entry is changed when any added or removed line
 * anywhere in the diff contains its key. A listing is returned only when at
 * least one declared location was left unchanged — when every copy moved
 * together there is nothing to remind anyone of.
 */
export function computeCounterparts(input: {
  entries: CounterpartEntry[];
  changes: Map<string, FileChange>;
  readLocation: (path: string) => string | null;
}): { listings: CounterpartListing[]; suppressed: SuppressedKey[] } {
  const listings: CounterpartListing[] = [];
  const suppressed: SuppressedKey[] = [];

  for (const entry of input.entries) {
    const changedAt: string[] = [];
    const changedPaths = new Set<string>();
    for (const change of input.changes.values()) {
      for (const a of change.added) {
        if (a.text.includes(entry.key)) {
          changedAt.push(`${change.path}:${a.line}`);
          changedPaths.add(change.path);
        }
      }
      if (change.removed.some((r) => r.includes(entry.key))) {
        changedPaths.add(change.path);
        if (!changedAt.some((c) => c === change.path || c.startsWith(`${change.path}:`))) {
          changedAt.push(change.path);
        }
      }
    }
    if (changedAt.length === 0) continue;

    if (entry.key.length < MIN_KEY_LENGTH) {
      suppressed.push({ key: entry.key, reason: "too-short" });
      continue;
    }

    const locations: CounterpartLocation[] = entry.locations.map((path) => {
      const content = input.readLocation(path);
      return {
        path,
        lines: content === null ? [] : occurrenceLines(content, entry.key),
        changed: changedPaths.has(path),
        missing: content === null,
      };
    });

    const unchanged = locations.filter((l) => !l.changed);
    if (unchanged.length === 0) continue;

    const total = unchanged.reduce((n, l) => n + l.lines.length, 0);
    const summarized = total > SUMMARY_THRESHOLD;
    if (summarized) {
      let budget = SUMMARY_KEEP;
      for (const l of unchanged) {
        l.lines = l.lines.slice(0, budget);
        budget -= l.lines.length;
      }
    }

    listings.push({ key: entry.key, kind: entry.kind, changedAt, locations, total, summarized });
  }

  return { listings, suppressed };
}
