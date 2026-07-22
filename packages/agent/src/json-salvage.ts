/**
 * Tolerate tool-argument JSON truncated by output-length limits.
 * When the model emits too many changes at once, the propose args JSON may be cut off
 * mid-stream and plain JSON.parse throws "Unterminated string". Here: if it parses
 * normally, return as-is; otherwise best-effort extract the plan plus the *fully closed*
 * items in the edits/ops arrays and drop the incomplete tail — degrading "whole batch
 * fails" into "apply the parsable portion".
 */
export interface SalvagedProposal {
  plan?: string;
  edits?: unknown[];
  ops?: unknown[];
  truncated: boolean;
}

/** Extract the *fully closed* object items under a given array key from raw (possibly truncated) JSON. */
function extractArrayItems(raw: string, key: string): unknown[] | undefined {
  const m = new RegExp('"' + key + '"\\s*:\\s*\\[').exec(raw);
  if (!m) return undefined;
  let i = m.index + m[0].length;
  const out: unknown[] = [];
  while (i < raw.length) {
    while (i < raw.length && /[\s,]/.test(raw[i]!)) i++;
    if (i >= raw.length || raw[i] !== '{') break;
    let depth = 0, inStr = false, esc = false, j = i, closed = false;
    for (; j < raw.length; j++) {
      const c = raw[j]!;
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) { j++; closed = true; break; } }
    }
    if (!closed) break; // incomplete tail, drop it
    try { out.push(JSON.parse(raw.slice(i, j))); } catch { break; }
    i = j;
  }
  return out.length ? out : undefined;
}

/** Safely parse arbitrary tool args: on failure (incl. truncation) return {}; never throws. */
export function safeParse(raw: string): Record<string, unknown> {
  try { return JSON.parse(raw || '{}') as Record<string, unknown>; } catch { return {}; }
}

/** Best-effort extract `text` from (possibly truncated) answer_user args, preserving what was generated. */
export function salvageText(raw: string): string {
  try { const o = JSON.parse(raw) as { text?: unknown }; if (o?.text != null) return String(o.text); } catch { /* truncated → fall back to regex */ }
  const m = /"text"\s*:\s*"((?:[^"\\]|\\.)*)/.exec(raw);
  if (!m) return '';
  try { return JSON.parse('"' + m[1] + '"') as string; } catch { return (m[1] ?? '').replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"'); }
}

export function salvageProposalArgs(raw: string): SalvagedProposal {
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    return { ...o, truncated: false } as SalvagedProposal;
  } catch {
    /* truncated → best-effort extraction */
  }
  const planRaw = /"plan"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(raw)?.[1];
  let plan: string | undefined;
  if (planRaw != null) { try { plan = JSON.parse('"' + planRaw + '"') as string; } catch { plan = undefined; } }
  const edits = extractArrayItems(raw, 'edits');
  const ops = extractArrayItems(raw, 'ops');
  return { ...(plan != null ? { plan } : {}), ...(edits ? { edits } : {}), ...(ops ? { ops } : {}), truncated: true };
}

/** Remove parser metadata before strict host-dialect validation. */
export function salvagedProposalPayload(value: SalvagedProposal): Record<string, unknown> {
  const { truncated: _truncated, ...payload } = value;
  return payload;
}
