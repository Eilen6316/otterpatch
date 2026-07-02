/**
 * ReviewBox — the per-turn review card in the agent rail (git-style diff + per-item
 * accept/reject + batch continuation). Extracted verbatim from App.tsx as part of the
 * god-file decomposition; all state stays in App, this component is render + callbacks only.
 */
import type { ReactNode, RefObject } from 'react';
import { useT } from './i18n.js';
import { IconSelect, IconCheck, IconChevron, IconX, IconUndo } from './icons.js';
import type { DiffTurn } from './App.js';
import type { RichDocHandle } from './RichDoc.js';
import { akey, BATCH_RX } from './review-shared.js';

export interface ReviewBoxProps {
  turn: DiffTurn;
  index: number;
  /** This turn is the latest, still-reviewable diff turn. */
  active: boolean;
  reviewIdx: number;
  accepted: Set<string>;
  hoverCid: string | null;
  autoBatch: boolean;
  wordRef: RefObject<RichDocHandle | null>;
  onSetReviewIdx(i: number): void;
  onHoverCid(cid: string | null): void;
  onAccept(idx: number): void;
  onReject(idx: number): void;
  onAcceptAll(): void;
  onRevertTurn(): void;
  onSend(text: string): void;
  onSetAutoBatch(v: boolean): void;
}

export function ReviewBox({ turn, active, reviewIdx, accepted, hoverCid, autoBatch, wordRef, onSetReviewIdx, onHoverCid, onAccept, onReject, onAcceptAll, onRevertTurn, onSend, onSetAutoBatch }: ReviewBoxProps): ReactNode {
  const t = useT();
  const d = turn.diff;
  const total = d.items.length;
  const ridx = Math.min(reviewIdx, total);
  const cur = active && ridx < total ? d.items[ridx] : undefined;
  const badgeText = (b: string): string => (b === 'add' ? t('新增') : b === 'remove' ? t('删除') : b === 'move' ? t('移动') : t('修改'));
  return (
    <div className="reviewbox">
      <div className="rv-top">
        <span className="rv-title"><IconSelect size={13} /> {turn.board ? t('已绘制图表') : t('审阅改动')}</span>
        {d.intent ? <span className="rv-intent">{d.intent}</span> : null}
        <span className="grow" />
        {total > 0 && active && <span className="rv-count">{Math.min(ridx + (cur ? 1 : 0), total)}<i>/</i>{total}</span>}
      </div>
      {total > 0 ? (
        turn.board ? (
          <details className="rv-code">
            <summary>{t('查看绘制代码')} · {total} {t('个对象')}</summary>
            <pre>{d.items.map((it) => `${it.ref}${it.after ? '  ' + it.after : ''}  · ${it.label}`).join('\n')}</pre>
          </details>
        ) : (
          <div className="rv-gitdiff">
            <div className="gd-head">{t('改动 diff')} · {total} {t('处')}</div>
            {d.items.map((it, k) => {
              const o = turn.ops.find((x) => x.editId === it.editId);
              const w = turn.word?.find((x) => x.editId === it.editId);
              const isFmt = !!(it.style || w?.style);
              const refShort = it.ref.replace(/^.*!/, '');
              const oldV = w ? (w.quote || '') : (!it.style && o?.before != null && String(o.before) !== '' ? String(o.before) : '');
              const newV = w ? (w.replacement ?? '') : (it.after ?? '');
              const fmtDesc = it.after || (w?.style ? Object.keys(w.style).join('/') : '') || t('改格式');
              const curHunk = active && k === ridx;
              const acc = accepted.has(akey(d.changeSetId, it.editId));
              const seen = active && k < ridx; // 游标已过 = 已处置,行尾亮出处置结果
              return (
                <div key={it.editId} data-cid={w?.domId} className={'gd-hunk' + (curHunk ? ' cur' : '') + (w && hoverCid && hoverCid === w.domId ? ' is-linked' : '') + (acc ? '' : ' gd-rej')}
                  onMouseEnter={() => { if (w) { onHoverCid(w.domId); wordRef.current?.linkChange(w.domId); } }}
                  onMouseLeave={() => { onHoverCid(null); wordRef.current?.linkChange(null); }}
                  onClick={() => { if (active) onSetReviewIdx(k); if (w) wordRef.current?.activateChange(w.domId); }} title={it.label}>
                  <div className="gd-ref"><span className="gd-at">@@</span> {refShort} <span className="gd-lbl">{it.label}</span>
                    {active ? (
                      <span className="gd-acts" onClick={(e) => e.stopPropagation()}>
                        {seen ? <span className={'gd-state ' + (acc ? 'ok' : 'no')}>{acc ? '✓' : '✕'}</span> : null}
                        <button className="gd-btn no" title={t('拒绝')} aria-label={t('拒绝')} onClick={() => onReject(k)}><IconX size={11} /></button>
                        <button className="gd-btn ok" title={t('接受')} aria-label={t('接受')} onClick={() => onAccept(k)}><IconCheck size={11} /></button>
                      </span>
                    ) : null}
                  </div>
                  {isFmt ? (
                    <div className="gd-line fmt"><span className="gd-sign">~</span>{fmtDesc}{oldV ? <span className="gd-ctx">　「{oldV.length > 42 ? oldV.slice(0, 42) + '…' : oldV}」</span> : null}</div>
                  ) : (<>
                    {oldV ? <div className="gd-line del"><span className="gd-sign">-</span>{oldV}</div> : null}
                    {newV ? <div className="gd-line add"><span className="gd-sign">+</span>{newV}</div> : null}
                  </>)}
                </div>
              );
            })}
          </div>
        )
      ) : null}
      {total > 0 && active && <div className="rv-prog"><div className="rv-prog-fill" style={{ width: `${(ridx / total) * 100}%` }} /></div>}

      {total === 0 ? (
        <div className="rv-empty">{t('Agent 未提出改动')}</div>
      ) : turn.committed ? (
        <div className="rv-final ok"><IconCheck size={15} /> {t('已采纳')}{turn.committedCount ? ` · ${turn.committedCount} ${t('处')}` : ''}<span className="grow" />
          {/* Batch continuation: if the plan declared batches, offer one-click continue + auto-continue. */}
          {BATCH_RX.test(d.intent ?? '') ? (
            <>
              <label className="rv-auto" title={t('接受后自动续发"下一批",每批仍逐条可审')}>
                <input type="checkbox" checked={autoBatch} onChange={(e) => onSetAutoBatch(e.target.checked)} />⚡{t('自动续批')}
              </label>
              <button className="btn solid rv-next" onClick={() => onSend('下一批')}>{t('继续下一批')} ›</button>
            </>
          ) : null}
          <button className="link-btn" onClick={onRevertTurn}>{t('撤销')}</button></div>
      ) : turn.reverted ? (
        <div className="rv-final dim">↩ {t('已撤销')}</div>
      ) : cur ? (
        // 单一交互面:列表里当前行即"审阅卡"(高亮展开),这里只留固定位置的动作条(串行审阅零鼠标位移)
        <div className="rv-acts">
          <button className="rv-step" disabled={ridx <= 0} onClick={() => onSetReviewIdx(Math.max(0, ridx - 1))} title={t('上一处')}><IconChevron size={14} /></button>
          <span className={'rv-badge ' + cur.badge}>{badgeText(cur.badge)}</span>
          <button className="btn no" onClick={() => onReject(ridx)}><IconX size={14} /> {t('拒绝')}</button>
          <button className="btn ok" onClick={() => onAccept(ridx)}><IconCheck size={14} /> {t('接受')}</button>
          <span className="grow" />
          {BATCH_RX.test(d.intent ?? '') ? (
            <label className="rv-auto" title={t('接受后自动续发"下一批",每批仍逐条可审')}>
              <input type="checkbox" checked={autoBatch} onChange={(e) => onSetAutoBatch(e.target.checked)} />⚡{t('自动续批')}
            </label>
          ) : null}
          <button className="btn solid" onClick={onAcceptAll}>{t('全部接受')}{total > 1 ? ` · ${total}` : ''}</button>
        </div>
      ) : active ? (
        <div className="rv-acts done">
          <span className="rv-donen">{t('已逐条过完')} · {d.items.filter((x) => accepted.has(akey(d.changeSetId, x.editId))).length}/{total}</span>
          <span className="grow" />
          <button className="rv-step" onClick={() => onSetReviewIdx(0)} title={t('重看')}><IconUndo size={14} /></button>
          <button className="btn solid" onClick={onAcceptAll}><IconCheck size={14} /> {t('全部接受')}</button>
        </div>
      ) : (
        <div className="rv-final dim">{total} {t('处改动')}<span className="grow" /><button className="link-btn" onClick={onRevertTurn}>↩ {t('撤销改动')}</button></div>
      )}
    </div>
  );
}
