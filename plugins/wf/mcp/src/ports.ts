// wf resolver — production side-effect ports for the typed service.
//
// Wires ResolverServicePorts to the real world: the deterministic resolver
// engine (WF-269) for snapshot builds, the filesystem for the project-local
// cache + registry edits, and `claude plugin list --json` for installed-pack
// facts. Kept apart from service.ts so the service logic stays a pure function
// of its ports and can be tested with in-memory doubles.

import { lstatSync, mkdirSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  extractRegistryPathRaw,
  fingerprintContainedCapabilityFile,
  fsIO,
  resolveSnapshot,
  readSnapshot,
  writeSnapshot,
  runPluginList,
} from "./resolver/index.js";
import { parsePluginList } from "./resolver/plugin-list.js";
import { joinSlash, normalizeSlashes } from "./resolver/paths.js";
import type { PayloadTargetResolution } from "./resolver/payload-plan.js";
import type { ResolverServicePorts, PluginListResult } from "./service.js";

const DEFAULT_REGISTRY_RELPATH = "_local/config.md";

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

/** Resolve a write target only when its existing path chain stays in the workspace. */
export function resolveContainedRegistryWritePath(
  workspaceRoot: string,
  registryRelPath: string,
): string {
  const canonicalRoot = realpathSync(workspaceRoot);
  const target = resolve(workspaceRoot, registryRelPath);
  let existing = target;
  while (true) {
    try {
      lstatSync(existing);
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      const parent = dirname(existing);
      if (parent === existing) throw err;
      existing = parent;
    }
  }
  const canonicalExisting = realpathSync(existing);
  const fromRoot = relative(canonicalRoot, canonicalExisting);
  if (
    fromRoot === "" ||
    (fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot))
  ) {
    return normalizeSlashes(target);
  }
  throw new Error(`resolved path leaves workspace root \`${normalizeSlashes(canonicalRoot)}\`.`);
}

/** Lexical rejection of a declared payload destination, applied BEFORE any
 *  filesystem access. Mirrors the declaration-time grammar `payloads.ts` already
 *  enforces, so a destination that somehow reached here unvalidated is still
 *  refused rather than probed. */
function lexicalPayloadRejection(
  destination: string,
): PayloadTargetResolution | null {
  if (destination.length === 0 || destination.includes("\0") || destination.includes("\\")) {
    return { ok: false, rejection: "malformed" };
  }
  if (destination.startsWith("/") || /^[A-Za-z]:/.test(destination)) {
    return { ok: false, rejection: "absolute" };
  }
  const segments = destination.split("/");
  if (segments.some((segment) => segment === "..")) {
    return { ok: false, rejection: "traversal" };
  }
  if (segments.some((segment) => segment === "" || segment === "." || segment.includes(":"))) {
    return { ok: false, rejection: "malformed" };
  }
  return null;
}

/**
 * Resolve one declared payload destination to a canonical workspace-contained
 * target — WITHOUT creating anything.
 *
 * The probe walks up to the deepest ancestor that already exists and
 * canonicalizes THAT, so it never has to materialize the path it is testing.
 * Canonicalization happens before the containment decision, which is what makes
 * an escaping symlink caught rather than followed: `realpathSync` resolves the
 * link and the resolved location is then measured against the canonical root.
 *
 * The root is passed in rather than closed over, because containment is measured
 * against the ONE admitted workspace root (WF-445) — a different question from
 * plugin-root validation, which this never performs.
 */
export function resolveContainedPayloadTarget(
  workspaceRoot: string,
  destination: string,
): PayloadTargetResolution {
  const lexical = lexicalPayloadRejection(destination);
  if (lexical !== null) return lexical;

  let canonicalRoot: string;
  try {
    canonicalRoot = realpathSync(workspaceRoot);
  } catch {
    return { ok: false, rejection: "unresolvable" };
  }

  const target = resolve(canonicalRoot, destination);

  // Walk up to the deepest EXISTING node. `lstatSync` does not follow a terminal
  // symlink, so a dangling link is still "existing" and is canonicalized below.
  let existing = target;
  const trailing: string[] = [];
  while (true) {
    try {
      lstatSync(existing);
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        return { ok: false, rejection: "unresolvable" };
      }
      const parent = dirname(existing);
      if (parent === existing) return { ok: false, rejection: "unresolvable" };
      trailing.unshift(basename(existing));
      existing = parent;
    }
  }

  let canonicalExisting: string;
  try {
    canonicalExisting = realpathSync(existing);
  } catch {
    // A dangling symlink cannot be canonicalized, so containment of whatever it
    // points at cannot be established. Fail closed rather than guess.
    return { ok: false, rejection: "symlink-escape" };
  }

  const fromRoot = relative(canonicalRoot, canonicalExisting);
  const contained =
    fromRoot === "" ||
    (fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot));
  if (!contained) {
    // A link was resolved iff canonicalization moved the path. That distinction
    // is what separates "escaped through a symlink" from "was simply outside".
    return {
      ok: false,
      rejection: canonicalExisting === existing ? "out-of-workspace" : "symlink-escape",
    };
  }

  const exists = trailing.length === 0;
  if (exists && !lstatSync(canonicalExisting).isFile()) {
    return { ok: false, rejection: "target-not-a-file" };
  }

  const canonicalTarget = joinSlash(normalizeSlashes(canonicalExisting), ...trailing);
  // Belt and braces: the composed target must still sit under the canonical root.
  const rootPrefix = normalizeSlashes(canonicalRoot).replace(/\/+$/, "");
  if (
    canonicalTarget !== rootPrefix &&
    !canonicalTarget.startsWith(rootPrefix === "/" ? "/" : `${rootPrefix}/`)
  ) {
    return { ok: false, rejection: "out-of-workspace" };
  }

  return { ok: true, canonicalTarget, exists };
}

export function createDefaultPorts(workspaceRoot: string): ResolverServicePorts {
  const registryRelPath = (): string => {
    const wfConfig = fsIO.readFile(joinSlash(workspaceRoot, "wf.config.js"));
    return extractRegistryPathRaw(wfConfig);
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
    readContainedFile: (capabilityRoot, selectedPath, maxBytes) =>
      fsIO.readContainedFile!(capabilityRoot, selectedPath, maxBytes),
    fingerprintContainedFile: (capabilityRoot, selectedPath, maxBytes) =>
      fingerprintContainedCapabilityFile(capabilityRoot, selectedPath, maxBytes),
    resolvePayloadTarget: (admittedRoot, destination) =>
      resolveContainedPayloadTarget(admittedRoot, destination),
    canonicalizeRoot: (root) => {
      try {
        return normalizeSlashes(realpathSync(root));
      } catch {
        return null;
      }
    },

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
      // The CLI never ran (or errored). Nothing was parsed, so there is no
      // contract verdict to report — `contractOk: true` with no issues means
      // "no drift observed", not "the output was fine".
      if (raw === null) return { plugins: [], ok: false, contractOk: true, issues: [] };
      const parsed = parsePluginList(raw);
      return {
        plugins: parsed.plugins,
        ok: true,
        contractOk: parsed.contractOk,
        issues: parsed.issues,
      };
    },

    registryRelPath: () => registryRelPath() || DEFAULT_REGISTRY_RELPATH,
    resolveRegistryWritePath: (registryRelPath) =>
      resolveContainedRegistryWritePath(workspaceRoot, registryRelPath),
  };
}
