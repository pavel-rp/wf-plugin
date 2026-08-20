import { test } from "node:test";
import assert from "node:assert/strict";
import { parseManifest, type RawManifestTable } from "../src/resolver/manifest.js";
import {
  isPayloadRelativePath,
  validatePayloadDeclarations,
} from "../src/resolver/payloads.js";

function table(rows: string[][], headers = [
  "Source",
  "Destination",
  "Production",
  "Refresh",
  "Removal",
]): RawManifestTable {
  return { headers, rows, sectionCount: 1 };
}

const validRows = [
  ["assets/a.bin", ".wf/a.bin", "copy", "replace-if-unmodified", "delete-if-unmodified"],
  ["assets/b.txt", "docs/b.txt", "copy", "retain", "retain"],
];

test("absent and header-only payload declarations are inert", () => {
  assert.deepEqual(validatePayloadDeclarations("wf-demo@local", "demo", null), {
    ok: true,
    payloads: [],
    diagnostics: [],
  });
  assert.deepEqual(validatePayloadDeclarations("wf-demo@local", "demo", table([])), {
    ok: true,
    payloads: [],
    diagnostics: [],
  });
});

test("ordered rows preserve pack/capability provenance and the closed semantic tuple", () => {
  const result = validatePayloadDeclarations("wf-demo@local", "demo", table(validRows));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.payloads, [
    {
      pluginId: "wf-demo@local",
      capability: "demo",
      source: "assets/a.bin",
      destination: ".wf/a.bin",
      production: "copy",
      refresh: "replace-if-unmodified",
      removal: "delete-if-unmodified",
    },
    {
      pluginId: "wf-demo@local",
      capability: "demo",
      source: "assets/b.txt",
      destination: "docs/b.txt",
      production: "copy",
      refresh: "retain",
      removal: "retain",
    },
  ]);
});

test("manifest parser preserves an ordered Payloads table for validation", () => {
  const parsed = parseManifest(`# demo\n\n**Kind:** both\n\n## Payloads\n\n| Source | Destination | Production | Refresh | Removal |\n|---|---|---|---|---|\n| assets/a.bin | .wf/a.bin | copy | replace-if-unmodified | delete-if-unmodified |\n`);
  const result = validatePayloadDeclarations("wf-demo@local", "demo", parsed.payloads);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.payloads[0].destination, ".wf/a.bin");
});

test("unknown, missing, duplicate columns and duplicate sections reject the complete set", () => {
  const cases: RawManifestTable[] = [
    table(validRows, ["Source", "Destination", "Production", "Refresh", "Removal", "Extra"]),
    table(validRows.map((row) => row.slice(0, 4)), ["Source", "Destination", "Production", "Refresh"]),
    table(validRows, ["Source", "Destination", "Production", "Refresh", "Refresh"]),
    { ...table(validRows), sectionCount: 2 },
  ];
  for (const candidate of cases) {
    const result = validatePayloadDeclarations("wf-demo@local", "demo", candidate);
    assert.equal(result.ok, false);
    if (result.ok) continue;
    assert.deepEqual(result.payloads, []);
    assert.ok(result.diagnostics.length > 0);
    assert.ok(
      result.diagnostics.every(
        (diagnostic) =>
          diagnostic.pluginId === "wf-demo@local" && diagnostic.capability === "demo",
      ),
    );
  }
});

test("source and destination grammar rejects every forbidden lexical shape", () => {
  const invalid = [
    "",
    "/absolute",
    "C:/drive",
    "a\\b",
    "a\0b",
    "a:b",
    "a//b",
    "./a",
    "a/./b",
    "../a",
    "a/../b",
  ];
  for (const candidate of invalid) assert.equal(isPayloadRelativePath(candidate), false, candidate);
  for (const candidate of ["a", ".wf/a", "nested/a.json", "-leading/ok"]) {
    assert.equal(isPayloadRelativePath(candidate), true, candidate);
  }

  for (const candidate of invalid) {
    const source = validatePayloadDeclarations(
      "wf-demo@local",
      "demo",
      table([[candidate, "safe/out", "copy", "retain", "retain"]]),
    );
    const destination = validatePayloadDeclarations(
      "wf-demo@local",
      "demo",
      table([["safe/in", candidate, "copy", "retain", "retain"]]),
    );
    assert.equal(source.ok, false, `source ${candidate}`);
    assert.equal(destination.ok, false, `destination ${candidate}`);
  }
});

test("unknown semantic tokens fail closed without a partial payload set", () => {
  const rows = [
    validRows[0],
    ["assets/b", "out/b", "render", "replace", "delete"],
  ];
  const result = validatePayloadDeclarations("wf-demo@local", "demo", table(rows));
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.deepEqual(result.payloads, []);
  assert.deepEqual(
    result.diagnostics.map((diagnostic) => diagnostic.field),
    ["production", "refresh", "removal"],
  );
  assert.ok(result.diagnostics.every((diagnostic) => diagnostic.row === 2));
});

test("malformed row width rejects every otherwise-valid row", () => {
  const result = validatePayloadDeclarations(
    "wf-demo@local",
    "demo",
    table([validRows[0], ["assets/b", "out/b", "copy"]]),
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.deepEqual(result.payloads, []);
    assert.equal(result.diagnostics[0].code, "payload/row-width");
  }
});
