# tui-kit

A terminal UI kit for Claude Code mods. It does not depend on the host's mod runtime. Its core does four things:

- resolves semantic colour tokens;
- builds an accessibility profile;
- makes untrusted text inert;
- renders a status badge as plain text, ANSI or markdown.

All of it is plain functions, with no mod loaded.

The pack ships **no hooks, skills or agents**. Installing it from the marketplace changes nothing. The kit only acts once a mod copies it in.

## Trust cost — read before adopting

A mod is **unsandboxed code that runs with your full user permissions**. Copying this kit into a mod adds its code to that mod, so whoever installs your mod is trusting this code as well as yours. Read the files before you vendor them. They are short, dependency-free and import nothing outside the kit folder.

The kit ships **no permission-deciding or rewriting handler**. It never allows, denies or rewrites a tool call, a prompt or any other host event. It only turns values you pass in into strings you choose to show. If your mod needs a handler like that, it is your own code and carries your own trust cost.

## How to adopt it (copy-in)

On this host, a mod's hooks module may import only its own files, by relative path, plus `claude-code`. A shared plugin's files, or a package referenced by a bare name, are refused. So the kit is a **template you copy**, not a dependency you install:

1. Copy `kit/` into your mod, for example as `lib/kit/`.
2. Import it by relative path: `import { defineBadge, renderBadge } from '../lib/kit/index.mjs'`.
3. Re-copy it when you want a newer version. Nothing updates on its own.

Every kit file is an ES module (`.mjs`) with no `require`, no dynamic `import()`, and no Node, DOM or host API. Your adapter reads the host and passes plain values in.

## What is in `kit/`

| File | Exports | Purpose |
|---|---|---|
| `tokens.mjs` | `HOST_THEME_KEYS`, `isHostThemeKey`, `BASE_TOKENS`, `DALTONIZED_OVERRIDES`, `DEFAULT_TIERS`, `createTokens`, `contrastRatio`, `colorFor`, `REFERENCE_BACKGROUNDS`, `MIN_REMAP_CONTRAST` | Semantic colour tokens |
| `color-mode.mjs` | `resolveColorMode` | How much colour text output may carry |
| `profile.mjs` | `HOST_THEMES`, `PROFILE_DEFAULTS`, `resolveProfile` | Accessibility profile from plain host values |
| `sanitize.mjs` | `sanitizeText`, `escapeMarkdown` | Make untrusted text inert |
| `badge.mjs` | `STATUSES`, `defineBadge`, `renderBadge` | The status badge |
| `index.mjs` | everything above | The public surface |

Later kit modules (composites, adapters) are added as new files beside these, and their exports are appended to `index.mjs`.

## Tokens: inherit before inventing

Each token maps to one of the host's **theme-key names**. When a mod draws with a host element, it should hand `token.hostKey` to that element's colour. The host then resolves the key for the person's theme, which includes the daltonized and 16-colour ANSI themes. Passing raw colours would bypass those remaps.

| Token | Host key |
|---|---|
| `text` | `text` |
| `muted` | `subtle` |
| `inactive` | `inactive` |
| `success` | `success` |
| `warning` | `warning` |
| `error` | `error` |
| `info` | `suggestion` |
| `accent` | `claude` |
| `permission` | `permission` |
| `tier.1` … `tier.5` | by default `success`, `suggestion`, `warning`, `claude`, `error` |

The host's validator checks only the *shape* of a colour string, so it will not catch a misspelt key. The kit therefore keeps its own closed list, `HOST_THEME_KEYS`, and checks every token against it.

Each token also carries the colours the kit itself uses for output that leaves the host, such as ANSI text and logs:

- **Adaptive:** separate `dark` and `light` values.
- **Complete:** each value comes as `hex`, `ansi256` and `ansi16`.
- **Shades:** derived `subtle` and `strong` shades.

Daltonized themes turn `success` from green to blue, and the kit's own fallback colours follow the same remap.

### Remapping tier colours

```js
const tokens = createTokens({ tiers: { 3: 'claude', 5: '#2f8fdf', 4: { dark: '#ffd75f', light: '#8a6d00' } } });
```

A tier can be remapped three ways:

- **A host key.** It inherits the host theme, and the key must be in `HOST_THEME_KEYS`. Otherwise a `TypeError` is thrown.
- **A hex colour.** The same value is used for both appearances.
- **A `{ dark, light }` pair.**

A raw colour must reach **at least 3:1 contrast** (WCAG non-text) against the reference background: `#000000` for dark and `#ffffff` for light. If it does not, a `RangeError` is thrown. A remap never changes a badge's glyph or label.

## Colour mode: `NO_COLOR` and `FORCE_COLOR`

`resolveColorMode({ env, isTTY })` returns `none`, `ansi16`, `ansi256` or `truecolor`. The first matching rule wins:

1. `NO_COLOR` is set and not empty → `none`. It also wins over `FORCE_COLOR`.
2. `FORCE_COLOR` is set → colour is on, even when output is not a TTY. The values map like this:
   - `0` or `false` → off;
   - `2` → 256 colours;
   - `3` → truecolour;
   - anything else → at least 16 colours.
3. Output is not a TTY → `none`.
4. `TERM=dumb` → `none`.
5. `COLORTERM=truecolor` or `24bit` → `truecolor`.
6. `TERM` contains `256color` → `ansi256`.
7. Otherwise → `ansi16`.

## Accessibility profile

Your adapter reads the host values and passes them to `resolveProfile`:

| Input | Where an adapter gets it |
|---|---|
| `theme` | the effective `theme` row of the host's config list |
| `reduceMotion` | the effective `reduceMotion` row of the host's config list |
| `prefersReducedMotion` | settings: a fallback, used only when the config row is unavailable |
| `axScreenReader` | settings |
| `axScreenReaderEnv` | the `CLAUDE_AX_SCREEN_READER` environment value |
| `screenReaderOff` | the person's own declared preference, for example a mod option |

The result reports `theme`, `appearance`, `daltonized`, `ansiTheme`, `reducedMotion`, `screenReader` and `preferPlainText`. It also carries a `sources` record that says where each value came from (`host`, `host-config`, `host-settings`, `host-env`, `declared` or `default`).

**Documented defaults.** When a value cannot be reached, the profile falls back as follows, and none of the defaults contradicts the host:

- **Theme:** `auto`. ANSI output then uses only the terminal's own 16 named colours, never an RGB value.
- **Reduced motion:** on. Showing no motion is never wrong.
- **Screen reader:** `unknown`, with plain text preferred. A screen reader switched on by command-line flag is invisible to a mod, so the kit never assumes it is off unless the person says so.

## Status badge

```js
const badge = defineBadge({ status: 'error' });
renderBadge(badge);                                  // '✗ Error'
renderBadge(badge, { format: 'markdown' });          // '✗ **Error**'
renderBadge(badge, { format: 'ansi', colorMode, profile, tokens });
```

Presets:

| Status | Glyph | Label |
|---|---|---|
| `ok` | ✓ | OK |
| `warn` | ! | Warning |
| `error` | ✗ | Error |
| `info` | i | Info |
| `pending` | ○ | Pending |
| `tier1` | ▁ | Tier 1 |
| `tier2` | ▃ | Tier 2 |
| `tier3` | ▅ | Tier 3 |
| `tier4` | ▇ | Tier 4 |
| `tier5` | █ | Tier 5 |

Every glyph is unique, so colour is never the only thing that carries meaning. Plain text and markdown show every fact the coloured rendering shows. `plain` is the default format, which is the plain-text-safe choice.

## Untrusted content is made inert

Badge content can come from anywhere: tool output, file names, branch names. The kit strips control sequences from every glyph and label, both when a badge is defined and again when it is rendered:

- ESC and C1 escape sequences: CSI, OSC (titles and hyperlinks), DCS, SOS, PM and APC;
- other C0 and C1 controls and DEL;
- bidi override and isolate characters.

Newlines and tabs become single spaces. Markdown output also escapes markdown metacharacters and `& < > "`. A stray sequence can never move the cursor, change the terminal title, open a link or reorder text.

## Tests

```sh
bash plugins/tui-kit/tests/run.sh
```

The suite runs on plain Node (`node:test`), with no mod and no host runtime, and CI runs it on every pull request. It covers:

- tokens and remaps;
- the colour-mode rules;
- profile reachability and defaults;
- the three badge renderings;
- sanitising;
- a boundary check that the kit imports only its own files and touches no host or runtime global.
