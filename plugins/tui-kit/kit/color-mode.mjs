// Colour-mode resolution from plain environment values.
//
// Host-free: the caller passes the environment as a plain object of strings and
// says whether output is a TTY. Nothing here reads a global.

/** @typedef {'none' | 'ansi16' | 'ansi256' | 'truecolor'} ColorMode */

/**
 * Decide how much colour text output may carry.
 *
 * Rules, first match wins:
 * 1. `NO_COLOR` present and non-empty -> `none` (it beats `FORCE_COLOR`).
 * 2. `FORCE_COLOR` present -> `0`/`false` gives `none`; `2` gives at least
 *    `ansi256` (`truecolor` when the terminal reports it); `3` gives `truecolor`; any other value (including empty, `1`, `true`)
 *    gives `ansi16`, or the terminal's detected depth when that is higher.
 *    This applies whether or not output is a TTY.
 * 3. Not a TTY -> `none`.
 * 4. `TERM=dumb` -> `none`.
 * 5. `COLORTERM` is `truecolor` or `24bit` -> `truecolor`.
 * 6. `TERM` contains `256color` -> `ansi256`.
 * 7. Otherwise -> `ansi16`.
 *
 * @param {{ env?: Record<string, string | undefined>, isTTY?: boolean }} [input]
 * @returns {ColorMode}
 */
export function resolveColorMode(input = {}) {
  const env = input.env ?? {};
  const isTTY = input.isTTY === true;

  const noColor = env.NO_COLOR;
  if (typeof noColor === 'string' && noColor !== '') return 'none';

  const detected = detectDepth(env);
  const force = env.FORCE_COLOR;
  if (typeof force === 'string') {
    const v = force.trim().toLowerCase();
    if (v === '0' || v === 'false') return 'none';
    if (v === '3') return 'truecolor';
    if (v === '2') return detected === 'truecolor' ? 'truecolor' : 'ansi256';
    return detected === 'none' ? 'ansi16' : detected;
  }

  if (!isTTY) return 'none';
  return detected;
}

/**
 * @param {Record<string, string | undefined>} env
 * @returns {ColorMode}
 */
function detectDepth(env) {
  const term = (env.TERM ?? '').toLowerCase();
  if (term === 'dumb') return 'none';
  const colorterm = (env.COLORTERM ?? '').toLowerCase();
  if (colorterm === 'truecolor' || colorterm === '24bit') return 'truecolor';
  if (term.includes('256color')) return 'ansi256';
  return 'ansi16';
}
