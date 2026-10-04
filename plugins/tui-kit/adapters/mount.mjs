// Mounting: which adapter draws, and whether a pane opens at all.
//
// `drawView` picks the terminal adapter on the terminal and the display-only
// adapter everywhere else. `openPane` and `shouldMount` keep a screen-reader
// user from a pane that may not be read: with `profile.screenReader === 'on'`
// a pane opens only when the mod says panes draw for a screen reader
// (`panesDrawForScreenReader: true`). Otherwise the pane is skipped and the
// view's plain text is logged to the transcript instead, one line per log.
// The default is to skip, because plain text always reaches a reader.

import { viewText } from './segments.mjs';
import { drawTerminal } from './terminal.mjs';
import { drawDesktop } from './desktop.mjs';

/**
 * Draw a view with the adapter for the event's surface.
 *
 * @param {any} $
 * @param {any} e a render hook's event
 * @param {{ kind: string, def: any, onSelect?: (index: number) => unknown }} view
 * @param {{ profile?: object, tokens?: Readonly<Record<string, any>> }} [options]
 */
export function drawView($, e, view, options = {}) {
  return e?.surface === 'terminal' ? drawTerminal($, e, view, options) : drawDesktop($, e, view, options);
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
 * Open a pane for a view, or, when it should not be drawn, log the view's
 * plain text instead.
 *
 * @param {any} $
 * @param {{ id: string, title: string, view: { kind: string, def: any } }} pane
 * @param {{ profile?: { screenReader?: string }, panesDrawForScreenReader?: boolean }} [options]
 * @returns {Promise<{ isMounted: true } | { isMounted: false, text: string }>}
 */
export async function openPane($, pane, options = {}) {
  if (shouldMount(options?.profile, options)) {
    await $.ui.open({ id: pane.id, title: pane.title });
    return { isMounted: true };
  }
  const text = viewText(pane.view, { profile: options?.profile });
  for (const line of text.split('\n')) $.ui.log(line);
  return { isMounted: false, text };
}
