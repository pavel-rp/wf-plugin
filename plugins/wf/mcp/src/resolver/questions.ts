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

function diagnostic(
  pack: string,
  question: string | null,
  field: string,
  code: string,
  detail: string,
): QuestionDiagnostic {
  const owner = question === null ? `pack \`${pack}\`` : `pack \`${pack}\`, question \`${question}\``;
  return {
    code,
    pack,
    question,
    field,
    message: `${owner}, field \`${field}\`: ${detail}`,
  };
}

function schemaFields(
  pack: string,
  question: string,
  raw: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  diagnostics: QuestionDiagnostic[],
): void {
  for (const field of Object.keys(raw).filter((key) => !allowed.has(key)).sort()) {
    diagnostics.push(
      diagnostic(
        pack,
        question,
        `schema.${field}`,
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
      diagnostic(
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
      diagnostic(
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
        diagnostic(
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
        diagnostic(
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
          diagnostic(
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
            diagnostic(
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
            diagnostic(
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
            diagnostic(
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
        } catch (err) {
          patternValid = false;
          diagnostics.push(
            diagnostic(
              pack,
              question,
              "schema.pattern",
              "question/schema-invalid-pattern",
              `must compile as a regular expression: ${
                err instanceof Error ? err.message : String(err)
              }`,
            ),
          );
        }
        if (patternValid) pattern = value.pattern;
      }
    }

    const schema: QuestionSchema = { type: "string" };
    if (hasMin && minLength !== null) schema.minLength = minLength;
    if (hasMax && maxLength !== null) schema.maxLength = maxLength;
    if (pattern !== undefined) schema.pattern = pattern;
    return schema;
  }

  if (type === "boolean") {
    schemaFields(pack, question, value, new Set(["type"]), diagnostics);
    return { type: "boolean" };
  }

  if (type === "integer") {
    schemaFields(pack, question, value, new Set(["type", "minimum", "maximum"]), diagnostics);
    if (!own(value, "minimum") || !own(value, "maximum")) {
      diagnostics.push(
        diagnostic(
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
        diagnostic(
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
        diagnostic(
          pack,
          question,
          "schema.values",
          "question/schema-invalid-enum",
          "must be a non-empty array of unique non-empty strings.",
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
          diagnostic(
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
          diagnostic(
            pack,
            question,
            `schema.values[${index}]`,
            "question/schema-duplicate-enum-value",
            `duplicates enum value \`${candidate}\`.`,
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
    diagnostic(
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
    diagnostics: [diagnostic(declaration.pack, declaration.id, "value", code, detail)],
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

  return { valid: true, source, value, diagnostics: [] };
}

/** Parse a raw JSON profile template into ordered, body-free question records.
 * Any declaration/default defect rejects the complete set: `questions` is empty
 * and every deterministic diagnostic is returned. */
export function parseQuestionDeclarations(
  pack: string,
  rawTemplate: string,
): QuestionDeclarationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawTemplate);
  } catch (err) {
    return {
      ok: false,
      questions: [],
      diagnostics: [
        diagnostic(
          pack,
          null,
          "template",
          "question/template-unparseable",
          `must be valid JSON: ${err instanceof Error ? err.message : String(err)}`,
        ),
      ],
    };
  }

  if (!isRecord(parsed)) {
    return {
      ok: false,
      questions: [],
      diagnostics: [
        diagnostic(
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
        diagnostic(
          pack,
          null,
          "ask",
          "question/ask-invalid",
          "must be an array.",
        ),
      ],
    };
  }

  const diagnostics: QuestionDiagnostic[] = [];
  const declarations: QuestionDeclaration[] = [];
  const ids = new Set<string>();
  const destinations = new Set<string>();

  for (let index = 0; index < parsed.ask.length; index++) {
    const raw = parsed.ask[index];
    const fallback = `ask[${index}]`;
    if (!isRecord(raw)) {
      diagnostics.push(
        diagnostic(
          pack,
          fallback,
          fallback,
          "question/declaration-invalid",
          "must be an object.",
        ),
      );
      continue;
    }

    const question = typeof raw.id === "string" && raw.id.length > 0 ? raw.id : fallback;
    for (const field of Object.keys(raw).filter((key) => !DECLARATION_FIELDS.has(key)).sort()) {
      diagnostics.push(
        diagnostic(
          pack,
          question,
          field,
          "question/declaration-unknown-field",
          "unknown declaration field.",
        ),
      );
    }

    const id = raw.id;
    if (typeof id !== "string" || !ID_RE.test(id)) {
      diagnostics.push(
        diagnostic(
          pack,
          question,
          "id",
          "question/id-invalid",
          "must be a lowercase hyphenated identifier.",
        ),
      );
    } else if (ids.has(id)) {
      diagnostics.push(
        diagnostic(pack, id, "id", "question/id-duplicate", `duplicates question id \`${id}\`.`),
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
        diagnostic(
          pack,
          question,
          "destination",
          "question/destination-invalid",
          "must be a non-empty profile key/path and must not be `ask`.",
        ),
      );
    } else if (destinations.has(destination)) {
      diagnostics.push(
        diagnostic(
          pack,
          question,
          "destination",
          "question/destination-duplicate",
          `duplicates destination \`${destination}\`.`,
        ),
      );
    } else {
      destinations.add(destination);
    }

    const prompt = raw.prompt;
    if (typeof prompt !== "string" || prompt.trim().length === 0) {
      diagnostics.push(
        diagnostic(
          pack,
          question,
          "prompt",
          "question/prompt-invalid",
          "must be a non-empty string.",
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
    if (own(raw, "suggestedDefault")) declaration.suggestedDefault = raw.suggestedDefault;
    declarations.push(declaration);
  }

  // Duplicate diagnostics may have been emitted after an earlier declaration was
  // tentatively accepted; the all-or-nothing return below prevents partial output.
  if (diagnostics.length > 0) return { ok: false, questions: [], diagnostics };

  const questions: QuestionRecord[] = [];
  for (const declaration of declarations) {
    const suggestions: QuestionSuggestion[] = [];
    if (own(declaration as unknown as Record<string, unknown>, "suggestedDefault")) {
      const checked = validateQuestionValue(
        declaration,
        "suggested-default",
        declaration.suggestedDefault,
      );
      if (!checked.valid) diagnostics.push(...checked.diagnostics);
      else suggestions.push({ source: "suggested-default", value: checked.value });
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

  return diagnostics.length > 0
    ? { ok: false, questions: [], diagnostics }
    : { ok: true, questions, diagnostics: [] };
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

  return diagnostics.length > 0
    ? { ok: false, questions: [], diagnostics }
    : { ok: true, questions: resolved, diagnostics: [] };
}
