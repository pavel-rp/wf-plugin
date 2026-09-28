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

import { createHash, randomBytes } from "node:crypto";
import { hostname } from "node:os";
import type { CoreConfig } from "./types.js";
import {
  createContainedStateFileExclusive,
  linkContainedStateFileExclusive,
  removeContainedStateFile,
  renameContainedStateFile,
} from "./contained-state.js";
import { readContainedCapabilityFile } from "./engine.js";

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

// --- the setup runner (WF-871) -----------------------------------------------
//
// A synchronous `spawnSync(command, { shell: true, timeout })` can only signal
// the wrapper shell it started, so anything that shell started keeps running
// after a timeout. The port therefore runs this small program under the same
// Node executable instead: it starts the command in a process group of its
// own, enforces the timeout, and stops the WHOLE group — on a timeout, and
// once the command exits, so a straggler it left behind cannot keep mutating
// the worktree either. POSIX signals the group; Windows ends the process tree
// with the host's `taskkill /T /F`. It reports one JSON line on stdout.
// (A descendant that deliberately detaches into a session of its own leaves
// the group and is outside what any group signal can reach.)

/** Extra time the port gives the runner beyond the command timeout, so the
 *  runner's own kill and report always happen before the port gives up. */
export const SETUP_RUNNER_MARGIN_MS = 15_000;
/** Once the command has exited and its group is signalled, how long to wait
 *  for its output streams to close before reporting anyway. */
const SETUP_RUNNER_DRAIN_MS = 2_000;

export type SetupRunnerRequest = {
  command: string;
  cwd: string;
  timeoutMs: number;
  tailChars: number;
  /** The held setup lock (absolute path + this run's token). When present the
   *  runner records its own pid and the command group's pid into that lock
   *  record, so the lock stays live while either still runs — even if the
   *  resolver that took the lock has died. */
  lock?: { path: string; token: string };
};

export const SETUP_RUNNER_SOURCE = `
const { spawn, spawnSync } = require("node:child_process");
const req = JSON.parse(process.env.WF_SETUP_REQUEST);
delete process.env.WF_SETUP_REQUEST;
const win = process.platform === "win32";
const out = { exitCode: null, signal: null, timedOut: false, output: "", error: null };
let tail = "";
const keep = (chunk) => {
  tail += chunk.toString("utf8");
  if (tail.length > req.tailChars) tail = tail.slice(tail.length - req.tailChars);
};
let child = null;
let done = false;
const finish = () => {
  if (done) return;
  done = true;
  out.output = tail;
  process.stdout.write(JSON.stringify(out), () => process.exit(0));
};
const stopGroup = () => {
  if (child === null || child.pid === undefined) return;
  try {
    if (win) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    else process.kill(-child.pid, "SIGKILL");
  } catch {}
};
try {
  child = spawn(req.command, { cwd: req.cwd, shell: true, detached: !win, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
} catch (err) {
  out.error = err instanceof Error ? err.message : String(err);
  finish();
}
const reportPids = () => {
  if (!req.lock || child === null || child.pid === undefined) return;
  try {
    const fs = require("node:fs");
    const rec = JSON.parse(fs.readFileSync(req.lock.path, "utf8"));
    if (rec === null || typeof rec !== "object" || rec.token !== req.lock.token) return;
    rec.runnerPid = process.pid;
    if (!win) rec.groupPid = child.pid;
    const tmp = req.lock.path + ".runner-" + process.pid;
    fs.writeFileSync(tmp, JSON.stringify(rec) + "\\n", { flag: "wx" });
    fs.renameSync(tmp, req.lock.path);
  } catch {}
};
if (child !== null) {
  reportPids();
  child.stdout.on("data", keep);
  child.stderr.on("data", keep);
  const timer = setTimeout(() => {
    out.timedOut = true;
    stopGroup();
  }, req.timeoutMs);
  child.on("error", (err) => {
    clearTimeout(timer);
    out.error = err instanceof Error ? err.message : String(err);
    stopGroup();
    finish();
  });
  child.on("exit", (code, signal) => {
    clearTimeout(timer);
    out.exitCode = code;
    out.signal = signal;
    stopGroup();
    setTimeout(finish, ${SETUP_RUNNER_DRAIN_MS});
  });
  child.on("close", finish);
}
`;

/** Parse the runner's report into the port's result shape. */
export function parseSetupRunnerReport(
  stdout: string,
  durationMs: number,
): SetupCommandResult | null {
  try {
    const parsed = JSON.parse(stdout) as {
      exitCode: number | null;
      signal: string | null;
      timedOut: boolean;
      output: string;
      error: string | null;
    };
    if (typeof parsed.timedOut !== "boolean") return null;
    return {
      exitCode: typeof parsed.exitCode === "number" ? parsed.exitCode : null,
      signal: typeof parsed.signal === "string" ? parsed.signal : null,
      timedOut: parsed.timedOut,
      outputTail: tailOf(typeof parsed.output === "string" ? parsed.output : ""),
      error: parsed.timedOut ? null : typeof parsed.error === "string" ? parsed.error : null,
      durationMs,
    };
  } catch {
    return null;
  }
}

// --- the per-workspace setup lock (WF-871) -----------------------------------
//
// The state check, the command run and the success-marker write happen while
// this lock is held, so two resolver processes working on one worktree can
// never both observe "not done" and both run the command. The lock is a small
// JSON record created exclusively through the contained, no-follow state
// helpers (WF-872). A second caller waits — bounded — and then re-checks the
// marker, so it reports `already-done` rather than running again.
//
// LIVENESS. A lock on this host is held while ANY of these is true:
//   (a) the resolver process that took it is alive;
//   (b) the setup runner, or the command's process group, it records is alive
//       (the runner writes both pids into the record once the command starts);
//   (c) `acquiredAt + timeoutMs + SETUP_RUNNER_MARGIN_MS` has not yet passed —
//       the latest moment the runner's own timeout can still be stopping it.
// Only when all three are false is the lock abandoned: the recorded group is
// then signalled (best effort) and the lock is reclaimed. A record carrying
// this process's own pid is judged by its token: a token this process issued
// and has finished with is abandoned outright; one it never issued (a reused
// pid) does not count as a live holder under (a).

/** The lock file; it lives beside the success marker. */
export const SETUP_LOCK_RELPATH = "_local/resolver/setup.lock";
/** Added to the command timeout to bound how long a caller waits for a holder. */
export const SETUP_LOCK_WAIT_GRACE_SECONDS = 30;
export const SETUP_LOCK_POLL_MS = 100;
const SETUP_LOCK_MAX_BYTES = 4096;

export type SetupLockRecord = {
  pid: number;
  host: string;
  token: string;
  acquiredAt: string;
  /** The command timeout the holder runs under; absent on an older record,
   *  which is then judged against the ceiling. */
  timeoutMs?: number;
  /** The setup runner's pid, written by the runner once the command starts. */
  runnerPid?: number;
  /** The command's process-group id (POSIX), written by the runner. */
  groupPid?: number;
};

export function renderSetupLock(record: SetupLockRecord): string {
  return `${JSON.stringify(record)}\n`;
}

function positiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/** The lock's holder, or `null` when the text is not a lock record. */
export function parseSetupLock(text: string | null): SetupLockRecord | null {
  if (text === null) return null;
  try {
    const parsed = JSON.parse(text) as Partial<SetupLockRecord>;
    if (
      positiveInt(parsed.pid) &&
      typeof parsed.host === "string" &&
      typeof parsed.token === "string" &&
      parsed.token.length > 0 &&
      typeof parsed.acquiredAt === "string"
    ) {
      const record: SetupLockRecord = { pid: parsed.pid, host: parsed.host, token: parsed.token, acquiredAt: parsed.acquiredAt };
      if (positiveInt(parsed.timeoutMs)) record.timeoutMs = parsed.timeoutMs;
      if (positiveInt(parsed.runnerPid)) record.runnerPid = parsed.runnerPid;
      if (positiveInt(parsed.groupPid)) record.groupPid = parsed.groupPid;
      return record;
    }
    return null;
  } catch {
    return null;
  }
}

/** Tokens this process has issued, and the subset it still holds. A record
 *  carrying this process's pid and an issued-but-released token is abandoned. */
const issuedSetupLockTokens = new Set<string>();
const heldSetupLockTokens = new Set<string>();

/** The environment the lock loop observes; injectable so tests stay fast. */
export type SetupLockDeps = {
  pid: number;
  host: string;
  now(): number;
  sleepMs(ms: number): void;
  /** Whether a process with this id exists on this host. A negative id asks
   *  about the process group `-pid` (POSIX). */
  processAlive(pid: number): boolean;
  /** Best-effort stop of an abandoned lock's recorded command group. */
  killGroup?(groupPid: number): void;
  /** The restore step of a reclaim that captured a live holder's lock;
   *  defaults to the contained exclusive hard link. */
  linkBack?(root: string, fromRel: string, toRel: string): boolean;
};

export const defaultSetupLockDeps: SetupLockDeps = {
  pid: process.pid,
  host: hostname(),
  now: () => Date.now(),
  sleepMs: (ms) => {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  },
  processAlive: (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch (err) {
      // EPERM: it exists but belongs to someone else — still alive.
      return (err as NodeJS.ErrnoException).code === "EPERM";
    }
  },
  killGroup: (groupPid) => {
    if (process.platform === "win32") return;
    try {
      process.kill(-groupPid, "SIGKILL");
    } catch {
      // Already gone, or not ours to signal: nothing more to do.
    }
  },
};

/** Whether a lock record on this host still has a live holder — (a), (b) or
 *  (c) in the module note above. */
export function setupLockLive(holder: SetupLockRecord, deps: SetupLockDeps): boolean {
  if (holder.pid === deps.pid) {
    // This process's own pid: its tokens say whether it still holds the lock.
    if (heldSetupLockTokens.has(holder.token)) return true;
    // Issued here and since released — spawnSync has returned, so the runner
    // it started has ended too.
    if (issuedSetupLockTokens.has(holder.token)) return false;
    // Never issued here: a reused pid, so (a) does not hold; (b)/(c) decide.
  } else if (deps.processAlive(holder.pid)) {
    return true;
  }
  if (holder.runnerPid !== undefined && deps.processAlive(holder.runnerPid)) return true;
  if (holder.groupPid !== undefined && deps.processAlive(-holder.groupPid)) return true;
  const acquired = Date.parse(holder.acquiredAt);
  if (!Number.isFinite(acquired)) return true;
  const bound = (holder.timeoutMs ?? MAX_SETUP_TIMEOUT_SECONDS * 1000) + SETUP_RUNNER_MARGIN_MS;
  return deps.now() < acquired + bound;
}

export type SetupLockAcquisition =
  | { ok: true; token: string }
  | { ok: false; kind: "unsafe" | "failed" | "busy"; detail: string };

function readLock(root: string, rel: string): { status: "ok"; record: SetupLockRecord | null } | { status: "missing" } | { status: "unsafe" } {
  const read = readContainedCapabilityFile(root, rel, SETUP_LOCK_MAX_BYTES);
  if (read.status === "ok") return { status: "ok", record: parseSetupLock(read.content) };
  if (read.status === "missing") return { status: "missing" };
  if (read.status === "unsafe") return { status: "unsafe" };
  // Oversized or otherwise unreadable: present, but not a record we can judge.
  return { status: "ok", record: null };
}

/**
 * Move a lock whose holder is gone out of the way. Returns `retry` when the
 * caller should attempt the create again (reclaimed, or the lock vanished),
 * `held` when a live — or unjudgeable — holder keeps it, `unsafe`, or
 * `restore-failed` (with the path the captured lock was kept at) when a live
 * holder's lock was moved aside and could not be put back.
 */
function reclaimIfAbandoned(
  root: string,
  deps: SetupLockDeps,
): "retry" | "held" | "unsafe" | { restoreFailed: string } {
  const current = readLock(root, SETUP_LOCK_RELPATH);
  if (current.status === "missing") return "retry";
  if (current.status === "unsafe") return "unsafe";
  const holder = current.record;
  // An unreadable record, a holder on another host, or a live holder is never
  // taken over: waiting is the safe side.
  if (holder === null || holder.host !== deps.host || setupLockLive(holder, deps)) return "held";

  // Abandoned: stop whatever the recorded command group left behind before the
  // next run starts beside it.
  if (holder.groupPid !== undefined) deps.killGroup?.(holder.groupPid);

  // Rename the stale lock aside first — an atomic step only one reclaimer can
  // win — then confirm what was moved is the record judged abandoned. If a
  // live holder's fresh lock was captured instead, put it back; if that
  // fails, keep the captured copy and never run beside its holder.
  const aside = `${SETUP_LOCK_RELPATH}.stale-${randomBytes(6).toString("hex")}`;
  const moved = renameContainedStateFile(root, SETUP_LOCK_RELPATH, aside);
  if (!moved.ok) return moved.kind === "unsafe" ? "unsafe" : "held";
  if (!moved.moved) return "retry";
  const captured = readLock(root, aside);
  if (captured.status === "ok" && captured.record?.token !== holder.token) {
    const linkBack = deps.linkBack ?? linkContainedStateFileExclusive;
    if (!linkBack(root, aside, SETUP_LOCK_RELPATH)) return { restoreFailed: aside };
  }
  removeContainedStateFile(root, aside);
  return "retry";
}

/**
 * Take the setup lock for `root`, waiting up to `waitMs` for a live holder.
 * `busy` names the lock when the wait runs out; the command is then not run.
 * `timeoutMs` is the command timeout the holder will run under; it is recorded
 * so another caller can judge liveness (c) against it.
 */
export function acquireSetupLock(
  root: string,
  waitMs: number,
  deps: SetupLockDeps = defaultSetupLockDeps,
  timeoutMs: number = MAX_SETUP_TIMEOUT_SECONDS * 1000,
): SetupLockAcquisition {
  const token = randomBytes(16).toString("hex");
  const content = renderSetupLock({
    pid: deps.pid,
    host: deps.host,
    token,
    acquiredAt: new Date(deps.now()).toISOString(),
    timeoutMs,
  });
  const deadline = deps.now() + waitMs;
  for (;;) {
    const created = createContainedStateFileExclusive(root, SETUP_LOCK_RELPATH, content);
    if (created.ok) {
      issuedSetupLockTokens.add(token);
      heldSetupLockTokens.add(token);
      return { ok: true, token };
    }
    if (created.kind !== "exists") return { ok: false, kind: created.kind, detail: created.detail };
    const reclaim = reclaimIfAbandoned(root, deps);
    if (reclaim === "unsafe") {
      return {
        ok: false,
        kind: "unsafe",
        detail: `\`${SETUP_LOCK_RELPATH}\` is not a contained regular file; resolver setup state follows no link.`,
      };
    }
    if (typeof reclaim === "object") {
      return {
        ok: false,
        kind: "failed",
        detail: `a live holder's \`${SETUP_LOCK_RELPATH}\` was moved aside during a reclaim and could not be restored; it is kept at \`${reclaim.restoreFailed}\` and the command was not run.`,
      };
    }
    if (reclaim === "retry") continue;
    if (deps.now() >= deadline) {
      return {
        ok: false,
        kind: "busy",
        detail: `another setup run still holds \`${SETUP_LOCK_RELPATH}\` after ${Math.round(waitMs / 1000)} seconds; the command was not run.`,
      };
    }
    deps.sleepMs(SETUP_LOCK_POLL_MS);
  }
}

/** Release the lock only while it still carries this run's token. A removal
 *  that fails is reported, so the caller can surface it in `diagnostics`. */
export function releaseSetupLock(root: string, token: string): { ok: true } | { ok: false; detail: string } {
  heldSetupLockTokens.delete(token);
  const current = readLock(root, SETUP_LOCK_RELPATH);
  if (current.status === "ok" && current.record?.token === token) {
    const removed = removeContainedStateFile(root, SETUP_LOCK_RELPATH);
    if (!removed.ok) {
      return { ok: false, detail: `the setup lock was not released: ${removed.detail}` };
    }
  }
  return { ok: true };
}

/** Keep only the tail, so a noisy command never floods the caller. */
export function tailOf(output: string): string {
  return output.length <= SETUP_OUTPUT_TAIL_CHARS
    ? output
    : output.slice(output.length - SETUP_OUTPUT_TAIL_CHARS);
}
