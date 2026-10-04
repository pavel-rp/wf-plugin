// Shared rendering helpers for the composite components.
//
// Host-free and pure. Every composite renders plain text, ANSI and markdown
// from one definition through these helpers, so the three formats share one
// code path: colour is added only to decoration, never to content, and with
// the colour stripped the ANSI rendering is exactly the plain one.

import { createTokens, colorFor } from './tokens.mjs';
import { sanitizeText } from './sanitize.mjs';
import { defineBadge, renderBadge } from './badge.mjs';

/** The three output formats every component renders. */
export const FORMATS = Object.freeze(['plain', 'ansi', 'markdown']);

const DEFAULT_TOKENS = createTokens();

/**
 * @typedef {{
 *   format: 'plain' | 'ansi' | 'markdown',
 *   tokens: Readonly<Record<string, any>>,
 *   profile: { appearance?: 'dark' | 'light' | 'auto', daltonized?: boolean, ansiTheme?: boolean, screenReader?: 'on' | 'off' | 'unknown', preferPlainText?: boolean },
 *   colorMode: 'none' | 'ansi16' | 'ansi256' | 'truecolor',
 * }} RenderOptions
 */

/**
 * Fill in render defaults and refuse an unknown format.
 *
 * @param {Partial<RenderOptions>} [options]
 * @returns {RenderOptions}
 */
export function resolveRenderOptions(options = {}) {
  const { format = 'plain', tokens = DEFAULT_TOKENS, profile = {}, colorMode = 'none' } = options ?? {};
  if (!FORMATS.includes(format)) throw new RangeError(`unknown format ${JSON.stringify(format)}`);
  return { format, tokens, profile: profile ?? {}, colorMode };
}

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
 * Colour `text` with the named token when rendering ANSI with colour on.
 * Every other case returns `text` unchanged. The token is looked up as an own
 * property only, so an inherited name such as `toString` is refused.
 *
 * @param {string} text already-safe text (kit-built decoration or sanitized content)
 * @param {string} tokenName
 * @param {RenderOptions} options
 * @returns {string}
 */
export function paint(text, tokenName, options) {
  const { format, tokens, profile, colorMode } = options;
  if (format !== 'ansi' || colorMode === 'none' || text === '') return text;
  const token = typeof tokenName === 'string' && Object.hasOwn(tokens, tokenName) ? tokens[tokenName] : undefined;
  if (!token) throw new RangeError(`unknown colour token ${JSON.stringify(tokenName)}`);
  // An ANSI host theme maps every key to the 16 terminal colours; follow it.
  const depth = profile.ansiTheme ? 'ansi16' : colorMode;
  const color = colorFor(token, {
    appearance: profile.appearance ?? 'auto',
    depth,
    daltonized: profile.daltonized === true,
  });
  return `${sgrOpen(color)}${text}${SGR_RESET_FG}`;
}

/**
 * Sanitize a caller-supplied text value and refuse it when nothing printable
 * is left. Only strings and finite numbers are text.
 *
 * @param {unknown} value
 * @param {string} what names the value in the error
 * @returns {string}
 */
export function requireText(value, what) {
  if (typeof value !== 'string' && !(typeof value === 'number' && Number.isFinite(value))) {
    throw new TypeError(`${what} must be a string or a finite number`);
  }
  const text = sanitizeText(value);
  if (text === '') throw new TypeError(`${what} must not be empty`);
  return text;
}

/**
 * Turn a status spec into a badge definition: a preset name such as `'ok'`,
 * or anything `defineBadge` accepts. `undefined` means no status.
 *
 * @param {unknown} spec
 * @returns {Readonly<{ status?: string, glyph: string, label: string, token: string }> | undefined}
 */
export function toBadge(spec) {
  if (spec === undefined) return undefined;
  if (typeof spec === 'string') return defineBadge({ status: spec });
  if (spec === null || typeof spec !== 'object') throw new TypeError('a status must be a preset name or a badge spec');
  return defineBadge(/** @type {any} */ (spec));
}

/**
 * Render a badge in the same format and colour context as its component.
 *
 * @param {{ glyph: string, label: string, token: string }} badge
 * @param {RenderOptions} options
 * @returns {string}
 */
export function badgeIn(badge, options) {
  const { format, tokens, profile, colorMode } = options;
  return renderBadge(badge, { format, tokens, profile, colorMode });
}

/**
 * Number of code points in `text`, the unit table padding counts in.
 * @param {string} text
 */
export function codePointLength(text) {
  let n = 0;
  for (const _ of text) n += 1;
  return n;
}
