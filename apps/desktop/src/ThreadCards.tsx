/**
 * ThreadCards — self-contained cards used inside the agent conversation thread:
 * ThinkingPanel (collapsible reasoning stream) and ClarifyCard (guided-choice clarify form).
 * Extracted from App.tsx (decomposition phase 5); each owns only its local UI state.
 */
import { useState } from 'react';
import type { ReactNode } from 'react';
import { useT } from './i18n.js';
import { IconSelect } from './icons.js';

export interface ClarifyOption { label: string; description?: string }
export interface ClarifyQuestion { header?: string; question: string; options: ClarifyOption[]; multi?: boolean }

/** DeepSeek-style collapsible "thinking" panel: expanded while streaming, collapsible after. */
export function ThinkingPanel({ reasoning, streaming }: { reasoning: string; streaming?: boolean }): ReactNode {
  const t = useT();
  const [open, setOpen] = useState<boolean | null>(null);
  const expanded = open ?? !!streaming;
  return (
    <div className={'thinking-panel' + (streaming ? ' live' : '')}>
      <button className="tp-head" onClick={() => setOpen(!expanded)}>
        <span className="tp-ico">{streaming ? <span className="spin sm" /> : '💭'}</span>
        <span>{streaming ? t('正在思考…') : t('思考过程')}</span>
        <span className="grow" />
        <span className="tp-chev">{expanded ? '▾' : '▸'}</span>
      </button>
      {expanded && <div className="tp-body">{reasoning || t('(无)')}</div>}
    </div>
  );
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
