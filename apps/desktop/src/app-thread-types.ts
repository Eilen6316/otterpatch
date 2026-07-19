import type { FileSnapshot } from './file-snapshot.js';
import type { AgentDiff, BoardPatch, GridOp, WordEdit } from './proposal-materializers.js';

export type WorkspaceFormat = 'excel' | 'word' | 'ppt' | 'drawio';

export interface ClarifyOption {
  label: string;
  description?: string;
}

export interface ClarifyQuestion {
  header?: string;
  question: string;
  options: ClarifyOption[];
  multi?: boolean;
}

export interface UserTurn {
  role: 'user';
  text: string;
}

export interface AnswerTurn {
  role: 'assistant';
  kind: 'answer';
  text: string;
  reasoning?: string;
  streaming?: boolean;
}

export interface ClarifyTurn {
  role: 'assistant';
  kind: 'clarify';
  questions: ClarifyQuestion[];
  reasoning?: string;
  answered?: boolean;
  answerText?: string;
}

export interface DiffTurn {
  role: 'assistant';
  kind: 'diff';
  format: WorkspaceFormat;
  fileSnapshot?: FileSnapshot;
  changeSet?: unknown;
  diff: AgentDiff;
  ops: GridOp[];
  board?: BoardPatch;
  word?: WordEdit[];
  text?: string;
  reasoning?: string;
  reverted?: boolean;
  committed?: boolean;
  committedCount?: number;
}

export type AssistantTurn = AnswerTurn | ClarifyTurn | DiffTurn;
export type Turn = UserTurn | AssistantTurn;
