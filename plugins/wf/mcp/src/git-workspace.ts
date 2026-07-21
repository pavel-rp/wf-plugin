// Canonical Git worktree identity shared by request admission and pre-MCP refresh.

import { execFileSync } from "node:child_process";
import { realpathSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { normalizeSlashes } from "./resolver/paths.js";

export type GitIdentity = {
  worktreeRoot: string;
  commonDir: string;
};

export type WorkspaceIdentity =
  | { kind: "git"; root: string; commonDir: string }
  | { kind: "plain"; root: string };

export function canonicalDirectory(path: string, label: string): string {
  if (!isAbsolute(path)) {
    throw new Error(`${label} must be an absolute path.`);
  }

  let stat;
  try {
    stat = statSync(path);
  } catch {
    throw new Error(`${label} does not exist: ${path}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`${label} must be a directory: ${path}`);
  }

  return normalizeSlashes(realpathSync(path));
}

function gitOutput(directory: string, ...args: string[]): string {
  try {
    return execFileSync("git", ["-C", directory, "rev-parse", ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    throw new Error(`workspaceRoot is not inside a Git worktree: ${directory}`);
  }
}

/** Resolve the canonical worktree root and common Git directory for a directory. */
export function resolveGitIdentity(directory: string, label = "workspaceRoot"): GitIdentity {
  const canonicalInput = canonicalDirectory(directory, label);
  const topLevel = gitOutput(canonicalInput, "--show-toplevel");
  const canonicalTopLevel = canonicalDirectory(
    isAbsolute(topLevel) ? topLevel : resolve(canonicalInput, topLevel),
    "Git worktree root",
  );
  const commonDir = gitOutput(canonicalInput, "--git-common-dir");
  const canonicalCommonDir = canonicalDirectory(
    isAbsolute(commonDir) ? commonDir : resolve(canonicalInput, commonDir),
    "Git common directory",
  );
  return { worktreeRoot: canonicalTopLevel, commonDir: canonicalCommonDir };
}

/** Resolve a directory to its Git worktree root, or to itself when it is plain. */
export function resolveWorkspaceIdentity(
  directory: string,
  label = "workspaceRoot",
): WorkspaceIdentity {
  const canonicalInput = canonicalDirectory(directory, label);
  try {
    const git = resolveGitIdentity(canonicalInput, label);
    return { kind: "git", root: git.worktreeRoot, commonDir: git.commonDir };
  } catch (err) {
    if (!(err instanceof Error) || !err.message.startsWith("workspaceRoot is not inside a Git worktree:")) {
      throw err;
    }
    return { kind: "plain", root: canonicalInput };
  }
}
