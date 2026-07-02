/**
 * word/document.xml 外科变换:按文本在段落内定位,把命中区间【run 级】重写成 Word 原生修订:
 *  · 文本改写 → 词级 <w:ins>/<w:del>(保留命中 run 的 <w:rPr>,未触及 run 逐字节保留);
 *  · 字符格式(加粗/字体/字号/颜色…)→ <w:rPr> + <w:rPrChange>(可审阅的格式修订);
 *  · 段落格式(对齐/行距/样式/底纹)→ <w:pPr> + <w:pPrChange>。
 * 其余段落原样透传 —— 配合外科写回(仅改 document.xml),即"OOXML 外科手术级"落盘。
 * v1 的"命中段整段扁平化、丢逐 run 格式"缺陷已修:仅在命中复杂 run(制表符/图形等)时才回退整段。
 */
import { buildRedlineXml, diffWords, type RedlineOptions } from './redline.js';
import { charElems, paraElems, mergeRPr, mergePPr, type CharProps, type ParaProps } from './style.js';
import { esc, paraText, parsePara, splitBody, sliceRuns } from './runs.js';

/** 文本改写(兼容旧签名)。 */
export interface ParaEdit { old: string; new: string }
/** 格式修订(字符 / 段落,二者可并存)。 */
export interface FmtEdit { kind: 'fmt'; quote: string; char?: CharProps; para?: ParaProps }
export type DocEdit = ParaEdit | FmtEdit;

const isText = (e: DocEdit): e is ParaEdit => 'old' in e;
const escAttr = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

interface Ctx { id: number; author: string; authorRaw: string; date: string }

/** 区间内词级红线;按各 run 的 rPr 保留格式:equal/del 分段带各自原 rPr(未改文本不被改格式),ins 用当前旧偏移处 rPr。 */
function spanRedline(middle: { rPr: string; text: string }[], newS: string, ctx: Ctx): string {
  const oldS = middle.map((m) => m.text).join('');
  const charRPr: string[] = [];
  for (const m of middle) for (let i = 0; i < m.text.length; i++) charRPr.push(m.rPr);
  const first = middle[0]?.rPr ?? '';
  let pos = 0; // oldS 偏移
  const byRPr = (text: string, make: (rPr: string, t: string) => string): string => {
    let out = '';
    let i = 0;
    while (i < text.length) {
      const rPr = charRPr[pos + i] ?? first;
      let j = i + 1;
      while (j < text.length && (charRPr[pos + j] ?? first) === rPr) j++;
      out += make(rPr, text.slice(i, j));
      i = j;
    }
    pos += text.length;
    return out;
  };
  return diffWords(oldS, newS)
    .map((seg) => {
      if (seg.op === 'equal') return byRPr(seg.text, (rPr, t) => `<w:r>${rPr}<w:t xml:space="preserve">${esc(t)}</w:t></w:r>`);
      if (seg.op === 'del') return byRPr(seg.text, (rPr, t) => `<w:del w:id="${ctx.id++}" w:author="${ctx.author}" w:date="${ctx.date}"><w:r>${rPr}<w:delText xml:space="preserve">${esc(t)}</w:delText></w:r></w:del>`);
      const insRPr = charRPr[Math.min(pos, charRPr.length - 1)] ?? first;
      return `<w:ins w:id="${ctx.id++}" w:author="${ctx.author}" w:date="${ctx.date}"><w:r>${insRPr}<w:t xml:space="preserve">${esc(seg.text)}</w:t></w:r></w:ins>`;
    })
    .join('');
}

/** 命中复杂 run 时的整段回退(丢逐 run 格式,罕见)。 */
function flattenReplace(full: string, quote: string, next: string, ctx: Ctx): string {
  const revised = full.replace(quote, () => next); // 函数替换:new 里的 $ 序列按字面处理
  const xml = buildRedlineXml(full, revised, { author: ctx.authorRaw, date: ctx.date, idStart: ctx.id });
  ctx.id += diffWords(full, revised).filter((x) => x.op !== 'equal').length;
  return xml;
}

/** 尝试把一条编辑应用到某段;quote 不在该段则返回 null。 */
function tryApply(para: string, edit: DocEdit, ctx: Ctx): string | null {
  const quote = isText(edit) ? edit.old : edit.quote;
  if (!quote) return null;
  const full = paraText(para);
  if (!full.includes(quote)) return null;

  const { open, pPr, body } = parsePara(para);
  const toks = splitBody(body);
  const runText = toks.filter((t) => t.run).map((t) => t.text).join('');
  const s = runText.indexOf(quote);

  let newPPr = pPr;
  let newBody = body;
  let changed = false;

  // 段落级格式(直接改 pPr)
  if (!isText(edit) && edit.para) {
    newPPr = mergePPr(pPr, paraElems(edit.para), ctx.id++, ctx.author, ctx.date);
    changed = true;
  }

  if (isText(edit)) {
    if (s >= 0) {
      const sl = sliceRuns(toks, s, s + quote.length);
      if (sl.ok && sl.middle.length) newBody = sl.before + spanRedline(sl.middle, edit.new, ctx) + sl.after;
      else newBody = flattenReplace(full, quote, edit.new, ctx); // 复杂 run → 整段回退
    } else {
      newBody = flattenReplace(full, quote, edit.new, ctx); // quote 在嵌套里 → 整段回退
    }
    changed = true;
  } else if (edit.char) {
    if (s >= 0) {
      const sl = sliceRuns(toks, s, s + quote.length);
      if (sl.ok && sl.middle.length) {
        const add = charElems(edit.char);
        newBody = sl.before + sl.middle.map((p) => `<w:r>${mergeRPr(p.rPr, add, ctx.id++, ctx.author, ctx.date)}<w:t xml:space="preserve">${esc(p.text)}</w:t></w:r>`).join('') + sl.after;
        changed = true;
      }
    }
  }

  if (!changed) return null;
  return open + newPPr + newBody + '</w:p>';
}

/** 对 document.xml 应用一组编辑;每条各自定位其首个命中段,外科重写。 */
export function redlineDocumentXml(documentXml: string, edits: DocEdit[], opts: RedlineOptions = {}): { xml: string; changed: number } {
  const authorRaw = opts.author ?? 'OtterPatch';
  const ctx: Ctx = { id: opts.idStart ?? 1, author: escAttr(authorRaw), authorRaw, date: opts.date ?? '1970-01-01T00:00:00Z' };
  let xml = documentXml;
  let changed = 0;
  for (const edit of edits) {
    let applied = false;
    // 同时匹配自闭合空段 <w:p .../>(Word 常见)与常规 <w:p>…</w:p>,避免空段吞并下一段
    xml = xml.replace(/<w:p\b[^>]*\/>|<w:p\b[\s\S]*?<\/w:p>/g, (para) => {
      if (applied) return para;
      const res = tryApply(para, edit, ctx);
      if (res == null) return para;
      applied = true;
      return res;
    });
    if (applied) changed++;
  }
  return { xml, changed };
}
