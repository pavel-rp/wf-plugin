// The terminal adapter: draws a view interactively.
//
// A `list` view that carries an `onSelect` callback draws each item as a
// `Button` keyed `item-<n>` (1-based); pressing it calls `onSelect(n - 1)` in
// the mod. Every other line is drawn as text runs.
//
// `el` is the surface's element table, `$.ui.resolve(e)` in the mod's render
// hook (the host never lets `$` itself cross an import).

import { viewLines } from './segments.mjs';
import { drawLine, drawColumn, tokensFrom } from './draw.mjs';

/**
 * @param {any} el the surface's element table
 * @param {{ kind: string, def: any, onSelect?: (index: number) => unknown }} view
 * @param {{ profile?: object, tokens?: Readonly<Record<string, any>> }} [options]
 */
export function drawTerminal(el, view, options = {}) {
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
