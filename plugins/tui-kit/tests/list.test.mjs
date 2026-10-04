import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineList, renderList } from '../kit/index.mjs';

const strip = (s) => s.replace(/\u001b\[[0-9;]*m/g, '');
const items = [{ text: 'lint', status: 'ok' }, { text: 'tests', status: 'error' }, 'docs'];

test('list renders the documented plain shape', () => {
  assert.equal(renderList(defineList({ items })), '- ✓ OK · lint\n- ✗ Error · tests\n- docs');
});

test('ordered list numbers its items in every format', () => {
  const list = defineList({ items, ordered: true });
  assert.equal(renderList(list), '1. ✓ OK · lint\n2. ✗ Error · tests\n3. docs');
  assert.equal(renderList(list, { format: 'markdown' }), '1. ✓ **OK** · lint\n2. ✗ **Error** · tests\n3. docs');
});

test('list ANSI colours the markers muted and keeps the plain text', () => {
  const list = defineList({ items });
  const ansi = renderList(list, { format: 'ansi', colorMode: 'ansi16' });
  assert.match(ansi, /^\u001b\[90m-\u001b\[39m \u001b\[32m✓ OK\u001b\[39m · lint/);
  assert.equal(strip(ansi), renderList(list));
});

test('list markdown escapes item text that looks like markdown', () => {
  const md = renderList(defineList({ items: ['1. not a number', '*bold*', '- dash'] }), { format: 'markdown' });
  assert.equal(md, '- 1\\. not a number\n- \\*bold\\*\n- \\- dash');
});

test('list accepts numbers and refuses empty lists, empty items and bad items', () => {
  assert.equal(renderList(defineList({ items: [42] })), '- 42');
  assert.throws(() => defineList({ items: [] }), TypeError);
  assert.throws(() => defineList({ items: ['ok', '\u001b[2J'] }), TypeError);
  assert.throws(() => defineList({ items: [null] }), TypeError);
  assert.throws(() => defineList({ items: [{ text: 'x', status: 'nope' }] }), RangeError);
  for (const format of ['plain', 'ansi', 'markdown']) {
    assert.throws(() => renderList({ items: [{ text: '' }], ordered: false }, { format }), TypeError);
  }
});
