/**
 * Surgical transform of word/document.xml: locate the target text within a paragraph and rewrite
 * only the hit range at the run level, as native Word tracked changes:
 *  - Text rewrite -> word-level <w:ins>/<w:del> (keeps each hit run's <w:rPr>; untouched runs preserved byte-for-byte);
 *  - Character formatting (bold/font/size/color...) -> <w:rPr> + <w:rPrChange> (reviewable format revision);
 *  - Paragraph formatting (alignment/line spacing/style/shading) -> <w:pPr> + <w:pPrChange>.
 * All other paragraphs pass through unchanged -- combined with surgical write-back (only document.xml
 * is modified), this is "OOXML surgical-grade" persistence.
 * v1's defect (flattening the whole hit paragraph, losing per-run formatting) is fixed: the whole-paragraph
 * fallback is used only when the hit involves a complex run (tabs/drawings, etc.).
 */
import { buildRedlineXml, diffWords, type RedlineOptions } from './redline.js';
import { charElems, paraElems, mergeRPr, mergePPr, type CharProps, type ParaProps } from './style.js';
import type { EditId } from '@otterpatch/core';
import { esc, paraText, parsePara, splitBody, sliceRuns } from './runs.js';

/** Text rewrite (compatible with the legacy signature). */
export interface ParaEdit { id?: EditId; old: string; new: string; paraIdx?: number }
/** Format revision (character and/or paragraph; both may coexist). paraIdx anchors empty/duplicate paragraphs by top-level block index. */
export interface FmtEdit { id?: EditId; kind: 'fmt'; quote: string; char?: CharProps; para?: ParaProps; paraIdx?: number }
/** Whole-paragraph deletion as a native revision: every run wrapped in <w:del> (w:t→w:delText) + paragraph-mark deletion in pPr, so accepting the revision leaves no empty paragraph behind. */
export interface DelParaEdit { id?: EditId; kind: 'delPara'; quote?: string; paraIdx?: number }
/** Image op on the drawing inside the anchored paragraph: remove (run wrapped in <w:del>) or resize (wp:extent/a:ext rewritten in EMU, aspect kept). */
export interface ImgEdit { id?: EditId; kind: 'img'; action: 'remove' | 'resize'; width?: number; quote?: string; paraIdx?: number }
/** Native Word table insertion. Rows are plain text only; row-level w:ins keeps the insertion reviewable in Word. */
export interface InsertTableEdit { id?: EditId; kind: 'insertTable'; rows: string[][]; headerRows: number; at: 'before' | 'after' | 'end'; quote?: string; paraIdx?: number }
export type DocEdit = ParaEdit | FmtEdit | DelParaEdit | ImgEdit | InsertTableEdit;

const isText = (e: DocEdit): e is ParaEdit => 'old' in e;
const isDel = (e: DocEdit): e is DelParaEdit => !isText(e) && e.kind === 'delPara';
const isImg = (e: DocEdit): e is ImgEdit => !isText(e) && e.kind === 'img';
const isTable = (e: DocEdit): e is InsertTableEdit => !isText(e) && e.kind === 'insertTable';
const EMU_PER_PX = 9525; // 96dpi: 1px = 9525 EMU
const escAttr = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

interface Ctx { id: number; author: string; authorRaw: string; date: string }

function tableXml(edit: InsertTableEdit, ctx: Ctx): string {
  const columns = edit.rows[0]?.length ?? 1;
  const cellWidth = Math.max(720, Math.floor(9000 / columns));
  const grid = edit.rows[0]!.map(() => `<w:gridCol w:w="${cellWidth}"/>`).join('');
  const borders = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    .map((side) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="B8C0CC"/>`)
    .join('');
  const rows = edit.rows.map((row, rowIndex) => {
    const header = rowIndex < edit.headerRows;
    const revision = `<w:ins w:id="${ctx.id++}" w:author="${ctx.author}" w:date="${ctx.date}"/>`;
    const cells = row.map((cell) => {
      const tcPr = `<w:tcPr><w:tcW w:w="${cellWidth}" w:type="dxa"/>${header ? '<w:shd w:val="clear" w:color="auto" w:fill="E8EEF7"/>' : ''}</w:tcPr>`;
      const rPr = header ? '<w:rPr><w:b/></w:rPr>' : '';
      return `<w:tc>${tcPr}<w:p><w:r>${rPr}<w:t xml:space="preserve">${esc(cell)}</w:t></w:r></w:p></w:tc>`;
    }).join('');
    return `<w:tr><w:trPr>${header ? '<w:tblHeader/>' : ''}${revision}</w:trPr>${cells}</w:tr>`;
  }).join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblLayout w:type="autofit"/><w:tblBorders>${borders}</w:tblBorders></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${rows}</w:tbl>`;
}

function insertTableAtDocumentEnd(documentXml: string, table: string): string | null {
  const body = /<w:body\b[^>]*>/.exec(documentXml);
  if (!body || body.index == null) return null;
  const contentStart = body.index + body[0].length;
  const bodyEnd = documentXml.indexOf('</w:body>', contentStart);
  if (bodyEnd < 0) return null;
  const content = documentXml.slice(contentStart, bodyEnd);
  // Only the final body-level sectPr belongs after document content. A lastIndexOf
  // can land on a paragraph-level section break and insert the table inside w:pPr.
  const sectStart = content.lastIndexOf('<w:sectPr');
  const sectTail = sectStart >= 0 ? content.slice(sectStart) : '';
  const hasFinalSectPr = /^<w:sectPr\b[^>]*(?:\/>|>[\s\S]*?<\/w:sectPr>)\s*$/.test(sectTail);
  const at = hasFinalSectPr ? contentStart + sectStart : bodyEnd;
  return documentXml.slice(0, at) + table + documentXml.slice(at);
}

/** Word-level redline within the range; preserves formatting per run's rPr: equal/del segments carry their original rPr (unchanged text keeps its formatting), ins uses the rPr at the current old-text offset. */
function spanRedline(middle: { rPr: string; text: string }[], newS: string, ctx: Ctx): string {
  const oldS = middle.map((m) => m.text).join('');
  const charRPr: string[] = [];
  for (const m of middle) for (let i = 0; i < m.text.length; i++) charRPr.push(m.rPr);
  const first = middle[0]?.rPr ?? '';
  let pos = 0; // offset into oldS
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

/** Whole-paragraph fallback when the hit involves a complex run (loses per-run formatting; rare). */
function flattenReplace(full: string, quote: string, next: string, ctx: Ctx): string {
  const revised = full.replace(quote, () => next); // function replacement: $ sequences in `next` are treated literally
  const xml = buildRedlineXml(full, revised, { author: ctx.authorRaw, date: ctx.date, idStart: ctx.id });
  ctx.id += diffWords(full, revised).filter((x) => x.op !== 'equal').length;
  return xml;
}

/** Paragraph-mark deletion element for pPr (the redline-notes backlog item: without it, accepting the revision leaves an empty paragraph). */
function paraMarkDel(pPr: string, ctx: Ctx): string {
  const del = `<w:del w:id="${ctx.id++}" w:author="${ctx.author}" w:date="${ctx.date}"/>`;
  if (!pPr) return `<w:pPr><w:rPr>${del}</w:rPr></w:pPr>`;
  if (/^\s*<w:pPr\b[^>]*\/>/.test(pPr)) return pPr.replace(/<w:pPr\b([^>]*)\/>/, `<w:pPr$1><w:rPr>${del}</w:rPr></w:pPr>`);
  if (/<w:rPr[\s/>]/.test(pPr)) return pPr.replace(/<w:rPr\b(\s[^>]*)?>/, (m) => m + del).replace(/<w:rPr\b([^>]*)\/>/, `<w:rPr$1>${del}</w:rPr>`);
  return pPr.replace(/<\/w:pPr>\s*$/, `<w:rPr>${del}</w:rPr></w:pPr>`);
}

/** Delete a whole paragraph as a native revision: runs → <w:del>-wrapped (w:t→w:delText), pPr gets the paragraph-mark <w:del/>. */
function delParaXml(para: string, ctx: Ctx): string {
  if (/^<w:p\b[^>]*\/>$/.test(para)) {
    // Self-closing empty paragraph: only the paragraph-mark deletion is needed
    return para.replace(/\/>$/, '>') + paraMarkDel('', ctx) + '</w:p>';
  }
  const { open, pPr, body } = parsePara(para);
  const newBody = body.replace(/<w:r\b[^>]*>[\s\S]*?<\/w:r>/g, (run) =>
    `<w:del w:id="${ctx.id++}" w:author="${ctx.author}" w:date="${ctx.date}">${run.replace(/<w:t\b(\s[^>]*)?>/g, '<w:delText$1>').replace(/<\/w:t>/g, '</w:delText>')}</w:del>`);
  return open + paraMarkDel(pPr, ctx) + newBody + '</w:p>';
}

/** Image ops inside a paragraph: resize rewrites wp:extent/a:ext (EMU, aspect kept, direct edit — image sizing has no practical revision form); remove wraps the drawing run in <w:del>. */
function imgXml(para: string, edit: ImgEdit, ctx: Ctx): string | null {
  if (!/<w:drawing\b|<w:pict\b/.test(para)) return null;
  if (edit.action === 'resize') {
    if (!edit.width) return null;
    let hit = false;
    const out = para.replace(/(<(?:wp:extent|a:ext)\b[^>]*?cx=")(\d+)("[^>]*?cy=")(\d+)(")/g, (_m, a, cx, b, cy, c) => {
      const ncx = Math.round(edit.width! * EMU_PER_PX);
      const ncy = Math.max(1, Math.round(ncx * (Number(cy) / Math.max(1, Number(cx)))));
      hit = true;
      return `${a}${ncx}${b}${ncy}${c}`;
    });
    return hit ? out : null;
  }
  // remove:包住含 drawing/pict 的 run(drawing run 无 w:t,w:del 包裹即为删除修订)
  const { open, pPr, body } = parsePara(para);
  let hit = false;
  const newBody = body.replace(/<w:r\b[^>]*>[\s\S]*?<\/w:r>/g, (run) => {
    if (!/<w:drawing\b|<w:pict\b/.test(run)) return run;
    hit = true;
    return `<w:del w:id="${ctx.id++}" w:author="${ctx.author}" w:date="${ctx.date}">${run}</w:del>`;
  });
  return hit ? open + pPr + newBody + '</w:p>' : null;
}

/** Try to apply one edit to a paragraph; returns null if the quote is not in this paragraph.
 *  blkIdx = the paragraph's top-level block index (each top-level <w:tbl> counts as one block, mirroring
 *  the workspace importer) — anchors paraIdx-based edits (empty paragraphs have no quote to match). */
function tryApply(para: string, edit: DocEdit, ctx: Ctx, blkIdx?: number): string | null {
  const quote = isText(edit) ? edit.old : (edit.quote ?? '');
  if (edit.paraIdx != null && edit.paraIdx !== blkIdx) return null;
  const idxHit = !isText(edit) && edit.paraIdx != null && edit.paraIdx === blkIdx;
  if (isTable(edit)) {
    if (edit.at === 'end') return null;
    const quoteHit = !para.startsWith('<w:tbl') && !!quote && paraText(para).includes(quote);
    if (!idxHit && !quoteHit) return null;
    const table = tableXml(edit, ctx);
    return edit.at === 'before' ? table + para : para + table;
  }
  // 结构/图片操作:quote 命中该段 或 段号命中(空段只有段号)
  if (isDel(edit)) {
    if (quote ? paraText(para).includes(quote) : idxHit) return delParaXml(para, ctx);
    return null;
  }
  if (isImg(edit)) {
    if (quote ? paraText(para).includes(quote) : idxHit) return imgXml(para, edit, ctx);
    return null;
  }
  // 段落格式 + 段号锚(空段落套格式:quote 为空,靠段号命中)
  if (!quote && !isText(edit) && idxHit && edit.para) {
    const { open, pPr, body } = parsePara(para);
    return open + mergePPr(pPr, paraElems(edit.para), ctx.id++, ctx.author, ctx.date) + body + '</w:p>';
  }
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

  // Paragraph-level formatting (modifies pPr directly)
  if (!isText(edit) && edit.para) {
    newPPr = mergePPr(pPr, paraElems(edit.para), ctx.id++, ctx.author, ctx.date);
    changed = true;
  }

  if (isText(edit)) {
    if (s >= 0) {
      const sl = sliceRuns(toks, s, s + quote.length);
      if (sl.ok && sl.middle.length) newBody = sl.before + spanRedline(sl.middle, edit.new, ctx) + sl.after;
      else newBody = flattenReplace(full, quote, edit.new, ctx); // complex run -> whole-paragraph fallback
    } else {
      newBody = flattenReplace(full, quote, edit.new, ctx); // quote lives in nested content -> whole-paragraph fallback
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

/** Apply a set of edits to document.xml; each edit locates its first matching paragraph and rewrites it surgically.
 *  Block indexing mirrors the workspace importer: top-level <w:tbl> consumes its inner paragraphs and counts
 *  as ONE block, so paraIdx from the workspace ("第N段") lands on the same paragraph here. */
export function redlineDocumentXml(documentXml: string, edits: DocEdit[], opts: RedlineOptions = {}): { xml: string; changed: number; appliedEditIds: EditId[]; droppedEdits: Array<{ editId: EditId; reason: string }> } {
  const authorRaw = opts.author ?? 'OtterPatch';
  const ctx: Ctx = { id: opts.idStart ?? 1, author: escAttr(authorRaw), authorRaw, date: opts.date ?? '1970-01-01T00:00:00Z' };
  let xml = documentXml;
  let changed = 0;
  const appliedEditIds: EditId[] = [];
  const droppedEdits: Array<{ editId: EditId; reason: string }> = [];
  for (const edit of edits) {
    if (isTable(edit) && edit.at === 'end') {
      const next = insertTableAtDocumentEnd(xml, tableXml(edit, ctx));
      if (next != null) {
        xml = next;
        changed++;
        if (edit.id) appliedEditIds.push(edit.id);
      } else if (edit.id) {
        droppedEdits.push({ editId: edit.id, reason: 'document body not found for table insertion' });
      }
      continue;
    }
    let applied = false;
    let blk = -1; // top-level block cursor (w:tbl = one block, its inner w:p don't count)
    // Match tables first (skipped whole), then self-closing empty paragraphs <w:p .../> and regular <w:p>...</w:p>
    xml = xml.replace(/<w:tbl\b[\s\S]*?<\/w:tbl>|<w:p\b[^>]*\/>|<w:p\b[\s\S]*?<\/w:p>/g, (el) => {
      blk++;
      if (applied || (el.startsWith('<w:tbl') && !isTable(edit))) return el;
      const res = tryApply(el, edit, ctx, blk);
      if (res == null) return el;
      applied = true;
      return res;
    });
    if (applied) {
      changed++;
      if (edit.id) appliedEditIds.push(edit.id);
    } else if (edit.id) {
      droppedEdits.push({ editId: edit.id, reason: 'anchor did not match document.xml' });
    }
  }
  return { xml, changed, appliedEditIds, droppedEdits };
}
