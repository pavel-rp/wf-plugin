// wf resolver — production side-effect ports for the typed service.
//
// Wires ResolverServicePorts to the real world: the deterministic resolver
// engine (WF-269) for snapshot builds, the filesystem for the project-local
// cache + registry edits, and `claude plugin list --json` for installed-pack
// facts. Kept apart from service.ts so the service logic stays a pure function
// of its ports and can be tested with in-memory doubles.

import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  extractRegistryPath,
  fsIO,
  resolveSnapshot,
  readSnapshot,
  writeSnapshot,
  runPluginList,
} from "./resolver/index.js";
import { parsePluginList } from "./resolver/plugin-list.js";
import { joinSlash, normalizeSlashes } from "./resolver/paths.js";
import type { ResolverServicePorts, PluginListResult } from "./service.js";

const DEFAULT_REGISTRY_RELPATH = "_local/config.md";

/** Resolve the workspace root the server operates against. The MCP process is
 *  launched with the Claude Code workspace as its cwd; `WF_WORKSPACE_ROOT`
 *  overrides it (tests / non-standard hosts). */
export function resolveWorkspaceRoot(): string {
  return normalizeSlashes(process.env.WF_WORKSPACE_ROOT || process.cwd());
}

/** Resolve the core `wf` plugin root — the anchor for `contract` / `shared` /
 *  core `references-template` content refs. This module is bundled into
 *  `<coreRoot>/mcp/dist/runtime.mjs`, so `import.meta.url` locates the server's
 *  own install and two directory levels up is the core plugin root — no registry
 *  or CLI dependency, correct in-tree and out-of-tree, and it moves with the
 *  install (so a version bump never re-prompts). `WF_CORE_PLUGIN_ROOT` overrides
 *  it (tests / non-standard hosts). */
export function resolveCorePluginRoot(): string {
  if (process.env.WF_CORE_PLUGIN_ROOT) {
    return normalizeSlashes(process.env.WF_CORE_PLUGIN_ROOT);
  }
  const here = fileURLToPath(import.meta.url); // .../plugins/wf/mcp/dist/runtime.mjs
  return normalizeSlashes(resolve(dirname(here), "..", "..")); // .../plugins/wf
}

export function createDefaultPorts(workspaceRoot: string): ResolverServicePorts {
  const registryRelPath = (): string => {
    const wfConfig = fsIO.readFile(joinSlash(workspaceRoot, "wf.config.js"));
    return extractRegistryPath(wfConfig);
  };

  return {
    workspaceRoot,
    corePluginRoot: resolveCorePluginRoot(),

    resolveFresh: () =>
      resolveSnapshot({ workspaceRoot, corePluginRoot: resolveCorePluginRoot() }),

    persist: (snapshot) => {
      writeSnapshot(workspaceRoot, snapshot);
    },

    readCache: () => {
      try {
        return readSnapshot(workspaceRoot);
      } catch {
        // An incompatible/corrupt cache is treated as "no cache" so the next
        // ensure() rebuilds cleanly rather than surfacing a read error.
        return null;
      }
    },

    readFile: (absPath) => fsIO.readFile(absPath),

    writeFile: (absPath, content) => {
      mkdirSync(dirname(absPath), { recursive: true });
      writeFileSync(absPath, content, { encoding: "utf8" });
    },

    listDirs: (absDir) => {
      try {
        return readdirSync(absDir, { withFileTypes: true })
          .filter((e) => e.isDirectory())
          .map((e) => e.name);
      } catch {
        return [];
      }
    },

    listFiles: (absDir) => {
      try {
        return readdirSync(absDir, { withFileTypes: true })
          .filter((e) => e.isFile())
          .map((e) => e.name);
      } catch {
        return [];
      }
    },

    listPlugins: (): PluginListResult => {
      const raw = runPluginList();
      if (raw === null) return { plugins: [], ok: false };
      return { plugins: parsePluginList(raw).plugins, ok: true };
    },

    registryRelPath: () => registryRelPath() || DEFAULT_REGISTRY_RELPATH,
  };
}
