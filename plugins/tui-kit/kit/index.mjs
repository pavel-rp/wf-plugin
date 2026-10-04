// The kit's public surface. Later modules add files beside these and append
// their exports below; nothing here is rewritten to make room for them.

export {
  HOST_THEME_KEYS,
  isHostThemeKey,
  REFERENCE_BACKGROUNDS,
  MIN_REMAP_CONTRAST,
  BASE_TOKENS,
  DALTONIZED_OVERRIDES,
  DEFAULT_TIERS,
  createTokens,
  contrastRatio,
  colorFor,
} from './tokens.mjs';
export { resolveColorMode } from './color-mode.mjs';
export { HOST_THEMES, PROFILE_DEFAULTS, resolveProfile } from './profile.mjs';
export { sanitizeText, escapeMarkdown } from './sanitize.mjs';
export { STATUSES, defineBadge, renderBadge } from './badge.mjs';
