/**
 * docx → HTML 导入(浏览器侧):真实 .docx 载入 Word 工作区,补上 hero 闭环缺的那一段——
 * 上传 → 工作区渲染 → 圈选/提案/行内审阅 → 外科写回 → 下载。
 * 解析口径与 adapter-word 一致(正则走 OOXML 文本),只求"常见文档看得对":
 * 段落(pStyle 标题/对齐/行距)+ run(加粗/斜体/下划线/删除线/字号/字体/颜色/高亮)。
 * 顶层表格保留二维结构并渲染为真实 HTML table;图片/脚注等复杂构件仍显式报告降级。
 */
import { unzipSync, strFromU8 } from 'fflate';

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c));
const xmlCodePoint = (raw: string, radix: number): string => {
  const value = Number.parseInt(raw, radix);
  return Number.isSafeInteger(value) && value >= 0 && value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff) ? String.fromCodePoint(value) : '\ufffd';
};
const unescapeXml = (s: string): string => s
  .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => xmlCodePoint(hex, 16))
  .replace(/&#(\d+);/g, (_match, dec: string) => xmlCodePoint(dec, 10))
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&amp;/g, '&');

/** 取 <w:xxx w:val="…"/> 的 val。 */
const val = (xml: string, tag: string): string | null => {
  const m = new RegExp(`<w:${tag}\\b[^>]*w:val="([^"]*)"`).exec(xml);
  return m ? m[1]! : null;
};
const has = (xml: string, tag: string): boolean => {
  const m = new RegExp(`<w:${tag}\\b([^>]*)/?>`).exec(xml);
  if (!m) return false;
  const v = /w:val="([^"]*)"/.exec(m[1] ?? '');
  return !v || !/^(false|0|none)$/i.test(v[1]!);
};

/** run 属性(w:rPr)→ 内联 style + 语义标签。 */
function runHtml(rXml: string): string {
  // w:t(保空格)+ w:br/w:tab;其余(图片/域)先忽略
  const texts: string[] = [];
  const re = /<w:(t|br|tab)\b[^>]*(?:\/>|>([\s\S]*?)<\/w:\1>)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rXml))) {
    if (m[1] === 't') texts.push(esc(unescapeXml(m[2] ?? '')));
    else if (m[1] === 'br') texts.push('<br/>');
    else texts.push('&emsp;');
  }
  let inner = texts.join('');
  if (!inner) return '';
  const pr = /<w:rPr>([\s\S]*?)<\/w:rPr>/.exec(rXml)?.[1] ?? '';
  const css: string[] = [];
  const sz = val(pr, 'sz'); // 半磅
  if (sz) css.push(`font-size:${parseInt(sz, 10) / 2}pt`);
  const font = /<w:rFonts\b[^>]*w:(?:eastAsia|ascii)="([^"]*)"/.exec(pr)?.[1];
  if (font) css.push(`font-family:${esc(font)}`);
  const color = val(pr, 'color');
  if (color && color !== 'auto') css.push(`color:#${color}`);
  const hi = val(pr, 'highlight');
  if (hi && hi !== 'none') css.push(`background-color:${hi}`);
  if (has(pr, 'b')) inner = `<b>${inner}</b>`;
  if (has(pr, 'i')) inner = `<i>${inner}</i>`;
  if (has(pr, 'u') && val(pr, 'u') !== 'none') inner = `<u>${inner}</u>`;
  if (has(pr, 'strike')) inner = `<s>${inner}</s>`;
  return css.length ? `<span style="${css.join(';')}">${inner}</span>` : inner;
}

/** 段落 → 块级 HTML(pStyle 映射标题;jc 对齐;spacing 行距)。 */
function paraHtml(pXml: string): string {
  const pr = /<w:pPr>([\s\S]*?)<\/w:pPr>/.exec(pXml)?.[1] ?? '';
  const style = val(pr, 'pStyle') ?? '';
  const tag = /^(heading?\s*1|1|h1|标题\s*1)$/i.test(style) || /heading1/i.test(style) ? 'h1'
    : /heading2|^2$|标题\s*2/i.test(style) ? 'h2'
    : /heading3|^3$|标题\s*3/i.test(style) ? 'h3'
    : /quote|引用/i.test(style) ? 'blockquote' : 'p';
  const css: string[] = [];
  const jc = val(pr, 'jc');
  if (jc === 'center') css.push('text-align:center');
  else if (jc === 'right' || jc === 'end') css.push('text-align:right');
  else if (jc === 'both' || jc === 'distribute') css.push('text-align:justify');
  const line = /<w:spacing\b[^>]*w:line="(\d+)"[^>]*w:lineRule="auto"/.exec(pr)?.[1];
  if (line) css.push(`line-height:${Math.round((parseInt(line, 10) / 240) * 100) / 100}`);
  const runs: string[] = [];
  const rr = /<w:r\b[^>]*>([\s\S]*?)<\/w:r>/g;
  let m: RegExpExecArray | null;
  while ((m = rr.exec(pXml))) runs.push(runHtml(m[0]));
  const inner = runs.join('') || '<br/>'; // 空段占位,保持段落结构
  const attr = css.length ? ` style="${css.join(';')}"` : '';
  return `<${tag}${attr}>${inner}</${tag}>`;
}

/** 顶层 Word 表格 → HTML table。每个 tc 内保留段落/run 样式,表头由 tblHeader 标记识别。 */
function tableHtml(tblXml: string): string {
  const rows: string[] = [];
  const rowRe = /<w:tr\b[^>]*>[\s\S]*?<\/w:tr>/g;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRe.exec(tblXml))) {
    const rowXml = rowMatch[0];
    const header = /<w:tblHeader\b/.test(rowXml);
    const cells: string[] = [];
    const cellRe = /<w:tc\b[^>]*>[\s\S]*?<\/w:tc>/g;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRe.exec(rowXml))) {
      const cellXml = cellMatch[0];
      const paras: string[] = [];
      const paraRe = /<w:p\b[^>]*(?:\/>|>[\s\S]*?<\/w:p>)/g;
      let paraMatch: RegExpExecArray | null;
      while ((paraMatch = paraRe.exec(cellXml))) paras.push(/<w:p\b[^>]*\/>/.test(paraMatch[0]) ? '<p><br/></p>' : paraHtml(paraMatch[0]));
      const span = /<w:gridSpan\b[^>]*w:val="(\d+)"/.exec(cellXml)?.[1];
      const colspan = span && Number(span) > 1 ? ` colspan="${Number(span)}"` : '';
      const tag = header ? 'th' : 'td';
      cells.push(`<${tag}${colspan}>${paras.join('') || '<br/>'}</${tag}>`);
    }
    rows.push(`<tr>${cells.join('')}</tr>`);
  }
  return `<table class="rd-tbl"><tbody>${rows.join('')}</tbody></table>`;
}

export interface DocxImport { html: string; skipped: string[] }

/** .docx 字节 → { html, skipped }。抛错=不是合法 docx。 */
export function docxToHtml(bytes: Uint8Array): DocxImport {
  const files = unzipSync(bytes);
  const doc = files['word/document.xml'];
  if (!doc) throw new Error('不是合法的 .docx(缺 word/document.xml)');
  const xml = strFromU8(doc);
  const body = /<w:body>([\s\S]*?)<\/w:body>/.exec(xml)?.[1] ?? xml;
  const skipped: string[] = [];
  if (/<w:drawing\b|<w:pict\b/.test(body)) skipped.push('图片/绘图');
  const parts: string[] = [];
  // 按 body 顶层块顺序解析。一个 w:tbl 只生成一个工作区块,与 adapter 的 paraIdx 计数一致。
  const blockRe = /<w:tbl\b[\s\S]*?<\/w:tbl>|<w:p\b[^>]*(?:\/>|>[\s\S]*?<\/w:p>)/g;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(body))) {
    if (m[0].startsWith('<w:tbl')) parts.push(tableHtml(m[0]));
    else parts.push(/<w:p\b[^>]*\/>/.test(m[0]) ? '<p><br/></p>' : paraHtml(m[0]));
  }
  const html = parts.join('\n');
  if (!html.trim()) throw new Error('文档没有可渲染的正文段落');
  return { html, skipped };
}
