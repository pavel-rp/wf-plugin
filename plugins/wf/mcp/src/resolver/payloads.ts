// wf resolver — validated pack payload declarations (WF-442).
//
// This module is pure: it validates one optional ordered manifest table and
// returns body-free, provenance-tagged rows. Filesystem source checks happen at
// pack inspection through the contained fingerprint port.

import type { RawManifestTable } from "./manifest.js";
import { resolveContainedCapabilityPath } from "./paths.js";
import type {
  PayloadDeclaration,
  PayloadDeclarationResult,
  PayloadDiagnostic,
  PayloadProduction,
  PayloadRefresh,
  PayloadRemoval,
} from "./types.js";

export const PAYLOAD_COLUMNS = [
  "source",
  "destination",
  "production",
  "refresh",
  "removal",
] as const;
export const MAX_PAYLOADS_PER_CAPABILITY = 256;
export const MAX_PAYLOAD_DIAGNOSTICS = 256;
export const MAX_NORMALIZED_PAYLOAD_BYTES = 256 * 1024;
const MAX_LABEL_LENGTH = 128;

function safeLabel(value: string, pattern: RegExp, fallback: string): string {
  return value.length <= MAX_LABEL_LENGTH && pattern.test(value) ? value : fallback;
}

export function makePayloadDiagnostic(
  pluginId: string,
  capability: string,
  row: number | null,
  field: PayloadDiagnostic["field"],
  code: string,
  detail: string,
): PayloadDiagnostic {
  const safePlugin = safeLabel(pluginId, /^[A-Za-z0-9][A-Za-z0-9@._-]*$/, "(invalid-plugin)");
  const safeCapability = safeLabel(
    capability,
    /^[a-z0-9][a-z0-9-]*$/,
    "(invalid-capability)",
  );
  const owner = `plugin \`${safePlugin}\`, capability \`${safeCapability}\``;
  const rowLabel = row === null ? "" : `, payload row ${row}`;
  return {
    code,
    pluginId: safePlugin,
    capability: safeCapability,
    row,
    field,
    message: `${owner}${rowLabel}, field \`${field}\`: ${detail}`,
  };
}

function diagnosticBytes(diagnostics: readonly PayloadDiagnostic[]): number {
  return Buffer.byteLength(JSON.stringify(diagnostics), "utf8");
}

function finalizeDiagnostics(
  pluginId: string,
  capability: string,
  diagnostics: readonly PayloadDiagnostic[],
): PayloadDiagnostic[] {
  const retained: PayloadDiagnostic[] = [];
  let truncated = false;
  for (const diagnostic of diagnostics) {
    if (retained.length >= MAX_PAYLOAD_DIAGNOSTICS) {
      truncated = true;
      break;
    }
    if (diagnosticBytes([...retained, diagnostic]) > MAX_NORMALIZED_PAYLOAD_BYTES) {
      truncated = true;
      break;
    }
    retained.push(diagnostic);
  }
  if (!truncated) return retained;

  const sentinel = makePayloadDiagnostic(
    pluginId,
    capability,
    null,
    "table",
    "payload/diagnostics-truncated",
    "additional diagnostics omitted after aggregate limit.",
  );
  while (
    retained.length >= MAX_PAYLOAD_DIAGNOSTICS ||
    diagnosticBytes([...retained, sentinel]) > MAX_NORMALIZED_PAYLOAD_BYTES
  ) {
    retained.pop();
  }
  return [...retained, sentinel];
}

/** Validate the shared lexical grammar without resolving or probing a workspace
 * target. The synthetic root is used only to reuse the capability-relative path
 * shape check; the returned joined path is discarded. */
export function isPayloadRelativePath(value: string): boolean {
  return resolveContainedCapabilityPath("/capability", value) !== null;
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase();
}

function fieldDiagnostic(
  diagnostics: PayloadDiagnostic[],
  pluginId: string,
  capability: string,
  row: number,
  field: PayloadDiagnostic["field"],
  code: string,
  detail: string,
): void {
  diagnostics.push(makePayloadDiagnostic(pluginId, capability, row, field, code, detail));
}

/** Validate one capability's optional `## Payloads` table. An absent table or a
 * correct header-only table is inert. Any defect rejects the complete row set. */
export function validatePayloadDeclarations(
  pluginId: string,
  capability: string,
  table: RawManifestTable | null,
): PayloadDeclarationResult {
  if (table === null) return { ok: true, payloads: [], diagnostics: [] };

  const diagnostics: PayloadDiagnostic[] = [];
  if (table.sectionCount !== 1) {
    diagnostics.push(
      makePayloadDiagnostic(
        pluginId,
        capability,
        null,
        "table",
        "payload/table-duplicate",
        "must declare exactly one `## Payloads` section.",
      ),
    );
  }
  if (table.rows.length > MAX_PAYLOADS_PER_CAPABILITY) {
    diagnostics.push(
      makePayloadDiagnostic(
        pluginId,
        capability,
        null,
        "table",
        "payload/table-too-many",
        `must contain at most ${MAX_PAYLOADS_PER_CAPABILITY} rows.`,
      ),
    );
  }

  const headers = table.headers.map(normalizeHeader);
  const headerSet = new Set(headers);
  for (const expected of PAYLOAD_COLUMNS) {
    const count = headers.filter((header) => header === expected).length;
    if (count === 0) {
      diagnostics.push(
        makePayloadDiagnostic(
          pluginId,
          capability,
          null,
          "table",
          "payload/table-missing-column",
          `missing required \`${expected}\` column.`,
        ),
      );
    } else if (count > 1) {
      diagnostics.push(
        makePayloadDiagnostic(
          pluginId,
          capability,
          null,
          "table",
          "payload/table-duplicate-column",
          `declares \`${expected}\` more than once.`,
        ),
      );
    }
  }
  for (const header of headerSet) {
    if (!PAYLOAD_COLUMNS.includes(header as (typeof PAYLOAD_COLUMNS)[number])) {
      diagnostics.push(
        makePayloadDiagnostic(
          pluginId,
          capability,
          null,
          "table",
          "payload/table-unknown-column",
          "contains an unknown column.",
        ),
      );
    }
  }

  if (diagnostics.length > 0) {
    return {
      ok: false,
      payloads: [],
      diagnostics: finalizeDiagnostics(pluginId, capability, diagnostics),
    };
  }

  const indexes = Object.fromEntries(headers.map((header, index) => [header, index])) as Record<
    (typeof PAYLOAD_COLUMNS)[number],
    number
  >;
  const payloads: PayloadDeclaration[] = [];

  for (let index = 0; index < table.rows.length; index++) {
    const rowNumber = index + 1;
    const cells = table.rows[index];
    if (cells.length !== headers.length) {
      diagnostics.push(
        makePayloadDiagnostic(
          pluginId,
          capability,
          rowNumber,
          "table",
          "payload/row-width",
          "must contain exactly one cell for every declared column.",
        ),
      );
      continue;
    }

    const source = cells[indexes.source] ?? "";
    const destination = cells[indexes.destination] ?? "";
    const production = cells[indexes.production] ?? "";
    const refresh = cells[indexes.refresh] ?? "";
    const removal = cells[indexes.removal] ?? "";
    const before = diagnostics.length;

    if (!isPayloadRelativePath(source)) {
      fieldDiagnostic(
        diagnostics,
        pluginId,
        capability,
        rowNumber,
        "source",
        "payload/source-invalid",
        "must be a non-empty forward-slash relative file path with no absolute prefix, drive prefix, backslash, NUL, colon, empty segment, `.` segment, or `..` segment.",
      );
    }
    if (!isPayloadRelativePath(destination)) {
      fieldDiagnostic(
        diagnostics,
        pluginId,
        capability,
        rowNumber,
        "destination",
        "payload/destination-invalid",
        "must be a non-empty forward-slash workspace-relative lexical path with no absolute prefix, drive prefix, backslash, NUL, colon, empty segment, `.` segment, or `..` segment.",
      );
    }
    if (production !== "copy") {
      fieldDiagnostic(
        diagnostics,
        pluginId,
        capability,
        rowNumber,
        "production",
        "payload/production-invalid",
        "must be exactly `copy`.",
      );
    }
    if (refresh !== "replace-if-unmodified" && refresh !== "retain") {
      fieldDiagnostic(
        diagnostics,
        pluginId,
        capability,
        rowNumber,
        "refresh",
        "payload/refresh-invalid",
        "must be exactly `replace-if-unmodified` or `retain`.",
      );
    }
    if (removal !== "delete-if-unmodified" && removal !== "retain") {
      fieldDiagnostic(
        diagnostics,
        pluginId,
        capability,
        rowNumber,
        "removal",
        "payload/removal-invalid",
        "must be exactly `delete-if-unmodified` or `retain`.",
      );
    }

    if (diagnostics.length === before) {
      payloads.push({
        pluginId,
        capability,
        source,
        destination,
        production: production as PayloadProduction,
        refresh: refresh as PayloadRefresh,
        removal: removal as PayloadRemoval,
      });
    }
  }

  if (diagnostics.length > 0) {
    return {
      ok: false,
      payloads: [],
      diagnostics: finalizeDiagnostics(pluginId, capability, diagnostics),
    };
  }

  const bytes = Buffer.byteLength(JSON.stringify(payloads), "utf8");
  if (bytes > MAX_NORMALIZED_PAYLOAD_BYTES) {
    return {
      ok: false,
      payloads: [],
      diagnostics: [
        makePayloadDiagnostic(
          pluginId,
          capability,
          null,
          "table",
          "payload/metadata-too-large",
          `normalized payload metadata must be at most ${MAX_NORMALIZED_PAYLOAD_BYTES} UTF-8 bytes.`,
        ),
      ],
    };
  }

  return { ok: true, payloads, diagnostics: [] };
}
