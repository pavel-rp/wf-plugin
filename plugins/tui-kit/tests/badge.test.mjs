import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STATUSES,
  defineBadge,
  renderBadge,
  createTokens,
  resolveColorMode,
  resolveProfile,
  sanitizeText,
  escapeMarkdown,
} from '../kit/index.mjs';

const SGR = /\u001b\[[0-9;]*m/;
const strip = (s) => s.replace(/\u001b\[[0-9;]*m/g, '');

test('with no mod, a badge renders to plain, ANSI and markdown, each carrying glyph and label', () => {
  const badge = defineBadge({ status: 'error' });
  const plain = renderBadge(badge);
  const ansi = renderBadge(badge, { format: 'ansi', colorMode: 'ansi16' });
  const md = renderBadge(badge, { format: 'markdown' });
  assert.equal(plain, '✗ Error');
  assert.equal(strip(ansi), '✗ Error');
  assert.match(ansi, SGR);
  assert.equal(md, '✗ **Error**');
  for (const out of [plain, ansi, md]) {
    assert.ok(out.includes('✗'));
    assert.ok(out.includes('Error'));
  }
});

test('every status and tier has its own glyph and a label', () => {
  const glyphs = Object.values(STATUSES).map((s) => s.glyph);
  assert.equal(new Set(glyphs).size, glyphs.length);
  for (const s of Object.values(STATUSES)) assert.ok(s.label.length > 0);
});

test('NO_COLOR: no colour emitted, glyph and text still carry every state', () => {
  const colorMode = resolveColorMode({ env: { NO_COLOR: '1' }, isTTY: true });
  const seen = new Set();
  for (const status of Object.keys(STATUSES)) {
    const out = renderBadge(defineBadge({ status }), { format: 'ansi', colorMode });
    assert.doesNotMatch(out, /\u001b/);
    assert.ok(out.startsWith(STATUSES[status].glyph));
    assert.ok(out.endsWith(STATUSES[status].label));
    seen.add(out);
  }
  assert.equal(seen.size, Object.keys(STATUSES).length);
});

test('FORCE_COLOR on a non-TTY: ANSI colour is emitted', () => {
  const colorMode = resolveColorMode({ env: { FORCE_COLOR: '1' }, isTTY: false });
  const out = renderBadge(defineBadge({ status: 'ok' }), { format: 'ansi', colorMode });
  assert.match(out, /^\u001b\[32m✓ OK\u001b\[39m$/);
});

test('depths: 256-colour and truecolour SGR when the appearance is known', () => {
  const profile = resolveProfile({ theme: 'dark' });
  const badge = defineBadge({ status: 'warn' });
  assert.match(renderBadge(badge, { format: 'ansi', colorMode: 'ansi256', profile }), /^\u001b\[38;5;\d+m/);
  assert.match(renderBadge(badge, { format: 'ansi', colorMode: 'truecolor', profile }), /^\u001b\[38;2;\d+;\d+;\d+m/);
});

test('an ANSI host theme caps output at 16 colours', () => {
  const profile = resolveProfile({ theme: 'dark-ansi' });
  const out = renderBadge(defineBadge({ status: 'warn' }), { format: 'ansi', colorMode: 'truecolor', profile });
  assert.match(out, /^\u001b\[33m/);
});

test('a daltonized theme renders success in blue', () => {
  const profile = resolveProfile({ theme: 'dark-daltonized' });
  const out = renderBadge(defineBadge({ status: 'ok' }), { format: 'ansi', colorMode: 'ansi16', profile });
  assert.match(out, /^\u001b\[34m/);
});

test('a remapped tier uses the remapped colour; glyph and label are unchanged', () => {
  const badge = defineBadge({ status: 'tier3' });
  const profile = resolveProfile({ theme: 'dark' });
  const base = renderBadge(badge, { format: 'ansi', colorMode: 'truecolor', profile });
  const remappedHex = renderBadge(badge, {
    format: 'ansi', colorMode: 'truecolor', profile, tokens: createTokens({ tiers: { 3: '#2f8fdf' } }),
  });
  const remappedKey = renderBadge(badge, {
    format: 'ansi', colorMode: 'ansi16', tokens: createTokens({ tiers: { 3: 'claude' } }),
  });
  assert.match(remappedHex, /^\u001b\[38;2;47;143;223m/);
  assert.notEqual(base, remappedHex);
  assert.match(remappedKey, /^\u001b\[35m/);
  assert.equal(strip(base), strip(remappedHex));
  assert.equal(strip(base), strip(remappedKey));
  assert.equal(strip(base), '▅ Tier 3');
  assert.equal(renderBadge(badge, { format: 'markdown', tokens: createTokens({ tiers: { 3: 'claude' } }) }), '▅ **Tier 3**');
});

test('control sequences in content are stripped in all three renderings', () => {
  const hostile = 'Build\u001b[31m red\u001b[0m \u001b]0;pwned\u0007\u001b]8;;https://x.example\u001b\\link\u001b]8;;\u001b\\ \u0007\u0008\u009b2J‮done⁦\r\nnext';
  const badge = defineBadge({ glyph: '!\u001b[5m', label: hostile, token: 'warning' });
  const outputs = [
    renderBadge(badge),
    strip(renderBadge(badge, { format: 'ansi', colorMode: 'ansi16' })),
    renderBadge(badge, { format: 'markdown' }),
  ];
  for (const out of outputs) {
    assert.doesNotMatch(out, /[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/);
    assert.ok(!out.includes('pwned'));
    assert.ok(out.includes('Build'));
    assert.ok(out.includes('done'));
  }
  assert.equal(outputs[0], '! Build red link done next');
  // the ANSI rendering carries exactly one opening and one closing SGR, both the kit's own
  const ansi = renderBadge(badge, { format: 'ansi', colorMode: 'ansi16' });
  assert.equal(ansi.match(/\u001b/g).length, 2);
});

test('a hand-built definition is sanitized at render time too', () => {
  const out = renderBadge({ glyph: '\u001b[2J✓', label: 'ok\u001b[H', token: 'success' });
  assert.equal(out, '✓ ok');
});

test('markdown escapes markdown and HTML metacharacters', () => {
  const badge = defineBadge({ glyph: '*', label: '<b>bold</b> _x_ [l](u) # | `c`', token: 'info' });
  const md = renderBadge(badge, { format: 'markdown' });
  assert.equal(md, '\\* **&lt;b&gt;bold&lt;/b&gt; \\_x\\_ \\[l\\]\\(u\\) \\# \\| \\`c\\`**');
  assert.doesNotMatch(md, /<|>/);
});

test('a C1 string terminator ends an escape string without swallowing the text after it', () => {
  assert.equal(sanitizeText('a\u001b]0;t\u009cVISIBLE tail'), 'aVISIBLE tail');
  assert.equal(sanitizeText('a\u001bPq\u009cVISIBLE tail'), 'aVISIBLE tail');
  assert.equal(sanitizeText('a\u001b_x\u009cVISIBLE tail'), 'aVISIBLE tail');
});

test('a C1-introduced escape string closed by ESC \\ keeps the text after it', () => {
  // OSC (0x9d), DCS (0x90), SOS (0x98), PM (0x9e) and APC (0x9f), each closed by the 7-bit ST
  for (const intro of ['\u009d', '\u0090', '\u0098', '\u009e', '\u009f']) {
    assert.equal(sanitizeText(`a${intro}0;t\u001b\\ visible`), 'a visible');
  }
  // and the C1 string introducers still end at C1 ST, and OSC at BEL
  assert.equal(sanitizeText('a\u0090q\u009cVISIBLE'), 'aVISIBLE');
  assert.equal(sanitizeText('a\u009d0;t\u0007VISIBLE'), 'aVISIBLE');
});

test('a long unterminated run of C1 string introducers is sanitized in linear time', () => {
  for (const intro of ['\u009d', '\u0090', '\u0098', '\u009e', '\u009f']) {
    // the run is closed by an ESC that starts a CSI, not a string terminator
    const input = `a${intro.repeat(40000)}\u001b[m tail`;
    const start = performance.now();
    const out = sanitizeText(input);
    const elapsed = performance.now() - start;
    assert.equal(out, 'a tail');
    assert.ok(elapsed < 50, `40000 introducers took ${elapsed.toFixed(1)} ms`);
  }
});

test('a hand-built definition whose label sanitizes to empty is refused in every format', () => {
  for (const format of ['plain', 'ansi', 'markdown']) {
    assert.throws(
      () => renderBadge({ glyph: '', label: '\u001b[0m', token: 'info' }, { format, colorMode: 'ansi16' }),
      TypeError,
    );
  }
});

test('inherited object names are not statuses or tokens', () => {
  assert.throws(() => defineBadge({ status: 'constructor' }), RangeError);
  assert.throws(() => defineBadge({ status: 'toString' }), RangeError);
  assert.throws(
    () => renderBadge(defineBadge({ glyph: 'x', label: 'y', token: 'toString' }), { format: 'ansi', colorMode: 'ansi16' }),
    RangeError,
  );
});

test('sanitizeText and escapeMarkdown accept non-strings', () => {
  assert.equal(sanitizeText(42), '42');
  assert.equal(sanitizeText(undefined), '');
  assert.equal(escapeMarkdown(null), '');
});

test('definition errors', () => {
  assert.throws(() => defineBadge({ status: 'nope' }), RangeError);
  assert.throws(() => defineBadge({ glyph: 'x', label: '\u001b[0m', token: 'info' }), TypeError);
  assert.throws(() => renderBadge(defineBadge({ status: 'ok' }), { format: 'html' }), RangeError);
  assert.throws(
    () => renderBadge(defineBadge({ glyph: 'x', label: 'y', token: 'missing' }), { format: 'ansi', colorMode: 'ansi16' }),
    RangeError,
  );
});
