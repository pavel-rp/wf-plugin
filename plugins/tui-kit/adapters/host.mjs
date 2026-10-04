// Host values: the accessibility values a mod reads from the host, checked
// and handed to the kit's profile as plain data.
//
// The host lets `$` reach only functions declared in the mod's own hooks
// module, never across an import, so the mod makes the three reads itself
// and passes their results here:
//
//   const configRows = await $.config.list()                    // theme, reduceMotion rows
//   const settings = await $.settings.read()                    // prefersReducedMotion, axScreenReader
//   const screenReaderEnv = await $.env.get('CLAUDE_AX_SCREEN_READER')
//
// Each read may fail; pass `undefined` for one that did. A missing or
// wrongly-typed value counts as unreachable, and the profile's documented
// default applies. The `--ax-screen-reader` flag is invisible to a mod, so the
// profile keeps its plain-text-safe default for that reason.

import { resolveProfile } from '../kit/index.mjs';

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
 * Resolve the kit profile from the host reads a mod made.
 *
 * @param {{ configRows?: unknown, settings?: unknown, screenReaderEnv?: unknown }} [reads]
 *   the results of `$.config.list()`, `$.settings.read()` and
 *   `$.env.get('CLAUDE_AX_SCREEN_READER')`, or `undefined` for a read that failed
 * @param {{ screenReaderOff?: boolean }} [options] `screenReaderOff`: the
 *   person's own declared "no screen reader" preference, for example a mod option
 * @returns {ReturnType<typeof resolveProfile>}
 */
export function profileFromHost(reads = {}, options = {}) {
  const { configRows, settings, screenReaderEnv } = reads ?? {};
  return resolveProfile({
    theme: asString(rowValue(configRows, 'theme')),
    reduceMotion: asBoolean(rowValue(configRows, 'reduceMotion')),
    prefersReducedMotion: asBoolean(ownValue(settings, 'prefersReducedMotion')),
    axScreenReader: asBoolean(ownValue(settings, 'axScreenReader')),
    axScreenReaderEnv: asString(screenReaderEnv),
    screenReaderOff: options?.screenReaderOff === true,
  });
}
