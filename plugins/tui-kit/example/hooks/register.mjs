// Example mod: the tui-kit and its adapters copied into lib/, drawing every
// kit component. `/tui-kit-demo` opens one pane per component; the band above
// the prompt shows the status badge. On the terminal the checks list is
// selectable; elsewhere it is display-only and says so.
//
// The host lets `$` reach only functions declared in this file, so every host
// call is made here and the adapters get plain values: the element table from
// `$.ui.resolve(e)`, the surface, and the profile built from the host reads.

import { atom, read, update } from 'claude-code';

import { defineBadge, definePanel, defineList, defineTable, defineMeter } from '../lib/kit/index.mjs';
import { drawView, planPane, profileFromHost, shouldMount } from '../lib/adapters/index.mjs';

const picked = atom({ plugin: 'tui-kit-example', key: 'picked' }, -1);

const CHECKS = ['lint', 'tests', 'docs'];

const PANES = Object.freeze({
  'tui-kit-badge': { title: 'Badge', view: () => ({ kind: 'badge', def: defineBadge({ status: 'warn' }) }) },
  'tui-kit-panel': {
    title: 'Panel',
    view: () => ({ kind: 'panel', def: definePanel({ title: 'Build', status: 'error', body: ['3 tests failed', 'see the log'] }) }),
  },
  'tui-kit-list': {
    title: 'Checks',
    view: () => ({
      kind: 'list',
      def: defineList({ items: [{ text: CHECKS[0], status: 'ok' }, { text: CHECKS[1], status: 'error' }, CHECKS[2]] }),
    }),
  },
  'tui-kit-table': {
    title: 'Table',
    view: () => ({
      kind: 'table',
      def: defineTable({
        columns: [{ key: 'check', header: 'Check' }, { key: 'result', header: 'Result' }, { key: 'ms', header: 'Time', align: 'right' }],
        rows: [{ check: 'lint', result: { status: 'ok' }, ms: 12 }, { check: 'tests', result: { status: 'error' }, ms: 340 }],
      }),
    }),
  },
  'tui-kit-meter': {
    title: 'Meter',
    view: () => ({ kind: 'meter', def: defineMeter({ label: 'Disk', value: 8, max: 10, status: 'warn' }) }),
  },
});

/**
 * Read the host's accessibility values; a read that fails counts as unreachable.
 *
 * @param {any} $
 * @param {{ screenReaderOff: boolean }} settings
 */
async function hostProfile($, settings) {
  let configRows;
  let hostSettings;
  let screenReaderEnv;
  try {
    configRows = await $.config.list();
  } catch {
    configRows = undefined;
  }
  try {
    hostSettings = await $.settings.read();
  } catch {
    hostSettings = undefined;
  }
  try {
    screenReaderEnv = await $.env.get('CLAUDE_AX_SCREEN_READER');
  } catch {
    screenReaderEnv = undefined;
  }
  return profileFromHost({ configRows, settings: hostSettings, screenReaderEnv }, settings);
}

/** @type {import('claude-code').Register} */
export const register = (on, options) => {
  const settings = {
    screenReaderOff: options.screenReaderOff === true,
    panesDrawForScreenReader: options.panesDrawForScreenReader === true,
  };

  on('command.run', { command: 'tui-kit-demo' }, async ($) => {
    const profile = await hostProfile($, settings);
    const skipped = [];
    for (const id of Object.keys(PANES)) {
      const pane = PANES[id];
      const plan = planPane(pane.view(), { ...settings, profile });
      if (plan.isMounted) {
        await $.ui.open({ id, title: pane.title });
      } else {
        for (const line of plan.lines) $.ui.log(line);
        skipped.push(pane.title);
      }
    }
    return { text: skipped.length === 0 ? 'Kit panes opened.' : `Kit panes skipped for the screen reader: ${skipped.join(', ')}.` };
  });

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (!Object.hasOwn(PANES, e.requestId)) return next(e);
    const profile = await hostProfile($, settings);
    const el = $.ui.resolve(e);
    const view = PANES[e.requestId].view();
    if (view.kind !== 'list') return drawView(el, e.surface, view, { profile });
    const index = await read($, picked);
    return el.Box({
      flexDirection: 'column',
      children: [
        drawView(el, e.surface, { ...view, onSelect: (i) => update($, picked, () => i) }, { profile }),
        el.Text({ dimColor: true, children: `Picked: ${index >= 0 && index < CHECKS.length ? CHECKS[index] : 'none'}` }),
      ],
    });
  });

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const profile = await hostProfile($, settings);
    if (e.props.hasSurvey || !shouldMount(profile, settings)) return next(e);
    return drawView($.ui.resolve(e), e.surface, PANES['tui-kit-badge'].view(), { profile });
  });
};
