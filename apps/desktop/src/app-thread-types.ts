import type { FileSnapshot } from './file-snapshot.js';
import type { AgentDiff, BoardPatch, GridOp, WordEdit } from './proposal-materializers.js';
import type { WorkspaceFormat } from './workspace-format.js';

export type { WorkspaceFormat };

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

export type AgentStreamStatus =
  | { phase: 'generating' }
  | { phase: 'reading'; source: 'spreadsheet' | 'document' | 'guidance' | 'context' }
  | { phase: 'checking' }
  | { phase: 'repairing'; attempt: number; reason: 'truncated_output' | 'check_failed' }
  | { phase: 'ready'; editCount: number };

export interface AnswerTurn {
  role: 'assistant';
  kind: 'answer';
  text: string;
  status?: AgentStreamStatus;
  streaming?: boolean;
}

export interface ClarifyTurn {
  role: 'assistant';
  kind: 'clarify';
  questions: ClarifyQuestion[];
  answered?: boolean;
  answerText?: string;
}

export interface DiffTurn {
  role: 'assistant';
  kind: 'diff';
  format: WorkspaceFormat;
  fileSnapshot?: FileSnapshot;
  changeSet?: unknown;
  proposal?: unknown;
  diff: AgentDiff;
  ops: GridOp[];
  board?: BoardPatch;
  word?: WordEdit[];
  text?: string;
  reverted?: boolean;
  committed?: boolean;
  committedCount?: number;
}

export type AssistantTurn = AnswerTurn | ClarifyTurn | DiffTurn;
export type Turn = UserTurn | AssistantTurn;
