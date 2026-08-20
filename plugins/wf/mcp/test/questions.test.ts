import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  MAX_ENUM_VALUES,
  MAX_NORMALIZED_QUESTION_BYTES,
  MAX_PROFILE_TEMPLATE_BYTES,
  MAX_PROMPT_LENGTH,
  MAX_QUESTION_DIAGNOSTICS,
  MAX_QUESTIONS_PER_TEMPLATE,
  applyQuestionValues,
  parseQuestionDeclarations,
  validateQuestionValue,
} from "../src/resolver/questions.js";
import type {
  QuestionDeclaration,
  QuestionValue,
  QuestionValueSource,
} from "../src/resolver/types.js";

const MCP_DIR = process.env.WF_MCP_DIR;
if (!MCP_DIR) throw new Error("WF_MCP_DIR is required");
const PLUGINS_ROOT = resolve(MCP_DIR, "../..");
const ADO_TEMPLATE_PATH = join(
  PLUGINS_ROOT,
  "wf-ado",
  "capabilities",
  "ado",
  "profile.template.json",
);
const LINEAR_TEMPLATE_PATH = join(
  PLUGINS_ROOT,
  "wf-linear",
  "capabilities",
  "linear",
  "profile.template.json",
);

function shippedProfileTemplates(): Array<{ pack: string; path: string }> {
  const templates: Array<{ pack: string; path: string }> = [];
  for (const plugin of readdirSync(PLUGINS_ROOT, { withFileTypes: true })) {
    if (!plugin.isDirectory()) continue;
    const capabilitiesRoot = join(PLUGINS_ROOT, plugin.name, "capabilities");
    if (!existsSync(capabilitiesRoot)) continue;
    for (const capability of readdirSync(capabilitiesRoot, { withFileTypes: true })) {
      if (!capability.isDirectory()) continue;
      const path = join(capabilitiesRoot, capability.name, "profile.template.json");
      if (existsSync(path)) templates.push({ pack: capability.name, path });
    }
  }
  return templates.sort((left, right) => left.path.localeCompare(right.path));
}

const VALID_TEMPLATE = JSON.stringify({
  ask: [
    {
      id: "project-name",
      destination: "project-name",
      prompt: "Project name?",
      schema: { type: "string", minLength: 2, maxLength: 8, pattern: "^[a-z]+$" },
      suggestedDefault: "alpha",
    },
    {
      id: "enabled",
      destination: "enabled",
      prompt: "Enable it?",
      schema: { type: "boolean" },
    },
    {
      id: "replicas",
      destination: "replicas",
      prompt: "Replica count?",
      schema: { type: "integer", minimum: 1, maximum: 5 },
    },
    {
      id: "mode",
      destination: "settings.mode",
      prompt: "Mode?",
      schema: { type: "enum", values: ["safe", "fast"] },
    },
  ],
  enabled: true,
  replicas: 2,
  "settings.mode": "safe",
});

test("real tracker templates declare the exact ordered question inventory", () => {
  const fixtures = [
    {
      pack: "ado",
      path: ADO_TEMPLATE_PATH,
      ordinary: { key: "work-item-id-prefix", value: "ADO" },
      expected: [
        {
          pack: "ado",
          id: "ado-organization",
          destination: "ado-organization",
          prompt: "Azure DevOps organization slug (the <org> segment in dev.azure.com/<org>)?",
          schema: { type: "string" },
        },
        {
          pack: "ado",
          id: "ado-project",
          destination: "ado-project",
          prompt: "Azure DevOps project name?",
          schema: { type: "string" },
        },
      ],
    },
    {
      pack: "linear",
      path: LINEAR_TEMPLATE_PATH,
      ordinary: { key: "linear-project", value: "none" },
      expected: [
        {
          pack: "linear",
          id: "linear-team",
          destination: "linear-team",
          prompt: "Linear team key or name for new issues?",
          schema: { type: "string" },
        },
      ],
    },
  ] as const;

  for (const fixture of fixtures) {
    const raw = readFileSync(fixture.path, "utf8");
    const template = JSON.parse(raw) as Record<string, unknown>;
    assert.equal(template[fixture.ordinary.key], fixture.ordinary.value);
    assert.ok(
      fixture.expected.every((expected) => !Object.hasOwn(template, expected.destination)),
      `${fixture.pack} question destinations must not carry pack defaults`,
    );

    const parsed = parseQuestionDeclarations(fixture.pack, raw);
    assert.equal(parsed.ok, true, fixture.pack);
    if (!parsed.ok) continue;
    assert.deepEqual(
      parsed.questions.map(({ pack, id, destination, prompt, schema }) => ({
        pack,
        id,
        destination,
        prompt,
        schema,
      })),
      fixture.expected,
    );
    assert.ok(parsed.questions.every((question) => question.suggestedDefault === undefined));
    assert.ok(
      parsed.questions.every(
        (question) =>
          question.state.status === "unresolved" &&
          question.state.source === null &&
          question.state.value === null &&
          question.state.suggestions.length === 0,
      ),
    );
  }
});

test("real tracker questions resolve only from valid persisted values", () => {
  const fixtures = [
    {
      pack: "ado",
      path: ADO_TEMPLATE_PATH,
      destination: "ado-organization",
      packValue: "example-org",
      personalValue: "personal-org",
      persistedValue: "persisted-org",
    },
    {
      pack: "linear",
      path: LINEAR_TEMPLATE_PATH,
      destination: "linear-team",
      packValue: "PACK",
      personalValue: "PERSONAL",
      persistedValue: "PERSISTED",
    },
  ] as const;

  for (const fixture of fixtures) {
    const template = JSON.parse(readFileSync(fixture.path, "utf8")) as Record<string, unknown>;
    const parsed = parseQuestionDeclarations(
      fixture.pack,
      JSON.stringify({ ...template, [fixture.destination]: fixture.packValue }),
    );
    assert.equal(parsed.ok, true, fixture.pack);
    if (!parsed.ok) continue;

    const suggested = applyQuestionValues(parsed.questions, {
      personal: { [fixture.destination]: fixture.personalValue },
    });
    assert.equal(suggested.ok, true, fixture.pack);
    if (!suggested.ok) continue;
    const suggestedQuestion = suggested.questions.find(
      (question) => question.destination === fixture.destination,
    );
    assert.deepEqual(suggestedQuestion?.state, {
      status: "unresolved",
      source: null,
      value: null,
      suggestions: [
        { source: "pack-default", value: fixture.packValue },
        { source: "personal", value: fixture.personalValue },
      ],
    });

    const persisted = applyQuestionValues(parsed.questions, {
      personal: { [fixture.destination]: fixture.personalValue },
      persisted: { [fixture.destination]: fixture.persistedValue },
    });
    assert.equal(persisted.ok, true, fixture.pack);
    if (!persisted.ok) continue;
    const persistedQuestion = persisted.questions.find(
      (question) => question.destination === fixture.destination,
    );
    assert.deepEqual(persistedQuestion?.state, {
      status: "resolved",
      source: "persisted",
      value: fixture.persistedValue,
      suggestions: [
        { source: "pack-default", value: fixture.packValue },
        { source: "personal", value: fixture.personalValue },
      ],
    });
  }
});

test("no other shipped pack contributes lifecycle questions", () => {
  const inventory: Array<{ pack: string; id: string }> = [];
  for (const template of shippedProfileTemplates()) {
    const parsed = parseQuestionDeclarations(template.pack, readFileSync(template.path, "utf8"));
    assert.equal(parsed.ok, true, template.path);
    if (!parsed.ok) continue;
    inventory.push(...parsed.questions.map((question) => ({ pack: question.pack, id: question.id })));
  }
  assert.deepEqual(inventory, [
    { pack: "ado", id: "ado-organization" },
    { pack: "ado", id: "ado-project" },
    { pack: "linear", id: "linear-team" },
  ]);

  const browserCapability = join(PLUGINS_ROOT, "wf-browser-qa", "capabilities", "browser-qa");
  const browserManifest = readFileSync(join(browserCapability, "manifest.md"), "utf8");
  assert.doesNotMatch(browserManifest, /^profile-template:/im);
  assert.equal(existsSync(join(browserCapability, "profile.template.json")), false);
});

test("parseQuestionDeclarations preserves order, provenance, schemas, and attributed suggestions", () => {
  const parsed = parseQuestionDeclarations("demo", VALID_TEMPLATE);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;

  assert.deepEqual(
    parsed.questions.map((q) => q.id),
    ["project-name", "enabled", "replicas", "mode"],
  );
  assert.ok(parsed.questions.every((q) => q.pack === "demo"));
  assert.deepEqual(parsed.questions.map((q) => q.schema.type), [
    "string",
    "boolean",
    "integer",
    "enum",
  ]);
  assert.deepEqual(parsed.questions[0].state, {
    status: "unresolved",
    source: null,
    value: null,
    suggestions: [{ source: "suggested-default", value: "alpha" }],
  });
  assert.equal(parsed.questions[0].suggestedDefault, "alpha");
  assert.deepEqual(parsed.questions[1].state.suggestions, [
    { source: "pack-default", value: true },
  ]);
  assert.equal(parsed.questions[3].destination, "settings.mode");
});

test("parseQuestionDeclarations keeps ordinary profile templates compatible", () => {
  const parsed = parseQuestionDeclarations("plain", JSON.stringify({ value: "default" }));
  assert.deepEqual(parsed, { ok: true, questions: [], diagnostics: [] });
});

test("parseQuestionDeclarations rejects malformed JSON and non-object templates", () => {
  const malformed = parseQuestionDeclarations("demo", "{");
  assert.equal(malformed.ok, false);
  assert.equal(malformed.questions.length, 0);
  assert.equal(malformed.diagnostics[0].pack, "demo");
  assert.equal(malformed.diagnostics[0].field, "template");
  assert.equal(
    malformed.diagnostics[0].message,
    "pack `demo`, field `template`: must be valid JSON.",
  );
  assert.ok(!malformed.diagnostics[0].message.includes("{"));

  const array = parseQuestionDeclarations("demo", "[]");
  assert.equal(array.ok, false);
  assert.equal(array.questions.length, 0);
});

const INVALID_CASES: Array<{ name: string; template: unknown; code: string }> = [
  {
    name: "ask is not an array",
    template: { ask: {} },
    code: "question/ask-invalid",
  },
  {
    name: "entry is not an object",
    template: { ask: ["bad"] },
    code: "question/declaration-invalid",
  },
  {
    name: "unknown declaration field",
    template: {
      ask: [
        {
          id: "name",
          destination: "name",
          prompt: "Name?",
          schema: { type: "string" },
          extra: true,
        },
      ],
    },
    code: "question/declaration-unknown-field",
  },
  {
    name: "invalid identifier",
    template: {
      ask: [
        {
          id: "Not Valid",
          destination: "name",
          prompt: "Name?",
          schema: { type: "string" },
        },
      ],
    },
    code: "question/id-invalid",
  },
  {
    name: "non-string destination",
    template: {
      ask: [
        {
          id: "name",
          destination: 42,
          prompt: "Name?",
          schema: { type: "string" },
        },
      ],
    },
    code: "question/destination-invalid",
  },
  {
    name: "malformed destination",
    template: {
      ask: [
        {
          id: "name",
          destination: "../name",
          prompt: "Name?",
          schema: { type: "string" },
        },
      ],
    },
    code: "question/destination-invalid",
  },
  {
    name: "reserved ask destination",
    template: {
      ask: [
        {
          id: "name",
          destination: "ask",
          prompt: "Name?",
          schema: { type: "string" },
        },
      ],
    },
    code: "question/destination-invalid",
  },
  {
    name: "empty prompt",
    template: {
      ask: [
        {
          id: "name",
          destination: "name",
          prompt: " ",
          schema: { type: "string" },
        },
      ],
    },
    code: "question/prompt-invalid",
  },
  {
    name: "unsupported type",
    template: {
      ask: [
        {
          id: "name",
          destination: "name",
          prompt: "Name?",
          schema: { type: "number" },
        },
      ],
    },
    code: "question/schema-unsupported-type",
  },
  {
    name: "unknown schema field",
    template: {
      ask: [
        {
          id: "flag",
          destination: "flag",
          prompt: "Flag?",
          schema: { type: "boolean", minimum: 1 },
        },
      ],
    },
    code: "question/schema-unknown-field",
  },
  {
    name: "incomplete string bounds",
    template: {
      ask: [
        {
          id: "name",
          destination: "name",
          prompt: "Name?",
          schema: { type: "string", minLength: 1 },
        },
      ],
    },
    code: "question/schema-incomplete-bounds",
  },
  {
    name: "incomplete integer bounds",
    template: {
      ask: [
        {
          id: "count",
          destination: "count",
          prompt: "Count?",
          schema: { type: "integer", minimum: 1 },
        },
      ],
    },
    code: "question/schema-incomplete-bounds",
  },
  {
    name: "reversed integer range",
    template: {
      ask: [
        {
          id: "count",
          destination: "count",
          prompt: "Count?",
          schema: { type: "integer", minimum: 3, maximum: 2 },
        },
      ],
    },
    code: "question/schema-invalid-range",
  },
  {
    name: "duplicate enum value",
    template: {
      ask: [
        {
          id: "mode",
          destination: "mode",
          prompt: "Mode?",
          schema: { type: "enum", values: ["same", "same"] },
        },
      ],
    },
    code: "question/schema-duplicate-enum-value",
  },
  {
    name: "duplicate ids",
    template: {
      ask: [
        { id: "same", destination: "one", prompt: "One?", schema: { type: "boolean" } },
        { id: "same", destination: "two", prompt: "Two?", schema: { type: "boolean" } },
      ],
    },
    code: "question/id-duplicate",
  },
  {
    name: "duplicate destinations",
    template: {
      ask: [
        { id: "one", destination: "same", prompt: "One?", schema: { type: "boolean" } },
        { id: "two", destination: "same", prompt: "Two?", schema: { type: "boolean" } },
      ],
    },
    code: "question/destination-duplicate",
  },
];

for (const fixture of INVALID_CASES) {
  test(`parseQuestionDeclarations rejects ${fixture.name} without partial output`, () => {
    const parsed = parseQuestionDeclarations("demo", JSON.stringify(fixture.template));
    assert.equal(parsed.ok, false);
    assert.deepEqual(parsed.questions, []);
    assert.ok(parsed.diagnostics.some((d) => d.code === fixture.code));
    assert.ok(parsed.diagnostics.every((d) => d.pack === "demo"));
    assert.ok(parsed.diagnostics.every((d) => d.message.includes("pack `demo`")));
  });
}

test("question declarations enforce template and aggregate metadata bounds", () => {
  const tooLargeTemplate = parseQuestionDeclarations(
    "demo",
    " ".repeat(MAX_PROFILE_TEMPLATE_BYTES + 1),
  );
  assert.equal(tooLargeTemplate.ok, false);
  assert.equal(tooLargeTemplate.diagnostics[0].code, "question/template-too-large");

  const tooManyQuestions = parseQuestionDeclarations(
    "demo",
    JSON.stringify({
      ask: Array.from({ length: MAX_QUESTIONS_PER_TEMPLATE + 1 }, (_, index) => ({
        id: `question-${index}`,
        destination: `question-${index}`,
        prompt: "Value?",
        schema: { type: "boolean" },
      })),
    }),
  );
  assert.equal(tooManyQuestions.ok, false);
  assert.equal(tooManyQuestions.diagnostics[0].code, "question/ask-too-many");

  const tooManyEnumValues = parseQuestionDeclarations(
    "demo",
    JSON.stringify({
      ask: [
        {
          id: "mode",
          destination: "mode",
          prompt: "Mode?",
          schema: {
            type: "enum",
            values: Array.from({ length: MAX_ENUM_VALUES + 1 }, (_, index) => `v${index}`),
          },
        },
      ],
    }),
  );
  assert.equal(tooManyEnumValues.ok, false);
  assert.equal(tooManyEnumValues.diagnostics[0].code, "question/schema-enum-too-large");

  const tooLongPrompt = parseQuestionDeclarations(
    "demo",
    JSON.stringify({
      ask: [
        {
          id: "name",
          destination: "name",
          prompt: "x".repeat(MAX_PROMPT_LENGTH + 1),
          schema: { type: "string" },
        },
      ],
    }),
  );
  assert.equal(tooLongPrompt.ok, false);
  assert.equal(tooLongPrompt.diagnostics[0].code, "question/prompt-too-long");

  const boundedPromptLength = Math.min(
    MAX_PROMPT_LENGTH,
    Math.ceil(MAX_NORMALIZED_QUESTION_BYTES / MAX_QUESTIONS_PER_TEMPLATE),
  );
  const oversizedMetadata = parseQuestionDeclarations(
    "demo",
    JSON.stringify({
      ask: Array.from({ length: MAX_QUESTIONS_PER_TEMPLATE }, (_, index) => ({
        id: `question-${index}`,
        destination: `question-${index}`,
        prompt: "x".repeat(boundedPromptLength),
        schema: { type: "boolean" },
      })),
    }),
  );
  assert.equal(oversizedMetadata.ok, false);
  assert.equal(oversizedMetadata.diagnostics[0].code, "question/metadata-too-large");
  assert.deepEqual(oversizedMetadata.questions, []);
});

test("pattern schemas require bounded input and reject backtracking-prone constructs", () => {
  const cases = [
    {
      schema: { type: "string", pattern: "^[a-z]+$" },
      code: "question/schema-pattern-unbounded",
    },
    {
      schema: { type: "string", minLength: 0, maxLength: 32, pattern: "^(a+)+$" },
      code: "question/schema-unsafe-pattern",
    },
    {
      schema: { type: "string", minLength: 0, maxLength: 32, pattern: "^a*a*b$" },
      code: "question/schema-unsafe-pattern",
    },
    {
      schema: { type: "string", minLength: 0, maxLength: 1025, pattern: "^[a-z]+$" },
      code: "question/schema-pattern-input-too-large",
    },
  ];

  for (const fixture of cases) {
    const parsed = parseQuestionDeclarations(
      "demo",
      JSON.stringify({
        ask: [
          {
            id: "name",
            destination: "name",
            prompt: "Name?",
            schema: fixture.schema,
          },
        ],
      }),
    );
    assert.equal(parsed.ok, false);
    assert.deepEqual(parsed.questions, []);
    assert.ok(parsed.diagnostics.some((diagnostic) => diagnostic.code === fixture.code));
  }
});

test("invalid regex diagnostics are fixed and never echo the pattern source", () => {
  const sentinel = "REGEX_SECRET_7f3b";
  const parsed = parseQuestionDeclarations(
    "demo",
    JSON.stringify({
      ask: [
        {
          id: "name",
          destination: "name",
          prompt: "Name?",
          schema: {
            type: "string",
            minLength: 0,
            maxLength: 32,
            pattern: `[${sentinel}`,
          },
        },
      ],
    }),
  );
  assert.equal(parsed.ok, false);
  assert.deepEqual(parsed.questions, []);
  const issue = parsed.diagnostics.find(
    (diagnostic) => diagnostic.code === "question/schema-invalid-pattern",
  );
  assert.equal(
    issue?.message,
    "pack `demo`, question `name`, field `schema.pattern`: must compile as a regular expression.",
  );
  assert.ok(!JSON.stringify(parsed.diagnostics).includes(sentinel));
});

test("invalid declaration diagnostics are count- and byte-bounded without controlled labels", () => {
  const sentinel = "DECLARATION_SECRET_9c2e";
  const unknownFields = Object.fromEntries(
    Array.from({ length: MAX_QUESTION_DIAGNOSTICS + 64 }, (_, index) => [
      `${sentinel}-${index}`,
      true,
    ]),
  );
  const parsed = parseQuestionDeclarations(
    "demo",
    JSON.stringify({
      ask: [
        {
          ...unknownFields,
          id: `${sentinel}!`,
          destination: "name",
          prompt: "Name?",
          schema: { type: "string" },
        },
      ],
    }),
  );
  assert.equal(parsed.ok, false);
  assert.deepEqual(parsed.questions, []);
  assert.ok(parsed.diagnostics.length <= MAX_QUESTION_DIAGNOSTICS);
  assert.ok(
    Buffer.byteLength(JSON.stringify(parsed.diagnostics), "utf8") <=
      MAX_NORMALIZED_QUESTION_BYTES,
  );
  assert.equal(
    parsed.diagnostics.at(-1)?.code,
    "question/diagnostics-truncated",
  );
  assert.ok(!JSON.stringify(parsed.diagnostics).includes(sentinel));
});

test("successful validation exposes only the closed QuestionValue union", () => {
  const declaration: QuestionDeclaration = {
    pack: "demo",
    id: "count",
    destination: "count",
    prompt: "Count?",
    schema: { type: "integer", minimum: 1, maximum: 3 },
  };
  const result = validateQuestionValue(declaration, "proposed", 2);
  assert.equal(result.valid, true);
  if (!result.valid) return;
  const value: QuestionValue = result.value;
  assert.equal(value, 2);
});

test("invalid suggested and pack defaults reject the complete declaration set", () => {
  const invalidSuggested = parseQuestionDeclarations(
    "demo",
    JSON.stringify({
      ask: [
        {
          id: "count",
          destination: "count",
          prompt: "Count?",
          schema: { type: "integer", minimum: 1, maximum: 3 },
          suggestedDefault: 4,
        },
      ],
    }),
  );
  assert.equal(invalidSuggested.ok, false);
  assert.deepEqual(invalidSuggested.questions, []);
  assert.equal(invalidSuggested.diagnostics[0].question, "count");

  const invalidPack = parseQuestionDeclarations(
    "demo",
    JSON.stringify({
      ask: [
        {
          id: "count",
          destination: "count",
          prompt: "Count?",
          schema: { type: "integer", minimum: 1, maximum: 3 },
        },
      ],
      count: 0,
    }),
  );
  assert.equal(invalidPack.ok, false);
  assert.deepEqual(invalidPack.questions, []);
});

test("every value provenance uses identical type and boundary validation", () => {
  const declaration: QuestionDeclaration = {
    pack: "demo",
    id: "count",
    destination: "count",
    prompt: "Count?",
    schema: { type: "integer", minimum: 1, maximum: 3 },
  };
  const sources: QuestionValueSource[] = [
    "suggested-default",
    "pack-default",
    "personal",
    "persisted",
    "proposed",
  ];
  for (const value of [0, 1, 3, 4, 2.5, "2"]) {
    const outcomes = sources.map((source) => validateQuestionValue(declaration, source, value));
    assert.ok(outcomes.every((result) => result.valid === outcomes[0].valid));
    if (!outcomes[0].valid) {
      assert.ok(
        outcomes.every(
          (result) => !result.valid && result.diagnostics[0].code === outcomes[0].diagnostics[0].code,
        ),
      );
    }
  }
});

test("only a valid explicitly persisted answer resolves a question", () => {
  const parsed = parseQuestionDeclarations("demo", VALID_TEMPLATE);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;

  const suggested = applyQuestionValues(parsed.questions, {
    personal: { "project-name": "beta" },
  });
  assert.equal(suggested.ok, true);
  if (!suggested.ok) return;
  assert.equal(suggested.questions[0].state.status, "unresolved");
  assert.deepEqual(suggested.questions[0].state.suggestions, [
    { source: "suggested-default", value: "alpha" },
    { source: "personal", value: "beta" },
  ]);

  const persisted = applyQuestionValues(parsed.questions, {
    personal: { "project-name": "beta" },
    persisted: { "project-name": "gamma" },
  });
  assert.equal(persisted.ok, true);
  if (!persisted.ok) return;
  assert.deepEqual(persisted.questions[0].state, {
    status: "resolved",
    source: "persisted",
    value: "gamma",
    suggestions: [
      { source: "suggested-default", value: "alpha" },
      { source: "personal", value: "beta" },
    ],
  });
});

test("invalid persisted or personal values reject the complete set", () => {
  const parsed = parseQuestionDeclarations("demo", VALID_TEMPLATE);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;

  const invalidPersisted = applyQuestionValues(parsed.questions, {
    persisted: { replicas: 99 },
  });
  assert.equal(invalidPersisted.ok, false);
  assert.deepEqual(invalidPersisted.questions, []);
  assert.equal(invalidPersisted.diagnostics[0].pack, "demo");
  assert.equal(invalidPersisted.diagnostics[0].question, "replicas");

  const invalidPersonal = applyQuestionValues(parsed.questions, {
    personal: { enabled: "yes" },
  });
  assert.equal(invalidPersonal.ok, false);
  assert.deepEqual(invalidPersonal.questions, []);
});
