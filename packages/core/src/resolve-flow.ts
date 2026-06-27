/**
 * flow 锚点解析器 —— 实现 PortableLocator.flow 的"上下文锚定、不依赖行号/偏移"定位。
 * 思路借鉴 codex 的 V4A apply_patch(用前后文锚点而非行号,抗文档漂移),clean-room 重写。
 * 三级回退:① 精确文本 + 前后文打分 → ② 空白/CRLF 不敏感 → ③ 仅靠前后文定位(正文被改)。
 * 输出 confidence 驱动 anchor.ts 的 RebaseResult(tracked/shifted/fuzzy/detached)。
 */
export interface FlowQuote {
  prefix: string;
  text: string;
  suffix: string;
}

export interface FlowMatch {
  start: number;
  end: number;
  confidence: number; // 1=精确且前后文吻合 … 0=无
  mode: 'exact' | 'ws-insensitive' | 'context-only';
}

function allIndices(h: string, n: string): number[] {
  const out: number[] = [];
  if (!n) return out;
  let i = h.indexOf(n);
  while (i >= 0) {
    out.push(i);
    i = h.indexOf(n, i + 1);
  }
  return out;
}
function commonSuffixLen(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[a.length - 1 - i] === b[b.length - 1 - i]) i++;
  return i;
}
function commonPrefixLen(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 在当前文档文本里定位 flow 锚点引用,返回命中范围 + 置信度;无法定位返回 null。 */
export function resolveFlow(doc: string, quote: FlowQuote): FlowMatch | null {
  const { prefix, text, suffix } = quote;
  if (!text) return null;

  // ① 精确文本:多处命中时用前后文打分消歧
  const occ = allIndices(doc, text);
  if (occ.length) {
    let best = occ[0]!;
    let bestScore = -1;
    let ties = 0;
    for (const idx of occ) {
      const before = doc.slice(Math.max(0, idx - prefix.length), idx);
      const after = doc.slice(idx + text.length, idx + text.length + suffix.length);
      const total = prefix.length + suffix.length;
      const ctx = total === 0 ? 1 : (commonSuffixLen(before, prefix) + commonPrefixLen(after, suffix)) / total;
      if (ctx > bestScore) {
        bestScore = ctx;
        best = idx;
        ties = 1;
      } else if (ctx === bestScore) {
        ties++;
      }
    }
    const confidence = Math.max(0, 0.6 + 0.4 * bestScore - (ties > 1 ? 0.1 : 0));
    return { start: best, end: best + text.length, confidence, mode: 'exact' };
  }

  // ② 空白/CRLF 不敏感:文本内部空白序列允许漂移(如 "a b" ↔ "a\nb")
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  if (tokens.length) {
    const re = new RegExp(tokens.map(escapeRe).join('\\s+'));
    const m = re.exec(doc);
    if (m) return { start: m.index, end: m.index + m[0].length, confidence: 0.85, mode: 'ws-insensitive' };
  }

  // ③ 仅靠前后文:正文已被改动,但 prefix…suffix 仍在 → 命中被改区间
  if (prefix && suffix) {
    const p = doc.indexOf(prefix);
    if (p >= 0) {
      const s = doc.indexOf(suffix, p + prefix.length);
      if (s >= 0) return { start: p + prefix.length, end: s, confidence: 0.4, mode: 'context-only' };
    }
  }
  return null;
}

/** confidence → RebaseResult 状态分层。 */
export function flowConfidenceToStatus(confidence: number): 'tracked' | 'shifted' | 'fuzzy' | 'detached' {
  if (confidence >= 0.95) return 'tracked';
  if (confidence >= 0.8) return 'shifted';
  if (confidence >= 0.45) return 'fuzzy';
  return 'detached';
}
