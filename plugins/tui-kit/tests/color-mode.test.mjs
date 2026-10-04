import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveColorMode } from '../kit/index.mjs';

test('NO_COLOR disables colour, even on a TTY and even with FORCE_COLOR', () => {
  assert.equal(resolveColorMode({ env: { NO_COLOR: '1' }, isTTY: true }), 'none');
  assert.equal(resolveColorMode({ env: { NO_COLOR: '1', FORCE_COLOR: '3' }, isTTY: true }), 'none');
});

test('an empty NO_COLOR is ignored', () => {
  assert.equal(resolveColorMode({ env: { NO_COLOR: '' }, isTTY: true }), 'ansi16');
});

test('FORCE_COLOR enables colour when output is not a TTY', () => {
  assert.equal(resolveColorMode({ env: { FORCE_COLOR: '1' }, isTTY: false }), 'ansi16');
  assert.equal(resolveColorMode({ env: { FORCE_COLOR: '' }, isTTY: false }), 'ansi16');
  assert.equal(resolveColorMode({ env: { FORCE_COLOR: '2' }, isTTY: false }), 'ansi256');
  assert.equal(resolveColorMode({ env: { FORCE_COLOR: '3' }, isTTY: false }), 'truecolor');
  assert.equal(resolveColorMode({ env: { FORCE_COLOR: '0' }, isTTY: true }), 'none');
  assert.equal(resolveColorMode({ env: { FORCE_COLOR: 'false' }, isTTY: true }), 'none');
});

test('without FORCE_COLOR a non-TTY gets no colour', () => {
  assert.equal(resolveColorMode({ env: {}, isTTY: false }), 'none');
  assert.equal(resolveColorMode(), 'none');
});

test('TTY depth detection', () => {
  assert.equal(resolveColorMode({ env: { TERM: 'dumb' }, isTTY: true }), 'none');
  assert.equal(resolveColorMode({ env: { COLORTERM: 'truecolor' }, isTTY: true }), 'truecolor');
  assert.equal(resolveColorMode({ env: { TERM: 'xterm-256color' }, isTTY: true }), 'ansi256');
  assert.equal(resolveColorMode({ env: { TERM: 'xterm' }, isTTY: true }), 'ansi16');
});
