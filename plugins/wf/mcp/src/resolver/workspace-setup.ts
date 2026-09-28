// wf resolver — the project-declared dependency-setup step (WF-831).
//
// A prepared worktree still has no installed dependencies. The project may
// declare ONE command that installs them, as a core config key in its own
// registry/config file. This module decides what that step does; the service
// runs the command through a port and maps the result.
//
// ONLY THE PROJECT DECLARES IT. The command is read from the core config values
// parsed out of the project's own config file and from nowhere else — no
// capability manifest, profile, settings file or fragment is consulted, so a
// capability that declares a setup command of its own is simply never read.
//
// EMPTY BY DEFAULT, BOUNDED ALWAYS. An unset key is `not-declared` and runs
// nothing (core stays inert). A declared command always runs under a timeout:
// the project's own `Dependency Setup Timeout` in seconds, else a default, and
// never above a fixed ceiling.

import { createHash } from "node:crypto";
import type { CoreConfig } from "./types.js";

/** Where a successful run is recorded, so the same command is not re-run. */
export const SETUP_STATE_RELPATH = "_local/resolver/setup-state.json";
export const DEFAULT_SETUP_TIMEOUT_SECONDS = 600;
export const MAX_SETUP_TIMEOUT_SECONDS = 3600;
/** The bounded amount of trailing command output ever returned. */
export const SETUP_OUTPUT_TAIL_CHARS = 2000;

/** `unsafe-path`: the success marker's path, or a directory on the way to it,
 *  is a symbolic link or otherwise not a real directory / regular file — the
 *  marker is neither trusted nor written through it (WF-872). */
export type SetupBlocker = "unprepared" | "failed" | "timed-out" | "unsafe-path";

/** Upper bound on the success marker's size; it is a two-field JSON record. */
export const SETUP_STATE_MAX_BYTES = 64 * 1024;

/** What the command-execution port reports. */
export type SetupCommandResult = {
  /** Exit status, or `null` when the process did not exit normally. */
  exitCode: number | null;
  /** Terminating signal name, when one ended it. */
  signal: string | null;
  timedOut: boolean;
  /** The last `SETUP_OUTPUT_TAIL_CHARS` characters of combined output. */
  outputTail: string;
  /** A spawn failure (the command could not be started at all). */
  error: string | null;
  durationMs: number;
};

export type WorkspaceSetupResponse = {
  status: "succeeded" | "already-done" | "not-declared" | "blocked";
  reason: SetupBlocker | null;
  /** The project-declared command, echoed verbatim; `null` when none is declared. */
  command: string | null;
  timeoutSeconds: number;
  exitCode: number | null;
  durationMs: number | null;
  outputTail: string;
  detail: string;
  diagnostics: string[];
};

export type SetupPlan =
  | { kind: "unprepared" }
  | { kind: "not-declared"; timeoutSeconds: number; diagnostics: string[] }
  | { kind: "already-done"; command: string; timeoutSeconds: number; diagnostics: string[] }
  | { kind: "run"; command: string; digest: string; timeoutSeconds: number; diagnostics: string[] };

/** Parse the declared timeout; an absent value is the default, an unusable one
 *  is the default with a diagnostic, and any value is held to the ceiling. */
export function parseSetupTimeout(raw: string | null): { seconds: number; diagnostic: string | null } {
  if (raw === null) return { seconds: DEFAULT_SETUP_TIMEOUT_SECONDS, diagnostic: null };
  const trimmed = raw.trim();
  if (!/^[0-9]+$/.test(trimmed) || Number(trimmed) <= 0) {
    return {
      seconds: DEFAULT_SETUP_TIMEOUT_SECONDS,
      diagnostic: `Dependency Setup Timeout \`${raw}\` is not a positive whole number of seconds; the default ${DEFAULT_SETUP_TIMEOUT_SECONDS} applies.`,
    };
  }
  const seconds = Number(trimmed);
  if (seconds > MAX_SETUP_TIMEOUT_SECONDS) {
    return {
      seconds: MAX_SETUP_TIMEOUT_SECONDS,
      diagnostic: `Dependency Setup Timeout ${seconds} exceeds the ${MAX_SETUP_TIMEOUT_SECONDS}-second ceiling; the ceiling applies.`,
    };
  }
  return { seconds, diagnostic: null };
}

export function setupCommandDigest(command: string): string {
  return createHash("sha256").update(command, "utf8").digest("hex");
}

/** The digest of the last command that succeeded, or `null`. Tolerant: an
 *  absent or unreadable record means "not done", which re-runs — the safe side. */
export function readSetupStateDigest(text: string | null): string | null {
  if (text === null) return null;
  try {
    const parsed = JSON.parse(text) as { commandDigest?: unknown };
    return typeof parsed.commandDigest === "string" && /^[a-f0-9]{64}$/.test(parsed.commandDigest)
      ? parsed.commandDigest
      : null;
  } catch {
    return null;
  }
}

export function renderSetupState(digest: string, completedAt: string): string {
  return `${JSON.stringify({ commandDigest: digest, completedAt }, null, 2)}\n`;
}

/** Decide the step from the project's own core config and the success record. */
export function planWorkspaceSetup(config: CoreConfig, stateText: string | null): SetupPlan {
  if (config.taskRoot === null) return { kind: "unprepared" };
  const timeout = parseSetupTimeout(config.dependencySetupTimeout);
  const diagnostics = timeout.diagnostic === null ? [] : [timeout.diagnostic];
  const command = config.dependencySetupCommand;
  if (command === null) {
    return { kind: "not-declared", timeoutSeconds: timeout.seconds, diagnostics };
  }
  const digest = setupCommandDigest(command);
  if (readSetupStateDigest(stateText) === digest) {
    return { kind: "already-done", command, timeoutSeconds: timeout.seconds, diagnostics };
  }
  return { kind: "run", command, digest, timeoutSeconds: timeout.seconds, diagnostics };
}

/** Keep only the tail, so a noisy command never floods the caller. */
export function tailOf(output: string): string {
  return output.length <= SETUP_OUTPUT_TAIL_CHARS
    ? output
    : output.slice(output.length - SETUP_OUTPUT_TAIL_CHARS);
}
