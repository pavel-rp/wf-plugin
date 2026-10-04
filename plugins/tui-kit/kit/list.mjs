// The list: bulleted or numbered items, each with an optional status badge.
//
// Host-free and pure. One definition renders to plain text, ANSI and markdown:
//
//   - ✓ OK · lint
//   - ✗ Error · tests
//   - docs
//
// In ANSI only the item markers are coloured (`muted`); badges carry their
// own colour.

import { escapeMarkdown } from './sanitize.mjs';
import { resolveRenderOptions, paint, requireText, toBadge, badgeIn } from './style.mjs';

/**
 * @typedef {{ text: string, badge?: Readonly<{ glyph: string, label: string, token: string }> }} ListItem
 * @typedef {{ items: readonly Readonly<ListItem>[], ordered: boolean }} ListDef
 */

/** @param {unknown} item @param {number} i @returns {Readonly<ListItem>} */
function toItem(item, i) {
  if (typeof item === 'string' || typeof item === 'number') {
    return Object.freeze({ text: requireText(item, `list item ${i + 1}`), badge: undefined });
  }
  if (!item || typeof item !== 'object') throw new TypeError(`list item ${i + 1} must be text or { text, status }`);
  const spec = /** @type {{ text?: unknown, status?: unknown }} */ (item);
  return Object.freeze({ text: requireText(spec.text, `list item ${i + 1}`), badge: toBadge(spec.status) });
}

/** @param {unknown} items */
function requireItems(items) {
  if (!Array.isArray(items) || items.length === 0) throw new TypeError('a list needs a non-empty items array');
  return items;
}

/**
 * Define a list. Every item is sanitized here and must not be empty
 * afterwards; an item's `status` composes the status badge.
 *
 * @param {{ items: Array<string | number | { text: string, status?: string | object }>, ordered?: boolean }} spec
 * @returns {Readonly<ListDef>}
 */
export function defineList(spec) {
  if (!spec || typeof spec !== 'object') throw new TypeError('defineList needs a spec object');
  const items = Object.freeze(requireItems(spec.items).map(toItem));
  return Object.freeze({ items, ordered: spec.ordered === true });
}

/**
 * Render a list as `plain` (default), `ansi` or `markdown`. Items are
 * sanitized again here, so a hand-built definition is made inert too.
 *
 * @param {ListDef} def
 * @param {Partial<import('./style.mjs').RenderOptions>} [options]
 * @returns {string}
 */
export function renderList(def, options) {
  const o = resolveRenderOptions(options);
  return requireItems(def.items)
    .map((item, i) => {
      const text = requireText(item?.text, `list item ${i + 1}`);
      const marker = def.ordered === true ? `${i + 1}.` : '-';
      const status = item.badge ? `${badgeIn(item.badge, o)} · ` : '';
      if (o.format === 'markdown') return `${marker} ${status}${escapeMarkdown(text)}`;
      return `${paint(marker, 'muted', o)} ${status}${text}`;
    })
    .join('\n');
}
