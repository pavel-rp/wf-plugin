// wf resolver — bundled-doc CONTENT ref resolution (WF-302, C011 SUB-1).
//
// C008 (WF-268..287) resolves every bundled-doc ref to a PATH and stops there:
// its snapshot is deliberately BODY-FREE (types.ts). This module adds the C011
// content surface on top WITHOUT re-implementing resolution — it consumes the
// already-resolved snapshot facts (capability `resolvedPath` /
// `profileTemplatePath`, `pluginRoots` resolved roots, incl. recorded-root-first
// self-heal) and the server's own core-plugin root, computes the absolute path
// for one of exactly FIVE logical content-ref classes, and returns a resolution
// PLAN. The service does the actual `fs` read of that plan's path (the snapshot
// is never touched, so the body-free invariant is untouched).
//
// A plan is one of three outcomes, mirroring the C008 resolve_gate posture:
//   - `path`       — a validated absolute path the service reads and serves.
//   - `unresolved` — resolution failed (unregistered / dangling / self-heal
//                    recovered nothing / no declared template) → a typed
//                    resolver-failure category + `/wf:resolve` recovery. NEVER a
//                    wrong-path body, NEVER a raw-read fall-through.
//   - `refused`    — the ref is outside the five served classes (a skill body, a
//                    CI-only fixture/validator input, a path traversal, or a
//                    malformed ref).

import { isAbsoluteRoot, joinSlash, normalizeSlashes } from "./paths.js";
import { recoveryFor } from "./failure.js";
import type { ResolverErrorCategory, ResolverSnapshot } from "./types.js";

/** The five — and only five — logical content-ref classes this surface serves. */
export type ContentRefClass =
  | "fragment"
  | "contract"
  | "shared"
  | "references-template"
  | "profile-template";

export const CONTENT_REF_CLASSES: readonly ContentRefClass[] = [
  "fragment",
  "contract",
  "shared",
  "references-template",
  "profile-template",
] as const;

/** A logical content ref. Only the fields a class uses are read; extras are
 *  ignored. Field-shape validation is part of resolution (a missing required
 *  field is a `refused` outcome, never a throw). */
export interface ContentRef {
  class: string;
  /** Registered capability name — `fragment` / `profile-template`. */
  capability?: string;
  /** Plugin name for a pack-owned `references-template`; omitted/`wf`/`core` =
   *  the core plugin. */
  plugin?: string;
  /** Skill slug for `references-template`. */
  skill?: string;
  /** Relative doc ref — `fragment` (within the capability folder),
   *  `contract` / `shared` (a bare filename), `references-template` (within the
   *  skill's `references/` folder). Unused by `profile-template`. */
  ref?: string;
}

/** A resolution plan — the service turns a `path` into a read, and maps the
 *  other two straight to a typed response. */
export type ContentPlan =
  | { kind: "path"; refClass: ContentRefClass; path: string }
  | {
      kind: "unresolved";
      refClass: ContentRefClass;
      category: ResolverErrorCategory;
      recovery: string;
      message: string;
    }
  | { kind: "refused"; refClass: string; reason: string };

/** The inputs the pure resolver needs beyond the ref itself. */
export interface ContentResolveContext {
  snapshot: ResolverSnapshot;
  /** Normalized absolute workspace root (for relativized snapshot paths). */
  workspaceRoot: string;
  /** Normalized absolute root of the core `wf` plugin (where the server runs
   *  from) — the anchor for `contract` / `shared` / core `references-template`.
   *  Not a second resolution engine: it is the server's own install location. */
  corePluginRoot: string;
}

const CORE_PLUGIN_ALIASES = new Set(["", "wf", "core"]);

/** A ref segment/path is safe when it holds no traversal, no absolute anchor,
 *  and no backslash — the same shape guard the registry-path validator enforces. */
function isSafeRelPath(p: string): boolean {
  if (p.length === 0) return false;
  const n = normalizeSlashes(p);
  if (n.includes("\\")) return false; // normalizeSlashes already stripped these; belt-and-braces
  if (n.startsWith("/") || isAbsoluteRoot(n)) return false;
  return !n.split("/").some((seg) => seg === "." || seg === ".." || seg === "");
}

/** A bare filename: a safe rel path with no directory separator. */
function isBareFilename(p: string): boolean {
  return isSafeRelPath(p) && !p.includes("/");
}

/** A skill slug: a single safe path segment (no separators, no dots). */
function isSkillSlug(s: string | undefined): s is string {
  return typeof s === "string" && /^[a-z0-9][a-z0-9-]*$/.test(s);
}

/** The basename of a slash path. */
function baseName(p: string): string {
  const n = normalizeSlashes(p);
  const i = n.lastIndexOf("/");
  return i >= 0 ? n.slice(i + 1) : n;
}

/** Resolve a relativized snapshot path (workspace-relative OR absolute) to an
 *  absolute forward-slash path. */
function toAbsolute(workspaceRoot: string, snapshotPath: string): string {
  return isAbsoluteRoot(snapshotPath)
    ? normalizeSlashes(snapshotPath)
    : joinSlash(workspaceRoot, snapshotPath);
}

function refused(refClass: string, reason: string): ContentPlan {
  return { kind: "refused", refClass, reason };
}

/** An unresolved plan carrying the `registry-invalid` resolve_gate class — the
 *  category every "the ref names something the resolver could not resolve"
 *  failure maps to (unregistered capability, dangling plugin root whose
 *  self-heal recovered nothing, no declared template). */
function unresolved(refClass: ContentRefClass, message: string): ContentPlan {
  return {
    kind: "unresolved",
    refClass,
    category: "registry-invalid",
    recovery: recoveryFor("registry-invalid"),
    message,
  };
}

/**
 * Resolve a content ref to a plan. Pure: it reads only the snapshot + the two
 * root anchors, never the filesystem. The service reads the resolved `path`.
 */
export function resolveContentRef(ref: ContentRef, ctx: ContentResolveContext): ContentPlan {
  const rawClass = typeof ref.class === "string" ? ref.class.trim() : "";
  if (!CONTENT_REF_CLASSES.includes(rawClass as ContentRefClass)) {
    return refused(
      rawClass || "(missing)",
      `unknown content class \`${rawClass || "(missing)"}\`; served classes are ${CONTENT_REF_CLASSES.join(", ")}. Skill bodies and CI-only fixtures are not served.`,
    );
  }
  const refClass = rawClass as ContentRefClass;
  const { snapshot, workspaceRoot, corePluginRoot } = ctx;

  switch (refClass) {
    case "fragment":
      return resolveFragment(ref, snapshot, workspaceRoot);
    case "profile-template":
      return resolveProfileTemplate(ref, snapshot, workspaceRoot);
    case "contract":
      return resolveCoreDoc(refClass, ref, corePluginRoot, "skills/_contracts");
    case "shared":
      return resolveCoreDoc(refClass, ref, corePluginRoot, "skills/_shared");
    case "references-template":
      return resolveReferencesTemplate(ref, ctx);
  }
}

/** `fragment`: a capability fragment body, at `<capability.resolvedPath>/<ref>`. */
function resolveFragment(
  ref: ContentRef,
  snapshot: ResolverSnapshot,
  workspaceRoot: string,
): ContentPlan {
  const cls: ContentRefClass = "fragment";
  const capability = ref.capability?.trim();
  if (!capability) return refused(cls, "a `fragment` ref requires a `capability` name.");
  if (typeof ref.ref !== "string" || !isSafeRelPath(ref.ref)) {
    return refused(cls, "a `fragment` ref requires a safe relative `ref` (no `..`, no absolute path).");
  }
  if (baseName(ref.ref) === "SKILL.md") {
    return refused(cls, "a skill body (`SKILL.md`) is not served by the content surface.");
  }
  if (!ref.ref.endsWith(".md")) {
    return refused(cls, "a `fragment` ref must name a `.md` doc; CI-only fixtures/scripts are not served.");
  }
  const cap = snapshot.capabilities.find((c) => c.name === capability);
  if (!cap) {
    return unresolved(cls, `capability \`${capability}\` is not in the active registry.`);
  }
  if (cap.validity !== "ok" || !cap.resolvedPath) {
    return unresolved(
      cls,
      `capability \`${capability}\` has no readable manifest (its plugin root dangles and self-heal recovered nothing) — its fragments cannot be served.`,
    );
  }
  return {
    kind: "path",
    refClass: cls,
    path: joinSlash(toAbsolute(workspaceRoot, cap.resolvedPath), ref.ref),
  };
}

/** `profile-template`: the pack's declared `profile.template.json` body, at the
 *  manifest's `profile-template:` path (already resolved in the snapshot). */
function resolveProfileTemplate(
  ref: ContentRef,
  snapshot: ResolverSnapshot,
  workspaceRoot: string,
): ContentPlan {
  const cls: ContentRefClass = "profile-template";
  const capability = ref.capability?.trim();
  if (!capability) return refused(cls, "a `profile-template` ref requires a `capability` name.");
  const cap = snapshot.capabilities.find((c) => c.name === capability);
  if (!cap) {
    return unresolved(cls, `capability \`${capability}\` is not in the active registry.`);
  }
  if (cap.validity !== "ok") {
    return unresolved(
      cls,
      `capability \`${capability}\` has no readable manifest (dangling plugin root, self-heal recovered nothing) — its profile template cannot be served.`,
    );
  }
  if (!cap.profileTemplatePath) {
    return unresolved(cls, `capability \`${capability}\` declares no \`profile-template:\` in its manifest.`);
  }
  return {
    kind: "path",
    refClass: cls,
    path: toAbsolute(workspaceRoot, cap.profileTemplatePath),
  };
}

/** `contract` / `shared`: a core-plugin doc under a fixed `skills/<dir>/` folder,
 *  named by a bare `.md` filename — refusing any sub-path (which would reach the
 *  CI-only `registry-fixtures/` inputs) or non-`.md` (a `.sh` validator). */
function resolveCoreDoc(
  cls: ContentRefClass,
  ref: ContentRef,
  corePluginRoot: string,
  subDir: string,
): ContentPlan {
  const name = typeof ref.ref === "string" ? ref.ref.trim() : "";
  if (!isBareFilename(name)) {
    return refused(cls, `a \`${cls}\` ref requires a bare filename (no sub-path); CI-only fixtures under sub-folders are not served.`);
  }
  if (name === "SKILL.md") {
    return refused(cls, "a skill body (`SKILL.md`) is not served by the content surface.");
  }
  if (!name.endsWith(".md")) {
    return refused(cls, `a \`${cls}\` ref must name a \`.md\` doc; validator scripts / fixture inputs are not served.`);
  }
  return { kind: "path", refClass: cls, path: joinSlash(corePluginRoot, subDir, name) };
}

/** `references-template`: a skill's `references/<ref>` template. The core plugin
 *  by default; a pack plugin via the snapshot's resolved plugin root (reused
 *  recorded-root-first self-heal). */
function resolveReferencesTemplate(ref: ContentRef, ctx: ContentResolveContext): ContentPlan {
  const cls: ContentRefClass = "references-template";
  const { snapshot, workspaceRoot, corePluginRoot } = ctx;
  if (!isSkillSlug(ref.skill)) {
    return refused(cls, "a `references-template` ref requires a `skill` slug (lowercase, hyphenated).");
  }
  if (typeof ref.ref !== "string" || !isSafeRelPath(ref.ref)) {
    return refused(cls, "a `references-template` ref requires a safe relative `ref` (no `..`, no absolute path).");
  }
  if (baseName(ref.ref) === "SKILL.md") {
    return refused(cls, "a skill body (`SKILL.md`) is not served by the content surface.");
  }
  if (!ref.ref.endsWith(".md")) {
    return refused(cls, "a `references-template` ref must name a `.md` doc.");
  }

  const plugin = (ref.plugin ?? "").trim();
  let root: string;
  if (CORE_PLUGIN_ALIASES.has(plugin)) {
    root = corePluginRoot;
  } else {
    const rootRow = snapshot.pluginRoots.find((r) => r.plugin === plugin);
    if (!rootRow || !rootRow.resolvedRoot) {
      return unresolved(
        cls,
        `plugin \`${plugin}\` has no resolved root (unmapped, or its recorded root dangles and self-heal recovered nothing) — its skill references cannot be served.`,
      );
    }
    root = toAbsolute(workspaceRoot, rootRow.resolvedRoot);
  }
  return { kind: "path", refClass: cls, path: joinSlash(root, "skills", ref.skill, "references", ref.ref) };
}
