// The meter: a labelled quantity out of a maximum, with an optional status
// badge.
//
// Host-free and pure. One definition renders to plain text, ANSI and markdown:
//
//   Disk ! Warning [████████░░] 80% (8/10)
//
// The percentage and the value/max always appear as text, so the bar is
// decoration only: colour, or the bar itself, can be lost without losing a
// fact. Under a screen-reader profile the bar is left out, so a reader hears
// the numbers rather than a run of block characters. The meter never animates.

import { escapeMarkdown } from './sanitize.mjs';
import { resolveRenderOptions, paint, requireText, toBadge, badgeIn } from './style.mjs';

const FILLED = '█';
const EMPTY = '░';

/** Bar width bounds, in cells. */
export const METER_WIDTH = Object.freeze({ min: 1, max: 100, default: 10 });

/**
 * @typedef {{ label: string, value: number, max: number, width: number, token: string, badge?: Readonly<{ glyph: string, label: string, token: string }> }} MeterDef
 */

/** @param {{ value: unknown, max: unknown, width: unknown }} m */
function checkNumbers({ value, max, width }) {
  if (typeof max !== 'number' || !Number.isFinite(max) || max <= 0) throw new RangeError('meter max must be a finite number above 0');
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max) {
    throw new RangeError('meter value must be a finite number from 0 to max');
  }
  if (!Number.isInteger(width) || /** @type {number} */ (width) < METER_WIDTH.min || /** @type {number} */ (width) > METER_WIDTH.max) {
    throw new RangeError(`meter width must be an integer from ${METER_WIDTH.min} to ${METER_WIDTH.max}`);
  }
}

/**
 * Define a meter. `max` defaults to 100 and `width` to 10 bar cells. The bar
 * takes the colour of `token`, else of the status badge, else `info`.
 *
 * @param {{ label: string, value: number, max?: number, width?: number, status?: string | object, token?: string }} spec
 * @returns {Readonly<MeterDef>}
 */
export function defineMeter(spec) {
  if (!spec || typeof spec !== 'object') throw new TypeError('defineMeter needs a spec object');
  const label = requireText(spec.label, 'meter label');
  const { value } = spec;
  const max = spec.max ?? 100;
  const width = spec.width ?? METER_WIDTH.default;
  checkNumbers({ value, max, width });
  const badge = toBadge(spec.status);
  const token = spec.token ?? badge?.token ?? 'info';
  if (typeof token !== 'string') throw new TypeError('meter token must be a token name');
  return Object.freeze({ label, value, max, width, token, badge });
}

/**
 * Render a meter as `plain` (default), `ansi` or `markdown`. The label is
 * sanitized and the numbers checked again here, so a hand-built definition is
 * made inert too.
 *
 * @param {MeterDef} def
 * @param {Partial<import('./style.mjs').RenderOptions>} [options]
 * @returns {string}
 */
export function renderMeter(def, options) {
  const o = resolveRenderOptions(options);
  const label = requireText(def.label, 'meter label');
  checkNumbers(def);
  const ratio = def.value / def.max;
  const filled = Math.round(ratio * def.width);
  const bar = FILLED.repeat(filled) + EMPTY.repeat(def.width - filled);
  const numbers = `${Math.round(ratio * 100)}% (${def.value}/${def.max})`;
  const status = def.badge ? ` ${badgeIn(def.badge, o)}` : '';
  const showBar = o.profile.screenReader !== 'on';

  if (o.format === 'markdown') {
    return `**${escapeMarkdown(label)}**${status}${showBar ? ` \`${bar}\`` : ''} ${numbers}`;
  }
  return `${label}${status}${showBar ? ` [${paint(bar, def.token, o)}]` : ''} ${numbers}`;
}
