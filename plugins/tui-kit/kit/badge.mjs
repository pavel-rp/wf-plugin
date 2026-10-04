// The status badge: glyph + label + colour token, rendered from one definition
// to plain text, ANSI and markdown.
//
// Host-free and pure. Colour is never the only carrier: every preset has its
// own glyph and a label, so plain text and markdown carry every fact the
// coloured rendering shows.

import { createTokens, colorFor } from './tokens.mjs';
import { sanitizeText, escapeMarkdown } from './sanitize.mjs';

/**
 * Badge presets. Each glyph is unique, so a state stays distinguishable with
 * colour stripped.
 */
export const STATUSES = Object.freeze({
  ok: Object.freeze({ glyph: '✓', label: 'OK', token: 'success' }),
  warn: Object.freeze({ glyph: '!', label: 'Warning', token: 'warning' }),
  error: Object.freeze({ glyph: '✗', label: 'Error', token: 'error' }),
  info: Object.freeze({ glyph: 'i', label: 'Info', token: 'info' }),
  pending: Object.freeze({ glyph: '○', label: 'Pending', token: 'inactive' }),
  tier1: Object.freeze({ glyph: '▁', label: 'Tier 1', token: 'tier.1' }),
  tier2: Object.freeze({ glyph: '▃', label: 'Tier 2', token: 'tier.2' }),
  tier3: Object.freeze({ glyph: '▅', label: 'Tier 3', token: 'tier.3' }),
  tier4: Object.freeze({ glyph: '▇', label: 'Tier 4', token: 'tier.4' }),
  tier5: Object.freeze({ glyph: '█', label: 'Tier 5', token: 'tier.5' }),
});

/** @typedef {{ status?: string, glyph: string, label: string, token: string }} BadgeDef */

/**
 * Define a badge from a preset, with optional overrides. Glyph and label are
 * sanitized here, so a definition can never carry a control sequence.
 *
 * @param {{ status?: keyof typeof STATUSES | string, glyph?: string, label?: string, token?: string }} spec
 * @returns {Readonly<BadgeDef>}
 */
export function defineBadge(spec) {
  if (!spec || typeof spec !== 'object') throw new TypeError('defineBadge needs a spec object');
  const preset = spec.status === undefined || !Object.hasOwn(STATUSES, spec.status)
    ? undefined
    : STATUSES[/** @type {keyof typeof STATUSES} */ (spec.status)];
  if (spec.status !== undefined && !preset) throw new RangeError(`unknown badge status ${JSON.stringify(spec.status)}`);
  const glyph = sanitizeText(spec.glyph ?? preset?.glyph ?? '');
  const label = sanitizeText(spec.label ?? preset?.label ?? '');
  const token = spec.token ?? preset?.token;
  if (label === '') throw new TypeError('a badge needs a non-empty label');
  if (typeof token !== 'string') throw new TypeError('a badge needs a colour token');
  return Object.freeze({ status: spec.status, glyph, label, token });
}

const DEFAULT_TOKENS = createTokens();

/** @param {{ ansi16?: number, ansi256?: number, hex?: string }} c */
function sgrOpen(c) {
  if (c.hex !== undefined) {
    const n = parseInt(c.hex.slice(1), 16);
    return `\u001b[38;2;${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}m`;
  }
  if (c.ansi256 !== undefined) return `\u001b[38;5;${c.ansi256}m`;
  return `\u001b[${c.ansi16}m`;
}

const SGR_RESET_FG = '\u001b[39m';

/**
 * Render a badge.
 *
 * - `plain` (default): `<glyph> <label>`, no colour.
 * - `ansi`: the plain text wrapped in an SGR foreground colour at the depth
 *   `colorMode` allows; with `colorMode` `none` (or omitted) it is identical
 *   to plain. With an `auto` appearance only ANSI 16 codes are emitted.
 * - `markdown`: `<glyph> **<label>**`, markdown- and HTML-escaped.
 *
 * Glyph and label are sanitized again at render time, so a hand-built
 * definition is made inert too.
 *
 * @param {BadgeDef} def
 * @param {{
 *   format?: 'plain' | 'ansi' | 'markdown',
 *   tokens?: Readonly<Record<string, any>>,
 *   profile?: { appearance?: 'dark' | 'light' | 'auto', daltonized?: boolean, ansiTheme?: boolean },
 *   colorMode?: 'none' | 'ansi16' | 'ansi256' | 'truecolor',
 * }} [options]
 * @returns {string}
 */
export function renderBadge(def, options = {}) {
  const { format = 'plain', tokens = DEFAULT_TOKENS, profile = {}, colorMode = 'none' } = options;
  const glyph = sanitizeText(def.glyph);
  const label = sanitizeText(def.label);
  if (label === '') throw new TypeError('a badge needs a non-empty label');
  const text = glyph === '' ? label : `${glyph} ${label}`;

  if (format === 'plain') return text;

  if (format === 'markdown') {
    const g = escapeMarkdown(glyph);
    const l = escapeMarkdown(label);
    return g === '' ? `**${l}**` : `${g} **${l}**`;
  }

  if (format === 'ansi') {
    if (colorMode === 'none') return text;
    const token = Object.hasOwn(tokens, def.token) ? tokens[def.token] : undefined;
    if (!token) throw new RangeError(`unknown colour token ${JSON.stringify(def.token)}`);
    // An ANSI host theme maps every key to the 16 terminal colours; follow it.
    const depth = profile.ansiTheme ? 'ansi16' : colorMode;
    const color = colorFor(token, {
      appearance: profile.appearance ?? 'auto',
      depth,
      daltonized: profile.daltonized === true,
    });
    return `${sgrOpen(color)}${text}${SGR_RESET_FG}`;
  }

  throw new RangeError(`unknown badge format ${JSON.stringify(format)}`);
}
