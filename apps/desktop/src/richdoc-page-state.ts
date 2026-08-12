import type { RichDocRevisionPageState } from './richdoc-editing.js';
import { MARGINS, PAPERS } from './RichDocMenus.js';

export interface RichDocPageState extends RichDocRevisionPageState {
  size?: string;
  writing?: 'v';
  hyphens?: boolean;
  lineNums?: boolean;
  grid?: boolean;
  ruler?: boolean;
  nav?: boolean;
  zoom?: number;
  view?: 'read' | 'web' | 'outline';
  spell?: boolean;
  hideComments?: boolean;
  track?: boolean;
  lang?: 'zh-CN' | 'en-US' | 'ja-JP';
}

const BOOLEAN_KEYS = [
  'hyphens',
  'lineNums',
  'grid',
  'ruler',
  'nav',
  'spell',
  'hideComments',
  'track',
] as const;
const MARGIN_NAMES = new Set(MARGINS.map(([name]) => name));
const PAPER_NAMES = new Set(Object.keys(PAPERS));
const VIEWS = new Set<RichDocPageState['view']>(['read', 'web', 'outline']);
const LANGUAGES = new Set<RichDocPageState['lang']>(['zh-CN', 'en-US', 'ja-JP']);

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

export function normalizeRichDocPageState(value: unknown): RichDocPageState {
  if (!isRecord(value)) return {};
  const page: RichDocPageState = {};
  if (typeof value.size === 'string' && PAPER_NAMES.has(value.size)) page.size = value.size;
  if (value.writing === 'v') page.writing = 'v';
  if (typeof value.margin === 'string' && MARGIN_NAMES.has(value.margin)) page.margin = value.margin;
  if (value.orient === 'portrait' || value.orient === 'landscape') page.orient = value.orient;
  if (typeof value.columns === 'number' && Number.isInteger(value.columns) && value.columns >= 1 && value.columns <= 3) page.columns = value.columns;
  if (typeof value.zoom === 'number' && Number.isFinite(value.zoom) && value.zoom >= 0.2 && value.zoom <= 4) page.zoom = value.zoom;
  if (typeof value.view === 'string' && VIEWS.has(value.view as RichDocPageState['view'])) page.view = value.view as RichDocPageState['view'];
  if (typeof value.lang === 'string' && LANGUAGES.has(value.lang as RichDocPageState['lang'])) page.lang = value.lang as RichDocPageState['lang'];
  for (const key of BOOLEAN_KEYS) {
    if (typeof value[key] === 'boolean') page[key] = value[key];
  }
  return page;
}

export function parseRichDocPageState(serialized: string | null): RichDocPageState {
  if (!serialized) return {};
  try { return normalizeRichDocPageState(JSON.parse(serialized) as unknown); }
  catch { return {}; }
}

export function applyRichDocPageState(element: HTMLElement, page: RichDocPageState): void {
  if (page.size || page.orient) {
    const dimensions = PAPERS[page.size ?? 'A4'] ?? PAPERS.A4!;
    const landscape = page.orient === 'landscape';
    element.style.width = `${landscape ? dimensions[1] : dimensions[0]}px`;
    element.style.minHeight = `${landscape ? dimensions[0] : dimensions[1]}px`;
  } else {
    element.style.width = '';
    element.style.minHeight = '';
  }
  element.style.padding = page.margin ? (MARGINS.find(([name]) => name === page.margin)?.[1] ?? '') : '';
  element.style.columnCount = page.columns && page.columns > 1 ? String(page.columns) : '';
  element.style.columnGap = page.columns && page.columns > 1 ? '2.4em' : '';
  element.style.writingMode = page.writing === 'v' ? 'vertical-rl' : '';
  element.style.hyphens = page.hyphens ? 'auto' : '';
  const language = page.lang ?? (page.hyphens ? 'en' : '');
  if (language) element.setAttribute('lang', language);
  else element.removeAttribute('lang');
  element.spellcheck = !!page.spell;
  element.classList.toggle('rd-grid', !!page.grid);
  element.classList.toggle('rd-linenumbers', !!page.lineNums);
  element.classList.toggle('rd-hide-comments', !!page.hideComments);
  element.classList.toggle('rd-track', !!page.track);
  const zoom = page.zoom && page.zoom > 0 ? page.zoom : 1;
  element.style.zoom = zoom !== 1 ? String(zoom) : '';
}
