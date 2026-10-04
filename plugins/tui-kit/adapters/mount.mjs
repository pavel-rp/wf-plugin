// Mounting: which adapter draws, and whether a pane opens at all.
//
// `drawView` picks the terminal adapter on the terminal and the display-only
// adapter everywhere else. `shouldMount` and `planPane` keep a screen-reader
// user from a pane that may not be read: with `profile.screenReader === 'on'`
// a pane or band is drawn only when the mod says panes draw for a screen
// reader (`panesDrawForScreenReader: true`). Otherwise the mod skips it and
// writes the view's plain text to the transcript instead, one line per
// `$.ui.log`. The default is to skip, because plain text always reaches a
// reader.
//
// The host lets `$` reach only the mod's own hooks module, so the mod makes
// the `$.ui.open` / `$.ui.log` calls these functions decide on.

import { viewText } from './segments.mjs';
import { drawTerminal } from './terminal.mjs';
import { drawDesktop } from './desktop.mjs';

/**
 * Draw a view with the adapter for the surface.
 *
 * @param {any} el the surface's element table, `$.ui.resolve(e)`
 * @param {string | undefined} surface the render event's `e.surface`
 * @param {{ kind: string, def: any, onSelect?: (index: number) => unknown }} view
 * @param {{ profile?: object, tokens?: Readonly<Record<string, any>> }} [options]
 */
export function drawView(el, surface, view, options = {}) {
  return surface === 'terminal' ? drawTerminal(el, view, options) : drawDesktop(el, view, options);
}

/**
 * Whether a pane or band should be drawn for this profile.
 *
 * @param {{ screenReader?: string } | undefined} profile
 * @param {{ panesDrawForScreenReader?: boolean }} [options]
 * @returns {boolean}
 */
export function shouldMount(profile, options = {}) {
  return !(profile?.screenReader === 'on' && options?.panesDrawForScreenReader !== true);
}

/**
 * Decide how a requested pane is shown: opened, or skipped with the view's
 * plain text to log in its place.
 *
 * @param {{ kind: string, def: any }} view
 * @param {{ profile?: { screenReader?: string }, panesDrawForScreenReader?: boolean }} [options]
 * @returns {{ isMounted: true } | { isMounted: false, text: string, lines: readonly string[] }}
 */
export function planPane(view, options = {}) {
  if (shouldMount(options?.profile, options)) return { isMounted: true };
  const text = viewText(view, { profile: options?.profile });
  return { isMounted: false, text, lines: Object.freeze(text.split('\n')) };
}
