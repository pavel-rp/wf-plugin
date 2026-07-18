// wf resolver — capability manifest + registry rule evaluation (WF-352).
//
// The rules layer behind `validate_manifest` and `validate_registry`. It sits
// ABOVE the live-resolution parsers (`manifest.ts`, `registry.ts`), which stay
// untouched: where a validator needs strictness the resolver deliberately lacks
// (a `## Fragments` row the resolver tolerates by skipping), that strictness
// lives here and surfaces as a finding — never as a behaviour change in the
// shared parsers.
//
// Every rule id is BORROWED from `validate-registry.sh`, whose numbered CHECK
// bodies own the same rules on the CI side, so a verdict can be diffed against
// guard output by eye and the agreement suite reads as more than coincidence.
// The vocabularies each CHECK tests against are derived live (validate-rules.ts),
// never transcribed.
//
// Scope note — `validate_registry` is the whole-guard equivalent: it runs the
// registry-level checks AND every resolvable manifest's manifest-level checks,
// because that is the set `validate-registry.sh` folds into one exit code.
// `validate_manifest` is the focused manifest-only subset for one manifest.

import {
  deriveRules,
  finding,
  RuleSourceError,
  toPosix,
  verdict,
  type ContractRules,
  type Finding,
  type ValidationVerdict,
} from "./validate-rules.js";

/** The filesystem surface these validators need. Injected so the tests can
 *  drive them over fixtures without standing up the whole service. */
export interface ValidatorFs {
  readFile(absPath: string): string | null;
  isDirectory(absPath: string): boolean;
  isFile(absPath: string): boolean;
}

export interface RegistryValidationOptions {
  /** Absolute path of the registry document to validate. */
  registryFile: string;
  /** Repo root that repo-relative `Path` values resolve against. */
  repoRoot: string;
  /** Absolute path of `capability-registry.ops.md`. */
  opsDocPath: string;
  /** The configured `registryPath` value whose SHAPE CHECK-1 tests. Optional —
   *  when absent the shape check is skipped (the guard warns; a warning is not
   *  a finding). */
  registryPathValue?: string | null;
  /** Install manifest the CHECK-4 self-heal fallback reads. Tests inject the
   *  fixture manifest so a run never depends on the real machine's. */
  installManifest?: string | null;
}

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

function stripCr(s: string): string {
  return s.replace(/\r$/, "");
}

function trimCell(s: string): string {
  return s.trim().replace(/^`/, "").replace(/`$/, "").trim();
}

function join(...parts: string[]): string {
  return toPosix(parts.filter((p) => p.length > 0).join("/")).replace(/\/{2,}/g, "/");
}

/**
 * Read the rows of the table under an exact `## <heading>`, WITH line numbers
 * and WITHOUT dropping rows that have an empty cell.
 *
 * The live-resolution parser (`registry.ts`) drops a row whose second cell is
 * empty — correct for resolution (there is nothing to resolve), wrong for
 * validation (an empty `Root` is exactly the CHECK-4a defect). This is the
 * validator-only strictness the plan places here rather than in the shared
 * parser.
 */
function tableRowsWithLines(
  content: string,
  heading: string,
): Array<{ cells: string[]; line: number }> {
  const rows: Array<{ cells: string[]; line: number }> = [];
  const lines = content.split(/\r?\n/);
  let inSection = false;
  let sawHeader = false;
  lines.forEach((raw, i) => {
    const line = stripCr(raw);
    if (line.startsWith("#")) {
      if (line.trim() === heading) {
        inSection = true;
        sawHeader = false;
      } else if (inSection) {
        inSection = false;
      }
      return;
    }
    if (!inSection) return;
    const t = line.trim();
    if (!t.startsWith("|")) return;
    const cells = t
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => c.trim());
    if (cells.every((c) => /^:?-{1,}:?$/.test(c) || c === "")) return;
    if (!sawHeader) {
      sawHeader = true;
      return;
    }
    rows.push({ cells, line: i + 1 });
  });
  return rows;
}

/** Canonical block headings whose near-misses parse to zero rows (CHECK-HEADING). */
const CANONICAL_HEADINGS = ["## Capabilities", "## Plugin Roots", "## Fragments"];

/**
 * CHECK-HEADING — the heading-typo guard (`validate-registry.sh`'s
 * `check_heading_typos`). Every block is parsed by EXACT heading text; a casing
 * or spacing slip parses zero rows, which would otherwise pass vacuously. Flag
 * any heading whose alphanumerics-only lowercased form equals a canonical
 * keyword but whose raw text is not the exact heading.
 */
function checkHeadingTypos(file: string, content: string, label: string): Finding[] {
  const out: Finding[] = [];
  const canonicalNorms = new Map<string, string>();
  for (const h of CANONICAL_HEADINGS) {
    canonicalNorms.set(h.replace(/^#+\s*/, "").toLowerCase().replace(/[^a-z0-9]/g, ""), h);
  }
  const lines = content.split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = stripCr(raw);
    if (!line.startsWith("#")) return;
    if (CANONICAL_HEADINGS.includes(line)) return;
    const norm = line
      .replace(/^#{1,6}\s*/, "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
    const canonical = canonicalNorms.get(norm);
    if (canonical) {
      out.push(
        finding(
          "CHECK-HEADING",
          file,
          i + 1,
          `${label} heading \`${line}\` looks like a typo of \`${canonical}\` — the exact heading is required, or the block parses to zero rows (a silent pass).`,
        ),
      );
    }
  });
  return out;
}

// ---------------------------------------------------------------------------
// Manifest-level checks (CHECK-6, 6b, 6c + the heading guard)
// ---------------------------------------------------------------------------

interface FragmentRow {
  phase: string;
  kind: string;
  dispatch: string;
  scope: string;
  line: number;
}

/**
 * Read a manifest's `## Fragments` rows WITH line numbers and WITHOUT the
 * resolver's tolerance — a row that does not carry the four contracted columns
 * is reported rather than skipped. Also returns the `article:` declarations and
 * the `requires:`/`conflicts:` lists the registry-level checks consume.
 */
function readManifest(content: string): {
  fragments: FragmentRow[];
  requires: string[];
  conflicts: string[];
  articles: Array<{ key: string; value: string; line: number }>;
  kind: string | null;
  malformedRows: Array<{ line: number; raw: string }>;
} {
  const lines = content.split(/\r?\n/).map(stripCr);
  const fragments: FragmentRow[] = [];
  const requires: string[] = [];
  const conflicts: string[] = [];
  const articles: Array<{ key: string; value: string; line: number }> = [];
  const malformedRows: Array<{ line: number; raw: string }> = [];
  let kind: string | null = null;

  let inFragments = false;
  let sawHeader = false;

  lines.forEach((line, i) => {
    const trimmed = line.trim();

    if (kind === null) {
      const km = /^\*\*Kind:\*\*\s*([A-Za-z-]+)/.exec(trimmed);
      if (km) kind = km[1];
    }

    if (/^requires:/i.test(trimmed)) {
      for (const v of trimmed.replace(/^requires:/i, "").split(",")) {
        const t = v.trim();
        if (t) requires.push(t);
      }
    } else if (/^conflicts:/i.test(trimmed)) {
      for (const v of trimmed.replace(/^conflicts:/i, "").split(",")) {
        const t = v.trim();
        if (t) conflicts.push(t);
      }
    } else if (/^article:/i.test(trimmed)) {
      const decl = trimmed.replace(/^article:/i, "").trim();
      const eq = decl.indexOf("=");
      if (eq > 0) {
        articles.push({
          key: decl.slice(0, eq).trim(),
          value: decl.slice(eq + 1).trim(),
          line: i + 1,
        });
      }
    }

    if (/^#{1,6}\s+/.test(line)) {
      if (/^#{1,6}\s+Fragments\s*$/i.test(trimmed)) {
        inFragments = true;
        sawHeader = false;
        return;
      }
      if (inFragments) inFragments = false;
      return;
    }
    if (!inFragments) return;
    if (!trimmed.startsWith("|")) return;

    const cells = trimmed
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => c.trim());

    if (cells.every((c) => /^:?-{1,}:?$/.test(c) || c === "")) return;
    if (!sawHeader) {
      sawHeader = true;
      return;
    }

    const phase = trimCell(cells[0] ?? "");
    if (!phase || phase.toLowerCase() === "phase") return;

    // An all-placeholder row declares "this capability attaches no fragment"
    // (the contract's `—` = not applicable). It is not a fragment to check.
    const kindCell = trimCell(cells[1] ?? "");
    const isPlaceholder = (c: string) => c === "—" || c === "-" || c === "";
    if (isPlaceholder(phase) && isPlaceholder(kindCell)) return;

    // The contract's fragments table is four columns. Fewer means the row
    // cannot be evaluated at all — the strictness the resolver forgoes.
    if (cells.length < 4) {
      malformedRows.push({ line: i + 1, raw: trimmed });
      return;
    }

    fragments.push({
      phase,
      kind: trimCell(cells[1] ?? ""),
      dispatch: trimCell(cells[2] ?? ""),
      scope: trimCell(cells[3] ?? ""),
      line: i + 1,
    });
  });

  return { fragments, requires, conflicts, articles, kind, malformedRows };
}

/** Normalize a scope cell: an em dash or hyphen placeholder means "absent". */
function normScope(scope: string): string {
  return scope === "—" || scope === "-" ? "" : scope;
}

/** Ownership claims a manifest contributes to the CHECK-5 overlap analysis. */
interface OwnershipClaim {
  capability: string;
  kind: string;
  scope: string;
  file: string;
  line: number;
}

/**
 * Evaluate one manifest's own rules. Returns its findings plus the ownership
 * claims and cross-manifest declarations the registry-level checks consume.
 */
function checkManifest(
  capability: string,
  manifestPath: string,
  content: string,
  rules: ContractRules,
): {
  findings: Finding[];
  claims: OwnershipClaim[];
  requires: string[];
  conflicts: string[];
  articles: Array<{ key: string; value: string; line: number }>;
} {
  const findings: Finding[] = [];
  const claims: OwnershipClaim[] = [];

  findings.push(
    ...checkHeadingTypos(manifestPath, content, `capability \`${capability}\` manifest`),
  );

  const parsed = readManifest(content);

  for (const bad of parsed.malformedRows) {
    findings.push(
      finding(
        "input-unparseable",
        manifestPath,
        bad.line,
        `capability \`${capability}\` has an unparseable \`## Fragments\` row \`${bad.raw}\` — the contracted table is \`| phase | contribution-kind | dispatch | scope |\`.`,
      ),
    );
  }

  for (const row of parsed.fragments) {
    const isPointTargeted = rules.pointTargetedKinds.includes(row.kind);

    // --- CHECK-6: phase + contribution-kind tokens ------------------------
    if (isPointTargeted) {
      if (row.phase !== "—" && row.phase !== "-") {
        findings.push(
          finding(
            "CHECK-6",
            manifestPath,
            row.line,
            `capability \`${capability}\` ${row.kind} fragment names phase \`${row.phase}\` (row: \`${row.phase} | ${row.kind} | ...\`) — a ${row.kind} targets a skill point (its scope), not an SDD phase; put \`—\` in the phase column.`,
          ),
        );
      }
    } else if (!rules.phases.includes(row.phase)) {
      findings.push(
        finding(
          "CHECK-6",
          manifestPath,
          row.line,
          `capability \`${capability}\` fragment names an unknown phase \`${row.phase}\` (row: \`${row.phase} | ${row.kind} | ...\`) — not one of the contract's SDD phases.`,
        ),
      );
    }

    if (!rules.kinds.includes(row.kind)) {
      findings.push(
        finding(
          "CHECK-6",
          manifestPath,
          row.line,
          `capability \`${capability}\` fragment names an unknown contribution-kind \`${row.kind}\` (row: \`${row.phase} | ${row.kind} | ...\`) — not one of the contract's taxonomy kinds.`,
        ),
      );
    }

    // --- CHECK-6b: dispatch column well-formed ---------------------------
    const d = row.dispatch;
    const prefix = rules.dispatchPrefixes.find((p) => d.startsWith(`${p}:`));
    const expected = rules.dispatchPrefixes.map((p) => `\`${p}: <…>\``).join(" or ");
    if (!prefix) {
      findings.push(
        finding(
          "CHECK-6b",
          manifestPath,
          row.line,
          `capability \`${capability}\` fragment at \`${row.phase} | ${row.kind}\` has a malformed dispatch \`${row.dispatch}\` — expected ${expected}.`,
        ),
      );
    } else if (d.slice(prefix.length + 1).trim() === "") {
      findings.push(
        finding(
          "CHECK-6b",
          manifestPath,
          row.line,
          `capability \`${capability}\` fragment at \`${row.phase} | ${row.kind}\` has an \`${prefix}:\` dispatch with no target (dispatch: \`${row.dispatch}\`).`,
        ),
      );
    }

    // --- CHECK-6c / CHECK-5 accumulation: scope --------------------------
    const scope = normScope(row.scope);
    if (isPointTargeted) {
      if (!scope) {
        findings.push(
          finding(
            "CHECK-6c",
            manifestPath,
            row.line,
            `capability \`${capability}\` ${row.kind} fragment at \`${row.phase} | ${row.kind}\` has no scope — a ${row.kind} row must carry a \`<skill>.<point> <merge-policy>\` scope.`,
          ),
        );
      } else {
        const point = scope.split(/\s+/)[0];
        const policy = scope.slice(point.length).trim();
        if (!/^[a-z0-9-]+\.[a-z0-9-]+$/.test(point)) {
          findings.push(
            finding(
              "CHECK-6c",
              manifestPath,
              row.line,
              `capability \`${capability}\` ${row.kind} fragment has a malformed scope \`${row.scope}\` — the skill.point must be \`<skill>.<point>\`, each segment lowercase letters/digits/hyphens joined by a single dot.`,
            ),
          );
        } else if (policy === "") {
          findings.push(
            finding(
              "CHECK-6c",
              manifestPath,
              row.line,
              `capability \`${capability}\` ${row.kind} fragment scope \`${row.scope}\` declares no merge policy — a ${row.kind} row must state ${rules.slotPolicies.map((p) => `\`${p}\``).join(" or ")} after the skill.point.`,
            ),
          );
        } else if (!rules.slotPolicies.includes(policy)) {
          findings.push(
            finding(
              "CHECK-6c",
              manifestPath,
              row.line,
              `capability \`${capability}\` ${row.kind} fragment scope \`${row.scope}\` names an unknown merge policy \`${policy}\` — expected ${rules.slotPolicies.map((p) => `\`${p}\``).join(" or ")}.`,
            ),
          );
        } else {
          // Only a single-owner policy accumulates an ownership claim; the
          // list-like policy composes and can never conflict.
          const singleOwner = rules.slotPolicies[0];
          if (policy === singleOwner) {
            claims.push({
              capability,
              kind: `${row.kind} skill.point (${policy})`,
              scope: point,
              file: manifestPath,
              line: row.line,
            });
          }
        }
      }
    } else if (rules.partitionedKinds.includes(row.kind) && scope) {
      claims.push({
        capability,
        kind: `${row.kind} scope`,
        scope,
        file: manifestPath,
        line: row.line,
      });
    }
  }

  return {
    findings,
    claims,
    requires: parsed.requires,
    conflicts: parsed.conflicts,
    articles: parsed.articles,
  };
}

// ---------------------------------------------------------------------------
// validate_manifest
// ---------------------------------------------------------------------------

/**
 * Validate ONE capability manifest against the live contract vocabulary.
 * `target` may be the manifest file or the capability folder holding it.
 */
export function validateManifest(
  fs: ValidatorFs,
  target: string,
  opsDocPath: string,
): ValidationVerdict {
  const manifestPath = /manifest\.md$/i.test(target) ? toPosix(target) : join(target, "manifest.md");

  let rules: ContractRules;
  try {
    rules = loadRules(fs, opsDocPath);
  } catch (err) {
    return ruleSourceErrorVerdict("validate_manifest", manifestPath, err, opsDocPath);
  }

  const content = fs.readFile(manifestPath);
  if (content === null) {
    return verdict(
      "validate_manifest",
      manifestPath,
      [
        finding(
          "input-unparseable",
          manifestPath,
          null,
          `no readable \`manifest.md\` at \`${manifestPath}\` — nothing to validate.`,
        ),
      ],
      rules.sources,
      "0 manifests checked — the target is not readable.",
      true,
    );
  }

  const capability = deriveCapabilityName(manifestPath);
  const { findings } = checkManifest(capability, manifestPath, content, rules);
  const unparseable = findings.some((f) => f.rule === "input-unparseable");

  return verdict(
    "validate_manifest",
    manifestPath,
    findings,
    rules.sources,
    `1 manifest checked, ${findings.length === 0 ? "0 findings" : `${findings.length} finding(s)`}.`,
    unparseable,
  );
}

/** The capability name a manifest path implies (its containing folder). */
function deriveCapabilityName(manifestPath: string): string {
  const parts = toPosix(manifestPath).split("/");
  return parts.length >= 2 ? parts[parts.length - 2] : manifestPath;
}

// ---------------------------------------------------------------------------
// validate_registry
// ---------------------------------------------------------------------------

/**
 * Validate a whole registry: the `## Capabilities` and `## Plugin Roots` tables,
 * every declared capability's resolvability, and every resolvable manifest's own
 * rules — the same set `validate-registry.sh` folds into one exit code.
 */
export function validateRegistry(
  fs: ValidatorFs,
  opts: RegistryValidationOptions,
): ValidationVerdict {
  const registryFile = toPosix(opts.registryFile);
  const repoRoot = toPosix(opts.repoRoot);

  let rules: ContractRules;
  try {
    rules = loadRules(fs, opts.opsDocPath);
  } catch (err) {
    return ruleSourceErrorVerdict("validate_registry", registryFile, err, opts.opsDocPath);
  }

  const content = fs.readFile(registryFile);
  if (content === null) {
    return verdict(
      "validate_registry",
      registryFile,
      [
        finding(
          "input-unparseable",
          registryFile,
          null,
          `registry file not found or unreadable: \`${registryFile}\`.`,
        ),
      ],
      rules.sources,
      "registry not readable — no verdict on its contents.",
      true,
    );
  }

  const findings: Finding[] = [];
  const sources = [...rules.sources];

  findings.push(...checkHeadingTypos(registryFile, content, "registry"));

  // --- CHECK-1: registryPath shape ---------------------------------------
  const rpv = opts.registryPathValue ?? "";
  if (rpv) {
    let bad = "";
    if (rpv.includes("\\")) bad = "contains a backslash (must use forward slashes)";
    else if (/^\//.test(rpv)) bad = "absolute path (leading '/')";
    else if (/^[A-Za-z]:/.test(rpv)) bad = "drive-prefixed path";
    else if (`/${rpv}/`.includes("/../")) bad = "contains a '..' segment";
    if (bad) {
      findings.push(
        finding(
          "CHECK-1",
          registryFile,
          null,
          `registryPath \`${rpv}\` is not a forward-slash repo-relative file path: ${bad}.`,
        ),
      );
    }
  }

  const capRows = tableRowsWithLines(content, "## Capabilities")
    .map((r) => ({ name: r.cells[0] ?? "", path: r.cells[1] ?? "", line: r.line }))
    .filter((r) => r.name !== "" && r.name !== "Capability");
  const rootRows = tableRowsWithLines(content, "## Plugin Roots")
    .map((r) => ({ plugin: r.cells[0] ?? "", root: r.cells[1] ?? "", line: r.line }))
    .filter((r) => r.plugin !== "" && r.plugin !== "Plugin");
  const parsed = { capabilities: capRows, pluginRoots: rootRows };

  // --- CHECK-4a/4b: plugin-root shape + name uniqueness ------------------
  parsed.pluginRoots.forEach((pr, i) => {
    const line = pr.line;
    let bad = "";
    if (pr.root.includes("\\")) bad = "contains a backslash (must use forward slashes)";
    else if (`/${pr.root}/`.includes("/../")) bad = "contains a '..' segment";
    if (!pr.root || pr.root === "—") {
      findings.push(
        finding(
          "CHECK-4a",
          registryFile,
          line,
          `plugin root for \`${pr.plugin}\` is empty — every \`## Plugin Roots\` row needs a Root.`,
        ),
      );
    } else if (bad) {
      findings.push(
        finding(
          "CHECK-4a",
          registryFile,
          line,
          `plugin root for \`${pr.plugin}\` \`${pr.root}\` is not a valid root: ${bad}.`,
        ),
      );
    }
    for (let j = i + 1; j < parsed.pluginRoots.length; j++) {
      if (parsed.pluginRoots[j].plugin === pr.plugin) {
        findings.push(
          finding(
            "CHECK-4b",
            registryFile,
            line,
            `duplicate plugin root name \`${pr.plugin}\` (rows ${i + 1} and ${j + 1}) — \`## Plugin Roots\` names must be unique so resolution is deterministic.`,
          ),
        );
      }
    }
  });

  // --- CHECK-2/3: capability names unique + filesystem-safe --------------
  parsed.capabilities.forEach((cap, i) => {
    const line = cap.line;
    for (let j = i + 1; j < parsed.capabilities.length; j++) {
      if (parsed.capabilities[j].name === cap.name) {
        findings.push(
          finding(
            "CHECK-2",
            registryFile,
            line,
            `duplicate capability name \`${cap.name}\` (rows ${i + 1} and ${j + 1}) — names must be unique across the registry.`,
          ),
        );
      }
    }
    if (/[^a-z0-9-]/.test(cap.name)) {
      findings.push(
        finding(
          "CHECK-3",
          registryFile,
          line,
          `capability name \`${cap.name}\` is not filesystem-safe — only lowercase letters, digits, and hyphens are allowed (no uppercase, whitespace, or path separators).`,
        ),
      );
    } else if (cap.name.includes("..")) {
      findings.push(
        finding(
          "CHECK-3",
          registryFile,
          line,
          `capability name \`${cap.name}\` is not filesystem-safe — it contains a \`..\` segment.`,
        ),
      );
    }
  });

  // --- CHECK-4: declared paths resolve and carry a manifest.md ----------
  const resolvePluginRoot = (name: string): string | null => {
    const row = parsed.pluginRoots.find((p) => p.plugin === name);
    if (!row) return null;
    return /^(\/|[A-Za-z]:)/.test(row.root) ? row.root : join(repoRoot, row.root);
  };

  const healFromInstallManifest = (name: string): string | null => {
    if (!opts.installManifest) return null;
    const raw = fs.readFile(opts.installManifest);
    if (raw === null) return null;
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      return null; // bounded-dependency degrade — the row stays unrecoverable
    }
    const plugins = (data as { plugins?: Record<string, unknown> })?.plugins;
    if (!plugins || typeof plugins !== "object") return null;
    for (const [key, value] of Object.entries(plugins)) {
      if (key.split("@")[0] !== name) continue;
      const records = Array.isArray(value) ? value : [];
      for (const rec of records) {
        const p = (rec as { installPath?: string })?.installPath;
        if (!p) continue;
        let norm = toPosix(p);
        if (!/^(\/|[A-Za-z]:)/.test(norm)) norm = join(repoRoot, norm);
        if (fs.isDirectory(norm)) return norm;
      }
    }
    return null;
  };

  const resolvedManifests: Array<{ capability: string; path: string }> = [];

  for (const cap of parsed.capabilities) {
    const line = cap.line;
    const p = cap.path;

    if (!p || p === "—") {
      findings.push(
        finding("CHECK-4", registryFile, line, `capability \`${cap.name}\` has no Path in the registry.`),
      );
      continue;
    }

    if (p.startsWith("plugin:")) {
      const tok = p.slice("plugin:".length);
      const slash = tok.indexOf("/");
      const plName = slash === -1 ? tok : tok.slice(0, slash);
      const plRel = slash === -1 ? "" : tok.slice(slash + 1);
      if (!plName || !plRel) {
        findings.push(
          finding(
            "CHECK-4",
            registryFile,
            line,
            `capability \`${cap.name}\` has a malformed plugin-anchored path \`${p}\` — expected \`plugin:<name>/<rel-path>\`.`,
          ),
        );
        continue;
      }

      let resolved: string | null = null;
      let primaryFail = "";
      const root = resolvePluginRoot(plName);
      if (root) {
        const folder = join(root, plRel);
        if (fs.isFile(join(folder, "manifest.md"))) resolved = folder;
        else if (!fs.isDirectory(folder)) {
          primaryFail = `plugin-anchored path \`${p}\` does not resolve to a directory via its recorded root (looked in \`${folder}\` via plugin root \`${plName}\`)`;
        } else {
          primaryFail = `plugin-anchored path \`${p}\` is missing a \`manifest.md\` (expected \`${folder}/manifest.md\`)`;
        }
      } else {
        primaryFail = `names plugin \`${plName}\` in its path \`${p}\`, but there is no \`## Plugin Roots\` entry for \`${plName}\``;
      }

      if (!resolved) {
        const healed = healFromInstallManifest(plName);
        if (healed && fs.isFile(join(healed, plRel, "manifest.md"))) {
          resolved = join(healed, plRel);
        } else {
          findings.push(
            finding(
              "CHECK-4",
              registryFile,
              line,
              `capability \`${cap.name}\` ${primaryFail}, and the install manifest recovers no live root for \`${plName}\` — unrecoverable; re-run the pack's init to refresh its \`## Plugin Roots\` row.`,
            ),
          );
        }
      }
      if (resolved) resolvedManifests.push({ capability: cap.name, path: join(resolved, "manifest.md") });
      continue;
    }

    const folder = join(repoRoot, p);
    if (!fs.isDirectory(folder)) {
      findings.push(
        finding(
          "CHECK-4",
          registryFile,
          line,
          `capability \`${cap.name}\` path does not exist: \`${p}\` (no directory at \`${folder}\`).`,
        ),
      );
    } else if (!fs.isFile(join(folder, "manifest.md"))) {
      findings.push(
        finding(
          "CHECK-4",
          registryFile,
          line,
          `capability \`${cap.name}\` path \`${p}\` is missing a \`manifest.md\` (expected \`${folder}/manifest.md\`).`,
        ),
      );
    } else {
      resolvedManifests.push({ capability: cap.name, path: join(folder, "manifest.md") });
    }
  }

  // --- per-manifest checks + cross-manifest accumulation -----------------
  const claims: OwnershipClaim[] = [];
  const requires: Array<{ capability: string; needed: string; file: string }> = [];
  const conflicts: Array<{ capability: string; foe: string; file: string }> = [];
  const articles: Array<{ capability: string; key: string; value: string; file: string; line: number }> = [];

  for (const rm of resolvedManifests) {
    const mContent = fs.readFile(rm.path);
    if (mContent === null) continue;
    sources.push(rm.path);
    const res = checkManifest(rm.capability, rm.path, mContent, rules);
    findings.push(...res.findings);
    claims.push(...res.claims);
    for (const n of res.requires) requires.push({ capability: rm.capability, needed: n, file: rm.path });
    for (const f of res.conflicts) conflicts.push({ capability: rm.capability, foe: f, file: rm.path });
    for (const a of res.articles)
      articles.push({ capability: rm.capability, key: a.key, value: a.value, file: rm.path, line: a.line });
  }

  // --- CHECK-5: no overlapping ownership scopes -------------------------
  for (let i = 0; i < claims.length; i++) {
    for (let j = i + 1; j < claims.length; j++) {
      const a = claims[i];
      const b = claims[j];
      if (a.scope === b.scope && a.kind === b.kind && a.capability !== b.capability) {
        findings.push(
          finding(
            "CHECK-5",
            a.file,
            a.line,
            `capabilities \`${a.capability}\` and \`${b.capability}\` both claim the same ${a.kind} \`${a.scope}\` — partitioned ownership must not overlap.`,
          ),
        );
      }
    }
  }

  const isActive = (name: string): boolean => parsed.capabilities.some((c) => c.name === name);

  // --- CHECK-7: requires satisfied --------------------------------------
  for (const r of requires) {
    if (!isActive(r.needed)) {
      findings.push(
        finding(
          "CHECK-7",
          r.file,
          null,
          `capability \`${r.capability}\` requires \`${r.needed}\`, which is not an active capability in the registry. Install and register/initialize the capability that provides \`${r.needed}\`, then re-run validation.`,
        ),
      );
    }
  }

  // --- CHECK-8: conflicts not both active -------------------------------
  for (const c of conflicts) {
    if (isActive(c.foe)) {
      findings.push(
        finding(
          "CHECK-8",
          c.file,
          null,
          `capabilities \`${c.capability}\` and \`${c.foe}\` are both active but \`${c.capability}\` declares a conflict with \`${c.foe}\`.`,
        ),
      );
    }
  }

  // --- CHECK-9: contradictory article clauses ---------------------------
  for (let i = 0; i < articles.length; i++) {
    for (let j = i + 1; j < articles.length; j++) {
      const a = articles[i];
      const b = articles[j];
      if (a.capability !== b.capability && a.key === b.key && a.value !== b.value) {
        findings.push(
          finding(
            "CHECK-9",
            a.file,
            a.line,
            `capabilities \`${a.capability}\` and \`${b.capability}\` declare contradictory article clause \`${a.key}\` (\`${a.value}\` vs \`${b.value}\`) — a capability-vs-capability contradiction is a validation error.`,
          ),
        );
      }
    }
  }

  const unparseable = findings.some((f) => f.rule === "input-unparseable");
  return verdict(
    "validate_registry",
    registryFile,
    findings,
    sources,
    `${parsed.capabilities.length} capability row(s), ${resolvedManifests.length} manifest(s) checked, ${findings.length} finding(s).`,
    unparseable,
  );
}

// ---------------------------------------------------------------------------
// Rule-source loading shared by both tools
// ---------------------------------------------------------------------------

export function loadRules(fs: ValidatorFs, opsDocPath: string): ContractRules {
  const content = fs.readFile(opsDocPath);
  if (content === null) {
    throw new RuleSourceError(
      `rule source \`${toPosix(opsDocPath)}\` is not readable — the contract vocabulary cannot be derived, so no verdict is issued.`,
      opsDocPath,
    );
  }
  return deriveRules(content, opsDocPath);
}

export function ruleSourceErrorVerdict(
  tool:
    | "validate_manifest"
    | "validate_registry"
    | "validate_skill_interface"
    | "validate_references",
  target: string,
  err: unknown,
  opsDocPath: string,
): ValidationVerdict {
  const message = err instanceof Error ? err.message : String(err);
  return verdict(
    tool,
    target,
    [finding("rule-source-unresolvable", opsDocPath, null, message)],
    [],
    "no verdict — the live rule source could not be read.",
    true,
  );
}
