// Clean-installed-copy smoke test for the wf resolver MCP runtime.
//
// Proves the production startup contract without the source repo or node_modules:
//   1. Copy ONLY the shipped plugin payload (the committed dist/ bundle + the
//      plugin-root .mcp.json) to a clean temp location — no src, no repo, no
//      node_modules, no package.json.
//   2. Parse the copied .mcp.json and launch EXACTLY the declared MCP process
//      (command `node`, ${CLAUDE_PLUGIN_ROOT} substituted), from a scratch cwd
//      that contains no package.json and no node_modules — so nothing could be
//      installed even if startup tried.
//   3. Drive the MCP stdio protocol handshake (initialize -> result, then
//      tools/list) and assert the server answers from the bundle alone.
//
// Run with `npm run smoke`. In CI this runs on the DECLARED MINIMUM Node (the
// `node` on PATH), so the handshake is proven against the floor, not just the
// developer's interpreter.

import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  copyFile,
  readFile,
  rm,
  readdir,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { createInterface } from "node:readline";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const pkgDir = join(scriptDir, ".."); // plugins/wf/mcp
const pluginSrcRoot = join(pkgDir, ".."); // plugins/wf

const HANDSHAKE_TIMEOUT_MS = 20_000;

function fail(message) {
  process.stderr.write(`SMOKE FAIL: ${message}\n`);
  process.exit(1);
}

/** Recursively assert a directory tree contains no node_modules / package.json. */
async function assertNoDependencyArtifacts(root) {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "node_modules") {
      fail(`clean payload unexpectedly contains node_modules at ${join(root, entry.name)}`);
    }
    if (entry.name === "package.json" || entry.name === "package-lock.json") {
      fail(`clean payload unexpectedly contains ${entry.name} at ${join(root, entry.name)}`);
    }
    if (entry.isDirectory()) {
      await assertNoDependencyArtifacts(join(root, entry.name));
    }
  }
}

const cleanRoot = await mkdtemp(join(tmpdir(), "wf-resolver-smoke-"));
let child;
try {
  // (1) Copy ONLY the shipped payload.
  const pluginRoot = join(cleanRoot, "plugin");
  const distTarget = join(pluginRoot, "mcp", "dist");
  await mkdir(distTarget, { recursive: true });

  for (const name of ["server.mjs", "runtime.mjs"]) {
    const from = join(pkgDir, "dist", name);
    if (!existsSync(from)) {
      fail(`committed bundle missing: dist/${name}. Run \`npm run build\` first.`);
    }
    await copyFile(from, join(distTarget, name));
  }
  await copyFile(join(pluginSrcRoot, ".mcp.json"), join(pluginRoot, ".mcp.json"));

  // Scratch cwd with nothing in it — no package.json, no node_modules.
  const scratchCwd = join(cleanRoot, "scratch");
  await mkdir(scratchCwd, { recursive: true });

  await assertNoDependencyArtifacts(cleanRoot);

  // (2) Parse the copied .mcp.json and reconstruct the DECLARED launch command.
  const mcpDecl = JSON.parse(await readFile(join(pluginRoot, ".mcp.json"), "utf8"));
  const servers = mcpDecl.mcpServers ?? {};
  const serverKeys = Object.keys(servers);
  if (serverKeys.length !== 1) {
    fail(`.mcp.json must declare exactly one server; found ${serverKeys.length}`);
  }
  const decl = servers[serverKeys[0]];

  if (decl.alwaysLoad !== true) {
    fail(`.mcp.json server "${serverKeys[0]}" must set alwaysLoad: true`);
  }
  if (decl.command !== "node") {
    fail(`.mcp.json command must be "node" (no npx / package manager); got "${decl.command}"`);
  }
  const rawArgs = Array.isArray(decl.args) ? decl.args : [];
  const declText = JSON.stringify(decl);
  for (const forbidden of ["npx", "npm ", "install", "pnpm", "yarn"]) {
    if (declText.includes(forbidden)) {
      fail(`.mcp.json must not reference a package manager / install step; found "${forbidden}"`);
    }
  }

  const args = rawArgs.map((a) => a.replaceAll("${CLAUDE_PLUGIN_ROOT}", pluginRoot));
  const bundleArg = args.find((a) => a.endsWith("server.mjs"));
  if (!bundleArg || !existsSync(bundleArg)) {
    fail(`declared launch target does not resolve to the copied bundle: ${bundleArg}`);
  }

  process.stdout.write(
    `Launching declared MCP process on Node ${process.version}: ${decl.command} ${args.join(" ")}\n`,
  );

  // (3) Launch and drive the handshake.
  child = spawn(decl.command, args, {
    cwd: scratchCwd,
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: pluginRoot },
    stdio: ["pipe", "pipe", "pipe"],
  });

  let stderrBuf = "";
  child.stderr.on("data", (d) => {
    stderrBuf += d.toString();
  });

  const responses = new Map();
  const waiters = new Map();
  const rl = createInterface({ input: child.stdout });
  rl.on("line", (line) => {
    const text = line.trim();
    if (!text) return;
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      return; // ignore non-JSON diagnostic lines
    }
    if (msg.id !== undefined && msg.id !== null) {
      responses.set(msg.id, msg);
      const w = waiters.get(msg.id);
      if (w) {
        waiters.delete(msg.id);
        w(msg);
      }
    }
  });

  const childExited = new Promise((_, reject) => {
    child.on("exit", (code) => reject(new Error(`server exited early (code ${code})\n${stderrBuf}`)));
    child.on("error", (err) => reject(new Error(`failed to spawn server: ${err.message}`)));
  });

  function send(obj) {
    child.stdin.write(`${JSON.stringify(obj)}\n`);
  }

  function awaitResponse(id) {
    return new Promise((resolveResp, reject) => {
      if (responses.has(id)) return resolveResp(responses.get(id));
      waiters.set(id, resolveResp);
      setTimeout(() => reject(new Error(`timed out waiting for response id=${id}\n${stderrBuf}`)), HANDSHAKE_TIMEOUT_MS);
    });
  }

  send({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "wf-resolver-smoke", version: "0.0.0" },
    },
  });

  const initResult = await Promise.race([awaitResponse(1), childExited]);
  if (initResult.error) {
    fail(`initialize returned an error: ${JSON.stringify(initResult.error)}`);
  }
  const result = initResult.result ?? {};
  if (!result.protocolVersion) {
    fail(`initialize result missing protocolVersion: ${JSON.stringify(initResult)}`);
  }
  if (result.serverInfo?.name !== "wf-resolver") {
    fail(`unexpected serverInfo: ${JSON.stringify(result.serverInfo)}`);
  }
  process.stdout.write(
    `Handshake OK: protocol ${result.protocolVersion}, server ${result.serverInfo.name} ${result.serverInfo.version}\n`,
  );

  // Complete the lifecycle and confirm the tool surface answers from the bundle.
  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  const toolsResult = await Promise.race([awaitResponse(2), childExited]);
  const tools = toolsResult.result?.tools ?? [];
  if (!tools.some((t) => t.name === "wf_resolver_status")) {
    fail(`tools/list did not include wf_resolver_status: ${JSON.stringify(tools)}`);
  }
  // The typed resolver query tools (WF-270) must be advertised from the bundle.
  for (const required of ["resolve_config", "inspect_pack", "register_pack", "resolve_inspect"]) {
    if (!tools.some((t) => t.name === required)) {
      fail(`tools/list did not include ${required}: ${JSON.stringify(tools.map((t) => t.name))}`);
    }
  }
  process.stdout.write(`tools/list OK: ${tools.map((t) => t.name).join(", ")}\n`);

  // Call a typed tool end-to-end through the bundle. resolve_inspect is the safe
  // choice: it reports lifecycle state from the (absent) cache under the scratch
  // cwd without a rebuild or a `claude` CLI call — hermetic and deterministic.
  send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "resolve_inspect", arguments: {} } });
  const callResult = await Promise.race([awaitResponse(3), childExited]);
  if (callResult.error) {
    fail(`resolve_inspect returned an error: ${JSON.stringify(callResult.error)}`);
  }
  const structured = callResult.result?.structuredContent;
  const textPayload = callResult.result?.content?.find((c) => c.type === "text")?.text;
  const parsed = structured ?? (textPayload ? JSON.parse(textPayload) : undefined);
  if (!parsed || typeof parsed.valid !== "boolean" || !("counts" in parsed)) {
    fail(`resolve_inspect did not return a lifecycle payload: ${JSON.stringify(callResult.result)}`);
  }
  process.stdout.write(
    `tools/call resolve_inspect OK: valid=${parsed.valid}, cached=${parsed.cached}\n`,
  );

  process.stdout.write(
    "SMOKE PASS: clean-copy MCP runtime started, completed the protocol handshake, and served a typed resolver query — with no repo, no node_modules, and no dependency install.\n",
  );
} finally {
  if (child) {
    try {
      child.stdin.end();
    } catch {
      /* ignore */
    }
    if (child.exitCode === null) {
      child.kill();
      // Wait for the OS to release the child's cwd handle before removing the
      // temp tree (Windows holds it briefly after kill).
      await new Promise((r) => {
        child.on("exit", r);
        setTimeout(r, 3000);
      });
    }
  }
  try {
    await rm(cleanRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    // Best-effort cleanup: a transient OS lock on the temp dir must not fail a
    // handshake that already passed.
  }
}

process.exit(0);
