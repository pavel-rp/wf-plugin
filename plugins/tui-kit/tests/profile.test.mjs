import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveProfile, PROFILE_DEFAULTS, defineBadge, renderBadge } from '../kit/index.mjs';

test('a reachable daltonized theme is reported', () => {
  const p = resolveProfile({ theme: 'dark-daltonized' });
  assert.equal(p.daltonized, true);
  assert.equal(p.appearance, 'dark');
  assert.equal(p.sources.theme, 'host');
});

test('reachable reduced motion is reported, config row before settings', () => {
  assert.deepEqual(
    [resolveProfile({ reduceMotion: true }).reducedMotion, resolveProfile({ reduceMotion: true }).sources.reducedMotion],
    [true, 'host-config'],
  );
  assert.deepEqual(
    [resolveProfile({ prefersReducedMotion: true }).reducedMotion, resolveProfile({ prefersReducedMotion: true }).sources.reducedMotion],
    [true, 'host-settings'],
  );
  const both = resolveProfile({ reduceMotion: false, prefersReducedMotion: true });
  assert.equal(both.reducedMotion, false);
  assert.equal(both.sources.reducedMotion, 'host-config');
});

test('screen reader is reported from settings or the environment', () => {
  const s = resolveProfile({ axScreenReader: true });
  assert.equal(s.screenReader, 'on');
  assert.equal(s.sources.screenReader, 'host-settings');
  const e = resolveProfile({ axScreenReaderEnv: '1' });
  assert.equal(e.screenReader, 'on');
  assert.equal(e.sources.screenReader, 'host-env');
  assert.equal(resolveProfile({ axScreenReaderEnv: '0' }).screenReader, 'unknown');
});

test('unreachable settings fall back to the documented defaults', () => {
  const p = resolveProfile({});
  assert.equal(p.theme, PROFILE_DEFAULTS.theme);
  assert.equal(p.theme, 'auto');
  assert.equal(p.appearance, 'auto');
  assert.equal(p.reducedMotion, true);
  assert.equal(p.screenReader, 'unknown');
  assert.equal(p.preferPlainText, true);
  assert.deepEqual({ ...p.sources }, { theme: 'default', reducedMotion: 'default', screenReader: 'default' });
  assert.ok(Object.isFrozen(p));
});

test('an unknown theme value is treated as unreachable', () => {
  const p = resolveProfile({ theme: 'neon' });
  assert.equal(p.theme, 'auto');
  assert.equal(p.sources.theme, 'default');
});

test('the default profile never emits an RGB or 256-colour value', () => {
  const p = resolveProfile({});
  for (const colorMode of ['ansi16', 'ansi256', 'truecolor']) {
    const out = renderBadge(defineBadge({ status: 'ok' }), { format: 'ansi', profile: p, colorMode });
    assert.match(out, /^\u001b\[(3[0-7]|9[0-7])m/);
    assert.doesNotMatch(out, /38;[25];/);
  }
});

test('only a declared preference turns plain-text preference off', () => {
  assert.equal(resolveProfile({ axScreenReader: false }).preferPlainText, true);
  assert.equal(resolveProfile({ screenReaderOff: true }).preferPlainText, false);
  assert.equal(resolveProfile({ screenReaderOff: true, axScreenReader: true }).screenReader, 'on');
});
