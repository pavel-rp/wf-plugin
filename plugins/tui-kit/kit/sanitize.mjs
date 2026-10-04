// Make untrusted content inert before it is rendered.
//
// Host-free and pure. Content may come from anywhere (a tool result, a file, a
// branch name), so every renderer passes it through `sanitizeText` first: a
// stray escape sequence must never move the cursor, retitle the terminal, open
// a hyperlink or reorder text.

// String sequences, matched first and in full, with the same terminators whether
// the introducer is the 7-bit ESC form or the single-byte C1 form:
// - OSC: ESC ] or 0x9d ... terminated by BEL, ESC \ or ST 0x9c (or to end of input)
// - DCS / SOS / PM / APC: ESC P|X|^|_ or 0x90|0x98|0x9e|0x9f ... terminated by
//   ESC \ or ST 0x9c (or to end of input)
// Running this pass first means a 7-bit ESC \ terminator is never stripped on its
// own before the string it closes is matched.
// A string body never contains another C1 string introducer: the match ends just
// before the next one, which then starts its own match. This keeps the pass
// linear on a long unterminated run of introducers.
const STRING_SEQUENCE = new RegExp(
  [
    '(?:\\u001b\\]|\\u009d)[^\\u0007\\u001b\\u009c\\u0090\\u0098\\u009d-\\u009f]*(?:\\u0007|\\u001b\\\\|\\u009c|$|(?=[\\u0090\\u0098\\u009d-\\u009f]))',
    '(?:\\u001b[PX^_]|[\\u0090\\u0098\\u009e\\u009f])[^\\u001b\\u009c\\u0090\\u0098\\u009d-\\u009f]*(?:\\u001b\\\\|\\u009c|$|(?=[\\u0090\\u0098\\u009d-\\u009f]))',
  ].join('|'),
  'g',
);

// Remaining ESC-introduced sequences:
// - CSI: ESC [ params intermediates final
// - two-character escapes: ESC followed by one byte in 0x20-0x7e
const ESC_SEQUENCE = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b[ -~]/g;

// C1 equivalent of CSI (single-byte introducer 0x9b).
const C1_SEQUENCE = /\u009b[0-?]*[ -/]*[@-~]/g;

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
    .replace(STRING_SEQUENCE, '')
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
