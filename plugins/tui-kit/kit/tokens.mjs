// Semantic colour tokens mapped onto the host's theme-key names.
//
// Host-free: this module imports nothing and touches no global. A mod hands
// `token.hostKey` to its host element's colour prop so the host resolves it per
// theme (dark, light, daltonized, ansi). The complete colour values below are
// only fallbacks for output that leaves the host (plain ANSI, markdown).

/**
 * Closed list of host theme-key names the kit may emit. The host's validator
 * only shape-checks colour strings, so the kit keeps this list itself and every
 * token's host key is checked against it.
 * @type {readonly string[]}
 */
export const HOST_THEME_KEYS = Object.freeze([
  'text',
  'inverseText',
  'inactive',
  'subtle',
  'success',
  'error',
  'warning',
  'permission',
  'suggestion',
  'remember',
  'merged',
  'claude',
  'background',
  'promptBorder',
  'planMode',
  'autoAccept',
  'diffAdded',
  'diffRemoved',
  'diffAddedDimmed',
  'diffRemovedDimmed',
  'diffAddedWord',
  'diffRemovedWord',
  'professionalBlue',
  'rainbow_red',
  'rainbow_orange',
  'rainbow_yellow',
  'rainbow_green',
  'rainbow_blue',
  'rainbow_indigo',
  'rainbow_violet',
]);

const HOST_KEY_SET = new Set(HOST_THEME_KEYS);

/**
 * @param {unknown} name
 * @returns {boolean} true when `name` is one of HOST_THEME_KEYS
 */
export function isHostThemeKey(name) {
  return typeof name === 'string' && HOST_KEY_SET.has(name);
}

/** Reference backgrounds used for the remap contrast check. */
export const REFERENCE_BACKGROUNDS = Object.freeze({ dark: '#000000', light: '#ffffff' });

/** Minimum contrast a raw-colour tier remap must reach against its background. */
export const MIN_REMAP_CONTRAST = 3;

// ANSI 16-colour foreground codes, by name.
const ANSI16 = Object.freeze({
  black: 30, red: 31, green: 32, yellow: 33, blue: 34, magenta: 35, cyan: 36, white: 37,
  gray: 90, brightRed: 91, brightGreen: 92, brightYellow: 93, brightBlue: 94,
  brightMagenta: 95, brightCyan: 96, brightWhite: 97,
});

// Standard xterm values for the 16 ANSI colours, used to map a hex to its nearest.
const ANSI16_RGB = [
  [30, [0, 0, 0]], [31, [205, 0, 0]], [32, [0, 205, 0]], [33, [205, 205, 0]],
  [34, [0, 0, 238]], [35, [205, 0, 205]], [36, [0, 205, 205]], [37, [229, 229, 229]],
  [90, [127, 127, 127]], [91, [255, 0, 0]], [92, [0, 255, 0]], [93, [255, 255, 0]],
  [94, [92, 92, 255]], [95, [255, 0, 255]], [96, [0, 255, 255]], [97, [255, 255, 255]],
];

/**
 * @param {string} hex `#rgb` or `#rrggbb`
 * @returns {[number, number, number]}
 */
function parseHex(hex) {
  if (typeof hex !== 'string') throw new TypeError('colour must be a hex string');
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new TypeError(`not a hex colour: ${JSON.stringify(hex)}`);
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

/** @param {[number, number, number]} rgb */
function toHex(rgb) {
  return '#' + rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
}

/** @param {[number, number, number]} rgb */
function luminance(rgb) {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * WCAG 2.x contrast ratio between two hex colours (1 to 21).
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function contrastRatio(a, b) {
  const la = luminance(parseHex(a));
  const lb = luminance(parseHex(b));
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** @param {[number, number, number]} rgb */
function nearestAnsi16(rgb) {
  let best = 37;
  let bestD = Infinity;
  for (const [code, ref] of ANSI16_RGB) {
    const d = (ref[0] - rgb[0]) ** 2 + (ref[1] - rgb[1]) ** 2 + (ref[2] - rgb[2]) ** 2;
    if (d < bestD) { bestD = d; best = code; }
  }
  return best;
}

/** @param {[number, number, number]} rgb */
function nearestAnsi256(rgb) {
  const steps = [0, 95, 135, 175, 215, 255];
  const idx = (v) => {
    let bi = 0;
    for (let i = 1; i < steps.length; i++) if (Math.abs(steps[i] - v) < Math.abs(steps[bi] - v)) bi = i;
    return bi;
  };
  const [ri, gi, bi] = rgb.map(idx);
  return 16 + 36 * ri + 6 * gi + bi;
}

/**
 * Build a complete colour (hex, ansi256, ansi16) from a hex value.
 * @param {string} hex
 */
function complete(hex) {
  const rgb = parseHex(hex);
  return Object.freeze({ hex: toHex(rgb), ansi256: nearestAnsi256(rgb), ansi16: nearestAnsi16(rgb) });
}

/** @param {string} hex @param {string} toward @param {number} t */
function mix(hex, toward, t) {
  const a = parseHex(hex);
  const b = parseHex(toward);
  return toHex([0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * t));
}

const BRIGHTER = Object.freeze({ 30: 90, 31: 91, 32: 92, 33: 93, 34: 94, 35: 95, 36: 96, 37: 97 });
const DIMMER = Object.freeze({ 90: 30, 91: 31, 92: 32, 93: 33, 94: 34, 95: 35, 96: 36, 97: 37 });

/**
 * Derive `subtle` and `strong` shades for one appearance.
 * @param {{hex: string, ansi16: number}} base
 * @param {'dark' | 'light'} appearance
 */
function shades(base, appearance) {
  const bg = REFERENCE_BACKGROUNDS[appearance];
  const fg = appearance === 'dark' ? '#ffffff' : '#000000';
  const subtle = complete(mix(base.hex, bg, 0.4));
  const strong = complete(mix(base.hex, fg, 0.25));
  return Object.freeze({
    subtle: Object.freeze({ ...subtle, ansi16: base.ansi16 === 90 ? 90 : (DIMMER[base.ansi16] ?? base.ansi16) }),
    strong: Object.freeze({ ...strong, ansi16: BRIGHTER[base.ansi16] ?? base.ansi16 }),
  });
}

/**
 * One adaptive + complete token definition.
 * @param {string} name
 * @param {string} hostKey
 * @param {string} darkHex
 * @param {string} lightHex
 * @param {number} ansi16 the 16-colour code used when the appearance is unknown
 */
function defineToken(name, hostKey, darkHex, lightHex, ansi16) {
  if (!isHostThemeKey(hostKey)) throw new TypeError(`unknown host theme key: ${hostKey}`);
  const dark = Object.freeze({ ...complete(darkHex), ansi16 });
  const light = Object.freeze({ ...complete(lightHex), ansi16 });
  return Object.freeze({
    name,
    hostKey,
    dark,
    light,
    shades: Object.freeze({ dark: shades(dark, 'dark'), light: shades(light, 'light') }),
  });
}

/**
 * The semantic base tokens. Every one maps to a host theme key, so a mod's
 * styled rendering inherits the host's theme, including its daltonized and
 * ANSI variants.
 */
export const BASE_TOKENS = Object.freeze({
  text: defineToken('text', 'text', '#e6e6e6', '#1f1f1f', ANSI16.white),
  muted: defineToken('muted', 'subtle', '#9a9a9a', '#5f5f5f', ANSI16.gray),
  inactive: defineToken('inactive', 'inactive', '#8a8a8a', '#6b6b6b', ANSI16.gray),
  success: defineToken('success', 'success', '#4eba65', '#2c7a39', ANSI16.green),
  warning: defineToken('warning', 'warning', '#ffc107', '#966c1e', ANSI16.yellow),
  error: defineToken('error', 'error', '#ff6b80', '#ab2b3f', ANSI16.red),
  info: defineToken('info', 'suggestion', '#b1b9f9', '#5769f7', ANSI16.blue),
  accent: defineToken('accent', 'claude', '#d77757', '#d77757', ANSI16.magenta),
  permission: defineToken('permission', 'permission', '#b1b9f9', '#5769f7', ANSI16.cyan),
});

/**
 * Daltonized themes remap success from green to blue; the kit's own fallback
 * colours follow the same remap so text output never contradicts the host.
 */
export const DALTONIZED_OVERRIDES = Object.freeze({
  success: defineToken('success', 'success', '#3399ff', '#0066cc', ANSI16.blue),
});

/** Default tier ramp: tier 1 (lowest) to tier 5 (highest). Values are base token names. */
export const DEFAULT_TIERS = Object.freeze({
  1: 'success',
  2: 'info',
  3: 'warning',
  4: 'accent',
  5: 'error',
});

const TIER_NUMBERS = Object.freeze([1, 2, 3, 4, 5]);

/**
 * Build one tier token from a remap value.
 * @param {number} n
 * @param {string | {dark: string, light: string}} value a host key, a hex, or a per-appearance hex pair
 */
function tierFromRemap(n, value) {
  const name = `tier.${n}`;
  if (typeof value === 'string' && !value.startsWith('#')) {
    if (!isHostThemeKey(value)) throw new TypeError(`tier ${n}: unknown host theme key ${JSON.stringify(value)}`);
    const base = Object.values(BASE_TOKENS).find((t) => t.hostKey === value);
    if (base) return Object.freeze({ ...base, name, from: base.name });
    // A host key with no kit fallback colour: host-side rendering uses the key,
    // text output falls back to the default text colour.
    return Object.freeze({ ...BASE_TOKENS.text, name, hostKey: value });
  }
  const pair = typeof value === 'string' ? { dark: value, light: value } : value;
  if (!pair || typeof pair !== 'object' || typeof pair.dark !== 'string' || typeof pair.light !== 'string') {
    throw new TypeError(`tier ${n}: remap must be a host theme key, a hex colour, or {dark, light} hex colours`);
  }
  for (const appearance of /** @type {const} */ (['dark', 'light'])) {
    const ratio = contrastRatio(pair[appearance], REFERENCE_BACKGROUNDS[appearance]);
    if (ratio < MIN_REMAP_CONTRAST) {
      throw new RangeError(
        `tier ${n}: ${pair[appearance]} reaches ${ratio.toFixed(2)}:1 against the ${appearance} background; at least ${MIN_REMAP_CONTRAST}:1 is required`,
      );
    }
  }
  // Raw colours have no host key of their own; the nearest-meaning base key
  // keeps host-side rendering valid while text output uses the remapped value.
  const fallbackKey = BASE_TOKENS[DEFAULT_TIERS[n]].hostKey;
  const dark = complete(pair.dark);
  const light = complete(pair.light);
  return Object.freeze({
    name,
    hostKey: fallbackKey,
    dark,
    light,
    shades: Object.freeze({ dark: shades(dark, 'dark'), light: shades(light, 'light') }),
  });
}

/**
 * Build a token set. With no options it is the base tokens plus the default
 * tier ramp. `tiers` remaps any of tier 1 to 5 to a host theme key, a hex
 * colour (used for both appearances), or `{ dark, light }` hex colours.
 *
 * @param {{ tiers?: Record<number | string, string | {dark: string, light: string}> }} [options]
 * @returns {Readonly<Record<string, any>>} frozen map from token name to token
 */
export function createTokens(options = {}) {
  const remaps = options.tiers ?? {};
  for (const key of Object.keys(remaps)) {
    if (!TIER_NUMBERS.includes(Number(key))) throw new RangeError(`unknown tier ${JSON.stringify(key)}; tiers are 1 to 5`);
  }
  /** @type {Record<string, any>} */
  const out = { ...BASE_TOKENS };
  for (const n of TIER_NUMBERS) {
    const remap = remaps[n] ?? remaps[String(n)];
    out[`tier.${n}`] = remap === undefined
      ? Object.freeze({ ...BASE_TOKENS[DEFAULT_TIERS[n]], name: `tier.${n}`, from: DEFAULT_TIERS[n] })
      : tierFromRemap(n, remap);
  }
  return Object.freeze(out);
}

/**
 * Pick the concrete colour for a token.
 *
 * @param {{dark: any, light: any, shades: any, name: string}} token
 * @param {{ appearance?: 'dark' | 'light' | 'auto', depth?: 'ansi16' | 'ansi256' | 'truecolor', daltonized?: boolean, shade?: 'base' | 'subtle' | 'strong' }} [options]
 * @returns {{ ansi16: number } | { ansi256: number } | { hex: string }}
 *   With appearance `auto` (unknown) only an ANSI 16 code is returned, so the
 *   terminal's own palette decides the shade and nothing contradicts the host.
 */
export function colorFor(token, options = {}) {
  const { appearance = 'auto', depth = 'ansi16', daltonized = false, shade = 'base' } = options;
  let t = token;
  if (daltonized && (token.name === 'success' || token.from === 'success')) {
    t = { ...DALTONIZED_OVERRIDES.success, name: token.name };
  }
  if (appearance === 'auto') {
    const code = shade === 'base' ? t.dark.ansi16 : t.shades.dark[shade].ansi16;
    return { ansi16: code };
  }
  const c = shade === 'base' ? t[appearance] : t.shades[appearance][shade];
  if (depth === 'truecolor') return { hex: c.hex };
  if (depth === 'ansi256') return { ansi256: c.ansi256 };
  return { ansi16: c.ansi16 };
}
