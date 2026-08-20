// wf resolver — validated declarative profile-template questions (WF-440).
//
// This module is deliberately pure. It parses only the reserved top-level `ask`
// metadata from a JSON profile template, emits normalized question records (never
// the template body), and sends every candidate value through one validator.

import type {
  QuestionDeclaration,
  QuestionDeclarationResult,
  QuestionDiagnostic,
  QuestionRecord,
  QuestionSchema,
  QuestionSuggestion,
  QuestionValue,
  QuestionValueSource,
  QuestionValueValidation,
} from "./types.js";

const DECLARATION_FIELDS = new Set([
  "id",
  "destination",
  "prompt",
  "schema",
  "suggestedDefault",
]);
const ID_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const DESTINATION_RE = /^[A-Za-z][A-Za-z0-9_.-]*$/;
export const MAX_PROFILE_TEMPLATE_BYTES = 256 * 1024;
export const MAX_QUESTIONS_PER_TEMPLATE = 64;
export const MAX_ENUM_VALUES = 128;
export const MAX_PROMPT_LENGTH = 2048;
export const MAX_NORMALIZED_QUESTION_BYTES = 128 * 1024;
export const MAX_QUESTION_DIAGNOSTICS = 256;
const MAX_DIAGNOSTIC_LABEL_LENGTH = 128;
const MAX_PATTERN_INPUT_LENGTH = 1024;
const MAX_PATTERN_LENGTH = 256;

/** Keep pack-controlled patterns in a deterministic, bounded RegExp subset.
 *  Grouping, alternation, backreferences, and more than one variable quantifier
 *  are excluded so the native matcher cannot enter catastrophic backtracking. */
function patternSafetyError(pattern: string): string | null {
  if (pattern.length > MAX_PATTERN_LENGTH) {
    return `must be at most ${MAX_PATTERN_LENGTH} characters.`;
  }

  let inClass = false;
  let escaped = false;
  let variableQuantifiers = 0;
  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index];
    if (escaped) {
      if (/[1-9]/.test(char) || (char === "k" && pattern[index + 1] === "<")) {
        return "backreferences are not supported.";
      }
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (inClass) {
      if (char === "]") inClass = false;
      continue;
    }
    if (char === "[") {
      inClass = true;
      continue;
    }
    if (char === "(" || char === ")" || char === "|") {
      return "grouping and alternation are not supported.";
    }
    if (char === "*" || char === "+" || char === "?") {
      variableQuantifiers++;
    } else if (char === "{") {
      const quantifier = /^\{(\d+)(?:,(\d*))?\}/.exec(pattern.slice(index));
      if (quantifier) {
        const minimum = Number(quantifier[1]);
        const maximum =
          quantifier[2] === undefined
            ? minimum
            : quantifier[2] === ""
              ? null
              : Number(quantifier[2]);
        if (
          minimum > MAX_PATTERN_INPUT_LENGTH ||
          (maximum !== null && maximum > MAX_PATTERN_INPUT_LENGTH)
        ) {
          return `quantifier bounds must not exceed ${MAX_PATTERN_INPUT_LENGTH}.`;
        }
        if (maximum === null || minimum !== maximum) variableQuantifiers++;
        index += quantifier[0].length - 1;
      }
    }
    if (variableQuantifiers > 1) {
      return "at most one variable quantifier is supported.";
    }
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function own(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function safeDiagnosticLabel(
  value: string,
  pattern: RegExp,
  fallback: string,
): string {
  return value.length <= MAX_DIAGNOSTIC_LABEL_LENGTH && pattern.test(value)
    ? value
    : fallback;
}

export function makeQuestionDiagnostic(
  pack: string,
  question: string | null,
  field: string,
  code: string,
  detail: string,
): QuestionDiagnostic {
  const safePack = safeDiagnosticLabel(
    pack,
    /^[a-z0-9][a-z0-9-]*$/,
    "(invalid-pack)",
  );
  const safeQuestion =
    question === null
      ? null
      : safeDiagnosticLabel(
          question,
          /^(?:[a-z][a-z0-9]*(?:-[a-z0-9]+)*|ask\[\d+\])$/,
          "(invalid-question)",
        );
  const safeField = safeDiagnosticLabel(
    field,
    /^(?:ask|template|profile|profile-template|declaration|id|destination|prompt|schema(?:\.(?:type|minLength|maxLength|pattern|minimum|maximum|values))?|schema\.values\[\d+\]|value)$/,
    "(invalid-field)",
  );
  const owner =
    safeQuestion === null
      ? `pack \`${safePack}\``
      : `pack \`${safePack}\`, question \`${safeQuestion}\``;
  return {
    code,
    pack: safePack,
    question: safeQuestion,
    field: safeField,
    message: `${owner}, field \`${safeField}\`: ${detail}`,
  };
}

function diagnosticBytes(diagnostics: readonly QuestionDiagnostic[]): number {
  return Buffer.byteLength(JSON.stringify(diagnostics), "utf8");
}

function finalizeDiagnostics(
  pack: string,
  diagnostics: readonly QuestionDiagnostic[],
): QuestionDiagnostic[] {
  const retained: QuestionDiagnostic[] = [];
  let truncated = false;
  for (const issue of diagnostics) {
    if (retained.length >= MAX_QUESTION_DIAGNOSTICS) {
      truncated = true;
      break;
    }
    if (diagnosticBytes([...retained, issue]) > MAX_NORMALIZED_QUESTION_BYTES) {
      truncated = true;
      break;
    }
    retained.push(issue);
  }
  if (!truncated) return retained;

  const sentinel = makeQuestionDiagnostic(
    pack,
    null,
    "ask",
    "question/diagnostics-truncated",
    "additional diagnostics omitted after aggregate limit.",
  );
  while (
    retained.length >= MAX_QUESTION_DIAGNOSTICS ||
    diagnosticBytes([...retained, sentinel]) > MAX_NORMALIZED_QUESTION_BYTES
  ) {
    retained.pop();
  }
  return [...retained, sentinel];
}

function normalizedMetadataDiagnostic(
  pack: string,
  questions: readonly QuestionRecord[],
): QuestionDiagnostic | null {
  if (questions.length > MAX_QUESTIONS_PER_TEMPLATE) {
    return makeQuestionDiagnostic(
      pack,
      null,
      "ask",
      "question/ask-too-many",
      `must contain at most ${MAX_QUESTIONS_PER_TEMPLATE} questions.`,
    );
  }
  const bytes = Buffer.byteLength(JSON.stringify(questions), "utf8");
  return bytes > MAX_NORMALIZED_QUESTION_BYTES
    ? makeQuestionDiagnostic(
        pack,
        null,
        "ask",
        "question/metadata-too-large",
        `normalized question metadata must be at most ${MAX_NORMALIZED_QUESTION_BYTES} UTF-8 bytes.`,
      )
    : null;
}

function schemaFields(
  pack: string,
  question: string,
  raw: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  diagnostics: QuestionDiagnostic[],
): void {
  const unknownFieldCount = Object.keys(raw).filter((key) => !allowed.has(key)).length;
  for (let index = 0; index < unknownFieldCount; index++) {
    diagnostics.push(
      makeQuestionDiagnostic(
        pack,
        question,
        "schema",
        "question/schema-unknown-field",
        "unknown schema field.",
      ),
    );
  }
}

function integerField(
  pack: string,
  question: string,
  raw: Record<string, unknown>,
  field: string,
  diagnostics: QuestionDiagnostic[],
  options: { nonNegative?: boolean } = {},
): number | null {
  const value = raw[field];
  if (!Number.isSafeInteger(value) || (options.nonNegative && (value as number) < 0)) {
    diagnostics.push(
      makeQuestionDiagnostic(
        pack,
        question,
        `schema.${field}`,
        "question/schema-invalid-bound",
        options.nonNegative
          ? "must be a non-negative safe integer."
          : "must be a safe integer.",
      ),
    );
    return null;
  }
  return value as number;
}

function parseSchema(
  pack: string,
  question: string,
  value: unknown,
  diagnostics: QuestionDiagnostic[],
): QuestionSchema | null {
  if (!isRecord(value)) {
    diagnostics.push(
      makeQuestionDiagnostic(
        pack,
        question,
        "schema",
        "question/schema-invalid",
        "must be an object.",
      ),
    );
    return null;
  }

  const type = value.type;
  if (type === "string") {
    const allowed = new Set(["type", "minLength", "maxLength", "pattern"]);
    schemaFields(pack, question, value, allowed, diagnostics);

    const hasMin = own(value, "minLength");
    const hasMax = own(value, "maxLength");
    if (hasMin !== hasMax) {
      diagnostics.push(
        makeQuestionDiagnostic(
          pack,
          question,
          "schema",
          "question/schema-incomplete-bounds",
          "string length bounds must declare both `minLength` and `maxLength`.",
        ),
      );
    }

    let minLength: number | null = null;
    let maxLength: number | null = null;
    if (hasMin) {
      minLength = integerField(pack, question, value, "minLength", diagnostics, {
        nonNegative: true,
      });
    }
    if (hasMax) {
      maxLength = integerField(pack, question, value, "maxLength", diagnostics, {
        nonNegative: true,
      });
    }
    if (minLength !== null && maxLength !== null && minLength > maxLength) {
      diagnostics.push(
        makeQuestionDiagnostic(
          pack,
          question,
          "schema",
          "question/schema-invalid-range",
          "`minLength` must be less than or equal to `maxLength`.",
        ),
      );
    }

    let pattern: string | undefined;
    if (own(value, "pattern")) {
      if (typeof value.pattern !== "string" || value.pattern.length === 0) {
        diagnostics.push(
          makeQuestionDiagnostic(
            pack,
            question,
            "schema.pattern",
            "question/schema-invalid-pattern",
            "must be a non-empty regular-expression string.",
          ),
        );
      } else {
        let patternValid = true;
        if (!hasMin || !hasMax || minLength === null || maxLength === null) {
          patternValid = false;
          diagnostics.push(
            makeQuestionDiagnostic(
              pack,
              question,
              "schema.pattern",
              "question/schema-pattern-unbounded",
              "requires valid `minLength` and `maxLength` bounds.",
            ),
          );
        } else if (maxLength > MAX_PATTERN_INPUT_LENGTH) {
          patternValid = false;
          diagnostics.push(
            makeQuestionDiagnostic(
              pack,
              question,
              "schema.maxLength",
              "question/schema-pattern-input-too-large",
              `must not exceed ${MAX_PATTERN_INPUT_LENGTH} when a pattern is declared.`,
            ),
          );
        }

        const safetyIssue = patternSafetyError(value.pattern);
        if (safetyIssue !== null) {
          patternValid = false;
          diagnostics.push(
            makeQuestionDiagnostic(
              pack,
              question,
              "schema.pattern",
              "question/schema-unsafe-pattern",
              safetyIssue,
            ),
          );
        }
        try {
          new RegExp(value.pattern);
        } catch {
          patternValid = false;
          diagnostics.push(
            makeQuestionDiagnostic(
              pack,
              question,
              "schema.pattern",
              "question/schema-invalid-pattern",
              "must compile as a regular expression.",
            ),
          );
        }
        if (patternValid) pattern = value.pattern;
      }
    }

    if (hasMin && hasMax && minLength !== null && maxLength !== null) {
      return pattern === undefined
        ? { type: "string", minLength, maxLength }
        : { type: "string", minLength, maxLength, pattern };
    }
    return { type: "string" };
  }

  if (type === "boolean") {
    schemaFields(pack, question, value, new Set(["type"]), diagnostics);
    return { type: "boolean" };
  }

  if (type === "integer") {
    schemaFields(pack, question, value, new Set(["type", "minimum", "maximum"]), diagnostics);
    if (!own(value, "minimum") || !own(value, "maximum")) {
      diagnostics.push(
        makeQuestionDiagnostic(
          pack,
          question,
          "schema",
          "question/schema-incomplete-bounds",
          "integer schemas must declare both `minimum` and `maximum`.",
        ),
      );
    }
    const minimum = own(value, "minimum")
      ? integerField(pack, question, value, "minimum", diagnostics)
      : null;
    const maximum = own(value, "maximum")
      ? integerField(pack, question, value, "maximum", diagnostics)
      : null;
    if (minimum !== null && maximum !== null && minimum > maximum) {
      diagnostics.push(
        makeQuestionDiagnostic(
          pack,
          question,
          "schema",
          "question/schema-invalid-range",
          "`minimum` must be less than or equal to `maximum`.",
        ),
      );
    }
    return minimum === null || maximum === null
      ? null
      : { type: "integer", minimum, maximum };
  }

  if (type === "enum") {
    schemaFields(pack, question, value, new Set(["type", "values"]), diagnostics);
    if (!Array.isArray(value.values) || value.values.length === 0) {
      diagnostics.push(
        makeQuestionDiagnostic(
          pack,
          question,
          "schema.values",
          "question/schema-invalid-enum",
          "must be a non-empty array of unique non-empty strings.",
        ),
      );
      return null;
    }
    if (value.values.length > MAX_ENUM_VALUES) {
      diagnostics.push(
        makeQuestionDiagnostic(
          pack,
          question,
          "schema.values",
          "question/schema-enum-too-large",
          `must contain at most ${MAX_ENUM_VALUES} values.`,
        ),
      );
      return null;
    }
    const values: string[] = [];
    const seen = new Set<string>();
    for (let index = 0; index < value.values.length; index++) {
      const candidate = value.values[index];
      if (typeof candidate !== "string" || candidate.length === 0) {
        diagnostics.push(
          makeQuestionDiagnostic(
            pack,
            question,
            `schema.values[${index}]`,
            "question/schema-invalid-enum-value",
            "must be a non-empty string.",
          ),
        );
        continue;
      }
      if (seen.has(candidate)) {
        diagnostics.push(
          makeQuestionDiagnostic(
            pack,
            question,
            `schema.values[${index}]`,
            "question/schema-duplicate-enum-value",
            "duplicates an earlier enum value.",
          ),
        );
        continue;
      }
      seen.add(candidate);
      values.push(candidate);
    }
    return values.length === value.values.length ? { type: "enum", values } : null;
  }

  diagnostics.push(
    makeQuestionDiagnostic(
      pack,
      question,
      "schema.type",
      "question/schema-unsupported-type",
      "must be exactly `string`, `boolean`, `integer`, or `enum`.",
    ),
  );
  return null;
}

function valueFailure(
  declaration: QuestionDeclaration,
  source: QuestionValueSource,
  value: unknown,
  code: string,
  detail: string,
): QuestionValueValidation {
  return {
    valid: false,
    source,
    value,
    diagnostics: [makeQuestionDiagnostic(declaration.pack, declaration.id, "value", code, detail)],
  };
}

/** Validate one suggested, persisted, personal, or proposed value through the
 * exact same type-and-constraint path. */
export function validateQuestionValue(
  declaration: QuestionDeclaration,
  source: QuestionValueSource,
  value: unknown,
): QuestionValueValidation {
  const schema = declaration.schema;
  if (schema.type === "string") {
    if (typeof value !== "string") {
      return valueFailure(
        declaration,
        source,
        value,
        "question/value-type",
        `${source} value must be a string.`,
      );
    }
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      return valueFailure(
        declaration,
        source,
        value,
        "question/value-min-length",
        `${source} string is shorter than minLength ${schema.minLength}.`,
      );
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      return valueFailure(
        declaration,
        source,
        value,
        "question/value-max-length",
        `${source} string is longer than maxLength ${schema.maxLength}.`,
      );
    }
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) {
      return valueFailure(
        declaration,
        source,
        value,
        "question/value-pattern",
        `${source} string does not match the declared pattern.`,
      );
    }
  } else if (schema.type === "boolean") {
    if (typeof value !== "boolean") {
      return valueFailure(
        declaration,
        source,
        value,
        "question/value-type",
        `${source} value must be a boolean.`,
      );
    }
  } else if (schema.type === "integer") {
    if (!Number.isSafeInteger(value)) {
      return valueFailure(
        declaration,
        source,
        value,
        "question/value-type",
        `${source} value must be a safe integer.`,
      );
    }
    if ((value as number) < schema.minimum || (value as number) > schema.maximum) {
      return valueFailure(
        declaration,
        source,
        value,
        "question/value-range",
        `${source} integer must be between ${schema.minimum} and ${schema.maximum}, inclusive.`,
      );
    }
  } else if (typeof value !== "string" || !schema.values.includes(value)) {
    return valueFailure(
      declaration,
      source,
      value,
      "question/value-enum",
      `${source} value must be one of the declared enum strings.`,
    );
  }

  return { valid: true, source, value: value as QuestionValue, diagnostics: [] };
}

/** Parse a raw JSON profile template into ordered, body-free question records.
 * Any declaration/default defect rejects the complete set: `questions` is empty
 * and every deterministic diagnostic is returned. */
export function parseQuestionDeclarations(
  pack: string,
  rawTemplate: string,
): QuestionDeclarationResult {
  if (Buffer.byteLength(rawTemplate, "utf8") > MAX_PROFILE_TEMPLATE_BYTES) {
    return {
      ok: false,
      questions: [],
      diagnostics: [
        makeQuestionDiagnostic(
          pack,
          null,
          "template",
          "question/template-too-large",
          `must be at most ${MAX_PROFILE_TEMPLATE_BYTES} UTF-8 bytes.`,
        ),
      ],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawTemplate);
  } catch {
    return {
      ok: false,
      questions: [],
      diagnostics: [
        makeQuestionDiagnostic(
          pack,
          null,
          "template",
          "question/template-unparseable",
          "must be valid JSON.",
        ),
      ],
    };
  }

  if (!isRecord(parsed)) {
    return {
      ok: false,
      questions: [],
      diagnostics: [
        makeQuestionDiagnostic(
          pack,
          null,
          "template",
          "question/template-invalid",
          "must be a JSON object.",
        ),
      ],
    };
  }

  if (!own(parsed, "ask")) return { ok: true, questions: [], diagnostics: [] };
  if (!Array.isArray(parsed.ask)) {
    return {
      ok: false,
      questions: [],
      diagnostics: [
        makeQuestionDiagnostic(
          pack,
          null,
          "ask",
          "question/ask-invalid",
          "must be an array.",
        ),
      ],
    };
  }
  if (parsed.ask.length > MAX_QUESTIONS_PER_TEMPLATE) {
    return {
      ok: false,
      questions: [],
      diagnostics: [
        makeQuestionDiagnostic(
          pack,
          null,
          "ask",
          "question/ask-too-many",
          `must contain at most ${MAX_QUESTIONS_PER_TEMPLATE} questions.`,
        ),
      ],
    };
  }

  const diagnostics: QuestionDiagnostic[] = [];
  const declarations: QuestionDeclaration[] = [];
  const suggestedDefaults = new Map<QuestionDeclaration, unknown>();
  const ids = new Set<string>();
  const destinations = new Set<string>();

  for (let index = 0; index < parsed.ask.length; index++) {
    const raw = parsed.ask[index];
    const fallback = `ask[${index}]`;
    if (!isRecord(raw)) {
      diagnostics.push(
        makeQuestionDiagnostic(
          pack,
          fallback,
          "declaration",
          "question/declaration-invalid",
          "must be an object.",
        ),
      );
      continue;
    }

    const question = typeof raw.id === "string" && raw.id.length > 0 ? raw.id : fallback;
    const unknownFieldCount = Object.keys(raw).filter(
      (key) => !DECLARATION_FIELDS.has(key),
    ).length;
    for (let fieldIndex = 0; fieldIndex < unknownFieldCount; fieldIndex++) {
      diagnostics.push(
        makeQuestionDiagnostic(
          pack,
          question,
          "declaration",
          "question/declaration-unknown-field",
          "unknown declaration field.",
        ),
      );
    }

    const id = raw.id;
    if (typeof id !== "string" || !ID_RE.test(id)) {
      diagnostics.push(
        makeQuestionDiagnostic(
          pack,
          question,
          "id",
          "question/id-invalid",
          "must be a lowercase hyphenated identifier.",
        ),
      );
    } else if (ids.has(id)) {
      diagnostics.push(
        makeQuestionDiagnostic(pack, id, "id", "question/id-duplicate", "duplicates an earlier question id."),
      );
    } else {
      ids.add(id);
    }

    const destination = raw.destination;
    if (
      typeof destination !== "string" ||
      !DESTINATION_RE.test(destination) ||
      destination === "ask"
    ) {
      diagnostics.push(
        makeQuestionDiagnostic(
          pack,
          question,
          "destination",
          "question/destination-invalid",
          "must be a non-empty profile key/path and must not be `ask`.",
        ),
      );
    } else if (destinations.has(destination)) {
      diagnostics.push(
        makeQuestionDiagnostic(
          pack,
          question,
          "destination",
          "question/destination-duplicate",
          "duplicates an earlier destination.",
        ),
      );
    } else {
      destinations.add(destination);
    }

    const prompt = raw.prompt;
    if (typeof prompt !== "string" || prompt.trim().length === 0) {
      diagnostics.push(
        makeQuestionDiagnostic(
          pack,
          question,
          "prompt",
          "question/prompt-invalid",
          "must be a non-empty string.",
        ),
      );
    } else if (prompt.length > MAX_PROMPT_LENGTH) {
      diagnostics.push(
        makeQuestionDiagnostic(
          pack,
          question,
          "prompt",
          "question/prompt-too-long",
          `must be at most ${MAX_PROMPT_LENGTH} characters.`,
        ),
      );
    }

    const beforeSchema = diagnostics.length;
    const schema = parseSchema(pack, question, raw.schema, diagnostics);
    const structurallyValid =
      typeof id === "string" &&
      ID_RE.test(id) &&
      typeof destination === "string" &&
      DESTINATION_RE.test(destination) &&
      destination !== "ask" &&
      typeof prompt === "string" &&
      prompt.trim().length > 0 &&
      prompt.length <= MAX_PROMPT_LENGTH &&
      schema !== null &&
      diagnostics.length === beforeSchema;

    if (!structurallyValid) continue;

    const declaration: QuestionDeclaration = {
      pack,
      id,
      destination,
      prompt,
      schema,
    };
    if (own(raw, "suggestedDefault")) suggestedDefaults.set(declaration, raw.suggestedDefault);
    declarations.push(declaration);
  }

  // Duplicate diagnostics may have been emitted after an earlier declaration was
  // tentatively accepted; the all-or-nothing return below prevents partial output.
  if (diagnostics.length > 0) {
    return { ok: false, questions: [], diagnostics: finalizeDiagnostics(pack, diagnostics) };
  }

  const questions: QuestionRecord[] = [];
  for (const declaration of declarations) {
    const suggestions: QuestionSuggestion[] = [];
    if (suggestedDefaults.has(declaration)) {
      const checked = validateQuestionValue(
        declaration,
        "suggested-default",
        suggestedDefaults.get(declaration),
      );
      if (!checked.valid) diagnostics.push(...checked.diagnostics);
      else {
        declaration.suggestedDefault = checked.value;
        suggestions.push({ source: "suggested-default", value: checked.value });
      }
    }
    if (own(parsed, declaration.destination)) {
      const checked = validateQuestionValue(
        declaration,
        "pack-default",
        parsed[declaration.destination],
      );
      if (!checked.valid) diagnostics.push(...checked.diagnostics);
      else suggestions.push({ source: "pack-default", value: checked.value });
    }
    questions.push({
      ...declaration,
      state: { status: "unresolved", source: null, value: null, suggestions },
    });
  }

  if (diagnostics.length > 0) {
    return { ok: false, questions: [], diagnostics: finalizeDiagnostics(pack, diagnostics) };
  }
  const sizeDiagnostic = normalizedMetadataDiagnostic(pack, questions);
  return sizeDiagnostic === null
    ? { ok: true, questions, diagnostics: [] }
    : { ok: false, questions: [], diagnostics: [sizeDiagnostic] };
}

export interface QuestionValueInputs {
  /** Optional personal profile values; valid values remain attributed suggestions. */
  personal?: Record<string, unknown> | null;
  /** Explicitly persisted project answers; only these can resolve a question. */
  persisted?: Record<string, unknown> | null;
}

/** Apply personal suggestions and persisted answers to a complete declaration
 * set. Invalid values reject the complete set; a valid persisted own-property at
 * `destination` is the only transition to `resolved`. */
export function applyQuestionValues(
  questions: readonly QuestionRecord[],
  inputs: QuestionValueInputs,
): QuestionDeclarationResult {
  const diagnostics: QuestionDiagnostic[] = [];
  const resolved: QuestionRecord[] = [];

  for (const question of questions) {
    const suggestions = [...question.state.suggestions];
    if (inputs.personal && own(inputs.personal, question.destination)) {
      const checked = validateQuestionValue(
        question,
        "personal",
        inputs.personal[question.destination],
      );
      if (!checked.valid) diagnostics.push(...checked.diagnostics);
      else suggestions.push({ source: "personal", value: checked.value });
    }

    if (inputs.persisted && own(inputs.persisted, question.destination)) {
      const checked = validateQuestionValue(
        question,
        "persisted",
        inputs.persisted[question.destination],
      );
      if (!checked.valid) {
        diagnostics.push(...checked.diagnostics);
        resolved.push({
          ...question,
          state: { status: "unresolved", source: null, value: null, suggestions },
        });
      } else {
        resolved.push({
          ...question,
          state: {
            status: "resolved",
            source: "persisted",
            value: checked.value,
            suggestions,
          },
        });
      }
    } else {
      resolved.push({
        ...question,
        state: { status: "unresolved", source: null, value: null, suggestions },
      });
    }
  }

  const pack = resolved[0]?.pack ?? questions[0]?.pack ?? "unknown";
  if (diagnostics.length > 0) {
    return { ok: false, questions: [], diagnostics: finalizeDiagnostics(pack, diagnostics) };
  }
  const sizeDiagnostic = normalizedMetadataDiagnostic(pack, resolved);
  return sizeDiagnostic === null
    ? { ok: true, questions: resolved, diagnostics: [] }
    : { ok: false, questions: [], diagnostics: [sizeDiagnostic] };
}
