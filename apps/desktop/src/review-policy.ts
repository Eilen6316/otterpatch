import type { DiffTurn } from './app-thread-types.js';
import type { AgentDiffItem } from './proposal-materializers.js';

export type ReviewRiskLevel = 'safe' | 'caution' | 'destructive';

export interface ReviewRiskSummary {
  total: number;
  safe: number;
  caution: number;
  destructive: number;
  deletions: number;
  structural: number;
  documentWide: number;
}

export function reviewRiskLevel(item: AgentDiffItem): ReviewRiskLevel {
  return item.risk?.level === 'safe' || item.risk?.level === 'destructive' ? item.risk.level : 'caution';
}

export function reviewItemKind(turn: DiffTurn, item: AgentDiffItem): string {
  if (turn.format === 'word') {
    const wordEdit = turn.word?.find((edit) => edit.editId === item.editId);
    if (wordEdit?.table) return 'structure';
    return wordEdit?.style || item.style ? 'style' : 'text';
  }
  if (turn.format === 'excel') {
    const op = turn.ops.find((candidate) => candidate.editId === item.editId);
    if (!op) return 'structure';
    return op.value !== undefined ? 'value' : 'style';
  }
  if (turn.format === 'drawio') return 'object';
  return 'other';
}

export function summarizeReviewRisk(turn: DiffTurn, items: readonly AgentDiffItem[] = turn.diff.items): ReviewRiskSummary {
  const summary: ReviewRiskSummary = {
    total: items.length,
    safe: 0,
    caution: 0,
    destructive: 0,
    deletions: 0,
    structural: 0,
    documentWide: 0,
  };
  for (const item of items) {
    summary[reviewRiskLevel(item)] += 1;
    const wordEdit = turn.word?.find((edit) => edit.editId === item.editId);
    if (item.badge === 'remove' || wordEdit?.remove || wordEdit?.img?.action === 'remove') summary.deletions += 1;
    if (reviewItemKind(turn, item) === 'structure') summary.structural += 1;
    const style = wordEdit?.style ?? item.style;
    const riskDescribesWideScope = item.risk?.reasons?.some((reason) =>
      /document-wide|sheet-wide|scope is (?:document|section)/i.test(reason),
    ) ?? false;
    if (riskDescribesWideScope || (turn.format === 'word' && style && (
      style.columns !== undefined || style.margin !== undefined || style.orient !== undefined
    ))) summary.documentWide += 1;
  }
  return summary;
}

export function acceptAllConfirmation(summary: ReviewRiskSummary): string {
  const scope = [
    summary.deletions ? `删除 ${summary.deletions}` : '',
    summary.structural ? `结构 ${summary.structural}` : '',
    summary.documentWide ? `文档级 ${summary.documentWide}` : '',
  ].filter(Boolean).join('，') || '无删除或结构操作';
  return [
    `确认接受全部 ${summary.total} 项改动？`,
    `风险：安全 ${summary.safe}，谨慎 ${summary.caution}，破坏性 ${summary.destructive}`,
    `范围：${scope}`,
  ].join('\n');
}
