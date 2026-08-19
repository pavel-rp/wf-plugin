import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_ENUM_VALUES,
  MAX_NORMALIZED_QUESTION_BYTES,
  MAX_PROFILE_TEMPLATE_BYTES,
  MAX_PROMPT_LENGTH,
  MAX_QUESTIONS_PER_TEMPLATE,
  applyQuestionValues,
  parseQuestionDeclarations,
  validateQuestionValue,
} from "../src/resolver/questions.js";
import type {
  QuestionDeclaration,
  QuestionValueSource,
} from "../src/resolver/types.js";

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
