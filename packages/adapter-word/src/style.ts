/**
 * OOXML 格式属性构建 —— 把抽象格式(字符/段落)编译成 <w:rPr>/<w:pPr> 子元素,
 * 并以【可审阅的格式修订】落盘:<w:rPrChange>(字符)/<w:pPrChange>(段落)内嵌原始属性,
 * 让 Word 把"改字体/字号/加粗/对齐/行距/样式/底纹"显示成可逐条接受/拒绝的原生修订。
 * clean-room:仅用公开 OOXML 语义。
 */

/** 字符级格式(作用于选中文本的 run)。 */
export interface CharProps { bold?: boolean; italic?: boolean; underline?: boolean; font?: string; size?: number; color?: string }
/** 段落级格式(作用于整段 pPr)。 */
export interface ParaProps { align?: 'left' | 'center' | 'right' | 'justify'; lineSpacing?: number; block?: 'h1' | 'h2' | 'h3' | 'p' | 'blockquote'; bgColor?: string }

const escAttr = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const hex = (c: string): string => { let h = c.replace(/[^0-9a-fA-F]/g, '').toUpperCase(); if (h.length === 3) h = h.replace(/(.)/g, '$1$1'); return h.slice(0, 6).padStart(6, '0'); };

/** 新的 rPr 子元素 + 它们覆盖(需从原 rPr 移除)的标签名。 */
export function charElems(p: CharProps): { xml: string; overrides: string[] } {
  const out: string[] = [];
  const ov: string[] = [];
  if (p.bold != null) { out.push(p.bold ? '<w:b/>' : '<w:b w:val="0"/>'); ov.push('w:b'); }
  if (p.italic != null) { out.push(p.italic ? '<w:i/>' : '<w:i w:val="0"/>'); ov.push('w:i'); }
  if (p.underline != null) { out.push(`<w:u w:val="${p.underline ? 'single' : 'none'}"/>`); ov.push('w:u'); }
  if (p.font) { const f = escAttr(p.font); out.push(`<w:rFonts w:ascii="${f}" w:hAnsi="${f}" w:eastAsia="${f}" w:cs="${f}"/>`); ov.push('w:rFonts'); }
  if (p.size != null) { const s = Math.max(1, Math.round(p.size * 2)); out.push(`<w:sz w:val="${s}"/>`, `<w:szCs w:val="${s}"/>`); ov.push('w:sz', 'w:szCs'); }
  if (p.color) { out.push(`<w:color w:val="${hex(p.color)}"/>`); ov.push('w:color'); }
  return { xml: out.join(''), overrides: ov };
}

const STYLE_ID: Record<string, string> = { h1: 'Heading1', h2: 'Heading2', h3: 'Heading3', p: 'Normal', blockquote: 'Quote' };

/** 新的 pPr 子元素(pStyle 需排在最前)+ 覆盖的标签名。 */
export function paraElems(p: ParaProps): { xml: string; overrides: string[]; pStyle: string } {
  const out: string[] = [];
  const ov: string[] = [];
  let pStyle = '';
  if (p.block) { pStyle = `<w:pStyle w:val="${STYLE_ID[p.block] ?? 'Normal'}"/>`; ov.push('w:pStyle'); }
  if (p.align) { const v = p.align === 'justify' ? 'both' : p.align; out.push(`<w:jc w:val="${v}"/>`); ov.push('w:jc'); }
  if (p.lineSpacing != null) { out.push(`<w:spacing w:line="${Math.round(p.lineSpacing * 240)}" w:lineRule="auto"/>`); ov.push('w:spacing'); }
  if (p.bgColor) { out.push(`<w:shd w:val="clear" w:color="auto" w:fill="${hex(p.bgColor)}"/>`); ov.push('w:shd'); }
  return { xml: out.join(''), overrides: ov, pStyle };
}

const rxEl = (tag: string): RegExp => { const t = tag.replace(':', '\\:'); return new RegExp(`<${t}\\b[^>]*/>|<${t}\\b[^>]*>[\\s\\S]*?</${t}>`, 'g'); };
/** 从一段 inner-XML 里删除指定标签(被新属性覆盖的旧元素)。 */
function stripElems(inner: string, overrides: string[]): string {
  let s = inner;
  for (const tag of overrides) s = s.replace(rxEl(tag), '');
  return s;
}
/** 取 '<w:rPr ...>inner</w:rPr>' 或 '<w:rPr/>' 或 '' 的 inner。 */
function innerOf(el: string): string {
  const t = el.trim();
  if (!t || /^<w:[a-zA-Z]+\b[^>]*\/>$/.test(t)) return '';
  return /^<w:[a-zA-Z]+\b[^>]*>([\s\S]*)<\/w:[a-zA-Z]+>$/.exec(t)?.[1] ?? '';
}

/** 合并字符格式到 rPr:保留原有未被覆盖的属性 + 新属性,并把【原始 rPr】封进 rPrChange。 */
export function mergeRPr(origRPr: string, add: { xml: string; overrides: string[] }, id: number, author: string, date: string): string {
  const orig = origRPr || '<w:rPr/>';
  const cleaned = stripElems(innerOf(origRPr), add.overrides);
  const change = `<w:rPrChange w:id="${id}" w:author="${author}" w:date="${date}">${orig}</w:rPrChange>`;
  return `<w:rPr>${cleaned}${add.xml}${change}</w:rPr>`;
}

/** 合并段落格式到 pPr:pStyle 置前、保留其它、把【原始 pPr】封进 pPrChange(置于最后)。 */
export function mergePPr(origPPr: string, add: { xml: string; overrides: string[]; pStyle: string }, id: number, author: string, date: string): string {
  const orig = origPPr || '<w:pPr/>';
  const cleaned = stripElems(innerOf(origPPr), add.overrides);
  const change = `<w:pPrChange w:id="${id}" w:author="${author}" w:date="${date}">${orig}</w:pPrChange>`;
  return `<w:pPr>${add.pStyle}${cleaned}${add.xml}${change}</w:pPr>`;
}
