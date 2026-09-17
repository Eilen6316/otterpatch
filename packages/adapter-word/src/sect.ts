/**
 * Surgical sectPr patch — writes page-level layout (columns/margins/orientation) into the
 * section properties at the end of word/document.xml. Only touches the last body-level
 * <w:sectPr> (the document-wide layout): existing tags are replaced in place, missing ones
 * are inserted in OOXML element order (pgSz → pgMar → cols); the rest of the document is
 * untouched — same safety moat as the word-level redline.
 */

export interface PagePatch {
  /** Column count (2 = two columns, IEEE/paper layout; 1 = restore single column). */
  columns?: number;
  /** Margin preset. */
  margin?: 'narrow' | 'normal' | 'moderate' | 'wide';
  /** Page orientation. */
  orient?: 'portrait' | 'landscape';
}

/** Margin presets → twips (1cm ≈ 567). Matches Word's built-in presets. */
const MARGINS: Record<string, { top: number; right: number; bottom: number; left: number }> = {
  normal: { top: 1440, right: 1800, bottom: 1440, left: 1800 }, // 2.54 / 3.18 cm (Word default)
  narrow: { top: 720, right: 720, bottom: 720, left: 720 }, // 1.27 cm
  moderate: { top: 1440, right: 1080, bottom: 1440, left: 1080 }, // 2.54 / 1.91 cm
  wide: { top: 1440, right: 2880, bottom: 1440, left: 2880 }, // 2.54 / 5.08 cm
};

/** The twip values a margin preset writes, for post-write-back verification. */
export function marginPreset(name: 'narrow' | 'normal' | 'moderate' | 'wide'): { top: number; right: number; bottom: number; left: number } {
  const preset = MARGINS[name];
  if (!preset) throw new Error(`unknown margin preset: ${name}`);
  return preset;
}

const setAttr = (tag: string, name: string, value: string): string => {
  const re = new RegExp(`${name}="[^"]*"`);
  if (re.test(tag)) return tag.replace(re, `${name}="${value}"`);
  return tag.replace(/\/>$|>$/, (m) => ` ${name}="${value}"${m}`);
};

/** Apply a page-level patch to document.xml; returns the new xml and whether it changed. */
export function patchSectPr(xml: string, patch: PagePatch): { xml: string; changed: boolean } {
  if (patch.columns == null && !patch.margin && !patch.orient) return { xml, changed: false };
  // Body-level sectPr = the last one before </w:body>; create a minimal one if absent
  const bodyEnd = xml.lastIndexOf('</w:body>');
  if (bodyEnd < 0) return { xml, changed: false };
  const sectRe = /<w:sectPr\b[^>]*>[\s\S]*?<\/w:sectPr>|<w:sectPr\b[^>]*\/>/g;
  let last: { start: number; end: number; text: string } | null = null;
  let m: RegExpExecArray | null;
  while ((m = sectRe.exec(xml))) { if (m.index < bodyEnd) last = { start: m.index, end: m.index + m[0].length, text: m[0] }; }

  let sect = last ? (last.text.endsWith('/>') ? last.text.replace(/\/>$/, '></w:sectPr>').replace('></w:sectPr>', '></w:sectPr>') : last.text) : '<w:sectPr></w:sectPr>';
  if (sect.endsWith('/>')) sect = sect.slice(0, -2) + '></w:sectPr>';

  const inner = (): string => /<w:sectPr\b[^>]*>([\s\S]*)<\/w:sectPr>/.exec(sect)?.[1] ?? '';
  const replaceTag = (tag: string, next: string | null, insertAfter: string[]): void => {
    const re = new RegExp(`<w:${tag}\\b[^>]*/?>(?:[\\s\\S]*?</w:${tag}>)?`);
    const body = inner();
    if (re.test(body)) {
      sect = sect.replace(body, next == null ? body.replace(re, '') : body.replace(re, next));
      return;
    }
    if (next == null) return;
    // Insert in element order: right after the last existing tag in insertAfter; if none exist, put it first
    for (const after of insertAfter) {
      const ar = new RegExp(`<w:${after}\\b[^>]*/?>(?:[\\s\\S]*?</w:${after}>)?`);
      const am = ar.exec(inner());
      if (am) { sect = sect.replace(am[0], am[0] + next); return; }
    }
    sect = sect.replace(/<w:sectPr\b[^>]*>/, (s) => s + next);
  };

  // Orientation: set pgSz orient and keep width/height consistent with it (landscape means w > h)
  if (patch.orient) {
    const body = inner();
    const pg = /<w:pgSz\b[^>]*\/?>/.exec(body)?.[0] ?? '<w:pgSz w:w="11906" w:h="16838"/>'; // A4 portrait default
    const w = parseInt(/w:w="(\d+)"/.exec(pg)?.[1] ?? '11906', 10);
    const h = parseInt(/w:h="(\d+)"/.exec(pg)?.[1] ?? '16838', 10);
    const landscape = patch.orient === 'landscape';
    const [nw, nh] = landscape === w > h ? [w, h] : [h, w]; // Swap width/height if they don't match the target orientation
    let next = setAttr(setAttr(pg, 'w:w', String(nw)), 'w:h', String(nh));
    next = landscape ? setAttr(next, 'w:orient', 'landscape') : next.replace(/\s*w:orient="[^"]*"/, '');
    replaceTag('pgSz', next, []);
  }
  // Margins: replace the whole group (preserving existing header/footer/gutter)
  if (patch.margin && MARGINS[patch.margin]) {
    const mg = MARGINS[patch.margin]!;
    const body = inner();
    const old = /<w:pgMar\b[^>]*\/?>/.exec(body)?.[0] ?? '<w:pgMar w:header="851" w:footer="992" w:gutter="0"/>';
    let next = old;
    next = setAttr(next, 'w:top', String(mg.top));
    next = setAttr(next, 'w:right', String(mg.right));
    next = setAttr(next, 'w:bottom', String(mg.bottom));
    next = setAttr(next, 'w:left', String(mg.left));
    replaceTag('pgMar', next, ['pgSz']);
  }
  // Columns: cols (equal width, 425 twips ≈ 0.75cm gap); 1 column = remove num (Word's single-column default)
  if (patch.columns != null) {
    const n = Math.max(1, Math.min(3, Math.floor(patch.columns)));
    const next = n <= 1 ? '<w:cols w:space="425"/>' : `<w:cols w:num="${n}" w:space="425" w:equalWidth="1"/>`;
    replaceTag('cols', next, ['pgMar', 'pgSz']);
  }

  let out: string;
  if (last) out = xml.slice(0, last.start) + sect + xml.slice(last.end);
  else out = xml.slice(0, bodyEnd) + sect + xml.slice(bodyEnd);
  return { xml: out, changed: out !== xml };
}
