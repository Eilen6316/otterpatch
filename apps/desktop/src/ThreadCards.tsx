/**
 * ThreadCards — self-contained cards used inside the agent conversation thread:
 * AgentStatusLine (bounded public progress) and ClarifyCard (guided-choice clarify form).
 * Extracted from App.tsx (decomposition phase 5); each owns only its local UI state.
 */
import { useState } from 'react';
import type { ReactNode } from 'react';
import type { AgentStreamStatus, ClarifyQuestion } from './app-thread-types.js';
import { useT } from './i18n.js';
import { IconSelect } from './icons.js';

export type { ClarifyOption, ClarifyQuestion } from './app-thread-types.js';

/** Render only locally-authored labels for the bounded status protocol. */
export function AgentStatusLine({ status }: { status: AgentStreamStatus }): ReactNode {
  const t = useT();
  const label = statusLabel(status, t);
  return (
    <div className="agent-status" role="status" aria-live="polite">
      <span className="spin sm" />
      <span>{label}</span>
    </div>
  );
}

function statusLabel(status: AgentStreamStatus, t: ReturnType<typeof useT>): string {
  if (status.phase === 'generating') return t('正在生成回复');
  if (status.phase === 'checking') return t('正在检查提案');
  if (status.phase === 'ready') return `${t('已生成可审阅改动')}: ${status.editCount}`;
  if (status.phase === 'repairing') {
    const action = status.reason === 'truncated_output' ? t('正在重新生成截断的提案') : t('正在修复未通过检查的提案');
    return `${action} (${status.attempt})`;
  }
  if (status.source === 'spreadsheet') return t('正在读取数据范围');
  if (status.source === 'document') return t('正在读取文档内容');
  if (status.source === 'guidance') return t('正在读取任务规范');
  return t('正在读取所需上下文');
}

/** The agent's reverse-clarify card (Claude Code style): options per question (single/multi)
 *  plus a free-text "other"; submits once every question has an answer. */
export function ClarifyCard({ questions, answered, answerText, onSubmit }: { questions: ClarifyQuestion[]; answered?: boolean; answerText?: string; onSubmit: (text: string) => void }): ReactNode {
  const t = useT();
  const [sel, setSel] = useState<Record<number, string[]>>({});
  const [other, setOther] = useState<Record<number, string>>({});
  const pick = (qi: number, label: string, multi?: boolean): void => {
    setSel((s) => {
      const cur = s[qi] ?? [];
      if (multi) return { ...s, [qi]: cur.includes(label) ? cur.filter((x) => x !== label) : [...cur, label] };
      return { ...s, [qi]: cur.includes(label) ? [] : [label] };
    });
  };
  const doneCount = questions.filter((_, qi) => (sel[qi]?.length ?? 0) > 0 || !!other[qi]?.trim()).length;
  const ready = doneCount === questions.length;
  const submit = (): void => {
    if (!ready) return;
    const lines = questions.map((q, qi) => {
      const picks = [...(sel[qi] ?? [])];
      const o = other[qi]?.trim();
      if (o) picks.push(o);
      return `- ${q.header || q.question}:${picks.join('、')}`;
    });
    onSubmit(t('我的选择如下,请据此继续:') + '\n' + lines.join('\n'));
  };
  if (answered) {
    return (
      <div className="clarify done">
        <div className="cl-top"><IconSelect size={13} /> {t('已回复澄清')}</div>
        {answerText ? <div className="cl-recap">{answerText}</div> : null}
      </div>
    );
  }
  return (
    <div className="clarify">
      <div className="cl-top"><IconSelect size={13} /> {t('需要你确认一下')}</div>
      {questions.map((q, qi) => (
        <div key={qi} className="cl-q">
          <div className="cl-qhead">{q.header ? <span className="cl-tag">{q.header}</span> : null}<span className="cl-qtext">{q.question}</span>{q.multi ? <span className="cl-multi">{t('可多选')}</span> : null}</div>
          <div className="cl-opts">
            {q.options.map((o, oi) => {
              const on = (sel[qi] ?? []).includes(o.label);
              return (
                <button key={oi} className={'cl-opt' + (on ? ' on' : '')} onClick={() => pick(qi, o.label, q.multi)}>
                  <span className="cl-optlabel">{o.label}{oi === 0 ? <i className="cl-rec">{t('推荐')}</i> : null}</span>
                  {o.description ? <span className="cl-optdesc">{o.description}</span> : null}
                </button>
              );
            })}
          </div>
          <input className="cl-other" placeholder={t('或自己填…')} value={other[qi] ?? ''} onChange={(ev) => setOther((s) => ({ ...s, [qi]: ev.target.value }))} onKeyDown={(ev) => { if (ev.key === 'Enter' && ready) submit(); }} />
        </div>
      ))}
      <div className="cl-acts">
        <span className="cl-prog">{doneCount}/{questions.length}</span>
        <span className="grow" />
        <button className="btn solid" disabled={!ready} onClick={submit}>{t('提交')}</button>
      </div>
    </div>
  );
}
