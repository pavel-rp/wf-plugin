// wf resolver — contained, no-follow access to resolver-owned setup state (WF-872).
//
// Workspace preparation and dependency setup each keep one small state file of
// their own under the workspace: the machine binding ledger and the setup
// success marker. Both are trusted as "already done" when present and are
// written by the resolver alone, so a symbolic link at the file or at any
// directory on the way to it would let a read trust state from outside the
// workspace, or let a write land outside it.
//
// These two primitives answer that for one workspace-relative path:
//
//   - `inspectContainedStatePath` walks the path from the canonical workspace
//     root with `lstat`, segment by segment. Every existing ancestor must be a
//     real directory and the terminal, when present, a regular file. A link of
//     any kind — resolving inside the workspace, outside it, or nowhere at all —
//     is refused, because the question is whether the resolver may follow it,
//     not where it happens to point today.
//   - `writeContainedStateFile` repeats that inspection, creates missing
//     directories one level at a time (re-checking each as it goes), and writes
//     through a create-exclusive temp file renamed over the target, so neither
//     the temp file nor the destination can be a planted link.
//
// Reads go through the existing contained reader (`readContainedCapabilityFile`),
// which applies the same per-segment rule and opens with `O_NOFOLLOW`.
//
// WF-871 adds the setup lock's primitives on the same rule: a create-exclusive
// write (temp file hard-linked into place, so exactly one creator wins and the
// file is never seen half-written), a contained remove, and the rename/link
// pair a stale-lock reclaim uses.

import {
  closeSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  renameSync,
  rmSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

export type ContainedStateInspection =
  | { ok: true; state: "absent" | "file" }
  | { ok: false; kind: "unsafe"; path: string; detail: string };

export type ContainedStateWrite =
  | { ok: true }
  | { ok: false; kind: "unsafe" | "failed"; path: string; detail: string };

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function unsafe(path: string, detail: string): { ok: false; kind: "unsafe"; path: string; detail: string } {
  return { ok: false, kind: "unsafe", path, detail };
}

/** A plain workspace-relative path: no absolute form, no empty, `.` or `..` segment. */
function lexicallyPlain(rel: string): boolean {
  if (rel.length === 0 || rel.includes("\0") || rel.includes("\\")) return false;
  if (rel.startsWith("/") || /^[A-Za-z]:/.test(rel)) return false;
  return !rel.split("/").some((segment) => segment === "" || segment === "." || segment === "..");
}

/**
 * Decide whether `rel` may be trusted and written under `root` without following
 * a link. `absent` covers a missing terminal and a missing ancestor alike —
 * nothing beneath a missing directory can exist.
 */
export function inspectContainedStatePath(root: string, rel: string): ContainedStateInspection {
  if (!lexicallyPlain(rel)) {
    return unsafe(rel, `\`${rel}\` is not a plain workspace-relative path.`);
  }
  let cursor: string;
  try {
    cursor = realpathSync(root);
  } catch (err) {
    return unsafe(rel, `the workspace root cannot be canonicalized: ${messageOf(err)}`);
  }
  const segments = rel.split("/");
  for (let i = 0; i < segments.length; i += 1) {
    cursor = join(cursor, segments[i]);
    const shown = segments.slice(0, i + 1).join("/");
    let stat;
    try {
      stat = lstatSync(cursor);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return { ok: true, state: "absent" };
      return unsafe(shown, `\`${shown}\` cannot be inspected: ${messageOf(err)}`);
    }
    if (stat.isSymbolicLink()) {
      return unsafe(shown, `\`${shown}\` is a symbolic link; resolver setup state follows no link.`);
    }
    const terminal = i === segments.length - 1;
    if (!terminal && !stat.isDirectory()) {
      return unsafe(shown, `\`${shown}\` is not a real directory.`);
    }
    if (terminal && !stat.isFile()) {
      return unsafe(shown, `\`${shown}\` exists but is not a regular file.`);
    }
  }
  return { ok: true, state: "file" };
}

/**
 * Prove `rel` safe, create its missing parent directories one level at a time
 * (re-checking each as it goes), and re-check the whole path immediately
 * before the caller writes. Returns the canonical parent directory and the
 * terminal name.
 */
function prepareContainedParent(
  root: string,
  rel: string,
): { ok: true; dir: string; name: string; state: "absent" | "file" } | { ok: false; kind: "unsafe" | "failed"; path: string; detail: string } {
  const before = inspectContainedStatePath(root, rel);
  if (!before.ok) return before;

  const segments = rel.split("/");
  let dir: string;
  try {
    dir = realpathSync(root);
  } catch (err) {
    return unsafe(rel, `the workspace root cannot be canonicalized: ${messageOf(err)}`);
  }
  for (let i = 0; i < segments.length - 1; i += 1) {
    dir = join(dir, segments[i]);
    const shown = segments.slice(0, i + 1).join("/");
    try {
      mkdirSync(dir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") {
        return { ok: false, kind: "failed", path: shown, detail: `\`${shown}\` could not be created: ${messageOf(err)}` };
      }
    }
    let stat;
    try {
      stat = lstatSync(dir);
    } catch (err) {
      return unsafe(shown, `\`${shown}\` cannot be inspected: ${messageOf(err)}`);
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      return unsafe(shown, `\`${shown}\` is not a real directory; resolver setup state follows no link.`);
    }
  }

  // The directories exist now; re-check the whole path, terminal included,
  // immediately before the write.
  const after = inspectContainedStatePath(root, rel);
  if (!after.ok) return after;
  return { ok: true, dir, name: segments[segments.length - 1], state: after.state };
}

/** Write `content` to a fresh, uniquely named temp file beside `name` in `dir`
 *  (created exclusively, so never through a planted link) and fsync it. */
function writeTempBeside(dir: string, name: string, content: string): string {
  const temp = join(dir, `.${name}.wf-state-${randomBytes(8).toString("hex")}.tmp`);
  let fd: number | null = null;
  try {
    fd = openSync(temp, "wx");
    writeSync(fd, Buffer.from(content, "utf8"));
    fsyncSync(fd);
    closeSync(fd);
    fd = null;
    return temp;
  } catch (err) {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        /* the unlink below is what matters */
      }
    }
    try {
      rmSync(temp, { force: true });
    } catch {
      /* a stranded temp file is inert and uniquely named */
    }
    throw err;
  }
}

/**
 * Write `content` to `rel` under `root` without following a link anywhere on
 * the path. Refuses (`unsafe`) exactly where the inspection refuses; a
 * filesystem error after the path proved safe is `failed`.
 */
export function writeContainedStateFile(root: string, rel: string, content: string): ContainedStateWrite {
  const parent = prepareContainedParent(root, rel);
  if (!parent.ok) return parent;
  let temp: string | null = null;
  try {
    // `wx` is O_CREAT|O_EXCL: the temp file is created fresh and never
    // resolved through an existing link. `rename` replaces the directory entry
    // itself and never follows a link at the destination.
    temp = writeTempBeside(parent.dir, parent.name, content);
    renameSync(temp, join(parent.dir, parent.name));
    return { ok: true };
  } catch (err) {
    if (temp !== null) {
      try {
        rmSync(temp, { force: true });
      } catch {
        /* a stranded temp file is inert and uniquely named */
      }
    }
    return { ok: false, kind: "failed", path: rel, detail: `\`${rel}\` could not be written: ${messageOf(err)}` };
  }
}

export type ContainedStateCreate =
  | { ok: true }
  | { ok: false; kind: "exists" }
  | { ok: false; kind: "unsafe" | "failed"; path: string; detail: string };

/**
 * Create `rel` under `root` holding `content` ONLY if nothing is there yet
 * (WF-871's setup lock). The content is written to a temp file first and then
 * hard-linked into place: the link is create-exclusive at the filesystem, so
 * exactly one of several concurrent creators wins, and the winner's file is
 * never observed empty or half-written. A present file — or one that appears
 * between the check and the link — is `exists`.
 */
export function createContainedStateFileExclusive(root: string, rel: string, content: string): ContainedStateCreate {
  const parent = prepareContainedParent(root, rel);
  if (!parent.ok) return parent;
  if (parent.state === "file") return { ok: false, kind: "exists" };
  let temp: string | null = null;
  try {
    temp = writeTempBeside(parent.dir, parent.name, content);
    linkSync(temp, join(parent.dir, parent.name));
    return { ok: true };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") return { ok: false, kind: "exists" };
    return { ok: false, kind: "failed", path: rel, detail: `\`${rel}\` could not be created: ${messageOf(err)}` };
  } finally {
    if (temp !== null) {
      try {
        rmSync(temp, { force: true });
      } catch {
        /* a stranded temp file is inert and uniquely named */
      }
    }
  }
}

/** Remove `rel` under `root` when it is a contained regular file; an absent
 *  file is already removed. A link anywhere on the path is refused, never
 *  followed. */
export function removeContainedStateFile(root: string, rel: string): ContainedStateWrite {
  const inspected = inspectContainedStatePath(root, rel);
  if (!inspected.ok) return inspected;
  if (inspected.state === "absent") return { ok: true };
  try {
    rmSync(join(realpathSync(root), ...rel.split("/")), { force: true });
    return { ok: true };
  } catch (err) {
    return { ok: false, kind: "failed", path: rel, detail: `\`${rel}\` could not be removed: ${messageOf(err)}` };
  }
}

/** Atomically move the contained regular file `rel` to `toRel` (same parent
 *  directory). `absent` when `rel` was not there to move. */
export function renameContainedStateFile(
  root: string,
  rel: string,
  toRel: string,
): { ok: true; moved: boolean } | { ok: false; kind: "unsafe" | "failed"; path: string; detail: string } {
  const from = inspectContainedStatePath(root, rel);
  if (!from.ok) return from;
  const to = inspectContainedStatePath(root, toRel);
  if (!to.ok) return to;
  if (from.state === "absent") return { ok: true, moved: false };
  try {
    const base = realpathSync(root);
    renameSync(join(base, ...rel.split("/")), join(base, ...toRel.split("/")));
    return { ok: true, moved: true };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { ok: true, moved: false };
    return { ok: false, kind: "failed", path: rel, detail: `\`${rel}\` could not be moved: ${messageOf(err)}` };
  }
}

/** Hard-link the contained file `fromRel` to `toRel` only if `toRel` is free —
 *  the restore half of a lock reclaim that captured a live holder's file. */
export function linkContainedStateFileExclusive(root: string, fromRel: string, toRel: string): boolean {
  const from = inspectContainedStatePath(root, fromRel);
  const to = inspectContainedStatePath(root, toRel);
  if (!from.ok || !to.ok || from.state !== "file" || to.state !== "absent") return false;
  try {
    const base = realpathSync(root);
    linkSync(join(base, ...fromRel.split("/")), join(base, ...toRel.split("/")));
    return true;
  } catch {
    return false;
  }
}
