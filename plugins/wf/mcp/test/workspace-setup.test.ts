// WF-831 — the project-declared dependency-setup step, and the fleet template
// that runs preparation then setup before the ceremony.

import { test } from "node:test";
import assert from "node:assert/strict";
import * as nodeFs from "node:fs";
import * as nodePath from "node:path";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { hostname, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { normalizeSlashes } from "../src/resolver/paths.js";
import { createDefaultPorts } from "../src/ports.js";
import { parseCoreConfig, splitTableRow } from "../src/resolver/config.js";
import {
  acquireSetupLock,
  DEFAULT_SETUP_TIMEOUT_SECONDS,
  MAX_SETUP_TIMEOUT_SECONDS,
  parseSetupLock,
  parseSetupTimeout,
  releaseSetupLock,
  renderSetupLock,
  SETUP_RUNNER_MARGIN_MS,
  renderSetupState,
  SETUP_LOCK_RELPATH,
  SETUP_RUNNER_SOURCE,
  setupCommandDigest,
  writeBackSetupRunnerPids,
  type SetupLockDeps,
  type WorkspaceSetupResponse,
} from "../src/resolver/workspace-setup.js";
import { ResolverService } from "../src/service.js";

// WF-871 — child mode: this same bundled file, re-run as a separate process,
// performs ONE setup call for the root it is handed and prints the response.
// That is what makes the concurrency test a real cross-process race.
const CHILD_ROOT = process.env.WF_SETUP_CHILD_ROOT;
if (CHILD_ROOT) {
  const response = new ResolverService({
    ...createDefaultPorts(CHILD_ROOT),
    listPlugins: () => ({ plugins: [], ok: true, contractOk: true, issues: [] }),
  }).runWorkspaceSetup();
  // Synchronous write then exit, before any `test(...)` below is registered.
  writeSync(1, JSON.stringify(response));
  process.exit(0);
}

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function config(rows: Record<string, string>): string {
  const extra = Object.entries(rows)
    .map(([key, value]) => `| **${key}** | ${value} |`)
    .join("\n");
  return `# Config\n\n| Key | Value |\n|-----|-------|\n| **Task Root** | \`_local\` |\n${extra}\n`;
}

function workspace(configText: string | null): { root: string; service: () => ResolverService; cleanup: () => void } {
  const root = normalizeSlashes(realpathSync(mkdtempSync(join(tmpdir(), "wf-setup-"))));
  if (configText !== null) write(`${root}/_local/config.md`, configText);
  return {
    root,
    service: () =>
      new ResolverService({
        ...createDefaultPorts(root),
        listPlugins: () => ({ plugins: [], ok: true, contractOk: true, issues: [] }),
      }),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

test("the keys are empty by default and parse from the project config only", () => {
  const empty = parseCoreConfig(config({}));
  assert.equal(empty.dependencySetupCommand, null);
  assert.equal(empty.dependencySetupTimeout, null);
  const placeholder = parseCoreConfig(config({ "Dependency Setup Command": "`<none>`" }));
  assert.equal(placeholder.dependencySetupCommand, null);
  const declared = parseCoreConfig(config({ "Dependency Setup Command": "`exit 0`", "Dependency Setup Timeout": "`30`" }));
  assert.equal(declared.dependencySetupCommand, "exit 0");
  assert.equal(declared.dependencySetupTimeout, "30");
});

test("the timeout defaults, falls back on garbage, and is held to the ceiling", () => {
  assert.equal(parseSetupTimeout(null).seconds, DEFAULT_SETUP_TIMEOUT_SECONDS);
  assert.equal(parseSetupTimeout("abc").seconds, DEFAULT_SETUP_TIMEOUT_SECONDS);
  assert.ok(parseSetupTimeout("abc").diagnostic);
  assert.equal(parseSetupTimeout("0").seconds, DEFAULT_SETUP_TIMEOUT_SECONDS);
  assert.equal(parseSetupTimeout("45").seconds, 45);
  assert.equal(parseSetupTimeout("999999").seconds, MAX_SETUP_TIMEOUT_SECONDS);
});

test("unprepared: no resolved project config blocks with a named reason", () => {
  const ws = workspace(null);
  try {
    const result = ws.service().runWorkspaceSetup();
    assert.equal(result.status, "blocked");
    assert.equal(result.reason, "unprepared");
  } finally {
    ws.cleanup();
  }
});

test("not-declared: an empty key runs nothing (inert by default)", () => {
  const ws = workspace(config({}));
  try {
    const result = ws.service().runWorkspaceSetup();
    assert.equal(result.status, "not-declared");
    assert.equal(result.command, null);
    assert.equal(result.reason, null);
  } finally {
    ws.cleanup();
  }
});

test("succeeded, then already-done: the declared command runs once and is echoed", () => {
  const ws = workspace(config({ "Dependency Setup Command": "`echo ran > setup-marker.txt`" }));
  try {
    const first = ws.service().runWorkspaceSetup();
    assert.equal(first.status, "succeeded", JSON.stringify(first));
    assert.equal(first.command, "echo ran > setup-marker.txt");
    assert.equal(first.exitCode, 0);
    assert.equal(readFileSync(`${ws.root}/setup-marker.txt`, "utf8").trim(), "ran");

    rmSync(`${ws.root}/setup-marker.txt`);
    const second = ws.service().runWorkspaceSetup();
    assert.equal(second.status, "already-done");
    assert.equal(second.command, "echo ran > setup-marker.txt");
    assert.equal(existsSync(`${ws.root}/setup-marker.txt`), false, "an already-done command is not re-run");
  } finally {
    ws.cleanup();
  }
});

test("failed: a non-zero exit blocks, names the status, and records no success", () => {
  const ws = workspace(config({ "Dependency Setup Command": "`exit 3`" }));
  try {
    const result = ws.service().runWorkspaceSetup();
    assert.equal(result.status, "blocked");
    assert.equal(result.reason, "failed");
    assert.equal(result.exitCode, 3);
    assert.match(result.detail, /exited with status 3/);
    assert.equal(ws.service().runWorkspaceSetup().status, "blocked", "a failure is retried, never marked done");
  } finally {
    ws.cleanup();
  }
});

test("timed-out: a command exceeding its timeout blocks with a named reason", () => {
  const ws = workspace(config({ "Dependency Setup Command": "`sleep 5`", "Dependency Setup Timeout": "`1`" }));
  try {
    const result = ws.service().runWorkspaceSetup();
    assert.equal(result.status, "blocked");
    assert.equal(result.reason, "timed-out");
    assert.equal(result.timeoutSeconds, 1);
    assert.equal(result.command, "sleep 5");
  } finally {
    ws.cleanup();
  }
});

// WF-872 — the success marker is never trusted or written through a link.

const MARKED = "echo ran > setup-marker.txt";

function validMarker(): string {
  return renderSetupState(setupCommandDigest(MARKED), "2026-01-01T00:00:00.000Z");
}

test("unsafe-path: an external marker carrying the current digest never yields already-done", () => {
  const ws = workspace(config({ "Dependency Setup Command": `\`${MARKED}\`` }));
  const outside = normalizeSlashes(realpathSync(mkdtempSync(join(tmpdir(), "wf-setup-out-"))));
  try {
    write(`${outside}/marker.json`, validMarker());
    mkdirSync(`${ws.root}/_local/resolver`, { recursive: true });
    symlinkSync(`${outside}/marker.json`, `${ws.root}/_local/resolver/setup-state.json`);
    const result = ws.service().runWorkspaceSetup();
    assert.equal(result.status, "blocked", JSON.stringify(result));
    assert.equal(result.reason, "unsafe-path");
    assert.equal(result.command, MARKED, "the declared command is still echoed");
    assert.equal(existsSync(`${ws.root}/setup-marker.txt`), false, "the command is not run");
    assert.equal(readFileSync(`${outside}/marker.json`, "utf8"), validMarker(), "the external file is untouched");
  } finally {
    ws.cleanup();
    rmSync(outside, { recursive: true, force: true });
  }
});

test("unsafe-path: a dangling marker symlink blocks and creates nothing outside", () => {
  const ws = workspace(config({ "Dependency Setup Command": `\`${MARKED}\`` }));
  const outside = normalizeSlashes(realpathSync(mkdtempSync(join(tmpdir(), "wf-setup-out-"))));
  try {
    mkdirSync(`${ws.root}/_local/resolver`, { recursive: true });
    symlinkSync(`${outside}/never.json`, `${ws.root}/_local/resolver/setup-state.json`);
    const result = ws.service().runWorkspaceSetup();
    assert.equal(result.status, "blocked");
    assert.equal(result.reason, "unsafe-path");
    assert.equal(existsSync(`${outside}/never.json`), false);
    assert.equal(existsSync(`${ws.root}/setup-marker.txt`), false);
  } finally {
    ws.cleanup();
    rmSync(outside, { recursive: true, force: true });
  }
});

test("unsafe-path: a symlinked `_local/resolver` ancestor is neither read nor written through", () => {
  const ws = workspace(config({ "Dependency Setup Command": `\`${MARKED}\`` }));
  const outside = normalizeSlashes(realpathSync(mkdtempSync(join(tmpdir(), "wf-setup-out-"))));
  try {
    write(`${outside}/setup-state.json`, validMarker());
    symlinkSync(outside, `${ws.root}/_local/resolver`);
    const result = ws.service().runWorkspaceSetup();
    assert.equal(result.status, "blocked");
    assert.equal(result.reason, "unsafe-path");
    assert.match(result.detail, /_local\/resolver/);
    assert.equal(existsSync(`${ws.root}/setup-marker.txt`), false);
    assert.equal(readFileSync(`${outside}/setup-state.json`, "utf8"), validMarker());
  } finally {
    ws.cleanup();
    rmSync(outside, { recursive: true, force: true });
  }
});

test("contained marker: the ordinary path records success as a regular file inside the workspace", () => {
  const ws = workspace(config({ "Dependency Setup Command": `\`${MARKED}\`` }));
  try {
    assert.equal(ws.service().runWorkspaceSetup().status, "succeeded");
    const marker = `${ws.root}/_local/resolver/setup-state.json`;
    assert.ok(lstatSync(marker).isFile() && !lstatSync(marker).isSymbolicLink());
    assert.equal(JSON.parse(readFileSync(marker, "utf8")).commandDigest, setupCommandDigest(MARKED));
    assert.equal(ws.service().runWorkspaceSetup().status, "already-done");
  } finally {
    ws.cleanup();
  }
});

test("a capability-declared setup command is ignored; only the project key is honoured", () => {
  const ws = workspace(config({}));
  try {
    const evil = "echo capability > capability-ran.txt";
    write(`${ws.root}/_local/profiles/demo.profile.json`, `${JSON.stringify({ dependencySetupCommand: evil, "Dependency Setup Command": evil })}\n`);
    write(`${ws.root}/caps/demo/manifest.md`, `# demo\n\n| Key | Value |\n|-----|-------|\n| **Dependency Setup Command** | \`${evil}\` |\n`);
    const result = ws.service().runWorkspaceSetup();
    assert.equal(result.status, "not-declared");
    assert.equal(existsSync(`${ws.root}/capability-ran.txt`), false);
  } finally {
    ws.cleanup();
  }
});

test("fleet template: preparation then setup run before the ceremony, and the scoreboard echoes the command", () => {
  const mcpDir = process.env.WF_MCP_DIR;
  assert.ok(mcpDir, "WF_MCP_DIR is set by the test runner");
  const skill = readFileSync(join(mcpDir, "..", "skills", "fleet", "SKILL.md"), "utf8");

  const start = skill.indexOf("## The shipper dispatch template");
  const end = skill.indexOf("\n## ", start + 1);
  assert.ok(start >= 0 && end > start, "the dispatch template section exists");
  const template = skill.slice(start, end);

  const prepare = template.indexOf("prepare_workspace");
  const setup = template.indexOf("run_workspace_setup");
  const ceremony = template.indexOf("EXECUTE — THE CEREMONY IS MANDATORY");
  assert.ok(prepare >= 0, "the template calls prepare_workspace");
  assert.ok(setup > prepare, "setup runs after preparation");
  assert.ok(ceremony > setup, "both run before the ceremony line");
  assert.match(template, /<SOURCE-ROOT>/, "the orchestrator fills the source root");
  assert.match(template, /SHIP — Blocked/, "a blocker stops the item before the ceremony");

  const step0 = skill.slice(skill.indexOf("## Step 0"), skill.indexOf("## The tick loop"));
  assert.match(step0, /\*\*Setup command:\*\*/, "the scoreboard header echoes the setup command");
});

// ---------------------------------------------------------------------------
// WF-871 — exact values, serialized runs, and a fully stopped process tree.
// ---------------------------------------------------------------------------

function pause(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function lockPath(root: string): string {
  return `${root}/${SETUP_LOCK_RELPATH}`;
}

function markerPath(root: string): string {
  return `${root}/_local/resolver/setup-state.json`;
}

/** Run one setup call in a separate resolver process for `root`. */
function runInChild(root: string): Promise<WorkspaceSetupResponse> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url)], {
      env: { ...process.env, WF_SETUP_CHILD_ROOT: root },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => (out += chunk.toString("utf8")));
    child.stderr.on("data", (chunk) => (err += chunk.toString("utf8")));
    child.on("error", reject);
    child.on("close", () => {
      try {
        resolvePromise(JSON.parse(out) as WorkspaceSetupResponse);
      } catch {
        reject(new Error(`child produced no response: ${out}${err}`));
      }
    });
  });
}

test("config cells: a pipe inside a code span or written as \\| stays in the value", () => {
  assert.deepEqual(splitTableRow("| **K** | `a | b` | note |"), ["**K**", "`a | b`", "note"]);
  assert.deepEqual(splitTableRow("| **K** | a \\| b |"), ["**K**", "a | b"]);
  assert.deepEqual(splitTableRow("| **K** | ``x ` | y`` |"), ["**K**", "``x ` | y``"]);
  assert.deepEqual(splitTableRow("| **K** | `unclosed | rest |"), ["**K**", "`unclosed", "rest"]);

  const backticked = parseCoreConfig(config({ "Dependency Setup Command": "`npm ci | tee install.log`" }));
  assert.equal(backticked.dependencySetupCommand, "npm ci | tee install.log");
  const escaped = parseCoreConfig(config({ "Dependency Setup Command": "npm ci \\| tee install.log" }));
  assert.equal(escaped.dependencySetupCommand, "npm ci | tee install.log");
  const verbatim = parseCoreConfig(config({ "Dependency Setup Command": "`grep -E 'a\\|b' x || true`" }));
  assert.equal(verbatim.dependencySetupCommand, "grep -E 'a\\|b' x || true", "a code span is taken verbatim");
});

test("config cells: a wrapping code span is unwrapped only when its first exact-N closer ends the value", () => {
  const cmd = (value: string) => parseCoreConfig(config({ "Dependency Setup Command": value })).dependencySetupCommand;
  assert.equal(cmd("``a`b``"), "a`b");
  assert.equal(cmd("`` `x` ``"), "`x`");
  assert.equal(cmd("`a` && `b`"), "`a` && `b`", "two spans are not one wrapping span");
  assert.equal(cmd("``a`"), "``a`", "an unclosed run is literal");
  assert.equal(cmd("```a``"), "```a``", "a shorter closing run does not close");
});

test("config cells: existing rows keep their meaning, a third column included", () => {
  const cfg = parseCoreConfig(
    "| Key | Value | Note |\n|---|---|---|\n| **Task Root** | `_local` | where tasks live |\n| **Verify Command** | `(cd x && npm run build)` | build |\n| **Context Ceiling** | `<none>` | |\n",
  );
  assert.equal(cfg.taskRoot, "_local");
  assert.equal(cfg.verifyCommand, "(cd x && npm run build)");
  assert.equal(cfg.contextCeiling, null);
});

test("a declared pipeline runs complete and is echoed verbatim", () => {
  const ws = workspace(config({ "Dependency Setup Command": "`echo piped | tr a-z A-Z > piped.txt`" }));
  try {
    const result = ws.service().runWorkspaceSetup();
    assert.equal(result.status, "succeeded", JSON.stringify(result));
    assert.equal(result.command, "echo piped | tr a-z A-Z > piped.txt");
    assert.equal(readFileSync(`${ws.root}/piped.txt`, "utf8").trim(), "PIPED");
  } finally {
    ws.cleanup();
  }
});

test("timeout stops the whole process tree: a descendant never writes afterwards", () => {
  const ws = workspace(
    config({ "Dependency Setup Command": "`(sleep 2; echo late > late.txt) & sleep 30`", "Dependency Setup Timeout": "`1`" }),
  );
  try {
    const started = Date.now();
    const result = ws.service().runWorkspaceSetup();
    assert.equal(result.status, "blocked", JSON.stringify(result));
    assert.equal(result.reason, "timed-out");
    assert.ok(Date.now() - started < 10_000, "the call returns at the timeout, not when the tree would finish");
    pause(3_000);
    assert.equal(existsSync(`${ws.root}/late.txt`), false, "the backgrounded descendant was stopped with its group");
    assert.equal(existsSync(lockPath(ws.root)), false, "the lock is released on timeout");
    assert.equal(existsSync(markerPath(ws.root)), false, "a timeout records no success");
  } finally {
    ws.cleanup();
  }
});

test("a straggler left running when the command exits is stopped before success is reported", () => {
  const ws = workspace(config({ "Dependency Setup Command": "`(sleep 2; echo late > straggler.txt) & echo started`" }));
  try {
    const result = ws.service().runWorkspaceSetup();
    assert.equal(result.status, "succeeded", JSON.stringify(result));
    assert.match(result.outputTail, /started/);
    pause(3_000);
    assert.equal(existsSync(`${ws.root}/straggler.txt`), false);
  } finally {
    ws.cleanup();
  }
});

test("failure releases the lock and records nothing; a retry runs again, then already-done", () => {
  const ws = workspace(config({ "Dependency Setup Command": "`test -f ok.txt || { touch ok.txt; exit 3; }`" }));
  try {
    const failed = ws.service().runWorkspaceSetup();
    assert.equal(failed.status, "blocked");
    assert.equal(failed.reason, "failed");
    assert.equal(existsSync(lockPath(ws.root)), false, "failure releases the lock");
    assert.equal(existsSync(markerPath(ws.root)), false, "failure creates no success marker");

    const retried = ws.service().runWorkspaceSetup();
    assert.equal(retried.status, "succeeded", JSON.stringify(retried));
    assert.equal(existsSync(lockPath(ws.root)), false);
    assert.equal(ws.service().runWorkspaceSetup().status, "already-done");
  } finally {
    ws.cleanup();
  }
});

test("concurrent resolver processes run the command exactly once", async () => {
  const ws = workspace(config({ "Dependency Setup Command": "`echo run >> runs.txt; sleep 1`" }));
  try {
    const results = await Promise.all([runInChild(ws.root), runInChild(ws.root)]);
    const statuses = results.map((r) => r.status).sort();
    assert.deepEqual(statuses, ["already-done", "succeeded"], JSON.stringify(results));
    const runs = readFileSync(`${ws.root}/runs.txt`, "utf8").trim().split("\n");
    assert.equal(runs.length, 1, "the command ran once");
    assert.equal(existsSync(lockPath(ws.root)), false, "the lock is released");
  } finally {
    ws.cleanup();
  }
});

test("a lock whose holder process is gone is reclaimed", () => {
  const ws = workspace(config({ "Dependency Setup Command": `\`${MARKED}\`` }));
  try {
    const gone = spawnSync(process.execPath, ["-e", ""]).pid;
    assert.ok(typeof gone === "number");
    write(lockPath(ws.root), renderSetupLock({ pid: gone, host: hostname(), token: "stale", acquiredAt: "2026-01-01T00:00:00.000Z" }));
    const result = ws.service().runWorkspaceSetup();
    assert.equal(result.status, "succeeded", JSON.stringify(result));
    assert.equal(existsSync(lockPath(ws.root)), false);
  } finally {
    ws.cleanup();
  }
});

test("a live holder past the wait bound is busy, and its lock is left alone", () => {
  const ws = workspace(config({}));
  try {
    const held = renderSetupLock({ pid: process.pid, host: hostname(), token: "live", acquiredAt: "2026-01-01T00:00:00.000Z" });
    write(lockPath(ws.root), held);
    let clock = 0;
    const deps: SetupLockDeps = {
      pid: process.pid + 1,
      host: hostname(),
      now: () => clock,
      sleepMs: (ms) => {
        clock += ms;
      },
      processAlive: () => true,
    };
    const result = acquireSetupLock(ws.root, 1_000, deps);
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.kind, "busy");
    assert.match(!result.ok ? result.detail : "", /setup\.lock/);
    assert.equal(readFileSync(lockPath(ws.root), "utf8"), held, "a live holder's lock is never taken over");
  } finally {
    ws.cleanup();
  }
});

// WF-871 lock liveness: held while (a) the holder resolver, (b) the recorded
// runner or command group is alive, or (c) acquiredAt + timeout + margin has
// not yet passed.
const DEAD_RESOLVER = 999_001;
const RUNNER = 999_002;
const GROUP = 999_003;

function lockDeps(alive: (pid: number) => boolean, start = 0): SetupLockDeps & { clock: () => number; killed: number[] } {
  let clock = start;
  const killed: number[] = [];
  return {
    pid: process.pid,
    host: hostname(),
    now: () => clock,
    sleepMs: (ms) => {
      clock += ms;
    },
    processAlive: alive,
    killGroup: (g) => {
      killed.push(g);
    },
    clock: () => clock,
    killed,
  };
}

test("lock liveness (b): a live recorded runner keeps the lock after its resolver died", () => {
  const ws = workspace(config({}));
  try {
    const held = renderSetupLock({
      pid: DEAD_RESOLVER,
      host: hostname(),
      token: "runner-live",
      acquiredAt: "2026-01-01T00:00:00.000Z",
      timeoutMs: 1_000,
      runnerPid: RUNNER,
    });
    write(lockPath(ws.root), held);
    const result = acquireSetupLock(ws.root, 1_000, lockDeps((pid) => pid === RUNNER, Date.parse("2026-06-01T00:00:00Z")));
    assert.equal(!result.ok && result.kind, "busy");
    assert.equal(readFileSync(lockPath(ws.root), "utf8"), held);

    const group = renderSetupLock({ ...parseSetupLock(held)!, runnerPid: undefined, groupPid: GROUP });
    write(lockPath(ws.root), group);
    const byGroup = acquireSetupLock(ws.root, 1_000, lockDeps((pid) => pid === -GROUP, Date.parse("2026-06-01T00:00:00Z")));
    assert.equal(!byGroup.ok && byGroup.kind, "busy", "a live command group keeps the lock too");
  } finally {
    ws.cleanup();
  }
});

test("lock liveness (c): a dead holder's lock is kept until acquiredAt + timeout + margin, then reclaimed", () => {
  const ws = workspace(config({}));
  try {
    const acquiredAt = Date.parse("2026-06-01T00:00:00Z");
    write(
      lockPath(ws.root),
      renderSetupLock({
        pid: DEAD_RESOLVER,
        host: hostname(),
        token: "window",
        acquiredAt: new Date(acquiredAt).toISOString(),
        timeoutMs: 5_000,
        runnerPid: RUNNER,
        groupPid: GROUP,
      }),
    );
    const early = acquireSetupLock(ws.root, 1_000, lockDeps(() => false, acquiredAt));
    assert.equal(!early.ok && early.kind, "busy", "inside the window the lock is still held");

    const deps = lockDeps(() => false, acquiredAt + 1_000);
    const late = acquireSetupLock(ws.root, 5_000 + SETUP_RUNNER_MARGIN_MS, deps);
    assert.equal(late.ok, true, JSON.stringify(late));
    assert.ok(deps.clock() >= acquiredAt + 5_000 + SETUP_RUNNER_MARGIN_MS, "reclaimed only after the window closed");
    assert.deepEqual(deps.killed, [GROUP], "the recorded command group is stopped before the reclaim");
    if (late.ok) releaseSetupLock(ws.root, late.token);
  } finally {
    ws.cleanup();
  }
});

test("lock liveness: this process's own pid with a token it is not using is abandoned", () => {
  const ws = workspace(config({}));
  try {
    const now = Date.parse("2026-06-01T00:00:00Z");
    // A token this process issued and has released: abandoned at once, even
    // inside the time window.
    const first = acquireSetupLock(ws.root, 1_000, lockDeps(() => false, now));
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.equal(releaseSetupLock(ws.root, first.token).ok, true);
    write(
      lockPath(ws.root),
      renderSetupLock({ pid: process.pid, host: hostname(), token: first.token, acquiredAt: new Date(now).toISOString(), timeoutMs: 60_000 }),
    );
    const again = acquireSetupLock(ws.root, 1_000, lockDeps(() => false, now));
    assert.equal(again.ok, true, JSON.stringify(again));
    if (again.ok) releaseSetupLock(ws.root, again.token);

    // A token this process never issued (a reused pid) is not a live holder
    // under (a); with no runner and the window passed it is reclaimed.
    write(
      lockPath(ws.root),
      renderSetupLock({ pid: process.pid, host: hostname(), token: "reused-pid", acquiredAt: "2026-01-01T00:00:00.000Z", timeoutMs: 1_000 }),
    );
    const reused = acquireSetupLock(ws.root, 1_000, lockDeps(() => false, now));
    assert.equal(reused.ok, true, JSON.stringify(reused));
    if (reused.ok) releaseSetupLock(ws.root, reused.token);
  } finally {
    ws.cleanup();
  }
});

// WF-926 — a reclaim that captures a live holder's lock and cannot link it
// back never leaves the lock path empty: a second acquire must still wait.
function staleLockReplacedByLiveHolder(root: string): { fresh: string; deps: ReturnType<typeof lockDeps> } {
  write(
    lockPath(root),
    renderSetupLock({ pid: DEAD_RESOLVER, host: hostname(), token: "stale", acquiredAt: "2026-01-01T00:00:00.000Z", groupPid: GROUP }),
  );
  const fresh = renderSetupLock({ pid: DEAD_RESOLVER + 10, host: hostname(), token: "fresh", acquiredAt: "2026-06-01T00:00:00.000Z" });
  const deps = lockDeps(() => false, Date.parse("2026-06-01T00:00:00Z"));
  // Between the judgement and the rename, a new holder replaces the lock.
  deps.killGroup = () => write(lockPath(root), fresh);
  return { fresh, deps };
}

function staleCopies(root: string): string[] {
  return readdirSync(join(root, "_local", "resolver")).filter((name) => name.startsWith("setup.lock.stale-"));
}

test("reclaim: a captured live lock whose link-back fails re-blocks the lock path and a second acquire cannot succeed", () => {
  const ws = workspace(config({}));
  try {
    const { fresh, deps } = staleLockReplacedByLiveHolder(ws.root);
    deps.linkBack = () => false;
    const first = acquireSetupLock(ws.root, 1_000, deps);
    assert.equal(first.ok, false, JSON.stringify(first));
    assert.equal(!first.ok && first.kind, "busy", "the re-blocked lock is waited on like any live holder");
    assert.equal(readFileSync(lockPath(ws.root), "utf8"), fresh, "the lock path carries the live holder's own record");
    assert.deepEqual(staleCopies(ws.root), [], "the captured copy is removed only once the lock path is blocked again");

    const second = acquireSetupLock(ws.root, 1_000, lockDeps(() => false, Date.parse("2026-06-01T00:00:00Z")));
    assert.equal(second.ok, false, "a second acquire cannot take the lock beside the live holder");
    assert.equal(!second.ok && second.kind, "busy");
    assert.equal(readFileSync(lockPath(ws.root), "utf8"), fresh);
  } finally {
    ws.cleanup();
  }
});

test("reclaim: a captured live lock is kept aside when another record already holds the lock path", () => {
  const ws = workspace(config({}));
  try {
    const { fresh, deps } = staleLockReplacedByLiveHolder(ws.root);
    const other = renderSetupLock({ pid: DEAD_RESOLVER + 20, host: hostname(), token: "other", acquiredAt: "2026-06-01T00:00:00.000Z" });
    // The link-back loses to a caller that took the free lock path first.
    deps.linkBack = (root) => {
      write(lockPath(root), other);
      return false;
    };
    const result = acquireSetupLock(ws.root, 1_000, deps);
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.kind, "failed");
    assert.match(!result.ok ? result.detail : "", /another record now holds the lock path/);
    const aside = !result.ok ? /`(_local\/resolver\/setup\.lock\.stale-[0-9a-f]+)`/.exec(result.detail)?.[1] : undefined;
    assert.ok(aside, !result.ok ? result.detail : "");
    assert.equal(readFileSync(`${ws.root}/${aside}`, "utf8"), fresh, "the captured live lock is never deleted");
    assert.equal(readFileSync(lockPath(ws.root), "utf8"), other, "the record holding the lock path is left alone");
  } finally {
    ws.cleanup();
  }
});

// WF-997 — a displaced live holder kept aside keeps blocking acquisition after
// the record that occupied the lock path is released.
test("reclaim: a displaced live holder still blocks acquisition after the occupier releases", () => {
  const ws = workspace(config({}));
  try {
    const { fresh, deps } = staleLockReplacedByLiveHolder(ws.root);
    const other = renderSetupLock({ pid: DEAD_RESOLVER + 20, host: hostname(), token: "other", acquiredAt: "2026-06-01T00:00:00.000Z" });
    deps.linkBack = (root) => {
      write(lockPath(root), other);
      return false;
    };
    const first = acquireSetupLock(ws.root, 1_000, deps);
    assert.equal(!first.ok && first.kind, "failed", JSON.stringify(first));
    assert.equal(staleCopies(ws.root).length, 1);

    // The occupier finishes and releases: the lock path is free again.
    assert.equal(releaseSetupLock(ws.root, "other").ok, true);
    assert.equal(existsSync(lockPath(ws.root)), false);

    const next = acquireSetupLock(ws.root, 1_000, lockDeps(() => false, Date.parse("2026-06-01T00:00:00Z")));
    assert.equal(next.ok, false, "no acquire succeeds beside the displaced live holder");
    assert.equal(!next.ok && next.kind, "busy");
    assert.match(!next.ok ? next.detail : "", /setup\.lock\.stale-[0-9a-f]+/);
    assert.equal(existsSync(lockPath(ws.root)), false, "the waiting caller gave the lock path back");
    assert.equal(readFileSync(join(ws.root, "_local", "resolver", staleCopies(ws.root)[0]), "utf8"), fresh);

    // Once the displaced holder is no longer live, its record stops blocking.
    const later = lockDeps(() => false, Date.parse("2027-06-01T00:00:00Z"));
    const after = acquireSetupLock(ws.root, 1_000, later);
    assert.equal(after.ok, true, JSON.stringify(after));
    assert.deepEqual(staleCopies(ws.root), [], "the abandoned displaced record is removed");
    if (after.ok) releaseSetupLock(ws.root, after.token);
  } finally {
    ws.cleanup();
  }
});

test("reclaim: a displaced holder's own release ends its claim", () => {
  const ws = workspace(config({}));
  try {
    const now = Date.parse("2026-06-01T00:00:00Z");
    const aside = join(ws.root, "_local", "resolver", "setup.lock.stale-0123456789ab");
    write(aside, renderSetupLock({ pid: DEAD_RESOLVER + 10, host: hostname(), token: "displaced", acquiredAt: new Date(now).toISOString() }));
    const blocked = acquireSetupLock(ws.root, 1_000, lockDeps(() => false, now));
    assert.equal(!blocked.ok && blocked.kind, "busy", JSON.stringify(blocked));

    assert.equal(releaseSetupLock(ws.root, "displaced").ok, true);
    assert.equal(existsSync(aside), false, "the release removed the displaced record");
    const taken = acquireSetupLock(ws.root, 1_000, lockDeps(() => false, now));
    assert.equal(taken.ok, true, JSON.stringify(taken));
    if (taken.ok) releaseSetupLock(ws.root, taken.token);
  } finally {
    ws.cleanup();
  }
});

test("reclaim: a displaced record that cannot be judged blocks acquisition", () => {
  const ws = workspace(config({}));
  try {
    const now = Date.parse("2027-06-01T00:00:00Z");
    const dir = join(ws.root, "_local", "resolver");
    for (const [name, body] of [
      ["setup.lock.stale-aaaaaaaaaaaa", "not a lock record"],
      ["setup.lock.stale-bbbbbbbbbbbb", renderSetupLock({ pid: DEAD_RESOLVER, host: "another-host", token: "remote", acquiredAt: "2026-01-01T00:00:00.000Z" })],
    ]) {
      write(join(dir, name), body);
      const result = acquireSetupLock(ws.root, 1_000, lockDeps(() => false, now));
      assert.equal(!result.ok && result.kind, "busy", `${name}: ${JSON.stringify(result)}`);
      assert.equal(existsSync(join(dir, name)), true, "an unjudgeable record is never removed");
      assert.equal(existsSync(lockPath(ws.root)), false);
      rmSync(join(dir, name));
    }
  } finally {
    ws.cleanup();
  }
});

test("reclaim: a symlinked displaced record is unsafe and neither followed nor removed", { skip: process.platform === "win32" }, () => {
  const ws = workspace(config({}));
  try {
    const target = join(ws.root, "outside.json");
    write(target, renderSetupLock({ pid: DEAD_RESOLVER, host: hostname(), token: "t", acquiredAt: "2026-01-01T00:00:00.000Z" }));
    const link = join(ws.root, "_local", "resolver", "setup.lock.stale-cccccccccccc");
    mkdirSync(dirname(link), { recursive: true });
    symlinkSync(target, link);
    const result = acquireSetupLock(ws.root, 1_000, lockDeps(() => false, Date.parse("2027-06-01T00:00:00Z")));
    assert.equal(!result.ok && result.kind, "unsafe", JSON.stringify(result));
    assert.equal(lstatSync(link).isSymbolicLink(), true);
    assert.equal(existsSync(target), true);
    assert.equal(existsSync(lockPath(ws.root)), false);
  } finally {
    ws.cleanup();
  }
});

const noPermissionTests = process.platform === "win32" || process.getuid?.() === 0;

test("reclaim: a lock directory that cannot be listed fails with the listing's reason", { skip: noPermissionTests }, () => {
  const ws = workspace(config({}));
  const dir = join(ws.root, "_local", "resolver");
  try {
    mkdirSync(dir, { recursive: true });
    chmodSync(dir, 0o300); // create and remove still work; listing does not
    const result = acquireSetupLock(ws.root, 1_000, lockDeps(() => false, Date.parse("2026-06-01T00:00:00Z")));
    assert.equal(!result.ok && result.kind, "failed", JSON.stringify(result));
    assert.match(!result.ok ? result.detail : "", /could not be checked: .*could not be listed/);
    assert.doesNotMatch(!result.ok ? result.detail : "", /displaced to/);
    chmodSync(dir, 0o700);
    assert.equal(existsSync(lockPath(ws.root)), false, "the lock path was given back");

    chmodSync(dir, 0o300);
    const released = releaseSetupLock(ws.root, "absent-token");
    assert.equal(released.ok, false, "a release that cannot list the displaced records reports it");
  } finally {
    chmodSync(dir, 0o700);
    ws.cleanup();
  }
});

test("reclaim: a lock path that cannot be given back fails, and the leftover record is abandoned", { skip: noPermissionTests }, () => {
  const ws = workspace(config({}));
  const dir = join(ws.root, "_local", "resolver");
  try {
    const now = Date.parse("2026-06-01T00:00:00Z");
    write(join(dir, "setup.lock.stale-0123456789ab"), renderSetupLock({ pid: DEAD_RESOLVER + 10, host: hostname(), token: "displaced", acquiredAt: new Date(now).toISOString() }));
    // While the displaced holder is judged live, the directory turns read-only,
    // so the caller cannot remove the lock record it just created.
    const deps = lockDeps((pid) => {
      if (pid === DEAD_RESOLVER + 10) chmodSync(dir, 0o500);
      return false;
    }, now);
    const result = acquireSetupLock(ws.root, 1_000, deps);
    assert.equal(!result.ok && result.kind, "failed", JSON.stringify(result));
    assert.match(!result.ok ? result.detail : "", /could not be given back/);
    chmodSync(dir, 0o700);
    const leftover = parseSetupLock(readFileSync(lockPath(ws.root), "utf8"));
    assert.ok(leftover);

    // The leftover carries this process's pid and a token it issued and gave
    // up, so it is abandoned at once once the displaced holder is gone.
    rmSync(join(dir, "setup.lock.stale-0123456789ab"));
    const next = acquireSetupLock(ws.root, 1_000, lockDeps(() => false, now));
    assert.equal(next.ok, true, JSON.stringify(next));
    if (next.ok) releaseSetupLock(ws.root, next.token);
  } finally {
    chmodSync(dir, 0o700);
    ws.cleanup();
  }
});

test("reclaim: an abandoned displaced record that cannot be removed fails with the reason", { skip: noPermissionTests }, () => {
  const ws = workspace(config({}));
  const dir = join(ws.root, "_local", "resolver");
  try {
    const aside = join(dir, "setup.lock.stale-0123456789ab");
    write(aside, renderSetupLock({ pid: DEAD_RESOLVER + 10, host: hostname(), token: "gone", acquiredAt: "2026-01-01T00:00:00.000Z", timeoutMs: 1_000 }));
    const deps = lockDeps((pid) => {
      if (pid === DEAD_RESOLVER + 10) chmodSync(dir, 0o500);
      return false;
    }, Date.parse("2026-06-01T00:00:00Z"));
    const result = acquireSetupLock(ws.root, 1_000, deps);
    assert.equal(!result.ok && result.kind, "failed", JSON.stringify(result));
    chmodSync(dir, 0o700);
    assert.equal(existsSync(aside), true, "the displaced record is still there");
  } finally {
    chmodSync(dir, 0o700);
    ws.cleanup();
  }
});

// WF-1005 — a give-back only counts as done when the record is missing or
// parsed with another token; an unsafe or unparseable read is a failure.
test("give-back: a lock path that turns unsafe before it is given back fails, and is neither followed nor removed", { skip: process.platform === "win32" }, () => {
  const ws = workspace(config({}));
  const dir = join(ws.root, "_local", "resolver");
  try {
    const now = Date.parse("2026-06-01T00:00:00Z");
    write(join(dir, "setup.lock.stale-0123456789ab"), renderSetupLock({ pid: DEAD_RESOLVER + 10, host: hostname(), token: "displaced", acquiredAt: new Date(now).toISOString() }));
    const outside = join(ws.root, "outside-lock.json");
    // While the displaced holder is judged live, the caller's own lock path is
    // swapped for a link to a copy of its record outside the lock directory.
    const deps = lockDeps((pid) => {
      if (pid === DEAD_RESOLVER + 10 && !existsSync(outside)) {
        write(outside, readFileSync(lockPath(ws.root), "utf8"));
        rmSync(lockPath(ws.root));
        symlinkSync(outside, lockPath(ws.root));
      }
      return false;
    }, now);
    const result = acquireSetupLock(ws.root, 1_000, deps);
    assert.equal(!result.ok && result.kind, "failed", JSON.stringify(result));
    assert.match(!result.ok ? result.detail : "", /could not be given back: .*not a contained regular file/);
    assert.equal(lstatSync(lockPath(ws.root)).isSymbolicLink(), true, "the unsafe lock path is not removed");
    assert.equal(existsSync(outside), true, "the link target is not followed or removed");
  } finally {
    ws.cleanup();
  }
});

test("release: an unsafe displaced record is reported, and is neither followed nor removed", { skip: process.platform === "win32" }, () => {
  const ws = workspace(config({}));
  try {
    const target = join(ws.root, "outside.json");
    write(target, renderSetupLock({ pid: DEAD_RESOLVER, host: hostname(), token: "mine", acquiredAt: "2026-01-01T00:00:00.000Z" }));
    const link = join(ws.root, "_local", "resolver", "setup.lock.stale-dddddddddddd");
    mkdirSync(dirname(link), { recursive: true });
    symlinkSync(target, link);
    const released = releaseSetupLock(ws.root, "mine");
    assert.equal(released.ok, false, "an unsafe displaced record is never taken as given back");
    assert.match(!released.ok ? released.detail : "", /displaced setup lock was not released: .*not a contained regular file/);
    assert.equal(lstatSync(link).isSymbolicLink(), true);
    assert.equal(existsSync(target), true);
  } finally {
    ws.cleanup();
  }
});

test("release: an unparseable displaced or canonical record is reported and left in place", () => {
  const ws = workspace(config({}));
  try {
    const aside = join(ws.root, "_local", "resolver", "setup.lock.stale-eeeeeeeeeeee");
    write(aside, "not a lock record");
    const fromAside = releaseSetupLock(ws.root, "mine");
    assert.equal(fromAside.ok, false);
    assert.match(!fromAside.ok ? fromAside.detail : "", /could not be read as a setup-lock record/);
    assert.equal(existsSync(aside), true);
    rmSync(aside);

    write(lockPath(ws.root), "not a lock record");
    const fromCanonical = releaseSetupLock(ws.root, "mine");
    assert.equal(fromCanonical.ok, false);
    assert.match(!fromCanonical.ok ? fromCanonical.detail : "", /setup lock was not released: .*could not be read/);
    assert.equal(existsSync(lockPath(ws.root)), true);

    // A missing record, or one parsed with another token, is already given back.
    rmSync(lockPath(ws.root));
    write(aside, renderSetupLock({ pid: DEAD_RESOLVER, host: hostname(), token: "theirs", acquiredAt: "2026-01-01T00:00:00.000Z" }));
    assert.equal(releaseSetupLock(ws.root, "mine").ok, true);
    assert.equal(existsSync(aside), true, "another holder's record is left alone");
  } finally {
    ws.cleanup();
  }
});

test("the runner records its own and the command group's pid in the held lock", () => {
  const ws = workspace(config({ "Dependency Setup Command": "`sleep 0.5; cat _local/resolver/setup.lock > seen.json`" }));
  try {
    const result = ws.service().runWorkspaceSetup();
    assert.equal(result.status, "succeeded", JSON.stringify(result));
    const seen = parseSetupLock(readFileSync(`${ws.root}/seen.json`, "utf8"));
    assert.ok(seen !== null);
    assert.equal(seen.pid, process.pid);
    assert.ok(typeof seen.runnerPid === "number" && seen.runnerPid !== process.pid);
    if (process.platform !== "win32") assert.ok(typeof seen.groupPid === "number");
    assert.equal(existsSync(lockPath(ws.root)), false, "the rewritten lock is still released by its token");
  } finally {
    ws.cleanup();
  }
});

// WF-925 — the runner's pid write-back follows the contained, no-follow rule.
function heldLock(root: string): { token: string; text: string } {
  const token = "a".repeat(32);
  const text = renderSetupLock({ pid: 4242, host: hostname(), token, acquiredAt: "2026-06-01T00:00:00.000Z", timeoutMs: 1_000 });
  write(lockPath(root), text);
  return { token, text };
}

test("pid write-back: the ordinary path records both pids and keeps the token", () => {
  const ws = workspace(config({}));
  try {
    const { token } = heldLock(ws.root);
    const outcome = writeBackSetupRunnerPids(nodeFs, nodePath, { root: ws.root, rel: SETUP_LOCK_RELPATH, token }, { runnerPid: 777, groupPid: 778 });
    assert.equal(outcome, "written");
    const record = parseSetupLock(readFileSync(lockPath(ws.root), "utf8"));
    assert.equal(record?.token, token);
    assert.equal(record?.runnerPid, 777);
    assert.equal(record?.groupPid, 778);
    assert.deepEqual(readdirSync(`${ws.root}/_local/resolver`), ["setup.lock"], "no temp file is left behind");
  } finally {
    ws.cleanup();
  }
});

test("pid write-back: a symlinked `_local/resolver` is neither read nor written through", { skip: process.platform === "win32" }, () => {
  const ws = workspace(config({}));
  const outside = normalizeSlashes(realpathSync(mkdtempSync(join(tmpdir(), "wf-setup-out-"))));
  try {
    // An outside directory holding a lock-shaped record that carries the SAME token.
    const { token, text } = heldLock(`${outside}/ws`);
    const outsideResolver = `${outside}/ws/_local/resolver`;
    rmSync(`${ws.root}/_local/resolver`, { recursive: true, force: true });
    symlinkSync(outsideResolver, `${ws.root}/_local/resolver`);
    const outcome = writeBackSetupRunnerPids(nodeFs, nodePath, { root: ws.root, rel: SETUP_LOCK_RELPATH, token }, { runnerPid: 777, groupPid: 778 });
    assert.equal(outcome, "unsafe");
    assert.equal(readFileSync(`${outsideResolver}/setup.lock`, "utf8"), text, "the outside file is byte-identical");
    assert.deepEqual(readdirSync(outsideResolver), ["setup.lock"], "no temp file lands outside");
  } finally {
    ws.cleanup();
    rmSync(outside, { recursive: true, force: true });
  }
});

test("pid write-back: a symlinked lock file is refused and its target left alone", { skip: process.platform === "win32" }, () => {
  const ws = workspace(config({}));
  const outside = normalizeSlashes(realpathSync(mkdtempSync(join(tmpdir(), "wf-setup-out-"))));
  try {
    const { token, text } = heldLock(`${outside}/ws`);
    mkdirSync(`${ws.root}/_local/resolver`, { recursive: true });
    symlinkSync(`${outside}/ws/${SETUP_LOCK_RELPATH}`, lockPath(ws.root));
    const outcome = writeBackSetupRunnerPids(nodeFs, nodePath, { root: ws.root, rel: SETUP_LOCK_RELPATH, token }, { runnerPid: 777 });
    assert.equal(outcome, "unsafe");
    assert.equal(readFileSync(`${outside}/ws/${SETUP_LOCK_RELPATH}`, "utf8"), text);
  } finally {
    ws.cleanup();
    rmSync(outside, { recursive: true, force: true });
  }
});

test("pid write-back: a lock whose token moved is left byte-identical", () => {
  const ws = workspace(config({}));
  try {
    const { text } = heldLock(ws.root);
    const outcome = writeBackSetupRunnerPids(nodeFs, nodePath, { root: ws.root, rel: SETUP_LOCK_RELPATH, token: "b".repeat(32) }, { runnerPid: 777 });
    assert.equal(outcome, "token-mismatch");
    assert.equal(readFileSync(lockPath(ws.root), "utf8"), text);
    assert.deepEqual(readdirSync(`${ws.root}/_local/resolver`), ["setup.lock"]);
  } finally {
    ws.cleanup();
  }
});

// WF-996 — a lock that replaces the validated one is never overwritten. The
// injected fs swaps a different-token lock onto the path at a chosen call, and
// refuses any rename, so the race lands at exactly that boundary every run.
function racingFs(root: string, at: "openSync" | "writeSync", otherText: string): typeof nodeFs {
  let swapped = false;
  const swap = (): void => {
    if (swapped) return;
    swapped = true;
    nodeFs.renameSync(lockPath(root), `${lockPath(root)}.aside`);
    writeFileSync(lockPath(root), otherText);
  };
  return {
    ...nodeFs,
    [at]: (...args: unknown[]) => {
      swap();
      return (nodeFs[at] as (...a: unknown[]) => unknown)(...args);
    },
    renameSync: () => {
      throw new Error("the write-back must never rename over the lock path");
    },
  } as typeof nodeFs;
}

function otherHolder(): string {
  return renderSetupLock({ pid: 5151, host: hostname(), token: "c".repeat(32), acquiredAt: "2026-06-01T00:00:01.000Z", timeoutMs: 1_000 });
}

test("pid write-back: a lock that replaces the validated one before the write is left byte-identical", () => {
  const ws = workspace(config({}));
  try {
    const { token } = heldLock(ws.root);
    const other = otherHolder();
    const fs = racingFs(ws.root, "writeSync", other);
    const outcome = writeBackSetupRunnerPids(fs, nodePath, { root: ws.root, rel: SETUP_LOCK_RELPATH, token }, { runnerPid: 777, groupPid: 778 });
    assert.equal(outcome, "unsafe", "a late identity mismatch is reported like the one before the open");
    assert.equal(readFileSync(lockPath(ws.root), "utf8"), other, "the new holder's lock is untouched");
    const displaced = parseSetupLock(readFileSync(`${lockPath(ws.root)}.aside`, "utf8"));
    assert.equal(displaced?.token, token, "the pids went to the validated file only");
    assert.equal(displaced?.runnerPid, 777);
    assert.deepEqual(readdirSync(`${ws.root}/_local/resolver`).sort(), ["setup.lock", "setup.lock.aside"]);
  } finally {
    ws.cleanup();
  }
});

test("pid write-back: a lock that replaces the walked one before the open is left byte-identical", () => {
  const ws = workspace(config({}));
  try {
    const { token, text } = heldLock(ws.root);
    const other = otherHolder();
    const fs = racingFs(ws.root, "openSync", other);
    const outcome = writeBackSetupRunnerPids(fs, nodePath, { root: ws.root, rel: SETUP_LOCK_RELPATH, token }, { runnerPid: 777 });
    assert.equal(outcome, "unsafe");
    assert.equal(readFileSync(lockPath(ws.root), "utf8"), other);
    assert.equal(readFileSync(`${lockPath(ws.root)}.aside`, "utf8"), text);
  } finally {
    ws.cleanup();
  }
});

test("pid write-back: a rewrite that fails partway puts the original record back", () => {
  const ws = workspace(config({}));
  try {
    const { token, text } = heldLock(ws.root);
    let failed = false;
    const fs = {
      ...nodeFs,
      writeSync: (...args: unknown[]) => {
        const [fd, data, offset, length, position] = args as [number, Buffer, number, number, number];
        if (!failed && length > 8) {
          failed = true;
          // Tear the record: land part of the new bytes, then fail.
          nodeFs.writeSync(fd, data, offset, 8, position);
          throw Object.assign(new Error("no space left on device"), { code: "ENOSPC" });
        }
        return nodeFs.writeSync(fd, data, offset, length, position);
      },
    } as typeof nodeFs;
    const outcome = writeBackSetupRunnerPids(fs, nodePath, { root: ws.root, rel: SETUP_LOCK_RELPATH, token }, { runnerPid: 777, groupPid: 778 });
    assert.equal(outcome, "failed");
    assert.ok(failed, "the injected failure fired");
    assert.equal(readFileSync(lockPath(ws.root), "utf8"), text, "the lock is byte-identical to its original record");
    assert.equal(parseSetupLock(readFileSync(lockPath(ws.root), "utf8"))?.token, token);
  } finally {
    ws.cleanup();
  }
});

test("pid write-back: a path that is not plain and relative is refused", () => {
  const ws = workspace(config({}));
  try {
    const { token, text } = heldLock(ws.root);
    for (const rel of ["../x/setup.lock", "/etc/setup.lock", "_local/./resolver/setup.lock", ""]) {
      assert.equal(writeBackSetupRunnerPids(nodeFs, nodePath, { root: ws.root, rel, token }, { runnerPid: 777 }), "unsafe", rel);
    }
    assert.equal(readFileSync(lockPath(ws.root), "utf8"), text);
  } finally {
    ws.cleanup();
  }
});

test("the runner embeds the contained write-back and no raw lock-path access", () => {
  assert.match(SETUP_RUNNER_SOURCE, /const writeBackSetupRunnerPids = function/);
  assert.doesNotMatch(SETUP_RUNNER_SOURCE, /req\.lock\.path/);
});

test("a failed lock release is reported, not dropped", { skip: process.platform === "win32" || process.getuid?.() === 0 }, () => {
  const ws = workspace(config({}));
  try {
    const acquired = acquireSetupLock(ws.root, 1_000, lockDeps(() => false, Date.parse("2026-06-01T00:00:00Z")));
    assert.equal(acquired.ok, true);
    if (!acquired.ok) return;
    chmodSync(`${ws.root}/_local/resolver`, 0o555);
    const released = releaseSetupLock(ws.root, acquired.token);
    chmodSync(`${ws.root}/_local/resolver`, 0o755);
    assert.equal(released.ok, false);
    assert.match(!released.ok ? released.detail : "", /setup lock was not released/);
  } finally {
    ws.cleanup();
  }
});

test("a release that reads an unsafe lock is reported and neither follows nor removes it", { skip: process.platform === "win32" }, () => {
  const ws = workspace(config({}));
  const outside = normalizeSlashes(realpathSync(mkdtempSync(join(tmpdir(), "wf-setup-out-"))));
  try {
    const acquired = acquireSetupLock(ws.root, 1_000, lockDeps(() => false, Date.parse("2026-06-01T00:00:00Z")));
    assert.equal(acquired.ok, true);
    if (!acquired.ok) return;
    write(`${outside}/lock`, "not ours\n");
    rmSync(lockPath(ws.root));
    symlinkSync(`${outside}/lock`, lockPath(ws.root));
    const released = releaseSetupLock(ws.root, acquired.token);
    assert.equal(released.ok, false);
    const detail = !released.ok ? released.detail : "";
    assert.match(detail, /setup lock was not released/);
    assert.ok(detail.includes(SETUP_LOCK_RELPATH), detail);
    assert.ok(lstatSync(lockPath(ws.root)).isSymbolicLink(), "the unsafe lock path is left in place");
    assert.equal(readFileSync(`${outside}/lock`, "utf8"), "not ours\n");
  } finally {
    ws.cleanup();
    rmSync(outside, { recursive: true, force: true });
  }
});

test("unsafe-path: a symlinked setup lock blocks and the command does not run", () => {
  const ws = workspace(config({ "Dependency Setup Command": `\`${MARKED}\`` }));
  const outside = normalizeSlashes(realpathSync(mkdtempSync(join(tmpdir(), "wf-setup-out-"))));
  try {
    write(`${outside}/lock`, "not ours\n");
    mkdirSync(`${ws.root}/_local/resolver`, { recursive: true });
    symlinkSync(`${outside}/lock`, lockPath(ws.root));
    const result = ws.service().runWorkspaceSetup();
    assert.equal(result.status, "blocked", JSON.stringify(result));
    assert.equal(result.reason, "unsafe-path");
    assert.equal(existsSync(`${ws.root}/setup-marker.txt`), false);
    assert.equal(readFileSync(`${outside}/lock`, "utf8"), "not ours\n");
  } finally {
    ws.cleanup();
    rmSync(outside, { recursive: true, force: true });
  }
});

test("not-declared never touches setup state, even under a symlinked `_local/resolver`", () => {
  const ws = workspace(config({}));
  const outside = normalizeSlashes(realpathSync(mkdtempSync(join(tmpdir(), "wf-setup-out-"))));
  try {
    symlinkSync(outside, `${ws.root}/_local/resolver`);
    const result = ws.service().runWorkspaceSetup();
    assert.equal(result.status, "not-declared", JSON.stringify(result));
  } finally {
    ws.cleanup();
    rmSync(outside, { recursive: true, force: true });
  }
});
