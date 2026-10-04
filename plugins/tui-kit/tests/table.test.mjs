import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineTable, renderTable } from '../kit/index.mjs';

const strip = (s) => s.replace(/\u001b\[[0-9;]*m/g, '');
const columns = [{ key: 'check', header: 'Check' }, { key: 'result', header: 'Result' }, { key: 'ms', header: 'Time', align: 'right' }];
const rows = [{ check: 'lint', result: { status: 'ok' }, ms: 12 }, { check: 'tests', result: { status: 'error' }, ms: 340 }];

test('table renders the documented plain and markdown shapes', () => {
  const table = defineTable({ columns, rows });
  assert.equal(
    renderTable(table),
    'Check  Result   Time\n-----  -------  ----\nlint   ✓ OK       12\ntests  ✗ Error   340',
  );
  assert.equal(
    renderTable(table, { format: 'markdown' }),
    '| Check | Result | Time |\n| --- | --- | ---: |\n| lint | ✓ **OK** | 12 |\n| tests | ✗ **Error** | 340 |',
  );
});

test('table ANSI colours only the rule and badges; stripped it equals plain', () => {
  const table = defineTable({ columns, rows });
  const ansi = renderTable(table, { format: 'ansi', colorMode: 'ansi16' });
  assert.match(ansi.split('\n')[1], /^\u001b\[90m-----  -------  ----\u001b\[39m$/);
  assert.equal(strip(ansi), renderTable(table));
});

test('table with no rows renders headers and rule', () => {
  assert.equal(renderTable(defineTable({ columns: [{ key: 'a', header: 'A' }] })), 'A\n-');
});

test('markdown escapes a pipe in a cell so it never splits the cell', () => {
  const md = renderTable(defineTable({ columns: [{ key: 'a', header: 'A|B' }], rows: [{ a: 'x | y' }] }), { format: 'markdown' });
  assert.equal(md, '| A\\|B |\n| --- |\n| x \\| y |');
  // every row still has exactly one unescaped cell separator pair
  for (const line of md.split('\n')) assert.equal(line.replace(/\\\|/g, '').split('|').length, 3);
});

test('a missing or inherited row key is refused, never rendered', () => {
  assert.throws(() => defineTable({ columns: [{ key: 'a', header: 'A' }], rows: [{}] }), TypeError);
  assert.throws(() => defineTable({ columns: [{ key: 'toString', header: 'A' }], rows: [{}] }), TypeError);
  assert.throws(() => defineTable({ columns: [{ key: 'constructor', header: 'A' }], rows: [{ a: 1 }] }), TypeError);
});

test('empty headers and cells are refused in every format', () => {
  assert.throws(() => defineTable({ columns: [{ key: 'a', header: '' }] }), TypeError);
  assert.throws(() => defineTable({ columns: [{ key: 'a', header: 'A' }], rows: [{ a: '\u001b[0m' }] }), TypeError);
  assert.throws(() => defineTable({ columns: [{ key: 'a', header: 'A' }], rows: [{ a: null }] }), TypeError);
  for (const format of ['plain', 'ansi', 'markdown']) {
    const def = { columns: [{ key: 'a', header: 'A', align: 'left' }], rows: [[{ text: '  ' }]] };
    assert.throws(() => renderTable(def, { format }), TypeError);
  }
});

test('table definition errors', () => {
  assert.throws(() => defineTable({ columns: [] }), TypeError);
  assert.throws(() => defineTable({ columns: [{ key: '', header: 'A' }] }), TypeError);
  assert.throws(() => defineTable({ columns: [{ key: 'a', header: 'A', align: 'center' }] }), RangeError);
  assert.throws(() => defineTable({ columns, rows: 'nope' }), TypeError);
  assert.throws(() => renderTable({ columns: [{ key: 'a', header: 'A' }], rows: [[]] }), TypeError);
});

test('padding counts code points', () => {
  const out = renderTable(defineTable({ columns: [{ key: 'a', header: 'A' }, { key: 'b', header: 'B' }], rows: [{ a: '日本', b: 'x' }] }));
  assert.equal(out, 'A   B\n--  -\n日本  x');
});

test('a long table renders without exceeding argument limits', () => {
  const many = Array.from({ length: 200000 }, (_, i) => ({ a: i }));
  const out = renderTable(defineTable({ columns: [{ key: 'a', header: 'A' }], rows: many }));
  assert.equal(out.split('\n').length, 200002);
});
