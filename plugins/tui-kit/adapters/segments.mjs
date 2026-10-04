// Segment lines: a component definition broken into styled runs of text.
//
// Host-free and pure, like the kit itself. An adapter draws each run with a
// host element; this module only says what the runs are. The joined text of
// line i is always line i of the core's plain rendering with the same
// profile, so every decoration rule (for example the meter dropping its bar
// for a screen reader) stays the core's. When a run split ever disagrees with
// the core's plain line, that line falls back to one uncoloured run of the
// core's own text, so a drawing never shows text the core would not.

import {
  sanitizeText,
  renderBadge,
  renderPanel,
  renderList,
  renderTable,
  renderMeter,
} from '../kit/index.mjs';

/** The component kinds a view may name. */
export const VIEW_KINDS = Object.freeze(['badge', 'panel', 'list', 'table', 'meter']);

/**
 * @typedef {Readonly<{ text: string, token?: string, bold?: boolean }>} Segment
 * @typedef {readonly Segment[]} Line
 * @typedef {{ kind: string, def: any }} View
 */

/**
 * @param {string} text kit-built decoration or already-sanitized content
 * @param {string} [token]
 * @param {boolean} [bold]
 * @returns {Segment}
 */
function run(text, token, bold) {
  /** @type {{ text: string, token?: string, bold?: boolean }} */
  const s = { text };
  if (token !== undefined) s.token = token;
  if (bold === true) s.bold = true;
  return Object.freeze(s);
}

/** @param {any} view */
function requireView(view) {
  if (!view || typeof view !== 'object') throw new TypeError('a view must be { kind, def }');
  if (typeof view.kind !== 'string' || !VIEW_KINDS.includes(view.kind)) {
    throw new RangeError(`unknown view kind ${JSON.stringify(view.kind)}`);
  }
  if (!view.def || typeof view.def !== 'object') throw new TypeError('a view needs a component definition');
  return view;
}

/** @param {any} badge @returns {Segment[]} */
function badgeRuns(badge) {
  return [run(renderBadge(badge), badge.token)];
}

/**
 * The core's plain rendering of a view: the text every drawing must show.
 *
 * @param {View} view
 * @param {{ profile?: object }} [options]
 * @returns {string}
 */
export function viewText(view, options = {}) {
  const { kind, def } = requireView(view);
  const profile = options?.profile ?? {};
  switch (kind) {
    case 'badge':
      return renderBadge(def);
    case 'panel':
      return renderPanel(def, { profile });
    case 'list':
      return renderList(def, { profile });
    case 'table':
      return renderTable(def, { profile });
    default:
      return renderMeter(def, { profile });
  }
}

/** @param {any} def @returns {Segment[][]} */
function panelRuns(def) {
  const border = def.badge ? def.badge.token : 'muted';
  const head = [run('┌', border), run(' '), run(sanitizeText(def.title), undefined, true)];
  if (def.badge) head.push(run(' — '), ...badgeRuns(def.badge));
  const body = (Array.isArray(def.body) ? def.body : []).map((line) => [run('│', border), run(' '), run(sanitizeText(line))]);
  return [head, ...body, [run('└', border)]];
}

/** @param {any} def @returns {Segment[][]} */
function listRuns(def) {
  return def.items.map((/** @type {any} */ item, /** @type {number} */ i) => {
    const marker = def.ordered === true ? `${i + 1}.` : '-';
    const line = [run(marker, 'muted'), run(' ')];
    if (item.badge) line.push(...badgeRuns(item.badge), run(' · '));
    line.push(run(sanitizeText(item.text)));
    return line;
  });
}

/** @param {string} plain @returns {Segment[][]} */
function tableRuns(plain) {
  // Column padding is the core's; take its lines and style them whole.
  return plain.split('\n').map((line, i) => {
    if (i === 0) return [run(line, undefined, true)];
    if (i === 1) return [run(line, 'muted')];
    return [run(line)];
  });
}

/** @param {any} def @param {string} plain @returns {Segment[][]} */
function meterRuns(def, plain) {
  const label = sanitizeText(def.label);
  const line = [run(label, undefined, true)];
  if (def.badge) line.push(run(' '), ...badgeRuns(def.badge));
  let rest = plain.slice(line.reduce((n, s) => n + s.text.length, 0));
  if (rest.startsWith(' [')) {
    const close = rest.indexOf(']');
    line.push(run(' ['), run(rest.slice(2, close), def.token), run(']'));
    rest = rest.slice(close + 1);
  }
  line.push(run(rest));
  return [line];
}

/**
 * Break a view into lines of styled runs.
 *
 * The core renders first, so a definition the core refuses throws exactly as
 * the core's own render does. Every run's text has passed `sanitizeText` or is
 * kit-built decoration.
 *
 * @param {View} view
 * @param {{ profile?: object }} [options]
 * @returns {readonly Line[]}
 */
export function viewLines(view, options = {}) {
  const plain = viewText(view, options);
  const { kind, def } = view;
  const plainLines = plain.split('\n');
  /** @type {Segment[][]} */
  let lines;
  switch (kind) {
    case 'badge':
      lines = [badgeRuns(def)];
      break;
    case 'panel':
      lines = panelRuns(def);
      break;
    case 'list':
      lines = listRuns(def);
      break;
    case 'table':
      lines = tableRuns(plain);
      break;
    default:
      lines = meterRuns(def, plain);
  }
  return Object.freeze(
    plainLines.map((text, i) => {
      const line = lines[i] ?? [];
      const joined = line.map((s) => s.text).join('');
      return Object.freeze(joined === text ? line.filter((s) => s.text !== '') : [run(text)]);
    }),
  );
}
