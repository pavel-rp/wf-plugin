// The adapters' public surface. A mod copies `kit/` and `adapters/` side by
// side and imports from here.

export { VIEW_KINDS, viewLines, viewText } from './segments.mjs';
export { readHostProfile } from './host.mjs';
export { hostKeyFor } from './draw.mjs';
export { drawTerminal } from './terminal.mjs';
export { DISPLAY_ONLY_NOTICE, drawDesktop } from './desktop.mjs';
export { drawView, shouldMount, openPane } from './mount.mjs';
