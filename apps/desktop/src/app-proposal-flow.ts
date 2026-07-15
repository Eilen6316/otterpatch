type UserTurn = { role: 'user'; text: string };

type AssistantTurn = {
  role: 'assistant';
  kind: string;
  text?: string;
  reasoning?: string;
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
  return [...thread, { role: 'assistant', kind: 'answer', text: '', reasoning: '', streaming: true } as Turn];
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

export function appendReasoningDelta<Turn extends ProposalThreadTurn>(thread: readonly Turn[], delta = ''): Turn[] {
  return updateLastAssistantTurn(thread, (turn) =>
    isAnswerTurn(turn) ? ({ ...turn, reasoning: (turn.reasoning ?? '') + delta } as Turn) : turn,
  );
}

export function appendAnswerDelta<Turn extends ProposalThreadTurn>(thread: readonly Turn[], delta = ''): Turn[] {
  return updateLastAssistantTurn(thread, (turn) =>
    isAnswerTurn(turn) ? ({ ...turn, text: (turn.text ?? '') + delta } as Turn) : turn,
  );
}

export function appendToolReasoning<Turn extends ProposalThreadTurn>(thread: readonly Turn[], name?: string): Turn[] {
  return appendReasoningDelta(thread, `\n〔查表 ${name ?? ''}〕\n`);
}

export function replaceLastWithClarify<Turn extends ProposalThreadTurn, Question>(
  thread: readonly Turn[],
  questions: readonly Question[],
): Turn[] {
  return updateLastAssistantTurn(thread, (turn) => ({
    role: 'assistant',
    kind: 'clarify',
    questions: [...questions],
    reasoning: isAnswerTurn(turn) ? turn.reasoning : undefined,
  } as Turn));
}

export function finalizeLastAnswer<Turn extends ProposalThreadTurn>(thread: readonly Turn[], text?: string): Turn[] {
  return updateLastAssistantTurn(thread, (turn) =>
    isAnswerTurn(turn) ? ({ ...turn, text: text ?? turn.text, streaming: false } as Turn) : turn,
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
    return { ...turn, streaming: false, text: prefix + message } as Turn;
  });
}
