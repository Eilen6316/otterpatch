interface UserTurn {
  role: 'user';
  text: string;
}

interface AnswerTurn {
  role: 'assistant';
  kind: 'answer';
  text?: string;
  streaming?: boolean;
}

interface ClarifyTurn {
  role: 'assistant';
  kind: 'clarify';
  questions: Array<{ question: string; options: Array<{ label: string }> }>;
  answered?: boolean;
}

interface DiffTurn {
  role: 'assistant';
  kind: 'diff';
  diff: { items: Array<{ ref: string; label: string }> };
  reverted?: boolean;
  committed?: boolean;
  committedCount?: number;
}

export type HistoryTurn = UserTurn | AnswerTurn | ClarifyTurn | DiffTurn;

export type ModelHistoryMessage = { role: 'user' | 'assistant'; content: string };

/**
 * Project the UI thread into a compact model history. Diff turns keep summaries
 * and final disposition instead of replaying full patches.
 */
export function buildHistory(thread: readonly HistoryTurn[]): ModelHistoryMessage[] {
  const proj = thread.map((turn): ModelHistoryMessage => {
    if (turn.role === 'user') return { role: 'user', content: turn.text };
    if (turn.kind === 'answer') return { role: 'assistant', content: turn.text ?? '' };
    if (turn.kind === 'clarify') return { role: 'assistant', content: '我向你澄清提问: ' + turn.questions.map((q) => q.question + '(候选: ' + q.options.map((o) => o.label).join('/') + ')').join(' | ') + (turn.answered ? '' : '(等待你的回答)') };
    const summary = '提出改动: ' + turn.diff.items.map((it) => `${it.ref} ${it.label}`).join('; ');
    const outcome = turn.reverted ? '(用户已撤销这些改动,文档未保留它们)' : turn.committed ? `(用户已接受并写入${turn.committedCount ?? turn.diff.items.length}处)` : '(已提出,待用户审阅,尚未确定写入)';
    return { role: 'assistant', content: summary + outcome };
  });
  const KEEP = 12;
  if (proj.length <= KEEP) return proj;
  const dropped = proj.slice(0, proj.length - KEEP);
  const kept = proj.slice(-KEEP);
  const userPts = dropped.filter((m) => m.role === 'user').map((m) => m.content).slice(-6);
  const outcomes = dropped.filter((m) => m.role === 'assistant' && /已接受并写入|已撤销/.test(m.content)).map((m) => m.content).slice(-6);
  const gist = '[此前对话要点] ' + [...userPts, ...outcomes].join(' / ');
  const first = kept[0];
  if (first) kept[0] = { ...first, content: gist + '\n' + first.content };
  return kept;
}

/** Remove refresh-time streaming residue before restoring persisted UI state. */
export function sanitizeThread<Turn extends HistoryTurn>(thread: readonly Turn[]): Turn[] {
  return thread
    .map((turn) => {
      if (turn.role !== 'assistant') return turn;
      const safe = { ...turn } as Turn & { reasoning?: unknown; status?: unknown; streaming?: boolean };
      delete safe.reasoning;
      delete safe.status;
      if (turn.kind === 'answer' && safe.streaming) safe.streaming = false;
      return safe as Turn;
    })
    .filter((turn) => !(turn.role === 'assistant' && turn.kind === 'answer' && !turn.text?.trim()));
}
