// Source hygiene — the control-character guard (WF-454).
//
// WF-454 found TWO LITERAL NUL BYTES already shipped in `plan-install.ts`, used
// as composite-key separators. The damage is not that the code misbehaved — it
// did not. The damage is that git classified the whole file as BINARY, so it was
// invisible to `grep`, to `git diff`, and therefore to every reviewer who has
// looked at it since. A defect nobody can read is a defect nobody can find.
//
// So the fix is paired with a guard rather than left to discipline: no resolver
// source file may carry a C0 control character other than the three that are
// genuinely textual — tab, line feed, carriage return. A composite key is built
// with `JSON.stringify` (injective over the pair, and escapes both hazards); a
// separator character is never the answer.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MCP_DIR = process.env.WF_MCP_DIR;
if (!MCP_DIR) throw new Error("WF_MCP_DIR is required");

/** Tab, line feed, carriage return. Every other byte below 0x20, plus DEL, is a
 *  control character with no business in a TypeScript source file. */
const TEXTUAL = new Set([0x09, 0x0a, 0x0d]);

function sourceFiles(dir: string, prefix: string): string[] {
  const out: string[] = [];
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix === "" ? item.name : `${prefix}/${item.name}`;
    if (item.isDirectory()) out.push(...sourceFiles(join(dir, item.name), rel));
    else if (item.name.endsWith(".ts")) out.push(rel);
  }
  return out;
}

/** The first offending byte, or `null` when the file is clean. */
function firstControlByte(bytes: Buffer): { byte: number; offset: number } | null {
  for (let offset = 0; offset < bytes.length; offset++) {
    const byte = bytes[offset];
    if (TEXTUAL.has(byte)) continue;
    if (byte < 0x20 || byte === 0x7f) return { byte, offset };
  }
  return null;
}

for (const root of ["src", "test"] as const) {
  test(`no \`${root}\` file carries a control character git would read as binary`, () => {
    const files = sourceFiles(join(MCP_DIR, root), "");
    assert.ok(files.length > 0, `\`${root}\` must contain TypeScript sources`);

    const offenders: string[] = [];
    for (const rel of files) {
      const found = firstControlByte(readFileSync(join(MCP_DIR, root, rel)));
      if (found !== null) {
        offenders.push(
          `${root}/${rel}: byte 0x${found.byte.toString(16).padStart(2, "0")} at offset ${found.offset}`,
        );
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `a control character makes git classify the file as binary — invisible to \`grep\` and to every reviewer:\n${offenders.join("\n")}`,
    );
  });
}

test("the guard itself detects a planted control byte", () => {
  // Guarding the guard: an assertion that can never fail is not a test. The byte
  // is CONSTRUCTED rather than typed, because typing one is the very defect
  // under test.
  const planted = Buffer.concat([
    Buffer.from("const key = 'a", "utf8"),
    Buffer.from([0x00]),
    Buffer.from("b';\n", "utf8"),
  ]);
  const found = firstControlByte(planted);
  assert.ok(found !== null);
  assert.equal(found?.byte, 0x00);
  // And the textual three are NOT flagged.
  assert.equal(firstControlByte(Buffer.from("a\tb\r\nc\n", "utf8")), null);
});

// --- The unimported-call guard (WF-459) -------------------------------------
//
// The bundler does NOT typecheck, so a call to a sibling module's export that
// was never imported survives the build intact and throws a `ReferenceError`
// only when that exact line is first reached at runtime. WF-459 shipped one:
// `service.ts` called `collectRemainingDivergence` on every NON-`applied` return
// without importing it, so every rejection turned into `apply/write-failed` with
// an `apply-threw` diagnostic — the right refusal reported under the WRONG class,
// which is precisely the confusion the frozen protocol forbids. The unit suite
// could not see it: every service-level double stops the run before the planner,
// so that line was never executed.
//
// The guard is therefore static and narrow. It flags only a bare call to a name
// that THIS codebase exports somewhere and that the calling file has neither
// imported nor declared — a shape that cannot be anything but the defect above.

/** `export function NAME` / `export const NAME` / `export class NAME`, anywhere
 *  under `src`. Types are excluded: a type is erased and can never throw. */
function exportedValueNames(files: readonly string[]): Set<string> {
  const names = new Set<string>();
  for (const rel of files) {
    const text = readFileSync(join(MCP_DIR!, "src", rel), "utf8");
    for (const match of text.matchAll(/^export\s+(?:async\s+)?(?:function|const|class)\s+([A-Za-z_$][\w$]*)/gm)) {
      names.add(match[1]!);
    }
  }
  return names;
}

/** Replace every comment, string, template and regex literal with spaces, so
 *  only executable code is scanned. Prose ABOUT a symbol, and a symbol's name
 *  inside a message, are not calls — flagging either would make the guard noise
 *  rather than signal. Newlines survive, so reported line numbers stay true. */
function codeOnly(text: string): string {
  const out = text.split("");
  const blank = (from: number, to: number): void => {
    for (let i = from; i < to && i < out.length; i++) if (out[i] !== "\n") out[i] = " ";
  };
  let i = 0;
  let prevCode = "";
  while (i < text.length) {
    const ch = text[i]!;
    const next = text[i + 1];
    if (ch === "/" && next === "/") {
      const end = text.indexOf("\n", i);
      blank(i, end === -1 ? text.length : end);
      i = end === -1 ? text.length : end;
    } else if (ch === "/" && next === "*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end === -1 ? text.length : end + 2;
      blank(i, stop);
      i = stop;
    } else if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      while (j < text.length) {
        if (text[j] === "\\") j += 2;
        else if (text[j] === ch) break;
        else if (ch !== "`" && text[j] === "\n") break;
        else j++;
      }
      // The delimiters SURVIVE: `from "./x.js"` must still read as an import.
      blank(i + 1, j);
      i = j + 1;
    } else if (ch === "/" && /[(,=:[!&|?{};+\n]|^$/.test(prevCode)) {
      let j = i + 1;
      let inClass = false;
      while (j < text.length) {
        if (text[j] === "\\") j += 2;
        else if (text[j] === "[") (inClass = true), j++;
        else if (text[j] === "]") (inClass = false), j++;
        else if (text[j] === "/" && !inClass) break;
        else if (text[j] === "\n") break;
        else j++;
      }
      blank(i, j + 1);
      i = j + 1;
    } else {
      if (!/\s/.test(ch)) prevCode = ch;
      i++;
    }
  }
  return out.join("");
}

/** Every name the file can legally reference bare: imported bindings plus any
 *  local declaration or binding-position occurrence. Deliberately generous —
 *  the guard must never flag a shadowed local, only a genuinely absent name. */
function locallyAvailable(text: string): Set<string> {
  const names = new Set<string>();
  for (const match of text.matchAll(/import\s+(?:type\s+)?([\s\S]*?)\s+from\s+["']/g)) {
    for (const part of match[1]!.replace(/[{}*]/g, " ").split(",")) {
      const token = part.trim().split(/\s+as\s+/).pop()?.trim() ?? "";
      if (/^[A-Za-z_$][\w$]*$/.test(token) && token !== "type") names.add(token);
    }
  }
  for (const match of text.matchAll(
    /\b(?:function|const|let|var|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g,
  )) {
    names.add(match[1]!);
  }
  // Destructured bindings and parameters, e.g. `const { a, b } = x` or `(a, b) =>`.
  for (const match of text.matchAll(/[({,]\s*([A-Za-z_$][\w$]*)\s*[,)}:=]/g)) names.add(match[1]!);
  return names;
}

test("no `src` file CALLS an export of this codebase it never imported", () => {
  const files = sourceFiles(join(MCP_DIR!, "src"), "");
  const exported = exportedValueNames(files);
  assert.ok(exported.size > 0, "the codebase must export named values");
  assert.ok(exported.has("collectRemainingDivergence"), "the guard must see the WF-459 symbol");
  assert.ok(exported.has("planRepair"), "the guard must see the WF-460 symbol");

  const offenders: string[] = [];
  for (const rel of files) {
    const text = codeOnly(readFileSync(join(MCP_DIR!, "src", rel), "utf8"));
    const available = locallyAvailable(text);
    const seen = new Set<string>();
    for (const match of text.matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) {
      const name = match[2]!;
      if (seen.has(name) || available.has(name) || !exported.has(name)) continue;
      // A class or object-literal METHOD DEFINITION shares the `name(` shape but
      // only ever at line start, after optional modifiers. Skipped per OCCURRENCE,
      // never per name: the same name called elsewhere in the file is still checked.
      const before = text.slice(text.lastIndexOf("\n", match.index) + 1, match.index + match[1]!.length);
      if (/^\s*(?:(?:public|private|protected|static|async|readonly|get|set)\s+)*$/.test(before)) continue;
      seen.add(name);
      const line = text.slice(0, match.index).split("\n").length;
      offenders.push(`src/${rel}:${line}: calls \`${name}\` without importing it`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `the build does not typecheck, so an unimported call ships and throws only when that line is first reached:\n${offenders.join("\n")}`,
  );
});

test("the unimported-call guard itself detects a planted omission", () => {
  // Guarding the guard, as above: the detector is exercised against the exact
  // shape of the WF-459 defect and against every shape it must NOT flag — each
  // of the four negatives below is a real occurrence this codebase contains.
  const exported = new Set(["collectRemainingDivergence"]);
  const flag = (raw: string): boolean => {
    const text = codeOnly(raw);
    const available = locallyAvailable(text);
    for (const match of text.matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) {
      if (available.has(match[2]!) || !exported.has(match[2]!)) continue;
      const before = text.slice(text.lastIndexOf("\n", match.index) + 1, match.index + match[1]!.length);
      if (/^\s*(?:(?:public|private|protected|static|async|readonly|get|set)\s+)*$/.test(before)) continue;
      return true;
    }
    return false;
  };
  assert.equal(flag("const r = collectRemainingDivergence({ a: 1 });\n"), true, "the defect");
  assert.equal(
    flag('import { collectRemainingDivergence } from "./x.js";\nconst r = collectRemainingDivergence({});\n'),
    false,
    "an imported call is fine",
  );
  assert.equal(flag("const r = ports.collectRemainingDivergence();\n"), false, "a member call is fine");
  assert.equal(
    flag("// `collectRemainingDivergence()` is the explicit way to say so.\n"),
    false,
    "prose about a symbol is not a call",
  );
  assert.equal(
    flag("const m = `${n} collectRemainingDivergence(s) checked`;\n"),
    false,
    "a symbol's name inside a message is not a call",
  );
  assert.equal(
    flag("class X {\n  collectRemainingDivergence(): number {\n    return 1;\n  }\n}\n"),
    false,
    "a method definition is not a call",
  );
});

test("the newest module is inside the guard's scan set, not merely adjacent to it", () => {
  // A `file:line` citation proves a line EXISTS, not that it is covered. The guard
  // above recurses, so a new module is picked up automatically — but "automatically"
  // is an assumption until something asserts it, and a mis-sited file (wrong folder,
  // wrong extension) would silently drop out of the scan while still shipping.
  const files = sourceFiles(join(MCP_DIR!, "src"), "");
  assert.ok(
    files.includes("resolver/repair-plan.ts"),
    `the WF-460 module must be scanned; scanned set was:\n${files.join("\n")}`,
  );
  // Its own imports resolve: every codebase export it calls is one it imported.
  const exported = exportedValueNames(files);
  const text = codeOnly(readFileSync(join(MCP_DIR!, "src/resolver/repair-plan.ts"), "utf8"));
  const available = locallyAvailable(text);
  const missing: string[] = [];
  for (const match of text.matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) {
    const name = match[2]!;
    if (available.has(name) || !exported.has(name)) continue;
    missing.push(name);
  }
  assert.deepEqual(missing, []);
});
