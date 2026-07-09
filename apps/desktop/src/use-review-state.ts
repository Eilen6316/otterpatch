import type { Dispatch, SetStateAction } from 'react';

interface ReviewThreadTurn {
  role: string;
  kind?: string;
}

export interface UseReviewStateOptions<Turn extends ReviewThreadTurn> {
  setThread: Dispatch<SetStateAction<Turn[]>>;
  setAccepted: Dispatch<SetStateAction<Set<string>>>;
}

export interface UseReviewStateResult {
  clearAccepted: () => void;
  toggleAccept: (id: string, on: boolean) => void;
  markCommitted: (index: number, count: number) => void;
  markReverted: (index: number) => void;
  markClarifyAnswered: (index: number, answerText: string) => void;
}

export function useReviewState<Turn extends ReviewThreadTurn>({
  setThread,
  setAccepted,
}: UseReviewStateOptions<Turn>): UseReviewStateResult {
  const clearAccepted = (): void => {
    setAccepted(new Set());
  };

  const toggleAccept = (id: string, on: boolean): void => {
    setAccepted((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const markCommitted = (index: number, count: number): void => {
    setThread((thread) =>
      thread.map((turn, i) =>
        i === index && turn.role === 'assistant' && turn.kind === 'diff'
          ? ({ ...turn, committed: true, committedCount: count } as Turn)
          : turn,
      ),
    );
  };

  const markReverted = (index: number): void => {
    setThread((thread) => thread.map((turn, i) => (i === index ? ({ ...turn, reverted: true } as Turn) : turn)));
  };

  const markClarifyAnswered = (index: number, answerText: string): void => {
    setThread((thread) =>
      thread.map((turn, i) =>
        i === index && turn.role === 'assistant' && turn.kind === 'clarify'
          ? ({ ...turn, answered: true, answerText } as Turn)
          : turn,
      ),
    );
  };

  return { clearAccepted, toggleAccept, markCommitted, markReverted, markClarifyAnswered };
}
