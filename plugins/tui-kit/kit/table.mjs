// The table: aligned records under column headers. A cell is text or a
// status badge.
//
// Host-free and pure. One definition renders to plain text, ANSI and markdown:
//
//   Check  Result   Time
//   -----  -------  ----
//   lint   ✓ OK      12
//   tests  ✗ Error  340
//
// Plain columns are padded by code-point count. A wide character (for example
// an East Asian ideograph or an emoji) still counts as one, so such a column
// can look ragged in a terminal. Markdown is a GFM table whose cells are
// escaped, so a `|` in content is written `\|` and never splits a cell. In
// ANSI only the rule under the headers is coloured (`muted`).

import { escapeMarkdown } from './sanitize.mjs';
import { resolveRenderOptions, paint, requireText, toBadge, badgeIn, codePointLength } from './style.mjs';

/** Column alignments. */
export const ALIGNMENTS = Object.freeze(['left', 'right']);

/**
 * @typedef {Readonly<{ glyph: string, label: string, token: string }>} Badge
 * @typedef {Readonly<{ text: string } | { badge: Badge }>} Cell
 * @typedef {Readonly<{ key: string, header: string, align: 'left' | 'right' }>} Column
 * @typedef {{ columns: readonly Column[], rows: readonly (readonly Cell[])[] }} TableDef
 */

/** @param {unknown} col @param {number} i @returns {Column} */
function toColumn(col, i) {
  if (!col || typeof col !== 'object') throw new TypeError(`column ${i + 1} must be { key, header, align? }`);
  const spec = /** @type {{ key?: unknown, header?: unknown, align?: unknown }} */ (col);
  if (typeof spec.key !== 'string' || spec.key === '') throw new TypeError(`column ${i + 1} needs a non-empty string key`);
  const align = spec.align ?? 'left';
  if (!ALIGNMENTS.includes(/** @type {any} */ (align))) throw new RangeError(`column ${i + 1}: unknown align ${JSON.stringify(align)}`);
  return Object.freeze({
    key: spec.key,
    header: requireText(spec.header, `column ${i + 1} header`),
    align: /** @type {'left' | 'right'} */ (align),
  });
}

/** @param {unknown} value @param {string} where @returns {Cell} */
function toCell(value, where) {
  if (typeof value === 'string' || typeof value === 'number') return Object.freeze({ text: requireText(value, where) });
  if (value && typeof value === 'object') return Object.freeze({ badge: /** @type {Badge} */ (toBadge(value)) });
  throw new TypeError(`${where} must be text, a number or a status badge spec`);
}

/** @param {unknown} columns */
function requireColumns(columns) {
  if (!Array.isArray(columns) || columns.length === 0) throw new TypeError('a table needs a non-empty columns array');
  return columns;
}

/**
 * Define a table. A row value is read only from the row's own property named
 * by the column key, so an inherited name such as `toString` is never a cell.
 * Headers and text cells are sanitized here and must not be empty afterwards.
 *
 * @param {{ columns: Array<{ key: string, header: string, align?: 'left' | 'right' }>, rows?: Array<Record<string, unknown>> }} spec
 * @returns {Readonly<TableDef>}
 */
export function defineTable(spec) {
  if (!spec || typeof spec !== 'object') throw new TypeError('defineTable needs a spec object');
  const columns = Object.freeze(requireColumns(spec.columns).map(toColumn));
  const rowsIn = spec.rows ?? [];
  if (!Array.isArray(rowsIn)) throw new TypeError('table rows must be an array');
  const rows = Object.freeze(
    rowsIn.map((row, r) => {
      if (!row || typeof row !== 'object') throw new TypeError(`row ${r + 1} must be an object`);
      return Object.freeze(
        columns.map((col) => {
          const where = `row ${r + 1}, column ${JSON.stringify(col.key)}`;
          if (!Object.hasOwn(row, col.key)) throw new TypeError(`${where} has no value`);
          return toCell(/** @type {Record<string, unknown>} */ (row)[col.key], where);
        }),
      );
    }),
  );
  return Object.freeze({ columns, rows });
}

/**
 * Render a table as `plain` (default), `ansi` or `markdown`. Headers and cells
 * are sanitized again here, so a hand-built definition is made inert too.
 *
 * @param {TableDef} def
 * @param {Partial<import('./style.mjs').RenderOptions>} [options]
 * @returns {string}
 */
export function renderTable(def, options) {
  const o = resolveRenderOptions(options);
  const columns = requireColumns(def.columns).map((col, i) => {
    const align = col?.align ?? 'left';
    if (!ALIGNMENTS.includes(align)) throw new RangeError(`column ${i + 1}: unknown align ${JSON.stringify(align)}`);
    return { header: requireText(col.header, `column ${i + 1} header`), align };
  });
  if (!Array.isArray(def.rows)) throw new TypeError('table rows must be an array');

  /** One cell, in this format, plus its plain text for measuring. */
  const cell = (/** @type {any} */ c, /** @type {string} */ where) => {
    if (c && typeof c === 'object' && Object.hasOwn(c, 'badge') && c.badge) {
      return { out: badgeIn(c.badge, o), plain: badgeIn(c.badge, { ...o, format: 'plain' }) };
    }
    const text = requireText(c?.text, where);
    return { out: o.format === 'markdown' ? escapeMarkdown(text) : text, plain: text };
  };

  const header = columns.map((col) => ({ out: o.format === 'markdown' ? escapeMarkdown(col.header) : col.header, plain: col.header }));
  const body = def.rows.map((row, r) => {
    if (!Array.isArray(row) || row.length !== columns.length) {
      throw new TypeError(`row ${r + 1} must hold one cell per column`);
    }
    return row.map((c, j) => cell(c, `row ${r + 1}, column ${j + 1}`));
  });

  if (o.format === 'markdown') {
    const line = (/** @type {{ out: string }[]} */ cells) => `| ${cells.map((c) => c.out).join(' | ')} |`;
    const rule = `| ${columns.map((col) => (col.align === 'right' ? '---:' : '---')).join(' | ')} |`;
    return [line(header), rule, ...body.map(line)].join('\n');
  }

  // A loop rather than Math.max(...spread), so a long table never exceeds the
  // engine's argument limit.
  const widths = columns.map((_, j) =>
    body.reduce((w, cells) => Math.max(w, codePointLength(cells[j].plain)), codePointLength(header[j].plain)),
  );
  const last = columns.length - 1;
  const line = (/** @type {{ out: string, plain: string }[]} */ cells) =>
    cells
      .map((c, j) => {
        const pad = ' '.repeat(widths[j] - codePointLength(c.plain));
        if (columns[j].align === 'right') return pad + c.out;
        return j === last ? c.out : c.out + pad;
      })
      .join('  ');
  const rule = paint(widths.map((w) => '-'.repeat(w)).join('  '), 'muted', o);
  return [line(header), rule, ...body.map(line)].join('\n');
}
