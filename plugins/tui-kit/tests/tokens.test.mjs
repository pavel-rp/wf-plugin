import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HOST_THEME_KEYS,
  isHostThemeKey,
  BASE_TOKENS,
  DEFAULT_TIERS,
  createTokens,
  contrastRatio,
  colorFor,
  REFERENCE_BACKGROUNDS,
} from '../kit/index.mjs';

test('the host key list is closed and frozen', () => {
  assert.ok(Object.isFrozen(HOST_THEME_KEYS));
  assert.ok(isHostThemeKey('success'));
  assert.ok(!isHostThemeKey('notAThemeKey'));
  assert.ok(!isHostThemeKey('kit.tier.1'));
  assert.ok(!isHostThemeKey(undefined));
});

test('every base token maps to a listed host key and carries adaptive, complete variants and shades', () => {
  const names = ['text', 'muted', 'inactive', 'success', 'warning', 'error', 'info', 'accent', 'permission'];
  assert.deepEqual(Object.keys(BASE_TOKENS).sort(), [...names].sort());
  for (const name of names) {
    const t = BASE_TOKENS[name];
    assert.ok(isHostThemeKey(t.hostKey), `${name} host key ${t.hostKey}`);
    for (const appearance of ['dark', 'light']) {
      assert.match(t[appearance].hex, /^#[0-9a-f]{6}$/);
      assert.ok(Number.isInteger(t[appearance].ansi256));
      assert.ok(Number.isInteger(t[appearance].ansi16));
      assert.ok(t.shades[appearance].subtle.hex);
      assert.ok(t.shades[appearance].strong.hex);
    }
  }
});

test('default tokens include tier 1 to 5 from the default ramp', () => {
  const tokens = createTokens();
  for (const n of [1, 2, 3, 4, 5]) {
    const t = tokens[`tier.${n}`];
    assert.equal(t.hostKey, BASE_TOKENS[DEFAULT_TIERS[n]].hostKey);
    assert.equal(t.dark.hex, BASE_TOKENS[DEFAULT_TIERS[n]].dark.hex);
  }
  assert.ok(Object.isFrozen(tokens));
});

test('a tier remapped to a host key takes that key and its colours', () => {
  const tokens = createTokens({ tiers: { 3: 'claude' } });
  assert.equal(tokens['tier.3'].hostKey, 'claude');
  assert.equal(tokens['tier.3'].dark.hex, BASE_TOKENS.accent.dark.hex);
  assert.equal(tokens['tier.2'].hostKey, BASE_TOKENS[DEFAULT_TIERS[2]].hostKey);
});

test('a tier remapped to a hex colour uses it for both appearances', () => {
  const tokens = createTokens({ tiers: { 3: '#2f8fdf' } });
  assert.equal(tokens['tier.3'].dark.hex, '#2f8fdf');
  assert.equal(tokens['tier.3'].light.hex, '#2f8fdf');
  assert.equal(colorFor(tokens['tier.3'], { appearance: 'dark', depth: 'truecolor' }).hex, '#2f8fdf');
  // a value that passes against one background but not the other is refused
  assert.throws(() => createTokens({ tiers: { 3: '#4aa8ff' } }), RangeError);
});

test('remap validation: unknown host key, low contrast, unknown tier', () => {
  assert.throws(() => createTokens({ tiers: { 3: 'notAThemeKey' } }), TypeError);
  assert.throws(() => createTokens({ tiers: { 3: '#ffffe0' } }), RangeError); // too light for the light background
  assert.throws(() => createTokens({ tiers: { 3: '#101010' } }), RangeError); // too dark for the dark background
  assert.throws(() => createTokens({ tiers: { 6: 'success' } }), RangeError);
  assert.doesNotThrow(() => createTokens({ tiers: { 3: { dark: '#ffd75f', light: '#8a6d00' } } }));
});

test('contrastRatio follows WCAG', () => {
  assert.equal(Math.round(contrastRatio(REFERENCE_BACKGROUNDS.dark, REFERENCE_BACKGROUNDS.light)), 21);
  assert.equal(contrastRatio('#777777', '#777777'), 1);
});

test('colorFor with an unknown appearance returns only an ANSI 16 code', () => {
  for (const depth of ['ansi16', 'ansi256', 'truecolor']) {
    const c = colorFor(BASE_TOKENS.error, { appearance: 'auto', depth });
    assert.deepEqual(Object.keys(c), ['ansi16']);
  }
});

test('the daltonized remap turns success blue, including tiers built on success', () => {
  const tokens = createTokens();
  const plain = colorFor(tokens.success, { appearance: 'auto' });
  const dalt = colorFor(tokens.success, { appearance: 'auto', daltonized: true });
  assert.equal(plain.ansi16, 32);
  assert.equal(dalt.ansi16, 34);
  assert.equal(colorFor(tokens['tier.1'], { appearance: 'auto', daltonized: true }).ansi16, 34);
});
