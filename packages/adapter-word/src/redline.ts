/**
 * Word 红线(track-changes)生成 —— 把"原文 → 改后"的词级 diff 编译成 Word 原生修订标记:
 * 删除 → <w:del><w:delText>;新增 → <w:ins><w:r><w:t>;未改 → 普通 <w:r><w:t>。
 * 这样 Agent 的改动落到 Word 时是可逐条 接受/拒绝 的原生修订,而非直接改字 —— 契合 OtterPatch
 * "可审阅安全执行"。clean-room 实现(仅用公开 OOXML 语义,不拷任何专有 skill 文本)。
 */
export interface RedlineOptions {
  author?: string;
  date?: string; // ISO,如 2026-01-01T00:00:00Z(由调用方传入,保持确定性)
  idStart?: number;
}

export interface DiffSeg {
  op: 'equal' | 'del' | 'ins';
  text: string;
}

function tokenize(s: string): string[] {
  return s.match(/\s+|\S+/g) ?? [];
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** 词级 LCS diff → equal/del/ins 段(相邻同 op 合并)。 */
export function diffWords(a: string, b: string): DiffSeg[] {
  const A = tokenize(a);
  const B = tokenize(b);
  const n = A.length;
  const m = B.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = A[i] === B[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const raw: DiffSeg[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      raw.push({ op: 'equal', text: A[i]! });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      raw.push({ op: 'del', text: A[i]! });
      i++;
    } else {
      raw.push({ op: 'ins', text: B[j]! });
      j++;
    }
  }
  while (i < n) raw.push({ op: 'del', text: A[i++]! });
  while (j < m) raw.push({ op: 'ins', text: B[j++]! });

  const out: DiffSeg[] = [];
  for (const seg of raw) {
    const last = out[out.length - 1];
    if (last && last.op === seg.op) last.text += seg.text;
    else out.push({ ...seg });
  }
  return out;
}

/** 把 diff 编译成段落内的 OOXML 修订 run 串(嵌进 word/document.xml 的 <w:p> 里)。 */
export function buildRedlineXml(original: string, revised: string, opts: RedlineOptions = {}): string {
  const author = esc(opts.author ?? 'OtterPatch');
  const date = opts.date ?? '1970-01-01T00:00:00Z';
  let id = opts.idStart ?? 1;
  const run = (txt: string): string => `<w:r><w:t xml:space="preserve">${esc(txt)}</w:t></w:r>`;
  return diffWords(original, revised)
    .map((seg) => {
      if (seg.op === 'equal') return run(seg.text);
      if (seg.op === 'del') {
        return `<w:del w:id="${id++}" w:author="${author}" w:date="${date}"><w:r><w:delText xml:space="preserve">${esc(seg.text)}</w:delText></w:r></w:del>`;
      }
      return `<w:ins w:id="${id++}" w:author="${author}" w:date="${date}"><w:r><w:t xml:space="preserve">${esc(seg.text)}</w:t></w:r></w:ins>`;
    })
    .join('');
}
