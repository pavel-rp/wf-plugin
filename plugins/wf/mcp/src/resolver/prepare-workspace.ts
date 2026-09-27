// wf resolver — fresh-worktree preparation (WF-831).
//
// A linked worktree of the same repository starts with no gitignored `_local/`
// setup state, so the resolver in it reports an uninitialized project. This
// module decides — and, only after every check passes, performs — the bounded
// copy of that setup state from a SOURCE worktree of the same family.
//
// THE ALLOWLIST ENUMERATES FILE CLASSES, IT NEVER WALKS `_local/`. Exactly five
// classes transfer: the registry/config file (at the child's own registry path),
// the composed constitution, capability profiles, per-skill settings overrides,
// and personal slot overrides. Task folders, receipts, approvals, run evidence,
// scoreboards, scratch, snapshots, locks, journals and the machine binding
// ledger are excluded by construction — nothing outside the five classes is
// ever listed, so nothing outside them can be copied.
//
// THE SOURCE IS READ-ONLY. Every write lands under the child's `_local/`, and
// nothing is written at all unless every candidate has passed the symlink,
// containment and divergence checks first.

import {
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { parseCoreConfig } from "./config.js";

/** The closed blocker set. */
export type PrepareBlocker =
  | "foreign-root"
  | "source-uninitialized"
  | "divergent"
  | "unsafe-path";

/** The machine binding ledger outcome — reported, never a blocker. */
export type InstallStateOutcome = "regenerated" | "present" | "unavailable";

export type PrepareWorkspaceResponse =
  | {
      status: "prepared" | "already-prepared";
      workspaceRoot: string;
      sourceRoot: string;
      /** Workspace-relative paths written into the child this call. */
      copied: string[];
      /** Allowlisted paths already byte-identical in the child. */
      unchanged: string[];
      installState: InstallStateOutcome;
      diagnostics: string[];
    }
  | {
      status: "blocked";
      workspaceRoot: string;
      sourceRoot: string;
      reason: PrepareBlocker;
      /** Workspace-relative path the blocker names, when it names one. */
      path: string | null;
      detail: string;
      copied: [];
      unchanged: [];
      installState: null;
      diagnostics: string[];
    };

/** The local setup-state root every allowlisted class lives under. */
export const SETUP_STATE_DIR = "_local";

const CORE_CONFIG_REL = "_local/config.md";
const CONSTITUTION_REL = "_local/constitution.md";
const PROFILES_DIR_REL = "_local/profiles";
const SLOTS_DIR_REL = "_local/slots";
const PROFILE_SUFFIXES = [".profile.json", ".settings.json"] as const;
const SLOT_SUFFIX = ".md";

export type PreparationPlan =
  | { ok: true; copies: { rel: string; bytes: Buffer }[]; unchanged: string[] }
  | { ok: false; reason: PrepareBlocker; path: string | null; detail: string };

function join(root: string, rel: string): string {
  return `${root.replace(/\/+$/, "")}/${rel}`;
}

type Kind = "absent" | "file" | "dir" | "symlink" | "other";

function kindOf(abs: string): Kind {
  try {
    const stat = lstatSync(abs);
    if (stat.isSymbolicLink()) return "symlink";
    if (stat.isFile()) return "file";
    if (stat.isDirectory()) return "dir";
    return "other";
  } catch {
    return "absent";
  }
}

/** A relative path is admissible only when it is a plain `_local/…` path. */
function lexicallyContained(rel: string): boolean {
  if (rel.length === 0 || rel.includes("\0") || rel.includes("\\")) return false;
  if (rel.startsWith("/") || /^[A-Za-z]:/.test(rel)) return false;
  const segments = rel.split("/");
  if (segments[0] !== SETUP_STATE_DIR || segments.length < 2) return false;
  return !segments.some((segment) => segment === "" || segment === "." || segment === "..");
}

/** Every directory on the way to `rel` must be a real directory (or absent)
 *  under `root` — a symlinked `_local/` or `_local/profiles/` would otherwise
 *  carry a read or a write outside the tree it appears to be in. */
function ancestorsSafe(root: string, rel: string): string | null {
  const segments = rel.split("/");
  for (let i = 1; i < segments.length; i += 1) {
    const ancestor = segments.slice(0, i).join("/");
    const kind = kindOf(join(root, ancestor));
    if (kind === "symlink" || kind === "file" || kind === "other") return ancestor;
  }
  return null;
}

function listClass(sourceRoot: string, dirRel: string, suffixes: readonly string[]): string[] {
  let names: string[];
  try {
    names = readdirSync(join(sourceRoot, dirRel));
  } catch {
    return [];
  }
  return names
    .filter((name) => suffixes.some((suffix) => name.endsWith(suffix) && name.length > suffix.length))
    .sort()
    .map((name) => `${dirRel}/${name}`);
}

/**
 * Decide the bounded copy. Reads the source and the child; writes nothing.
 *
 * `registryRel` is the CHILD's own registry location — the file the child's
 * resolver will read — so a relocated registry is carried exactly when it lives
 * under `_local/`, and refused as `unsafe-path` when it does not.
 */
export function planPreparation(input: {
  childRoot: string;
  sourceRoot: string;
  registryRel: string;
}): PreparationPlan {
  const { childRoot, sourceRoot, registryRel } = input;

  if (!lexicallyContained(registryRel)) {
    return {
      ok: false,
      reason: "unsafe-path",
      path: registryRel,
      detail: `the registry location \`${registryRel}\` is not a plain path under \`${SETUP_STATE_DIR}/\`; preparation writes nowhere else.`,
    };
  }

  // The source must itself be an initialized project.
  const registryKind = kindOf(join(sourceRoot, registryRel));
  if (registryKind === "symlink") {
    return {
      ok: false,
      reason: "unsafe-path",
      path: registryRel,
      detail: `the source registry \`${registryRel}\` is a symbolic link; only regular files are copied.`,
    };
  }
  if (registryKind !== "file") {
    return {
      ok: false,
      reason: "source-uninitialized",
      path: registryRel,
      detail: `the source worktree has no registry at \`${registryRel}\`.`,
    };
  }
  // Core config values are read from the default config file when present, else
  // from the registry — the same order the snapshot build uses.
  const hasDefaultConfig = kindOf(join(sourceRoot, CORE_CONFIG_REL)) === "file";
  const configRel = hasDefaultConfig ? CORE_CONFIG_REL : registryRel;
  const configText = readFileSync(join(sourceRoot, configRel), "utf8");
  if (parseCoreConfig(configText).taskRoot === null) {
    return {
      ok: false,
      reason: "source-uninitialized",
      path: configRel,
      detail: `the source config \`${configRel}\` declares no task root.`,
    };
  }

  const candidates = [
    registryRel,
    ...(hasDefaultConfig ? [CORE_CONFIG_REL] : []),
    ...(kindOf(join(sourceRoot, CONSTITUTION_REL)) === "absent" ? [] : [CONSTITUTION_REL]),
    ...listClass(sourceRoot, PROFILES_DIR_REL, PROFILE_SUFFIXES),
    ...listClass(sourceRoot, SLOTS_DIR_REL, [SLOT_SUFFIX]),
  ].filter((rel, index, all) => all.indexOf(rel) === index);

  const copies: { rel: string; bytes: Buffer }[] = [];
  const unchanged: string[] = [];
  for (const rel of candidates) {
    for (const [root, side] of [
      [sourceRoot, "source"],
      [childRoot, "child"],
    ] as const) {
      const unsafeAncestor = ancestorsSafe(root, rel);
      if (unsafeAncestor !== null) {
        return {
          ok: false,
          reason: "unsafe-path",
          path: unsafeAncestor,
          detail: `the ${side} directory \`${unsafeAncestor}\` is not a real directory; preparation follows no link.`,
        };
      }
    }
    const sourceKind = kindOf(join(sourceRoot, rel));
    if (sourceKind !== "file") {
      return {
        ok: false,
        reason: "unsafe-path",
        path: rel,
        detail: `the source entry \`${rel}\` is not a regular file (${sourceKind}); only regular files are copied.`,
      };
    }
    const bytes = readFileSync(join(sourceRoot, rel));
    const childKind = kindOf(join(childRoot, rel));
    if (childKind === "absent") {
      copies.push({ rel, bytes });
      continue;
    }
    if (childKind !== "file") {
      return {
        ok: false,
        reason: "unsafe-path",
        path: rel,
        detail: `the child entry \`${rel}\` exists but is not a regular file (${childKind}).`,
      };
    }
    if (readFileSync(join(childRoot, rel)).equals(bytes)) {
      unchanged.push(rel);
      continue;
    }
    return {
      ok: false,
      reason: "divergent",
      path: rel,
      detail: `the child already holds a different \`${rel}\`; it is left untouched rather than overwritten.`,
    };
  }
  return { ok: true, copies, unchanged };
}

/** Write each planned copy as a regular file under the child, temp-then-rename
 *  so a reader never observes a half-written file. Returns the written paths. */
export function applyPreparation(
  childRoot: string,
  copies: readonly { rel: string; bytes: Buffer }[],
): string[] {
  const written: string[] = [];
  for (const { rel, bytes } of copies) {
    const target = join(childRoot, rel);
    mkdirSync(target.slice(0, target.lastIndexOf("/")), { recursive: true });
    const temp = `${target}.wf-prepare-${process.pid}.tmp`;
    try {
      writeFileSync(temp, bytes, { flag: "wx" });
      renameSync(temp, target);
    } catch (err) {
      rmSync(temp, { force: true });
      throw err;
    }
    written.push(rel);
  }
  return written;
}
