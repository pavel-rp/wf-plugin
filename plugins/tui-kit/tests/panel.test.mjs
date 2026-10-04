import { test } from 'node:test';
import assert from 'node:assert/strict';
import { definePanel, renderPanel, defineBadge } from '../kit/index.mjs';

const strip = (s) => s.replace(/\u001b\[[0-9;]*m/g, '');

test('panel renders the documented plain and markdown shapes', () => {
  const panel = definePanel({ title: 'Build', status: 'error', body: ['3 tests failed', 'see the log'] });
  assert.equal(renderPanel(panel), '┌ Build — ✗ Error\n│ 3 tests failed\n│ see the log\n└');
  assert.equal(renderPanel(panel, { format: 'markdown' }), '**Build** — ✗ **Error**\n> 3 tests failed\\\n> see the log');
});

test('panel without status or body', () => {
  const panel = definePanel({ title: 'Notes' });
  assert.equal(renderPanel(panel), '┌ Notes\n└');
  assert.equal(renderPanel(panel, { format: 'markdown' }), '**Notes**');
  assert.equal(renderPanel(definePanel({ title: 'One', body: 'line' })), '┌ One\n│ line\n└');
});

test('panel ANSI colours only the border, with the status colour or muted', () => {
  const withStatus = renderPanel(definePanel({ title: 'Build', status: 'ok', body: ['x'] }), { format: 'ansi', colorMode: 'ansi16' });
  assert.match(withStatus, /^\u001b\[32m┌\u001b\[39m Build — \u001b\[32m✓ OK\u001b\[39m\n\u001b\[32m│\u001b\[39m x\n\u001b\[32m└\u001b\[39m$/);
  const muted = renderPanel(definePanel({ title: 'Plain', body: ['x'] }), { format: 'ansi', colorMode: 'ansi16' });
  assert.match(muted, /^\u001b\[90m┌\u001b\[39m Plain\n/);
  assert.equal(strip(muted), renderPanel(definePanel({ title: 'Plain', body: ['x'] })));
});

test('panel composes the status badge', () => {
  const badge = defineBadge({ glyph: '◆', label: 'Custom', token: 'accent' });
  assert.equal(renderPanel(definePanel({ title: 'T', status: badge })), '┌ T — ◆ Custom\n└');
});

test('panel refuses empty title or body line, and non-text values', () => {
  assert.throws(() => definePanel({ title: '\u001b[0m' }), TypeError);
  assert.throws(() => definePanel({ title: 'T', body: ['ok', '  '] }), TypeError);
  assert.throws(() => definePanel({ title: { toString: () => 'x' } }), TypeError);
  assert.throws(() => definePanel({ title: 'T', body: { length: 1 } }), TypeError);
  assert.throws(() => definePanel(null), TypeError);
  for (const format of ['plain', 'ansi', 'markdown']) {
    assert.throws(() => renderPanel({ title: 'T', body: ['\u0007'] }, { format }), TypeError);
  }
});

test('panel markdown escapes structural characters in content', () => {
  const md = renderPanel(definePanel({ title: '# *x*', body: ['> quote', '- item | pipe'] }), { format: 'markdown' });
  assert.equal(md, '**\\# \\*x\\***\n> &gt; quote\\\n> \\- item \\| pipe');
});

test('panel markdown body lines end in a hard break except the last, so they never join', () => {
  const md = renderPanel(definePanel({ title: 'T', body: ['one', 'two', 'three'] }), { format: 'markdown' });
  assert.deepEqual(md.split('\n'), ['**T**', '> one\\', '> two\\', '> three']);
  // a single line carries no break
  assert.equal(renderPanel(definePanel({ title: 'T', body: ['only'] }), { format: 'markdown' }), '**T**\n> only');
  // content ending in a backslash stays escaped, so the break is never doubled into a literal
  const tricky = renderPanel(definePanel({ title: 'T', body: ['a\\', 'b'] }), { format: 'markdown' });
  assert.equal(tricky, '**T**\n> a\\\\\\\n> b');
});
