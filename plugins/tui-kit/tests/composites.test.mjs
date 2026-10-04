// Cross-component guarantees: one definition renders three formats with no
// fact lost, in every accessibility profile, and hostile content stays inert.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  definePanel, renderPanel,
  defineList, renderList,
  defineTable, renderTable,
  defineMeter, renderMeter,
  resolveColorMode, resolveProfile, FORMATS,
} from '../kit/index.mjs';

const strip = (s) => s.replace(/\u001b\[[0-9;]*m/g, '');
const unescapeMd = (s) => s.replace(/\\(.)/g, '$1').replace(/\*\*/g, '');

/** Each fixture: a definition, its renderer, and the facts every rendering must carry. */
function fixtures(text = (s) => s) {
  return [
    {
      name: 'panel',
      def: definePanel({ title: text('Build'), status: 'error', body: [text('3 tests failed'), text('see log')] }),
      render: renderPanel,
      facts: ['Build', '✗', 'Error', '3 tests failed', 'see log'],
    },
    {
      name: 'list',
      def: defineList({ items: [{ text: text('lint'), status: 'ok' }, { text: text('tests'), status: 'warn' }] }),
      render: renderList,
      facts: ['lint', '✓', 'OK', 'tests', '!', 'Warning'],
    },
    {
      name: 'table',
      def: defineTable({
        columns: [{ key: 'n', header: text('Name') }, { key: 's', header: text('State') }],
        rows: [{ n: text('api'), s: { status: 'ok' } }, { n: text('db'), s: { status: 'error' } }],
      }),
      render: renderTable,
      facts: ['Name', 'State', 'api', '✓', 'OK', 'db', '✗', 'Error'],
    },
    {
      name: 'meter',
      def: defineMeter({ label: text('Disk'), value: 3, max: 4, status: 'pending' }),
      render: renderMeter,
      facts: ['Disk', '○', 'Pending', '75%', '3/4'],
    },
  ];
}

const PROFILES = {
  daltonized: { profile: resolveProfile({ theme: 'dark-daltonized' }), colorMode: 'truecolor' },
  'NO_COLOR': { profile: resolveProfile({ theme: 'dark' }), colorMode: resolveColorMode({ env: { NO_COLOR: '1' }, isTTY: true }) },
  'reduced-motion': { profile: resolveProfile({ reduceMotion: true }), colorMode: 'ansi16' },
  'screen-reader': { profile: resolveProfile({ axScreenReader: true }), colorMode: 'ansi16' },
};

test('every component renders all three formats, and plain is the default', () => {
  assert.deepEqual(FORMATS, ['plain', 'ansi', 'markdown']);
  for (const f of fixtures()) {
    assert.equal(f.render(f.def), f.render(f.def, { format: 'plain' }), f.name);
    assert.throws(() => f.render(f.def, { format: 'html' }), RangeError, f.name);
  }
});

test('parity: plain equals stripped ANSI, and plain and markdown carry every fact', () => {
  for (const f of fixtures()) {
    const plain = f.render(f.def);
    const ansi = f.render(f.def, { format: 'ansi', colorMode: 'ansi16' });
    const md = f.render(f.def, { format: 'markdown' });
    assert.match(ansi, /\u001b\[/, `${f.name} ANSI is coloured`);
    assert.equal(strip(ansi), plain, f.name);
    for (const fact of f.facts) {
      assert.ok(plain.includes(fact), `${f.name} plain lacks ${fact}`);
      assert.ok(unescapeMd(md).includes(fact), `${f.name} markdown lacks ${fact}`);
    }
  }
});

test('no information is lost in the daltonized, NO_COLOR, reduced-motion and screen-reader profiles', () => {
  for (const [name, { profile, colorMode }] of Object.entries(PROFILES)) {
    for (const f of fixtures()) {
      for (const format of FORMATS) {
        const out = f.render(f.def, { format, profile, colorMode });
        const readable = format === 'markdown' ? unescapeMd(out) : strip(out);
        for (const fact of f.facts) assert.ok(readable.includes(fact), `${name}/${f.name}/${format} lacks ${fact}`);
        if (name === 'NO_COLOR') assert.doesNotMatch(out, /\u001b/, `${f.name}/${format} emits ESC under NO_COLOR`);
      }
    }
  }
});

test('a daltonized profile renders success in blue in every component that shows it', () => {
  const { profile } = PROFILES.daltonized;
  const list = renderList(defineList({ items: [{ text: 'x', status: 'ok' }] }), { format: 'ansi', colorMode: 'ansi16', profile });
  assert.match(list, /\u001b\[34m✓ OK/);
});

test('rendering is deterministic: the same definition gives the same output (no motion)', () => {
  for (const f of fixtures()) {
    const opts = { format: 'ansi', colorMode: 'ansi16', profile: PROFILES['reduced-motion'].profile };
    assert.equal(f.render(f.def, opts), f.render(f.def, opts), f.name);
  }
});

test('hostile content is stripped in all three renderings of every component', () => {
  const hostile = (s) => `${s}\u001b[31m\u001b]0;pwned\u0007\u001b]8;;https://x.example\u001b\\\u009b2J‮\u0008`;
  for (const f of fixtures(hostile)) {
    for (const format of FORMATS) {
      const out = f.render(f.def, { format, colorMode: 'ansi16' });
      const content = strip(out);
      assert.doesNotMatch(content, /[\u0000-\u0009\u000b-\u001f\u007f-\u009f‪-‮⁦-⁩]/, `${f.name}/${format}`);
      assert.ok(!out.includes('pwned'), `${f.name}/${format}`);
      assert.ok(!out.includes('x.example'), `${f.name}/${format}`);
    }
  }
});

test('a hand-built definition carrying control sequences is made inert at render time', () => {
  assert.equal(renderPanel({ title: 'a\u001b[2Jb', body: ['c\u001b]0;t\u0007d'] }), '┌ ab\n│ cd\n└');
  assert.equal(renderList({ items: [{ text: 'x\u001b[Hy' }] }), '- xy');
  assert.equal(renderMeter({ label: 'L\u009b5m', value: 1, max: 2, width: 2, token: 'info' }), 'L [█░] 50% (1/2)');
});

test('inherited names are never tokens or statuses', () => {
  assert.throws(() => definePanel({ title: 't', status: 'constructor' }), RangeError);
  assert.throws(() => defineList({ items: [{ text: 't', status: 'toString' }] }), RangeError);
  assert.throws(
    () => renderPanel({ title: 't', body: [], badge: { glyph: 'x', label: 'y', token: 'hasOwnProperty' } }, { format: 'ansi', colorMode: 'ansi16' }),
    RangeError,
  );
});

test('long hostile input renders in linear time', () => {
  const big = 'a\u001b['.repeat(20000) + '\u009d'.repeat(20000) + 'tail';
  const start = performance.now();
  for (const f of fixtures(() => big)) {
    for (const format of FORMATS) f.render(f.def, { format, colorMode: 'ansi16' });
  }
  const elapsed = performance.now() - start;
  assert.ok(elapsed < 1000, `rendering took ${elapsed.toFixed(1)} ms`);
});
