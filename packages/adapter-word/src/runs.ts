/**
 * <w:p> 段落内 run 级解析与切分 —— 外科写回的关键:
 * 把段落正文拆成 run/非run 词元,按【字符区间】精确切分命中的 run,
 * 使未触及的 run【逐字节保留】(含其 <w:rPr> 细粒度格式),只重写真正改到的那一小段。
 */

export const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export function unescapeXml(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

/** 段落全部可见文本(所有 <w:t>,含嵌套如超链接内),用于"该段是否含 quote"判定。 */
export function paraText(para: string): string {
  let t = '';
  for (const m of para.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)) t += unescapeXml(m[1]!);
  return t;
}

/** 拆出 <w:p> 的 open 标签、pPr、以及 pPr 之后的正文 body。pPr 深度感知(可含嵌套 pPrChange 里的 <w:pPr>)。 */
export function parsePara(para: string): { open: string; pPr: string; body: string } {
  const open = /^<w:p\b[^>]*>/.exec(para)?.[0] ?? '<w:p>';
  const inner = para.slice(open.length, para.length - '</w:p>'.length);
  let pPr = '';
  const sc = /^\s*<w:pPr\b[^>]*\/>/.exec(inner); // 自闭合 pPr
  if (sc) pPr = sc[0];
  else if (/^\s*<w:pPr\b/.test(inner)) {
    // 深度匹配:pPrChange 里嵌了 <w:pPr>…</w:pPr>,不能用非贪婪一把切
    const re = /<w:pPr\b(?:[^>]*[^/])?>|<\/w:pPr>/g;
    let depth = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(inner))) {
      depth += m[0].startsWith('</') ? -1 : 1;
      if (depth === 0) { pPr = inner.slice(0, re.lastIndex); break; }
    }
  }
  const body = inner.slice(pPr.length);
  return { open, pPr, body };
}

export interface Tok { run: boolean; xml: string; rPr: string; text: string; complex: boolean }

/** 把 body 拆成 顶层 run 与其间的非run 片段(书签/超链接等原样保留)。 */
export function splitBody(body: string): Tok[] {
  const toks: Tok[] = [];
  const re = /<w:r\b[^>]*>[\s\S]*?<\/w:r>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    if (m.index > last) toks.push({ run: false, xml: body.slice(last, m.index), rPr: '', text: '', complex: false });
    const xml = m[0];
    const rPr = /<w:rPr\b[^>]*\/>|<w:rPr\b[^>]*>[\s\S]*?<\/w:rPr>/.exec(xml)?.[0] ?? '';
    let text = '';
    for (const tm of xml.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)) text += unescapeXml(tm[1]!);
    const complex = /<w:(tab|br|cr|drawing|object|pict|fldChar|instrText|sym|noBreakHyphen|softHyphen)\b/.test(xml);
    toks.push({ run: true, xml, rPr, text, complex });
    last = re.lastIndex;
  }
  if (last < body.length) toks.push({ run: false, xml: body.slice(last), rPr: '', text: '', complex: false });
  return toks;
}

const mkRun = (rPr: string, text: string): string => `<w:r>${rPr}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;

/**
 * 在拼接后的 run 文本区间 [s,e) 上切分:
 * before = 区间前的 run(逐字节保留)+ 命中 run 的前缀;
 * middle = 区间覆盖的各 run 片段(带各自 rPr,供 red-line/加格式);
 * after  = 命中 run 的后缀 + 区间后的 run(逐字节保留)。
 * ok=false 表示区间落进了含制表符/换行/图形等的复杂 run,无法安全切分(由调用方回退)。
 */
export function sliceRuns(toks: Tok[], s: number, e: number): { before: string; middle: { rPr: string; text: string }[]; after: string; ok: boolean } {
  let pos = 0;
  let before = '';
  let after = '';
  let ok = true;
  const middle: { rPr: string; text: string }[] = [];
  for (const tk of toks) {
    if (!tk.run) { if (pos <= s) before += tk.xml; else after += tk.xml; continue; }
    const L = tk.text.length;
    const start = pos;
    const end = pos + L;
    if (end <= s) before += tk.xml;
    else if (start >= e) after += tk.xml;
    else if (tk.complex) {
      // 命中复杂 run(制表符/换行/图形…):整体保留、不进 middle,ok=false 交由调用方整段回退,
      // 否则会与 spanRedline 对整段 quote 的删改重复输出该 run 文本,造成正文重复/损坏。
      ok = false;
      if (start < s) before += tk.xml; else after += tk.xml;
    } else {
      const a = Math.max(0, s - start);
      const b = Math.min(L, e - start);
      if (a > 0) before += mkRun(tk.rPr, tk.text.slice(0, a));
      middle.push({ rPr: tk.rPr, text: tk.text.slice(a, b) });
      if (b < L) after += mkRun(tk.rPr, tk.text.slice(b));
    }
    pos = end;
  }
  return { before, middle, after, ok };
}

export { mkRun };
