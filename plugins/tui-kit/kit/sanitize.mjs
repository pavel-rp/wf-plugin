// Make untrusted content inert before it is rendered.
//
// Host-free and pure. Content may come from anywhere (a tool result, a file, a
// branch name), so every renderer passes it through `sanitizeText` first: a
// stray escape sequence must never move the cursor, retitle the terminal, open
// a hyperlink or reorder text.

// ESC-introduced sequences, matched in full so no fragment survives:
// - CSI: ESC [ params intermediates final
// - OSC: ESC ] ... terminated by BEL, ESC \ or C1 ST (or unterminated to end of input)
// - DCS / SOS / PM / APC: ESC P|X|^|_ ... ESC \ or C1 ST (or to end of input)
// - two-character escapes: ESC followed by one byte in 0x20-0x7e
const ESC_SEQUENCE = new RegExp(
  [
    '\\u001b\\[[0-?]*[ -/]*[@-~]',
    '\\u001b\\][^\\u0007\\u001b\\u009c]*(?:\\u0007|\\u001b\\\\|\\u009c|$)',
    '\\u001b[PX^_][^\\u001b\\u009c]*(?:\\u001b\\\\|\\u009c|$)',
    '\\u001b[ -~]',
  ].join('|'),
  'g',
);

// C1 equivalents of CSI and OSC (single-byte introducers 0x9b and 0x9d).
const C1_SEQUENCE = /\u009b[0-?]*[ -/]*[@-~]|\u009d[^\u0007\u009c]*(?:\u0007|\u009c|$)/g;

// Whitespace controls that become a single space rather than vanishing, so
// words on either side of a newline or tab stay apart.
const WHITESPACE_CONTROLS = /[\t\n\v\f\r]+/g;

// Every remaining C0 control, DEL, C1 control, and the bidi embedding,
// override and isolate controls (the "trojan source" set).
const OTHER_CONTROLS = /[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g;

/**
 * Strip escape sequences and control characters from `value`.
 * Non-string input is converted with `String()` first.
 *
 * @param {unknown} value
 * @returns {string} printable text only
 */
export function sanitizeText(value) {
  const s = typeof value === 'string' ? value : String(value ?? '');
  return s
    .replace(ESC_SEQUENCE, '')
    .replace(C1_SEQUENCE, '')
    .replace(WHITESPACE_CONTROLS, ' ')
    .replace(OTHER_CONTROLS, '')
    .replace(/ {2,}/g, ' ')
    .trim();
}

const MARKDOWN_SPECIALS = /[\\`*_{}[\]()#+\-.!|~>]/g;
const HTML_ENTITIES = Object.freeze({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' });

/**
 * Sanitize `value`, then escape every markdown metacharacter and the HTML
 * specials so the result renders as literal text in markdown.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function escapeMarkdown(value) {
  return sanitizeText(value)
    .replace(/[&<>"]/g, (c) => HTML_ENTITIES[/** @type {'&' | '<' | '>' | '"'} */ (c)])
    .replace(MARKDOWN_SPECIALS, (c) => `\\${c}`);
}
