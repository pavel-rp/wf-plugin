// The panel: a titled block of lines, with an optional status badge.
//
// Host-free and pure. One definition renders to plain text, ANSI and markdown:
//
//   ┌ Build — ✗ Error
//   │ 3 tests failed
//   │ see the log
//   └
//
// There is no right border, so the panel never measures text width. In ANSI
// only the border glyphs are coloured (with the status colour, or `muted`).

import { escapeMarkdown } from './sanitize.mjs';
import { resolveRenderOptions, paint, requireText, toBadge, badgeIn } from './style.mjs';

/**
 * @typedef {{ title: string, badge?: Readonly<{ glyph: string, label: string, token: string }>, body: readonly string[] }} PanelDef
 */

/** @param {unknown} body @returns {unknown[]} */
function bodyLines(body) {
  if (body === undefined) return [];
  if (typeof body === 'string' || typeof body === 'number') return [body];
  if (!Array.isArray(body)) throw new TypeError('panel body must be a string or an array of lines');
  return body;
}

/**
 * Define a panel. The title and every body line are sanitized here and must
 * not be empty afterwards; `status` composes the status badge.
 *
 * @param {{ title: string, status?: string | object, body?: string | Array<string | number> }} spec
 * @returns {Readonly<PanelDef>}
 */
export function definePanel(spec) {
  if (!spec || typeof spec !== 'object') throw new TypeError('definePanel needs a spec object');
  const title = requireText(spec.title, 'panel title');
  const badge = toBadge(spec.status);
  const body = Object.freeze(bodyLines(spec.body).map((line, i) => requireText(line, `panel body line ${i + 1}`)));
  return Object.freeze({ title, badge, body });
}

/**
 * Render a panel as `plain` (default), `ansi` or `markdown`. Content is
 * sanitized again here, so a hand-built definition is made inert too.
 *
 * @param {PanelDef} def
 * @param {Partial<import('./style.mjs').RenderOptions>} [options]
 * @returns {string}
 */
export function renderPanel(def, options) {
  const o = resolveRenderOptions(options);
  const title = requireText(def.title, 'panel title');
  const body = bodyLines(def.body).map((line, i) => requireText(line, `panel body line ${i + 1}`));
  const badge = def.badge;

  if (o.format === 'markdown') {
    const head = `**${escapeMarkdown(title)}**${badge ? ` — ${badgeIn(badge, o)}` : ''}`;
    return [head, ...body.map((line) => `> ${escapeMarkdown(line)}`)].join('\n');
  }

  const border = badge ? badge.token : 'muted';
  const head = `${paint('┌', border, o)} ${title}${badge ? ` — ${badgeIn(badge, o)}` : ''}`;
  const lines = body.map((line) => `${paint('│', border, o)} ${line}`);
  return [head, ...lines, paint('└', border, o)].join('\n');
}
