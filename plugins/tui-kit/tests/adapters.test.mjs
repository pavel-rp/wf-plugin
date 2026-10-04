// The adapters: segment lines, host reading, the terminal and display-only
// drawings, pane mounting, and the boundaries that keep host names out of the
// kit core. Runs on plain Node with a fake engine interface.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createTokens,
  defineBadge,
  definePanel,
  defineList,
  defineTable,
  defineMeter,
  resolveProfile,
  renderPanel,
  renderBadge,
} from '../kit/index.mjs';
import {
  VIEW_KINDS,
  viewLines,
  viewText,
  profileFromHost,
  hostKeyFor,
  drawTerminal,
  drawDesktop,
  DISPLAY_ONLY_NOTICE,
  drawView,
  shouldMount,
  planPane,
} from '../adapters/index.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const packRoot = join(here, '..');

/** One view of every kind, each carrying a status so every colour state shows. */
function views() {
  return {
    badge: { kind: 'badge', def: defineBadge({ status: 'warn' }) },
    panel: { kind: 'panel', def: definePanel({ title: 'Build', status: 'error', body: ['3 tests failed', 'see the log'] }) },
    list: { kind: 'list', def: defineList({ items: [{ text: 'lint', status: 'ok' }, { text: 'tests', status: 'error' }, 'docs'] }) },
    ordered: { kind: 'list', def: defineList({ ordered: true, items: ['one', { text: 'two', status: 'pending' }] }) },
    table: {
      kind: 'table',
      def: defineTable({
        columns: [{ key: 'check', header: 'Check' }, { key: 'result', header: 'Result' }, { key: 'ms', header: 'Time', align: 'right' }],
        rows: [{ check: 'lint', result: { status: 'ok' }, ms: 12 }, { check: 'tests', result: { status: 'error' }, ms: 340 }],
      }),
    },
    meter: { kind: 'meter', def: defineMeter({ label: 'Disk', value: 8, max: 10, status: 'warn' }) },
    plainMeter: { kind: 'meter', def: defineMeter({ label: 'CPU', value: 3, max: 4 }) },
  };
}

const PROFILES = {
  none: undefined,
  default: resolveProfile({}),
  declared: resolveProfile({ screenReaderOff: true }),
  screenReader: resolveProfile({ axScreenReader: true }),
};

/** A fake element table, as `$.ui.resolve(e)` hands one out: constructors to plain data. */
function fakeElements() {
  const make = (type) => (props) => ({ type, props });
  return { Box: make('Box'), Text: make('Text'), Button: make('Button'), Input: make('Input'), Select: make('Select') };
}

/** Every element in a drawn tree, depth first. */
function elements(node) {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== 'object') return [];
  const kids = node.props?.children;
  return [node, ...elements(kids)];
}

/** The text a drawn tree shows, one string per row. */
function shownRows(tree) {
  return tree.props.children.map((row) => {
    if (row.type === 'Button') return row.props.label;
    return elements(row)
      .filter((n) => n.type === 'Text')
      .map((n) => n.props.children)
      .join('');
  });
}

test('every view kind is known and an unknown kind is refused', () => {
  assert.deepEqual([...VIEW_KINDS], ['badge', 'panel', 'list', 'table', 'meter']);
  assert.throws(() => viewLines({ kind: 'chart', def: {} }), RangeError);
  assert.throws(() => viewLines({ kind: 'toString', def: {} }), RangeError);
  assert.throws(() => viewLines(null), TypeError);
  assert.throws(() => viewLines({ kind: 'panel' }), TypeError);
});

test('segment lines join to the core plain rendering for every kind and profile', () => {
  for (const [pname, profile] of Object.entries(PROFILES)) {
    for (const [vname, view] of Object.entries(views())) {
      const plain = viewText(view, { profile }).split('\n');
      const lines = viewLines(view, { profile });
      assert.equal(lines.length, plain.length, `${vname}/${pname} line count`);
      lines.forEach((line, i) => assert.equal(line.map((s) => s.text).join(''), plain[i], `${vname}/${pname} line ${i}`));
    }
  }
});

test('segment runs carry the decoration and badge colours, not plain fallbacks', () => {
  const v = views();
  const panel = viewLines(v.panel);
  assert.equal(panel[0][0].text, '┌');
  assert.equal(panel[0][0].token, 'error');
  assert.ok(panel[0].some((s) => s.text === '✗ Error' && s.token === 'error'));
  const list = viewLines(v.list);
  assert.equal(list[0][0].token, 'muted');
  assert.ok(list[0].some((s) => s.text === '✓ OK' && s.token === 'success'));
  const meter = viewLines(v.meter, { profile: PROFILES.declared });
  assert.ok(meter[0].some((s) => s.text === '████████░░' && s.token === 'warning'));
  const table = viewLines(v.table);
  assert.equal(table[0][0].bold, true);
  assert.equal(table[1][0].token, 'muted');
});

test('the meter bar is dropped for preferPlainText and for a screen reader, as the core drops it', () => {
  const meter = views().meter;
  for (const profile of [PROFILES.default, PROFILES.screenReader]) {
    const text = viewLines(meter, { profile })[0].map((s) => s.text).join('');
    assert.equal(text, 'Disk ! Warning 80% (8/10)');
  }
  assert.match(viewLines(meter, { profile: PROFILES.declared })[0].map((s) => s.text).join(''), /\[████████░░\]/);
});

test('a definition the core refuses throws the same error through the adapter', () => {
  assert.throws(() => viewLines({ kind: 'panel', def: { title: '\u001b[2J', body: [] } }), TypeError);
  assert.throws(() => viewLines({ kind: 'meter', def: { label: 'x', value: 5, max: 2, width: 10, token: 'info' } }), RangeError);
});

test('hostile text in a hand-built definition is inert in every segment', () => {
  const evil = 'ok\u001b]0;pwned\u0007\u001b[31m‮evil\u009b2J';
  const defs = [
    { kind: 'panel', def: { title: evil, body: [evil], badge: { glyph: evil, label: evil, token: 'error' } } },
    { kind: 'list', def: { items: [{ text: evil, badge: { glyph: '!', label: evil, token: 'warning' } }], ordered: false } },
    { kind: 'meter', def: { label: evil, value: 1, max: 2, width: 4, token: 'info' } },
  ];
  for (const view of defs) {
    for (const line of viewLines(view, { profile: PROFILES.declared })) {
      for (const s of line) assert.doesNotMatch(s.text, /[\u0000-\u001f\u007f-\u009f‮]/);
    }
  }
});

test('hostKeyFor reads own token properties only', () => {
  const tokens = createTokens();
  assert.equal(hostKeyFor(tokens, 'muted'), 'subtle');
  assert.equal(hostKeyFor(tokens, 'tier.1'), 'success');
  assert.equal(hostKeyFor(tokens, 'toString'), undefined);
  assert.equal(hostKeyFor(tokens, '__proto__'), undefined);
  assert.equal(hostKeyFor(tokens, undefined), undefined);
});

test('drawn text colours are the tokens\' host theme keys', () => {
  const el = fakeElements();
  const tokens = createTokens();
  for (const view of Object.values(views())) {
    for (const draw of [drawTerminal, drawDesktop]) {
      const tree = draw(el, view, { profile: PROFILES.declared });
      const keys = new Set(Object.values(tokens).map((t) => t.hostKey));
      for (const n of elements(tree).filter((x) => x.type === 'Text' && x.props.color !== undefined)) {
        assert.ok(keys.has(n.props.color), `${n.props.color} is a host key`);
      }
    }
  }
  const panel = drawTerminal(el,views().panel);
  assert.ok(elements(panel).some((n) => n.type === 'Text' && n.props.children === '┌' && n.props.color === 'error'));
});

test('a drawing shows exactly the core plain rendering, row by row', () => {
  const el = fakeElements();
  for (const [name, view] of Object.entries(views())) {
    for (const draw of [drawTerminal, drawDesktop]) {
      const tree = draw(el, view, { profile: PROFILES.default });
      assert.deepEqual(shownRows(tree), viewText(view, { profile: PROFILES.default }).split('\n'), name);
    }
  }
});

test('terminal: a list with onSelect draws one Button per item, and a press reaches the mod', () => {
  const el = fakeElements();
  const picked = [];
  const view = { ...views().list, onSelect: (i) => picked.push(i) };
  const tree = drawTerminal(el,view);
  const buttons = elements(tree).filter((n) => n.type === 'Button');
  assert.deepEqual(buttons.map((b) => b.props.key), ['item-1', 'item-2', 'item-3']);
  assert.deepEqual(buttons.map((b) => b.props.label), ['- ✓ OK · lint', '- ✗ Error · tests', '- docs']);
  buttons[1].props.onPress();
  buttons[2].props.onPress();
  assert.deepEqual(picked, [1, 2]);
});

test('terminal: no Button without onSelect, and onSelect on a non-list is ignored', () => {
  const el = fakeElements();
  assert.equal(elements(drawTerminal(el,views().list)).filter((n) => n.type === 'Button').length, 0);
  const panel = { ...views().panel, onSelect: () => {} };
  assert.equal(elements(drawTerminal(el,panel)).filter((n) => n.type === 'Button').length, 0);
});

test('desktop: no live controls, and a display-only notice when the view asked for interaction', () => {
  const el = fakeElements();
  const view = { ...views().list, onSelect: () => assert.fail('desktop must not wire a press') };
  const tree = drawDesktop(el,view);
  const types = elements(tree).map((n) => n.type);
  for (const control of ['Button', 'Input', 'Select']) assert.ok(!types.includes(control), `no ${control}`);
  const notice = elements(tree).find((n) => n.type === 'Box' && n.props.key === 'display-only');
  assert.ok(notice, 'display-only notice drawn');
  assert.equal(elements(notice).find((n) => n.type === 'Text').props.children, DISPLAY_ONLY_NOTICE);
  assert.match(DISPLAY_ONLY_NOTICE, /display-only/i);
  const plain = drawDesktop(el,views().list);
  assert.ok(!elements(plain).some((n) => n.props?.key === 'display-only'));
});

test('drawView picks the terminal adapter on the terminal and display-only elsewhere', () => {
  const el = fakeElements();
  const view = { ...views().list, onSelect: () => {} };
  const count = (tree) => elements(tree).filter((n) => n.type === 'Button').length;
  assert.equal(count(drawView(el, 'terminal', view)), 3);
  for (const surface of ['desktop', 'vscode', 'mobile', undefined]) {
    const tree = drawView(el, surface, view);
    assert.equal(count(tree), 0, String(surface));
    assert.ok(elements(tree).some((n) => n.props?.key === 'display-only'));
  }
});

test('profileFromHost reads theme and reduced motion from the config rows', () => {
  const p = profileFromHost({ configRows: [{ key: 'theme', value: 'dark-daltonized' }, { key: 'reduceMotion', value: false }] });
  assert.equal(p.theme, 'dark-daltonized');
  assert.equal(p.daltonized, true);
  assert.equal(p.reducedMotion, false);
  assert.equal(p.sources.reducedMotion, 'host-config');
});

test('profileFromHost falls back to settings for reduced motion and reads the screen reader there', () => {
  const p = profileFromHost({ settings: { prefersReducedMotion: false, axScreenReader: true } });
  assert.equal(p.reducedMotion, false);
  assert.equal(p.sources.reducedMotion, 'host-settings');
  assert.equal(p.screenReader, 'on');
  assert.equal(p.sources.screenReader, 'host-settings');
});

test('profileFromHost reads the screen reader from the environment value', () => {
  const p = profileFromHost({ screenReaderEnv: '1' });
  assert.equal(p.screenReader, 'on');
  assert.equal(p.sources.screenReader, 'host-env');
});

test('profileFromHost honours the declared no-screen-reader preference', () => {
  const p = profileFromHost({}, { screenReaderOff: true });
  assert.equal(p.screenReader, 'off');
  assert.equal(p.preferPlainText, false);
});

test('profileFromHost treats failed, missing or mistyped reads as unreachable, so defaults apply', () => {
  const defaults = resolveProfile({});
  assert.deepEqual(profileFromHost(), defaults);
  assert.deepEqual(profileFromHost({ configRows: undefined, settings: undefined, screenReaderEnv: undefined }), defaults);
  assert.deepEqual(
    profileFromHost({
      configRows: [{ key: 'theme', value: 42 }, { key: 'reduceMotion', value: 'no' }, { key: 'toString' }, null],
      settings: { prefersReducedMotion: 'yes', axScreenReader: 'true' },
      screenReaderEnv: 7,
    }),
    defaults,
  );
  assert.deepEqual(profileFromHost({ configRows: 'not rows', settings: Object.create({ axScreenReader: true }) }), defaults);
  assert.deepEqual(profileFromHost({ configRows: [Object.create({ key: 'theme', value: 'dark' })] }), defaults);
});

test('shouldMount skips only for a screen reader without the panes-draw option', () => {
  assert.equal(shouldMount(PROFILES.screenReader), false);
  assert.equal(shouldMount(PROFILES.screenReader, { panesDrawForScreenReader: false }), false);
  assert.equal(shouldMount(PROFILES.screenReader, { panesDrawForScreenReader: true }), true);
  assert.equal(shouldMount(PROFILES.default), true);
  assert.equal(shouldMount(PROFILES.declared), true);
  assert.equal(shouldMount(undefined), true);
});

test('planPane mounts the pane when it should be drawn', () => {
  const view = views().panel;
  assert.deepEqual(planPane(view, { profile: PROFILES.default }), { isMounted: true });
  assert.deepEqual(planPane(view, { profile: PROFILES.declared }), { isMounted: true });
  assert.deepEqual(planPane(view, { profile: PROFILES.screenReader, panesDrawForScreenReader: true }), { isMounted: true });
  assert.deepEqual(planPane(view), { isMounted: true });
});

test('screen reader, panes draw: the drawn pane carries every glyph and label as text', () => {
  const el = fakeElements();
  for (const view of Object.values(views())) {
    const shown = shownRows(drawView(el, 'terminal', view, { profile: PROFILES.screenReader })).join('\n');
    const badges = [view.def.badge, ...(view.def.items ?? []).map((i) => i.badge), ...(view.def.rows ?? []).flat().map((c) => c.badge)];
    if (view.kind === 'badge') badges.push(view.def);
    for (const b of badges.filter(Boolean)) assert.ok(shown.includes(renderBadge(b)), `${view.kind} shows ${renderBadge(b)}`);
  }
});

test('screen reader, panes do not draw: planPane skips the pane and hands back the plain text to log', () => {
  const view = views().panel;
  const result = planPane(view, { profile: PROFILES.screenReader });
  assert.equal(result.isMounted, false);
  assert.equal(result.text, renderPanel(view.def, { profile: PROFILES.screenReader }));
  assert.deepEqual([...result.lines], result.text.split('\n'));
  assert.ok(Object.isFrozen(result.lines));
  const meter = planPane(views().meter, { profile: PROFILES.screenReader, panesDrawForScreenReader: false });
  assert.deepEqual([...meter.lines], ['Disk ! Warning 80% (8/10)']);
});

/** Source with comments removed, as the boundary test reads it. */
function code(file) {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

test('the kit core names no host element and calls no host interface', () => {
  const kit = join(packRoot, 'kit');
  const banned = [/\b(?:Box|Text|Button|Input|Select|Pane|AbovePrompt)\b/, /\bui\./];
  for (const name of readdirSync(kit)) {
    for (const re of banned) assert.doesNotMatch(code(join(kit, name)), re, `kit/${name} matches ${re}`);
  }
});

test('adapters import only sibling adapter files or the kit index', () => {
  const dir = join(packRoot, 'adapters');
  for (const name of readdirSync(dir)) {
    assert.match(name, /\.mjs$/);
    const src = readFileSync(join(dir, name), 'utf8');
    assert.doesNotMatch(src, /\bimport\s*\(|\brequire\s*\(|\bprocess\b|\bglobalThis\b/, name);
    for (const m of src.matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom\s+['"]([^'"]+)['"]/gm)) {
      assert.match(m[1], /^(?:\.\/[a-z0-9-]+\.mjs|\.\.\/kit\/index\.mjs)$/, `adapters/${name} imports ${m[1]}`);
    }
  }
});

test('the pack root ships no hooks, so installing it changes nothing', () => {
  assert.ok(!readdirSync(packRoot).includes('hooks'));
});
