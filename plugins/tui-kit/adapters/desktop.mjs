// The Desktop adapter: draws a view display-only.
//
// Desktop stays display-only (no form, no blocking input), so this adapter
// draws text runs alone: never a Button, Input or Select. A view that asks for
// interaction (a `list` with `onSelect`) also gets a line keyed `display-only`
// saying so, so the person knows the items cannot be picked here.

import { viewLines } from './segments.mjs';
import { drawLine, drawColumn, drawSegment, tokensFrom } from './draw.mjs';

/** The line a display-only drawing adds when the view asked for interaction. */
export const DISPLAY_ONLY_NOTICE = 'Display-only here: pick an item in the terminal.';

/**
 * @param {any} $ the engine interface a render hook receives
 * @param {any} e the render hook's own event (its surface picks the table)
 * @param {{ kind: string, def: any, onSelect?: (index: number) => unknown }} view
 * @param {{ profile?: object, tokens?: Readonly<Record<string, any>> }} [options]
 */
export function drawDesktop($, e, view, options = {}) {
  const el = $.ui.resolve(e);
  const tokens = tokensFrom(options);
  const rows = viewLines(view, { profile: options?.profile }).map((line) => drawLine(el, line, tokens));
  if (view.kind === 'list' && typeof view.onSelect === 'function') {
    rows.push(el.Box({ key: 'display-only', children: [drawSegment(el, { text: DISPLAY_ONLY_NOTICE, token: 'muted' }, tokens)] }));
  }
  return drawColumn(el, rows);
}
