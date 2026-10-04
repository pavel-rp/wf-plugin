// The terminal adapter: draws a view interactively.
//
// A `list` view that carries an `onSelect` callback draws each item as a
// `Button` keyed `item-<n>` (1-based); pressing it calls `onSelect(n - 1)` in
// the mod. Every other line is drawn as text runs.

import { viewLines } from './segments.mjs';
import { drawLine, drawColumn, tokensFrom } from './draw.mjs';

/**
 * @param {any} $ the engine interface a render hook receives
 * @param {any} e the render hook's own event (its surface picks the table)
 * @param {{ kind: string, def: any, onSelect?: (index: number) => unknown }} view
 * @param {{ profile?: object, tokens?: Readonly<Record<string, any>> }} [options]
 */
export function drawTerminal($, e, view, options = {}) {
  const el = $.ui.resolve(e);
  const tokens = tokensFrom(options);
  const lines = viewLines(view, { profile: options?.profile });
  const onSelect = view.kind === 'list' && typeof view.onSelect === 'function' ? view.onSelect : undefined;
  const rows = lines.map((line, i) => {
    if (!onSelect) return drawLine(el, line, tokens);
    return el.Button({
      key: `item-${i + 1}`,
      label: line.map((s) => s.text).join(''),
      onPress: () => onSelect(i),
    });
  });
  return drawColumn(el, rows);
}
