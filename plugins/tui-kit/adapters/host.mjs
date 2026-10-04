// Host reading: the one place the adapters ask the host for accessibility
// values and hand them to the kit's profile as plain data.
//
// Where each value comes from:
// - theme and reduced motion: the effective `theme` and `reduceMotion` rows of
//   `$.config.list()` (a settings key only shows a value some source set);
// - the reduced-motion fallback and the screen reader: `$.settings.read()`
//   keys `prefersReducedMotion` and `axScreenReader`;
// - the screen reader, again: the `CLAUDE_AX_SCREEN_READER` environment value.
// The `--ax-screen-reader` flag is invisible to a mod, so nothing here can see
// it; the profile keeps its plain-text-safe default for that reason.
//
// A read that throws, or yields a value of the wrong type, counts as
// unreachable, and the profile's documented default applies.

import { resolveProfile } from '../kit/index.mjs';

/** @param {() => Promise<any>} read */
async function attempt(read) {
  try {
    return await read();
  } catch {
    return undefined;
  }
}

/** @param {unknown} rows @param {string} key */
function rowValue(rows, key) {
  if (!Array.isArray(rows)) return undefined;
  const row = rows.find((r) => r && typeof r === 'object' && Object.hasOwn(r, 'key') && r.key === key);
  return row && Object.hasOwn(row, 'value') ? row.value : undefined;
}

/** @param {unknown} obj @param {string} key */
function ownValue(obj, key) {
  return obj && typeof obj === 'object' && Object.hasOwn(obj, key) ? /** @type {any} */ (obj)[key] : undefined;
}

/** @param {unknown} v */
const asString = (v) => (typeof v === 'string' ? v : undefined);
/** @param {unknown} v */
const asBoolean = (v) => (typeof v === 'boolean' ? v : undefined);

/**
 * Read the host's accessibility values and resolve the kit profile.
 *
 * @param {any} $ the engine interface a hook receives
 * @param {{ screenReaderOff?: boolean }} [options] `screenReaderOff`: the
 *   person's own declared "no screen reader" preference, for example a mod option
 * @returns {Promise<ReturnType<typeof resolveProfile>>}
 */
export async function readHostProfile($, options = {}) {
  const rows = await attempt(() => $.config.list());
  const settings = await attempt(() => $.settings.read());
  const env = await attempt(() => $.env.get('CLAUDE_AX_SCREEN_READER'));
  return resolveProfile({
    theme: asString(rowValue(rows, 'theme')),
    reduceMotion: asBoolean(rowValue(rows, 'reduceMotion')),
    prefersReducedMotion: asBoolean(ownValue(settings, 'prefersReducedMotion')),
    axScreenReader: asBoolean(ownValue(settings, 'axScreenReader')),
    axScreenReaderEnv: asString(env),
    screenReaderOff: options?.screenReaderOff === true,
  });
}
