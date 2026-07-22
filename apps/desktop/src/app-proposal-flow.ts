import type { AgentStreamStatus } from './app-thread-types.js';

type UserTurn = { role: 'user'; text: string };

type AssistantTurn = {
  role: 'assistant';
  kind: string;
  text?: string;
  status?: AgentStreamStatus;
  streaming?: boolean;
  questions?: unknown[];
};

export type ProposalThreadTurn = UserTurn | AssistantTurn;

function isAnswerTurn(turn: ProposalThreadTurn | undefined): turn is AssistantTurn {
  return turn?.role === 'assistant' && turn.kind === 'answer';
}

export function appendUserTurn<Turn extends ProposalThreadTurn>(thread: readonly Turn[], text: string): Turn[] {
  return [...thread, { role: 'user', text } as Turn];
}

export function appendStreamingAnswerTurn<Turn extends ProposalThreadTurn>(thread: readonly Turn[]): Turn[] {
  return [...thread, { role: 'assistant', kind: 'answer', text: '', status: { phase: 'generating' }, streaming: true } as Turn];
}

export function updateLastAssistantTurn<Turn extends ProposalThreadTurn>(
  thread: readonly Turn[],
  update: (turn: Extract<Turn, { role: 'assistant' }>) => Turn,
): Turn[] {
  return thread.map((turn, index) =>
    index === thread.length - 1 && turn.role === 'assistant'
      ? update(turn as Extract<Turn, { role: 'assistant' }>)
      : turn,
  );
}

export function setStreamStatus<Turn extends ProposalThreadTurn>(thread: readonly Turn[], value: unknown): Turn[] {
  const status = parseStreamStatus(value);
  if (!status) return [...thread];
  return updateLastAssistantTurn(thread, (turn) =>
    isAnswerTurn(turn) ? ({ ...turn, status } as Turn) : turn,
  );
}

export function appendAnswerDelta<Turn extends ProposalThreadTurn>(thread: readonly Turn[], delta = ''): Turn[] {
  return updateLastAssistantTurn(thread, (turn) =>
    isAnswerTurn(turn) ? ({ ...turn, text: (turn.text ?? '') + delta } as Turn) : turn,
  );
}

export function replaceLastWithClarify<Turn extends ProposalThreadTurn, Question>(
  thread: readonly Turn[],
  questions: readonly Question[],
): Turn[] {
  return updateLastAssistantTurn(thread, (turn) => ({
    role: 'assistant',
    kind: 'clarify',
    questions: [...questions],
  } as Turn));
}

export function finalizeLastAnswer<Turn extends ProposalThreadTurn>(thread: readonly Turn[], text?: string): Turn[] {
  return updateLastAssistantTurn(thread, (turn) =>
    isAnswerTurn(turn) ? ({ ...turn, text: text ?? turn.text, status: undefined, streaming: false } as Turn) : turn,
  );
}

export function interruptLastStreamingAnswer<Turn extends ProposalThreadTurn>(
  thread: readonly Turn[],
  message: string,
): Turn[] {
  const last = thread[thread.length - 1];
  if (!isAnswerTurn(last) || !last.streaming) return [...thread];
  return updateLastAssistantTurn(thread, (turn) => {
    if (!isAnswerTurn(turn)) return turn;
    const prefix = turn.text?.trim() ? `${turn.text}\n\n` : '';
    return { ...turn, status: undefined, streaming: false, text: prefix + message } as Turn;
  });
}

function parseStreamStatus(value: unknown): AgentStreamStatus | null {
  if (!value || typeof value !== 'object') return null;
  const status = value as Record<string, unknown>;
  if (status.phase === 'generating' || status.phase === 'checking') return { phase: status.phase };
  if (status.phase === 'reading' && (status.source === 'spreadsheet' || status.source === 'document' || status.source === 'guidance' || status.source === 'context')) {
    return { phase: 'reading', source: status.source };
  }
  if (status.phase === 'repairing'
    && Number.isSafeInteger(status.attempt) && Number(status.attempt) > 0 && Number(status.attempt) <= 100
    && (status.reason === 'truncated_output' || status.reason === 'check_failed')) {
    return { phase: 'repairing', attempt: Number(status.attempt), reason: status.reason };
  }
  if (status.phase === 'ready' && Number.isSafeInteger(status.editCount) && Number(status.editCount) >= 0 && Number(status.editCount) <= 100_000) {
    return { phase: 'ready', editCount: Number(status.editCount) };
  }
  return null;
}
