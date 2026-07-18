// wf resolver — cross-reference existence checking (WF-354).
//
// The defect class this closes is WF-337: `plugins/wf/skills/fleet/SKILL.md`
// shipped instructions invoking `/wf:tc`, a skill that had been removed. Nothing
// structural caught it — the manifest was valid, the registry resolved, the slot
// markers balanced. Only a hand fix found it. This module resolves every
// INVOCATION reference in a skill body or agent file against the real tree and
// reports the ones that resolve to nothing.
//
// --- The classifier is DERIVED, never transcribed (D-1) ---
// `out4-skill-read-guard.sh` already owns an instruction-vs-prose classifier for
// the adjacent question ("is this a SKILL.md READ instruction?"). It holds it as
// two single-quoted shell assignments, `p1` and `p2`. This module PARSES THOSE
// ASSIGNMENTS OUT OF THE GUARD at call time and records the guard in
// `ruleSources` — the same live-rule-sourcing discipline `deriveRules` applies
// to `capability-registry.ops.md`. The guard file is never modified, and if the
// assignments cannot be located the tool returns `rule-source-unresolvable`
// rather than falling back to a copied pattern (which is exactly how the two
// surfaces would fork silently).
//
// `p2` — the `${CLAUDE_PLUGIN_ROOT}/skills/…/SKILL.md` load token — is used
// DIRECTLY as this tool's plugin-root path-token pattern. `p1` supplies the
// reused AXIS, not a second copy of the guard's own rule: a word-bounded
// directive verb governing a reference token on the same line, with
// `load(s)`/`loading` deliberately excluded as non-directive. WF-354 extends
// that axis with its own invocation verb family and token shapes, declared in
// exactly one place below (`INVOCATION_AXIS`). The guard remains authoritative
// for its own read-instruction question.
//
// --- Severity and indeterminacy (D-3) ---
// Severity stays single-valued. A reference whose OWNING PLUGIN ROOT is not
// resolvable in this workspace is indeterminate, not proven dead — it is
// excluded from `findings` entirely and counted in `summary`. That preserves the
// findings-empty-iff-pass invariant exactly, with no `warning` tier.

import {
  finding,
  RuleSourceError,
  toPosix,
  verdict,
  type Finding,
  type ValidationVerdict,
} from "./validate-rules.js";
import { ruleSourceErrorVerdict, type ValidatorFs } from "./validate-capability.js";

// ---------------------------------------------------------------------------
// The guard-derived rule source
// ---------------------------------------------------------------------------

export interface ReferenceRules {
  /** Literal text of the guard's `p2` assignment — the version-pinned
   *  `${CLAUDE_PLUGIN_ROOT}/skills/…/SKILL.md` load token. Already valid JS
   *  regex source, so it is used verbatim. */
  pluginRootPattern: string;
  /** Literal text of the guard's `p1` assignment with PCRE's inline `(?i)`
   *  stripped — JavaScript's `RegExp` rejects an inline flag group, so the
   *  case-insensitivity it encoded moves to `axisFlags`. Recorded so the reused
   *  axis is provably the guard's, not a paraphrase. */
  directiveAxisPattern: string;
  /** Flags lifted out of `p1`'s inline PCRE flag group (`i`, or empty). */
  axisFlags: string;
  /** Absolute path of every rule artifact parsed on this call. */
  sources: string[];
}

/** Lift a single-quoted top-level shell assignment (`name='…'`) verbatim. */
function liftAssignment(source: string, name: string, path: string): string {
  const m = new RegExp(`^${name}='([^']*)'`, "m").exec(source);
  if (m === null) {
    throw new RuleSourceError(
      `rule source \`${toPosix(path)}\` has no single-quoted \`${name}=…\` classifier assignment — the instruction-vs-prose rule cannot be derived, so no verdict is issued.`,
      path,
    );
  }
  return m[1];
}

/**
 * Derive the reference classifier from `out4-skill-read-guard.sh` itself.
 *
 * @param guardSource content of the guard script
 * @param guardPath   its absolute path (recorded into `sources`)
 */
export function deriveReferenceRules(guardSource: string, guardPath: string): ReferenceRules {
  const p1 = liftAssignment(guardSource, "p1", guardPath);
  const p2 = liftAssignment(guardSource, "p2", guardPath);
  const inlineFlags = /^\(\?([a-z]+)\)/.exec(p1);
  return {
    pluginRootPattern: p2,
    directiveAxisPattern: p1.replace(/^\(\?[a-z]+\)/, ""),
    axisFlags: inlineFlags ? inlineFlags[1] : "",
    sources: [toPosix(guardPath)],
  };
}

// ---------------------------------------------------------------------------
// The WF-354 extension of the guard's axis — declared exactly once
// ---------------------------------------------------------------------------

/**
 * The single declaration of WF-354's own half of the classifier: the invocation
 * verb family and the reference token shapes. Nothing below re-declares either
 * set — a change here is the only change needed.
 *
 * The verbs are INVOCATION verbs, distinct from the guard's read/glob verbs
 * because the question is different, but they sit on the same axis: word-bounded
 * on the same line as the token they govern. `load(s)`/`loading` stay excluded
 * as non-directive, exactly as the guard excludes them — "the harness loads the
 * skill's `SKILL.md` by invocation" is prose about mechanism, not an instruction.
 */
export const INVOCATION_AXIS = {
  /** Base forms; inflections are generated, never listed twice. */
  verbs: ["invoke", "call", "run", "dispatch"],
  /** Deliberately non-directive — mirrors the guard's own exclusion. */
  excludedVerbs: ["load", "loads", "loading"],
  /** `/wf:<skill>` and `/wf-<pack>:<skill>`. A concrete lowercase slug only:
   *  a placeholder (`/wf:<name>`, `/wf:*`) names no real skill and is not a
   *  reference to resolve. The leading look-behind keeps a path segment
   *  (`.../skills/wf:x`) or a longer token from matching mid-string. */
  skillToken: "(?<![\\w./-])/(wf(?:-[a-z0-9][a-z0-9-]*)?):([a-z][a-z0-9-]*)",
  /** `subagent_type: wf:<agent>` — the Task-tool dispatch declaration, with or
   *  without backticks around the value. */
  agentToken: "subagent_type:?\\s*[`'\"]?(wf(?:-[a-z0-9][a-z0-9-]*)?):([a-z][a-z0-9-]*)",
} as const;

/** Generate the inflected verb alternation from the base family. */
function verbAlternation(): string {
  const forms = new Set<string>();
  for (const v of INVOCATION_AXIS.verbs) {
    forms.add(v);
    forms.add(`${v}s`);
    forms.add(v.endsWith("e") ? `${v}d` : `${v}ed`);
    forms.add(v.endsWith("e") ? `${v.slice(0, -1)}ing` : `${v}ing`);
    if (v === "dispatch") forms.add("dispatches");
  }
  for (const x of INVOCATION_AXIS.excludedVerbs) forms.delete(x);
  return [...forms].join("|");
}

// ---------------------------------------------------------------------------
// The check
// ---------------------------------------------------------------------------

export interface ReferenceCheckOptions {
  /** Root the `plugins/<plugin>/…` reference targets resolve against. */
  repoRoot: string;
  /** Absolute paths of the skill bodies / agent files to scan. */
  files: string[];
  /** What the verdict's `target` describes (a file, a folder, or a tree scope). */
  target: string;
  /** Absolute path of `out4-skill-read-guard.sh` — the live rule source. */
  guardPath: string;
}

/**
 * Split a line into sentence spans — the scope within which a directive verb
 * governs a token.
 *
 * The guard classifies line-wise because grep does; government is really a
 * sentence relation, and a whole line routinely carries two independent
 * clauses ("You are invoked only via the Task tool. There is no `/wf:x` slash
 * command."). Splitting on sentence-final punctuation followed by whitespace
 * keeps `.ops.md`, `SKILL.md`, and version tokens intact, because those carry
 * no space after the dot.
 */
function sentences(line: string): string[] {
  return line.split(/(?<=[.!?])\s+/);
}

/** The plugin a scanned file belongs to (`<repoRoot>/plugins/<plugin>/…`), or
 *  `null` when the file sits outside any plugin — the indeterminate case. */
function pluginOf(file: string, repoRoot: string): string | null {
  const norm = toPosix(file);
  const prefix = `${repoRoot}/plugins/`;
  if (!norm.startsWith(prefix)) return null;
  const rest = norm.slice(prefix.length);
  const seg = rest.split("/")[0];
  return seg && seg !== ".." ? seg : null;
}

/**
 * Resolve every invocation reference in the given files against the real tree.
 * Returns the frozen `ValidationVerdict` — assembled by the shared `verdict()`,
 * so findings-empty-iff-pass is structural rather than restated.
 */
export function validateReferences(
  fs: ValidatorFs,
  opts: ReferenceCheckOptions,
): ValidationVerdict {
  let rules: ReferenceRules;
  try {
    const guardSource = fs.readFile(opts.guardPath);
    if (guardSource === null) {
      throw new RuleSourceError(
        `rule source \`${toPosix(opts.guardPath)}\` is not readable — the instruction-vs-prose classifier cannot be derived, so no verdict is issued.`,
        opts.guardPath,
      );
    }
    rules = deriveReferenceRules(guardSource, opts.guardPath);
  } catch (err) {
    return ruleSourceErrorVerdict("validate_references", opts.target, err, opts.guardPath);
  }

  const repoRoot = toPosix(opts.repoRoot).replace(/\/$/, "");
  const verbRe = new RegExp(`\\b(?:${verbAlternation()})\\b`, "i");
  const skillRe = new RegExp(INVOCATION_AXIS.skillToken, "g");
  const agentRe = new RegExp(INVOCATION_AXIS.agentToken, "gi");
  const pluginRootRe = new RegExp(rules.pluginRootPattern, "g");

  const findings: Finding[] = [];
  let filesScanned = 0;
  let checked = 0;
  let indeterminate = 0;

  for (const file of opts.files) {
    const content = fs.readFile(file);
    if (content === null) continue;
    filesScanned++;
    const owner = pluginOf(file, repoRoot);

    content.split(/\r?\n/).forEach((raw, i) => {
      const line = raw.replace(/\r$/, "");
      const ln = i + 1;

      // --- REF-2: the version-pinned `${CLAUDE_PLUGIN_ROOT}` load token ------
      // No verb is required: the guard's own `p2` treats this token standing
      // alone as a load step, and a dead path is dead either way. `${...}`
      // resolves to the install root of the plugin that OWNS the file.
      pluginRootRe.lastIndex = 0;
      let pm: RegExpExecArray | null;
      const seenPaths = new Set<string>();
      while ((pm = pluginRootRe.exec(line)) !== null) {
        const token = pm[0];
        if (seenPaths.has(token)) continue;
        seenPaths.add(token);
        if (owner === null) {
          indeterminate++;
          continue;
        }
        checked++;
        const rel = token.replace(/^\$\{CLAUDE_PLUGIN_ROOT\}\/?/, "");
        const abs = `${repoRoot}/plugins/${owner}/${rel}`;
        if (!fs.isFile(abs)) {
          findings.push(
            finding(
              "REF-2",
              file,
              ln,
              `plugin-root path \`${token}\` resolves to nothing — \`${abs}\` does not exist in plugin \`${owner}\`.`,
            ),
          );
        }
      }

      // --- REF-1: skill / agent invocation references -----------------------
      // The reused axis, in full: the guard's `p1` is `\b(verb)\b.*<token>` —
      // a word-bounded directive verb GOVERNING a token that follows it. Three
      // things have to hold, and each is load-bearing against real live prose:
      //
      //   * a verb is present at all — a bare mention (a README skill table,
      //     "the same call shape `/wf:spec` uses") is never flagged;
      //   * the verb precedes the token — a verb that trails it governs
      //     something else;
      //   * the verb is in the SAME SENTENCE as the token. The guard works
      //     line-wise because grep does; "governs" is really a sentence
      //     relation, and the live counter-example needs it:
      //     `plugins/wf/agents/phase-runner.md` line 12 reads "You are invoked
      //     only via the **Task** tool from `wf:run`. There is no
      //     `/wf:phase-runner` slash command, and a user should never invoke
      //     you directly." The first sentence's "invoked" governs nothing here,
      //     and the second sentence NEGATES the token's existence — its own
      //     "invoke" trails the token and governs "you". Sentence scoping plus
      //     ordering passes both, while still catching "Invoke `/wf:tc` …".
      const seenRefs = new Set<string>();
      for (const sentence of sentences(line)) {
        const verbAt = verbRe.exec(sentence);
        if (verbAt === null) continue;
        const governsFrom = verbAt.index;

        for (const [re, kind] of [
          [skillRe, "skill"],
          [agentRe, "agent"],
        ] as const) {
          re.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = re.exec(sentence)) !== null) {
            if (m.index < governsFrom) continue; // the verb does not govern this token
            const plugin = m[1];
            const name = m[2];
            const key = `${kind}:${plugin}:${name}`;
            if (seenRefs.has(key)) continue;
            seenRefs.add(key);

            const pluginDir = `${repoRoot}/plugins/${plugin}`;
            if (!fs.isDirectory(pluginDir)) {
              // D-3: the owning plugin is not installed/vendored in THIS
              // workspace, so the reference is indeterminate — not proven dead.
              indeterminate++;
              continue;
            }
            checked++;

            const expected =
              kind === "skill"
                ? `${pluginDir}/skills/${name}/SKILL.md`
                : `${pluginDir}/agents/${name}.md`;
            if (fs.isFile(expected)) continue;

            findings.push(
              finding(
                "REF-1",
                file,
                ln,
                kind === "skill"
                  ? `invocation reference \`/${plugin}:${name}\` names a skill that does not exist — no \`${expected}\`.`
                  : `invocation reference \`subagent_type: ${plugin}:${name}\` names an agent that does not exist — no \`${expected}\`.`,
              ),
            );
          }
        }
      }
    });
  }

  if (opts.files.length === 0) {
    return verdict(
      "validate_references",
      opts.target,
      [
        finding(
          "input-unparseable",
          opts.target,
          null,
          `no skill body or agent file found at \`${toPosix(opts.target)}\` — nothing to check.`,
        ),
      ],
      rules.sources,
      "0 files scanned — the target names no skill body or agent file.",
      true,
    );
  }

  return verdict(
    "validate_references",
    opts.target,
    findings,
    rules.sources,
    `${filesScanned} file(s) scanned, ${checked} reference(s) resolved against the tree, ${indeterminate} indeterminate (owning plugin root not resolvable in this workspace), ${findings.length} finding(s).`,
  );
}
