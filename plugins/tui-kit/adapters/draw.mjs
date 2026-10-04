// Drawing: segment lines turned into host elements.
//
// Adapter code: it names host elements, which the kit core never does. The
// element constructors come from `$.ui.resolve(e)` and are passed in, so the
// tree is whatever the drawing surface's own table builds.

import { createTokens } from '../kit/index.mjs';

const DEFAULT_TOKENS = createTokens();

/**
 * The host theme key for a token, or undefined. Looked up as an own property
 * only, so an inherited name such as `toString` never colours anything.
 *
 * @param {Readonly<Record<string, any>>} tokens
 * @param {string | undefined} name
 * @returns {string | undefined}
 */
export function hostKeyFor(tokens, name) {
  if (typeof name !== 'string' || !Object.hasOwn(tokens, name)) return undefined;
  const token = tokens[name];
  return token && typeof token.hostKey === 'string' ? token.hostKey : undefined;
}

/**
 * One run of text as a `Text` element: the token's host key as its colour.
 *
 * @param {any} el the surface's element table
 * @param {{ text: string, token?: string, bold?: boolean }} segment
 * @param {Readonly<Record<string, any>>} tokens
 */
export function drawSegment(el, segment, tokens) {
  /** @type {Record<string, unknown>} */
  const props = { children: segment.text };
  const color = hostKeyFor(tokens, segment.token);
  if (color !== undefined) props.color = color;
  if (segment.bold === true) props.bold = true;
  return el.Text(props);
}

/**
 * One line of runs as a row.
 *
 * @param {any} el
 * @param {readonly { text: string, token?: string, bold?: boolean }[]} line
 * @param {Readonly<Record<string, any>>} tokens
 */
export function drawLine(el, line, tokens) {
  return el.Box({ flexDirection: 'row', children: line.map((s) => drawSegment(el, s, tokens)) });
}

/**
 * Rows stacked in a column.
 *
 * @param {any} el
 * @param {unknown[]} rows already-built row elements
 */
export function drawColumn(el, rows) {
  return el.Box({ flexDirection: 'column', children: rows });
}

/** @param {{ tokens?: Readonly<Record<string, any>> }} [options] */
export function tokensFrom(options) {
  return options?.tokens ?? DEFAULT_TOKENS;
}
