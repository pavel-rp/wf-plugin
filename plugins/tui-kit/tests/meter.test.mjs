import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineMeter, renderMeter, METER_WIDTH, resolveProfile } from '../kit/index.mjs';

const strip = (s) => s.replace(/\u001b\[[0-9;]*m/g, '');

test('meter renders the documented plain and markdown shapes', () => {
  const meter = defineMeter({ label: 'Disk', value: 8, max: 10, status: 'warn' });
  assert.equal(renderMeter(meter), 'Disk ! Warning [████████░░] 80% (8/10)');
  assert.equal(renderMeter(meter, { format: 'markdown' }), '**Disk** \\! **Warning** `████████░░` 80% (8/10)');
});

test('meter defaults: max 100, width 10, no status', () => {
  const meter = defineMeter({ label: 'CPU', value: 25 });
  assert.equal(meter.max, 100);
  assert.equal(meter.width, METER_WIDTH.default);
  assert.equal(renderMeter(meter), 'CPU [███░░░░░░░] 25% (25/100)');
});

test('meter ANSI colours the bar with token, else badge colour, else info', () => {
  const tokenColoured = renderMeter(defineMeter({ label: 'A', value: 1, max: 2, token: 'error' }), { format: 'ansi', colorMode: 'ansi16' });
  assert.match(tokenColoured, /\[\u001b\[31m█████░░░░░\u001b\[39m\]/);
  const badgeColoured = renderMeter(defineMeter({ label: 'A', value: 1, max: 2, status: 'ok' }), { format: 'ansi', colorMode: 'ansi16' });
  assert.match(badgeColoured, /\[\u001b\[32m█████░░░░░\u001b\[39m\]/);
  const infoColoured = renderMeter(defineMeter({ label: 'A', value: 1, max: 2 }), { format: 'ansi', colorMode: 'ansi16' });
  assert.match(infoColoured, /\[\u001b\[34m█████░░░░░\u001b\[39m\]/);
  assert.equal(strip(infoColoured), renderMeter(defineMeter({ label: 'A', value: 1, max: 2 })));
});

test('a screen-reader profile drops the bar and keeps label, badge and numbers', () => {
  const meter = defineMeter({ label: 'Disk', value: 8, max: 10, status: 'warn' });
  const profile = { screenReader: 'on' };
  assert.equal(renderMeter(meter, { profile }), 'Disk ! Warning 80% (8/10)');
  assert.equal(renderMeter(meter, { format: 'markdown', profile }), '**Disk** \\! **Warning** 80% (8/10)');
  assert.doesNotMatch(renderMeter(meter, { format: 'ansi', colorMode: 'ansi16', profile }), /█|░/);
});

test('a plain-text-preferring profile drops the bar; a declared no-screen-reader profile keeps it', () => {
  const meter = defineMeter({ label: 'Disk', value: 8, max: 10 });
  // resolveProfile defaults to screenReader 'unknown' with preferPlainText true
  const unknown = resolveProfile({ theme: 'dark' });
  assert.equal(unknown.screenReader, 'unknown');
  assert.equal(renderMeter(meter, { profile: unknown }), 'Disk 80% (8/10)');
  assert.equal(renderMeter(meter, { profile: { preferPlainText: true } }), 'Disk 80% (8/10)');
  const declaredOff = resolveProfile({ theme: 'dark', screenReaderOff: true });
  assert.equal(renderMeter(meter, { profile: declaredOff }), 'Disk [████████░░] 80% (8/10)');
  assert.equal(renderMeter(meter), 'Disk [████████░░] 80% (8/10)');
});

test('meter width and bounds', () => {
  assert.equal(renderMeter(defineMeter({ label: 'E', value: 0, width: 4 })), 'E [░░░░] 0% (0/100)');
  assert.equal(renderMeter(defineMeter({ label: 'F', value: 100, width: 1 })), 'F [█] 100% (100/100)');
  assert.equal(renderMeter(defineMeter({ label: 'D', value: 2.5, max: 10 })), 'D [███░░░░░░░] 25% (2.5/10)');
});

test('meter refuses out-of-range numbers', () => {
  for (const bad of [
    { value: -1 }, { value: 11, max: 10 }, { value: NaN }, { value: Infinity }, { value: '5' },
    { value: 1, max: 0 }, { value: 1, max: -5 }, { value: 1, max: Infinity },
    { value: 1, width: 0 }, { value: 1, width: 101 }, { value: 1, width: 2.5 },
  ]) {
    assert.throws(() => defineMeter({ label: 'x', ...bad }), RangeError, JSON.stringify(bad));
  }
  assert.throws(() => renderMeter({ label: 'x', value: 5, max: 1, width: 10, token: 'info' }), RangeError);
});

test('meter refuses an empty label and a non-string token', () => {
  assert.throws(() => defineMeter({ label: '\u001b]0;t\u0007', value: 1 }), TypeError);
  assert.throws(() => defineMeter({ label: 'x', value: 1, token: 5 }), TypeError);
  assert.throws(
    () => renderMeter(defineMeter({ label: 'x', value: 1, token: 'toString' }), { format: 'ansi', colorMode: 'ansi16' }),
    RangeError,
  );
});
