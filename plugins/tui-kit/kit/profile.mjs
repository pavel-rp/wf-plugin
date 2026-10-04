// Accessibility profile built from plain host values.
//
// Host-free: an adapter reads the host (its config rows, settings and
// environment) and passes plain values in. Every field the adapter could not
// reach falls back to a documented default, and `sources` says which applied.

/** Theme names the host offers. Any other value is treated as unreachable. */
export const HOST_THEMES = Object.freeze([
  'auto',
  'dark',
  'light',
  'dark-daltonized',
  'light-daltonized',
  'dark-ansi',
  'light-ansi',
]);

/**
 * The documented defaults used when a host value cannot be reached. None of
 * them contradicts the host: an unknown theme renders through the terminal's
 * own 16-colour palette, reduced motion is assumed on (no motion is never
 * wrong), and an unseen screen reader keeps output plain-text-safe, because a
 * screen reader enabled by command-line flag is invisible to a mod.
 */
export const PROFILE_DEFAULTS = Object.freeze({
  theme: 'auto',
  reducedMotion: true,
  screenReader: 'unknown',
});

/**
 * @typedef {object} ProfileInputs
 * @property {string} [theme] effective theme from the host's config rows
 * @property {boolean} [reduceMotion] effective reduced-motion value from the host's config rows
 * @property {boolean} [prefersReducedMotion] reduced-motion value from settings (fallback)
 * @property {boolean} [axScreenReader] screen-reader value from settings
 * @property {string} [axScreenReaderEnv] value of the screen-reader environment variable, if set
 * @property {boolean} [screenReaderOff] the person's own declared "no screen reader" preference
 */

/**
 * Resolve the accessibility profile.
 *
 * @param {ProfileInputs} [inputs]
 * @returns {Readonly<{
 *   theme: string,
 *   appearance: 'dark' | 'light' | 'auto',
 *   daltonized: boolean,
 *   ansiTheme: boolean,
 *   reducedMotion: boolean,
 *   screenReader: 'on' | 'off' | 'unknown',
 *   preferPlainText: boolean,
 *   sources: Readonly<{ theme: string, reducedMotion: string, screenReader: string }>,
 * }>}
 */
export function resolveProfile(inputs = {}) {
  const themeReachable = typeof inputs.theme === 'string' && HOST_THEMES.includes(inputs.theme);
  const theme = themeReachable ? inputs.theme : PROFILE_DEFAULTS.theme;
  const appearance = theme.startsWith('dark') ? 'dark' : theme.startsWith('light') ? 'light' : 'auto';

  let reducedMotion = PROFILE_DEFAULTS.reducedMotion;
  let reducedMotionSource = 'default';
  if (typeof inputs.reduceMotion === 'boolean') {
    reducedMotion = inputs.reduceMotion;
    reducedMotionSource = 'host-config';
  } else if (typeof inputs.prefersReducedMotion === 'boolean') {
    reducedMotion = inputs.prefersReducedMotion;
    reducedMotionSource = 'host-settings';
  }

  /** @type {'on' | 'off' | 'unknown'} */
  let screenReader = 'unknown';
  let screenReaderSource = 'default';
  const envValue = typeof inputs.axScreenReaderEnv === 'string' ? inputs.axScreenReaderEnv.trim() : '';
  if (inputs.axScreenReader === true) {
    screenReader = 'on';
    screenReaderSource = 'host-settings';
  } else if (envValue !== '' && envValue !== '0' && envValue.toLowerCase() !== 'false') {
    screenReader = 'on';
    screenReaderSource = 'host-env';
  } else if (inputs.screenReaderOff === true) {
    screenReader = 'off';
    screenReaderSource = 'declared';
  }

  return Object.freeze({
    theme,
    appearance,
    daltonized: theme.endsWith('-daltonized'),
    ansiTheme: theme.endsWith('-ansi'),
    reducedMotion,
    screenReader,
    preferPlainText: screenReader !== 'off',
    sources: Object.freeze({
      theme: themeReachable ? 'host' : 'default',
      reducedMotion: reducedMotionSource,
      screenReader: screenReaderSource,
    }),
  });
}
