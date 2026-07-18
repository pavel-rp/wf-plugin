// wf resolver — validation verdict types + LIVE rule-source derivation (WF-352).
//
// The three validator tools (`validate_manifest`, `validate_registry`,
// `validate_skill_interface`) must not transcribe the contract's rules into
// TypeScript, or they fork from it the first time the contract moves. So every
// vocabulary they check against is DERIVED HERE, at call time, from the
// runtime-ops contract artifact `capability-registry.ops.md` — the same
// precedent `glossary-lint.sh` sets by parsing `GLOSSARY.md` directly rather
// than copying its rules into the script.
//
// What is derived, and from which section:
//   "## The SDD phases (the injection points)"        -> the phase spine
//   "## The contribution taxonomy (the fragment kinds)" -> the contribution
//        kinds, which of them partition (and so require a `scope`), which of
//        them target a skill point instead of a phase, and the slot merge
//        policies
//   "## Manifest schema v2 (the capability side, …)"  -> the accepted `kind:`
//        values and the accepted `dispatch` prefixes
//
// Nothing below hardcodes a phase name, a kind name, or a policy name. The
// shell guard `validate-registry.sh` PINS the same vocabularies as literal
// arrays; a test asserts the derived sets equal the pinned ones, so an ops-doc
// edit the shell guard did not follow fails the build instead of forking
// silently.

/** One rule violation, anchored to a file and (where meaningful) a line. */
export interface Finding {
  /** Stable id borrowed from the guard that owns the rule: `CHECK-1`…`CHECK-9`,
   *  `CHECK-4a`/`4b`/`6b`/`6c`, `CHECK-HEADING`, `D1`…`D5`, or one of the two
   *  typed-error ids (`input-unparseable`, `rule-source-unresolvable`). */
  rule: string;
  /** Single-valued today; the tier exists so WF-354's reference-existence
   *  check can add `warning` without reshaping the verdict. */
  severity: "error";
  /** Absolute, forward-slash-normalized path. */
  file: string;
  /** 1-based line of the offending row, or null when the defect is file-scoped. */
  line: number | null;
  message: string;
}

export type VerdictStatus = "pass" | "fail" | "error";

export type ValidatorTool =
  | "validate_manifest"
  | "validate_registry"
  | "validate_skill_interface";

/**
 * The frozen verdict shape all three validators return (and that WF-354's
 * further tools reuse rather than reshape).
 *
 * Status semantics — `error` is NEVER collapsed into `pass` or `fail`:
 *   pass  — the rules were fully evaluated; nothing was violated.
 *   fail  — the rules were fully evaluated; at least one was violated.
 *   error — the rules could NOT be fully evaluated (unparseable input, or an
 *           unresolvable rule source). A broken input is never a silent pass.
 */
export interface ValidationVerdict {
  tool: ValidatorTool;
  status: VerdictStatus;
  /** Normalized absolute path, or a scope descriptor for a whole-tree run. */
  target: string;
  /** Empty if and only if `status === "pass"`. */
  findings: Finding[];
  /** Absolute paths of every rule artifact parsed on THIS call. */
  ruleSources: string[];
  summary: string;
}

/** Normalize a path to forward slashes (the contract's path style everywhere). */
export function toPosix(p: string): string {
  return p.replace(/\\/g, "/");
}

/** Build one finding. */
export function finding(
  rule: string,
  file: string,
  line: number | null,
  message: string,
): Finding {
  return { rule, severity: "error", file: toPosix(file), line, message };
}

/** Assemble a verdict, enforcing the findings-empty-iff-pass invariant. */
export function verdict(
  tool: ValidatorTool,
  target: string,
  findings: Finding[],
  ruleSources: string[],
  summary: string,
  forceError = false,
): ValidationVerdict {
  const status: VerdictStatus = forceError
    ? "error"
    : findings.length === 0
      ? "pass"
      : "fail";
  return {
    tool,
    status,
    target: toPosix(target),
    findings,
    ruleSources: ruleSources.map(toPosix),
    summary,
  };
}

// ---------------------------------------------------------------------------
// Section extraction
// ---------------------------------------------------------------------------

/**
 * Return the body lines of the `##`-level section whose heading STARTS WITH the
 * given text (headings in the ops doc carry a parenthetical gloss, e.g.
 * "## The SDD phases (the injection points)"), stopping at the next heading.
 * Returns null when no such heading exists — the caller turns that into a
 * `rule-source-unresolvable` error rather than guessing.
 */
export function sectionBody(markdown: string, headingPrefix: string): string[] | null {
  const lines = markdown.split(/\r?\n/);
  const out: string[] = [];
  let inSection = false;
  for (const raw of lines) {
    const line = raw.replace(/\r$/, "");
    if (/^#{1,6}\s+/.test(line)) {
      if (inSection) break;
      const text = line.replace(/^#{1,6}\s+/, "").trim();
      if (text.toLowerCase().startsWith(headingPrefix.toLowerCase())) {
        inSection = true;
      }
      continue;
    }
    if (inSection) out.push(line);
  }
  return inSection ? out : null;
}

/** Every `` `token` `` in a string, in order. */
function backticked(s: string): string[] {
  const out: string[] = [];
  const re = /`([^`]+)`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) out.push(m[1].trim());
  return out;
}

/** Data rows of the first markdown table in a set of lines (header + separator
 *  dropped), each row as trimmed cells. */
function tableRows(lines: string[]): string[][] {
  const rows: string[][] = [];
  let sawHeader = false;
  for (const line of lines) {
    const t = line.trim();
    if (!t.startsWith("|")) {
      if (sawHeader && rows.length > 0) break; // blank line ends the table
      continue;
    }
    const cells = t
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => c.trim());
    if (!sawHeader) {
      sawHeader = true;
      continue;
    }
    if (cells.every((c) => /^:?-{1,}:?$/.test(c) || c === "")) continue;
    rows.push(cells);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// The derived rule set
// ---------------------------------------------------------------------------

export interface ContractRules {
  /** The SDD phase spine a non-slot fragment row may name. */
  phases: string[];
  /** The contribution kinds a fragment row may name. */
  kinds: string[];
  /** Kinds whose aggregation policy partitions — these require a `scope`. */
  partitionedKinds: string[];
  /** Kinds that target a skill point rather than an SDD phase (phase cell `—`). */
  pointTargetedKinds: string[];
  /** The merge policies a slot scope may declare. */
  slotPolicies: string[];
  /** Accepted `kind:` manifest values. */
  manifestKinds: string[];
  /** Accepted `dispatch` prefixes (e.g. `inline`, `subagent`). */
  dispatchPrefixes: string[];
  /** Absolute path of every artifact parsed to produce this rule set. */
  sources: string[];
}

/** Thrown when a rule source cannot be located or a required section is absent.
 *  Callers turn this into a `rule-source-unresolvable` typed-error verdict. */
export class RuleSourceError extends Error {
  constructor(
    message: string,
    readonly source: string,
  ) {
    super(message);
    this.name = "RuleSourceError";
  }
}

/**
 * Derive the full contract vocabulary from the ops doc's own prose and tables.
 *
 * @param opsMarkdown content of `capability-registry.ops.md`
 * @param opsPath     its absolute path (recorded into `sources`)
 */
export function deriveRules(opsMarkdown: string, opsPath: string): ContractRules {
  const need = (prefix: string): string[] => {
    const body = sectionBody(opsMarkdown, prefix);
    if (body === null) {
      throw new RuleSourceError(
        `rule source ${toPosix(opsPath)} has no \`## ${prefix}…\` section — the vocabulary cannot be derived, so no verdict is issued.`,
        opsPath,
      );
    }
    return body;
  };

  // --- phases -------------------------------------------------------------
  // The spine is one prose line of `·`-separated entries, each LEADING with the
  // phase token in backticks (later backticks in an entry are the kind gloss,
  // e.g. "`plan` (`artifact`)"), so take the first backticked token per entry.
  const phaseBody = need("The SDD phases");
  // The spine line is the one enumerating entries with the `·` separator; fall
  // back to whichever line carries the most backticked tokens. (Picking merely
  // "a line with backticks" would grab the preamble sentence, which mentions a
  // kind and a placeholder but no phase.)
  const phaseLine =
    phaseBody.find((l) => l.includes("·")) ??
    phaseBody.reduce((best, l) => (backticked(l).length > backticked(best).length ? l : best), "");
  const phases: string[] = [];
  for (const seg of phaseLine.split("·")) {
    const tok = backticked(seg)[0];
    if (tok && /^[a-z][a-z0-9-]*$/.test(tok) && !phases.includes(tok)) phases.push(tok);
  }
  if (phases.length === 0) {
    throw new RuleSourceError(
      `rule source ${toPosix(opsPath)} §"The SDD phases" yielded no phase tokens — refusing to validate against an empty vocabulary.`,
      opsPath,
    );
  }

  // --- kinds, partitioning, point-targeting, slot policies ----------------
  // The taxonomy table: | Kind | Phase(s) | Aggregation policy |
  const taxRows = tableRows(need("The contribution taxonomy"));
  const kinds: string[] = [];
  const partitionedKinds: string[] = [];
  const pointTargetedKinds: string[] = [];
  const slotPolicies: string[] = [];
  for (const row of taxRows) {
    const kind = backticked(row[0] ?? "")[0];
    if (!kind) continue;
    kinds.push(kind);
    const phaseCell = (row[1] ?? "").trim();
    const policyCell = row[2] ?? "";
    // "partition"/"partitions" in the aggregation policy => single-owner scope.
    if (/partition/i.test(policyCell)) partitionedKinds.push(kind);
    // A phase cell opening with an em dash declares "not an SDD phase".
    if (/^[—-]/.test(phaseCell)) {
      pointTargetedKinds.push(kind);
      // The merge policies are the bare backticked words in this row's policy
      // cell (the `skill.point` token carries a dot and is excluded).
      for (const tok of backticked(policyCell)) {
        if (/^[a-z]+$/.test(tok) && !slotPolicies.includes(tok)) slotPolicies.push(tok);
      }
    }
  }
  if (kinds.length === 0) {
    throw new RuleSourceError(
      `rule source ${toPosix(opsPath)} §"The contribution taxonomy" yielded no contribution kinds — refusing to validate against an empty vocabulary.`,
      opsPath,
    );
  }

  // --- manifest `kind:` values and `dispatch` prefixes --------------------
  const schemaBody = need("Manifest schema v2");
  let manifestKinds: string[] = [];
  const dispatchPrefixes: string[] = [];
  for (const line of schemaBody) {
    if (manifestKinds.length === 0 && /\*\*`kind:`\*\*/.test(line)) {
      manifestKinds = backticked(line)
        .filter((t) => t !== "kind:")
        .filter((t) => /^[a-z][a-z-]*$/.test(t));
    }
    if (/`dispatch`/.test(line)) {
      for (const tok of backticked(line)) {
        const m = /^([a-z][a-z-]*):\s*</.exec(tok);
        if (m && !dispatchPrefixes.includes(m[1])) dispatchPrefixes.push(m[1]);
      }
    }
  }
  if (dispatchPrefixes.length === 0) {
    throw new RuleSourceError(
      `rule source ${toPosix(opsPath)} §"Manifest schema v2" yielded no \`dispatch\` prefixes — refusing to validate against an empty vocabulary.`,
      opsPath,
    );
  }

  return {
    phases,
    kinds,
    partitionedKinds,
    pointTargetedKinds,
    slotPolicies,
    manifestKinds,
    dispatchPrefixes,
    sources: [toPosix(opsPath)],
  };
}
