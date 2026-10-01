// wf resolver — path normalization + plugin-anchored resolution.
//
// All snapshot paths are normalized to forward slashes (the repo convention;
// see CLAUDE.md "No Windows-style paths"). Plugin-anchored capability paths
// resolve recorded-root-first with a self-heal that uses ONLY `claude plugin
// list --json` install paths — never a private Claude install manifest
// (~/.claude/plugins/installed_plugins.json), per the WF-269 scope boundary.

/** Explain why a configured registry path is not a forward-slash repo-relative path. */
export function registryPathShapeError(path: string): string | null {
  if (path.includes("\\")) return "contains a backslash (must use forward slashes)";
  if (/^\//.test(path)) return "absolute path (leading '/')";
  if (/^[A-Za-z]:/.test(path)) return "drive-prefixed path";
  if (`/${path}/`.includes("/../")) return "contains a '..' segment";
  return null;
}

/** Replace every backslash with a forward slash. Idempotent. */
export function normalizeSlashes(p: string): string {
  return p.replace(/\\/g, "/");
}

/** Join path segments with a single forward slash, trimming interior repeats
 *  and any trailing slash on the left operand. */
export function joinSlash(...segments: string[]): string {
  return segments
    .map((s, i) => {
      let seg = normalizeSlashes(s);
      if (i > 0) seg = seg.replace(/^\/+/, "");
      if (i < segments.length - 1) seg = seg.replace(/\/+$/, "");
      return seg;
    })
    .filter((s) => s.length > 0)
    .join("/");
}

/** The parent of a normalized forward-slash path, with no trailing slash. Returns
 *  the input unchanged when it has no parent segment. Purely lexical — it never
 *  touches the filesystem, so it is safe on a path that does not exist. */
export function dirnameSlash(p: string): string {
  const normalized = normalizeSlashes(p).replace(/\/+$/, "");
  const cut = normalized.lastIndexOf("/");
  if (cut < 0) return normalized;
  if (cut === 0) return "/";
  return normalized.slice(0, cut);
}

/** Resolve a manifest-controlled file path beneath one capability root.
 *  Reject absolute anchors, backslashes, empty/dot segments, and traversal before
 *  joining, then prove the normalized result remains under the normalized root. */
export function resolveContainedCapabilityPath(root: string, relative: string): string | null {
  if (
    relative.length === 0 ||
    relative.includes("\0") ||
    relative.includes("\\") ||
    isAbsoluteRoot(relative)
  ) {
    return null;
  }
  const segments = relative.split("/");
  if (
    segments.some(
      (segment) => segment === "" || segment === "." || segment === ".." || segment.includes(":"),
    )
  ) {
    return null;
  }

  const normalizedRoot = normalizeSlashes(root).replace(/\/+$/, "");
  const candidate = joinSlash(normalizedRoot, ...segments);
  const prefix = normalizedRoot === "/" ? "/" : `${normalizedRoot}/`;
  return candidate.startsWith(prefix) ? candidate : null;
}

export type ContainedFileReadResult =
  | { status: "ok"; path: string; content: string }
  | {
      status: "missing" | "unsafe" | "too-large" | "unsupported" | "unreadable";
      path: string | null;
      content: null;
    };

const PLUGIN_ANCHOR = /^plugin:([^/]+)\/(.+)$/;

export interface ParsedAnchor {
  pluginName: string;
  relPath: string;
}

/** Parse a `plugin:<plugin-name>/<rel-path>` token; `null` for a plain path. */
export function parsePluginAnchor(registryPath: string): ParsedAnchor | null {
  const m = PLUGIN_ANCHOR.exec(registryPath.trim());
  if (!m) return null;
  return { pluginName: m[1], relPath: m[2] };
}

/** Minimal view of a plugin-root recorded mapping row. */
export interface RecordedRoot {
  plugin: string;
  root: string;
}

/** Minimal view of an installed pack's recovery datum (from the CLI). */
export interface InstalledRoot {
  pluginName: string;
  installPath: string;
}

export interface ResolvedCapabilityPath {
  /** Normalized capability folder path (…/capabilities/<cap>), or null. */
  resolvedPath: string | null;
  /** Normalized manifest.md path, or null when no readable manifest exists. */
  manifestPath: string | null;
  provenance: "recorded" | "self-healed" | "unrecoverable";
  /** The normalized recorded root when it was passed over for the installed
   *  pack because it is an older sibling version folder of the installed root
   *  (both readable). `null` on every other path. */
  supersededRoot?: string | null;
}

/** True when two normalized roots are distinct sibling folders — different
 *  paths under one shared parent directory, as two version folders of one
 *  pack in the host's plugin cache are. Purely lexical. */
function isSiblingRoot(a: string, b: string): boolean {
  const left = a.replace(/\/+$/, "");
  const right = b.replace(/\/+$/, "");
  if (left === right) return false;
  const parent = dirnameSlash(left);
  return parent !== left && parent === dirnameSlash(right);
}

/**
 * Resolve a registry `Path` to a capability folder + manifest path.
 *
 * A repo-relative folder resolves against `workspaceRoot` (provenance
 * `recorded`). A plugin-anchored token resolves recorded-root-first; if the
 * recorded root dangles (no readable manifest), it self-heals from the matching
 * installed pack's installPath (provenance `self-healed`). When neither route
 * yields a readable manifest, provenance is `unrecoverable`.
 *
 * One exception to recorded-root-first: when the recorded root is a sibling
 * folder of the installed pack's installPath (an older version folder the host
 * has not purged yet) and the installed manifest is readable, the installed
 * pack wins — provenance `self-healed`, with the recorded root reported as
 * `supersededRoot` — so capability folders and pack-owned references come from
 * the version the host actually runs. A recorded root that is not such a
 * sibling (a checkout pointed at on purpose) still wins as before.
 *
 * `manifestExists` is injected so the pure resolver can be driven from either a
 * real filesystem probe or a test double.
 */
export function resolveCapabilityPath(
  registryPath: string,
  opts: {
    workspaceRoot: string;
    recordedRoots: RecordedRoot[];
    installedRoots: InstalledRoot[];
    manifestExists: (manifestPath: string) => boolean;
  },
): ResolvedCapabilityPath {
  const anchor = parsePluginAnchor(registryPath);

  if (!anchor) {
    // Repo-relative folder against the workspace root.
    const folder = joinSlash(opts.workspaceRoot, registryPath);
    const manifest = joinSlash(folder, "manifest.md");
    if (opts.manifestExists(manifest)) {
      return { resolvedPath: folder, manifestPath: manifest, provenance: "recorded", supersededRoot: null };
    }
    return { resolvedPath: folder, manifestPath: null, provenance: "unrecoverable", supersededRoot: null };
  }

  const recorded = opts.recordedRoots.find((r) => r.plugin === anchor.pluginName);
  const recordedRoot = recorded
    ? isAbsoluteRoot(recorded.root)
      ? normalizeSlashes(recorded.root)
      : joinSlash(opts.workspaceRoot, recorded.root)
    : null;
  const installed = opts.installedRoots.find((r) => r.pluginName === anchor.pluginName);
  const installedRoot = installed ? normalizeSlashes(installed.installPath) : null;
  const installedFolder = installedRoot ? joinSlash(installedRoot, anchor.relPath) : null;
  const installedManifest = installedFolder ? joinSlash(installedFolder, "manifest.md") : null;

  // 1. Recorded root first — unless it is an older sibling version folder of a
  //    readable installed pack, which the installed pack supersedes.
  if (recordedRoot !== null) {
    const folder = joinSlash(recordedRoot, anchor.relPath);
    const manifest = joinSlash(folder, "manifest.md");
    if (opts.manifestExists(manifest)) {
      if (
        installedRoot !== null &&
        installedFolder !== null &&
        installedManifest !== null &&
        isSiblingRoot(recordedRoot, installedRoot) &&
        opts.manifestExists(installedManifest)
      ) {
        return {
          resolvedPath: installedFolder,
          manifestPath: installedManifest,
          provenance: "self-healed",
          supersededRoot: recordedRoot.replace(/\/+$/, ""),
        };
      }
      return {
        resolvedPath: folder,
        manifestPath: manifest,
        provenance: "recorded",
        supersededRoot: null,
      };
    }
  }

  // 2. Dangling / unmapped → self-heal from the installed pack's installPath.
  if (installedFolder !== null && installedManifest !== null) {
    if (opts.manifestExists(installedManifest)) {
      return {
        resolvedPath: installedFolder,
        manifestPath: installedManifest,
        provenance: "self-healed",
        supersededRoot: null,
      };
    }
  }

  // 3. Neither route recovered a readable manifest.
  return { resolvedPath: null, manifestPath: null, provenance: "unrecoverable", supersededRoot: null };
}

/** An absolute root has a leading `/` or a drive prefix (`C:`), per the
 *  `## Plugin Roots` `Root` shape which permits absolute/drive-prefixed roots. */
export function isAbsoluteRoot(root: string): boolean {
  const n = normalizeSlashes(root);
  return n.startsWith("/") || /^[A-Za-z]:/.test(n);
}
