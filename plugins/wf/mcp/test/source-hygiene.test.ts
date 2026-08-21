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
