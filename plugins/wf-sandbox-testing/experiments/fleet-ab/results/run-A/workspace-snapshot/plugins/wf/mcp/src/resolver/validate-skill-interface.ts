// wf resolver — skill interface slot-marker checks, D1–D5 (WF-352).
//
// The in-session twin of `skill-slot-marker-lint.sh`. It keeps a skill's body
// slot markers honest against its `interface.md` `## Slots` declaration, using
// the guard's own defect ids so the two surfaces' verdicts diff by eye:
//
//   D1 malformed declaration  — a `## Slots` row whose id is not a well-formed
//      `skill.point`, whose first segment is not the folder name, or whose merge
//      policy is absent / not one of the contract's policies.
//   D2 malformed marker       — a `<!-- wf:slot… -->` comment that is not
//      EXACTLY an opening or closing marker with a well-formed id on its line.
//   D3 undeclared marker      — a well-formed marker with no matching `## Slots`
//      declaration in the same skill.
//   D4 unbalanced marker      — an open with no close (or a close with no open),
//      or a duplicate opening marker for one slot.
//   D5 declared-but-unmarked  — a declared slot with no opening marker.
//
// Inert by construction: a skill with no `## Slots` rows and no markers yields
// zero declared ids and zero marker hits, so every loop body is empty — the
// whole current skill tree passes unchanged, exactly as the shell guard does.
//
// Body-read policy: this reads `SKILL.md` with the server's own Node fs and
// emits ONLY file/line/message diagnostics — never body content. That is
// unrelated to `resolve_content`'s refusal to *serve* a skill body to the
// model, which is unchanged.

import {
  finding,
  toPosix,
  verdict,
  type Finding,
  type ValidationVerdict,
} from "./validate-rules.js";
import { loadRules, ruleSourceErrorVerdict, type ValidatorFs } from "./validate-capability.js";

/** A well-formed slot id: two dot-joined segments of lowercase alnum/hyphen. */
const ID_RE = /[a-z0-9-]+\.[a-z0-9-]+/;
const OPEN_RE = new RegExp(`^<!-- wf:slot (${ID_RE.source}) -->$`);
const CLOSE_RE = new RegExp(`^<!-- wf:slot-end (${ID_RE.source}) -->$`);
const ID_EXACT_RE = new RegExp(`^${ID_RE.source}$`);

/** Lint one skill folder. `dir` is absolute; its basename is the skill name. */
export function checkSkillDir(
  fs: ValidatorFs,
  dir: string,
  slotPolicies: string[],
): Finding[] {
  const out: Finding[] = [];
  const skillDir = toPosix(dir).replace(/\/$/, "");
  const skill = skillDir.split("/").pop() ?? skillDir;
  const bodyPath = `${skillDir}/SKILL.md`;
  const ifacePath = `${skillDir}/interface.md`;

  const body = fs.readFile(bodyPath);
  if (body === null) return out; // not a skill folder — inert

  const policyList = slotPolicies.map((p) => `'${p}'`).join(" or ");

  // --- 1. declared slots from interface.md's ## Slots table ---------------
  const declared: string[] = [];
  const declLines = new Map<string, number>();
  const iface = fs.readFile(ifacePath);
  if (iface !== null) {
    let inSlots = false;
    iface.split(/\r?\n/).forEach((raw, i) => {
      const line = raw.replace(/\r$/, "");
      if (line.startsWith("## Slots")) {
        inSlots = true;
        return;
      }
      if (line.startsWith("## ")) inSlots = false;
      if (!inSlots) return;
      if (!line.startsWith("|")) return;

      const cells = line.replace(/^\|/, "").split("|");
      const c1 = (cells[0] ?? "").trim();
      const c2 = (cells[1] ?? "").trim();

      // Skip the header row and the |---| separator: a declared id carries no
      // space or paren, contains an alnum, and is not a pure-dash rule.
      if (!c1 || c1.includes(" ") || c1.includes("(")) return;
      if (!/[a-z0-9]/.test(c1)) return;

      if (!ID_EXACT_RE.test(c1)) {
        out.push(
          finding(
            "D1",
            ifacePath,
            i + 1,
            `malformed slot declaration '${c1}' — a slot id must be <skill>.<point> (each segment lowercase letters/digits/hyphens, exactly one dot).`,
          ),
        );
        return;
      }
      const seg1 = c1.split(".")[0];
      if (seg1 !== skill) {
        out.push(
          finding(
            "D1",
            ifacePath,
            i + 1,
            `slot id '${c1}' names skill '${seg1}' but is declared under skill '${skill}' — the id's first segment must match the skill folder name.`,
          ),
        );
        return;
      }
      if (c2 === "") {
        out.push(
          finding("D1", ifacePath, i + 1, `slot '${c1}' declares no merge policy (expected ${policyList}).`),
        );
        return;
      }
      if (!slotPolicies.includes(c2)) {
        out.push(
          finding(
            "D1",
            ifacePath,
            i + 1,
            `slot '${c1}' has unknown merge policy '${c2}' (expected ${policyList}).`,
          ),
        );
        return;
      }
      declared.push(c1);
      declLines.set(c1, i + 1);
    });
  }

  // --- 2. scan SKILL.md markers -----------------------------------------
  const opens: string[] = [];
  const closes: string[] = [];
  body.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.replace(/\r$/, "");
    if (!/<!--\s*wf:slot/.test(line)) return;
    const trimmed = line.trim();

    const openMatch = OPEN_RE.exec(trimmed);
    if (openMatch) {
      const id = openMatch[1];
      if (opens.includes(id)) {
        out.push(finding("D4", bodyPath, i + 1, `duplicate opening marker for slot '${id}'.`));
      }
      opens.push(id);
      if (!declared.includes(id)) {
        out.push(
          finding(
            "D3",
            bodyPath,
            i + 1,
            `slot marker '${id}' is not declared in ${skill}/interface.md (## Slots).`,
          ),
        );
      }
      return;
    }

    const closeMatch = CLOSE_RE.exec(trimmed);
    if (closeMatch) {
      closes.push(closeMatch[1]);
      return;
    }

    out.push(
      finding(
        "D2",
        bodyPath,
        i + 1,
        `malformed slot marker: '${trimmed}' — expected exactly '<!-- wf:slot <skill.point> -->' or '<!-- wf:slot-end <skill.point> -->' alone on its line.`,
      ),
    );
  });

  // --- 3. balance + declared-has-marker ---------------------------------
  for (const id of opens) {
    if (!closes.includes(id)) {
      out.push(
        finding(
          "D4",
          bodyPath,
          null,
          `opening marker for slot '${id}' has no matching '<!-- wf:slot-end ${id} -->' close.`,
        ),
      );
    }
  }
  for (const id of closes) {
    if (!opens.includes(id)) {
      out.push(finding("D4", bodyPath, null, `closing marker for slot '${id}' has no matching opening marker.`));
    }
  }
  for (const id of declared) {
    if (!opens.includes(id)) {
      out.push(
        finding(
          "D5",
          ifacePath,
          declLines.get(id) ?? null,
          `declared slot '${id}' has no '<!-- wf:slot ${id} -->' marker in ${skill}/SKILL.md.`,
        ),
      );
    }
  }

  return out;
}

export interface SkillInterfaceOptions {
  /** Absolute path of `capability-registry.ops.md` (the live rule source). */
  opsDocPath: string;
  /** Absolute skill folders to check. */
  skillDirs: string[];
  /** What the verdict's `target` describes (a folder, or a tree scope). */
  target: string;
}

/** Validate the slot-marker/interface correspondence over one or many skills. */
export function validateSkillInterface(
  fs: ValidatorFs,
  opts: SkillInterfaceOptions,
): ValidationVerdict {
  let policies: string[];
  let sources: string[];
  try {
    const rules = loadRules(fs, opts.opsDocPath);
    policies = rules.slotPolicies;
    sources = rules.sources;
  } catch (err) {
    return ruleSourceErrorVerdict("validate_skill_interface", opts.target, err, opts.opsDocPath);
  }

  if (opts.skillDirs.length === 0) {
    return verdict(
      "validate_skill_interface",
      opts.target,
      [
        finding(
          "input-unparseable",
          opts.target,
          null,
          `no skill folder found at \`${toPosix(opts.target)}\` — a skill folder is one holding a \`SKILL.md\`.`,
        ),
      ],
      sources,
      "0 skills checked — the target names no skill folder.",
      true,
    );
  }

  const findings: Finding[] = [];
  for (const dir of opts.skillDirs) {
    findings.push(...checkSkillDir(fs, dir, policies));
  }

  return verdict(
    "validate_skill_interface",
    opts.target,
    findings,
    sources,
    `${opts.skillDirs.length} skill(s) checked, ${findings.length} finding(s).`,
  );
}
