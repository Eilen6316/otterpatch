import type { ReactNode } from 'react';
import { DiffToggle } from './DiffToggle.js';
import { useT } from './i18n.js';

export type RichDocDiffView = 'orig' | 'mark' | 'clean' | 'final';

export interface RichDocDocumentChange {
  cid: string;
  label: string;
}

export interface RichDocNavigationItem {
  level: number;
  text: string;
  idx: number;
}

export interface RichDocWordCount {
  chars: number;
  noSpace: number;
  cjk: number;
  words: number;
  paras: number;
}

export interface RichDocHoverCardState {
  cid: string;
  kind: string;
  oldText: string;
  newText: string;
  glyph: string;
  x: number;
  y: number;
  below: boolean;
}

export function RichDocRevisionBar({
  visible,
  active,
  changeCount,
  stepPosition,
  documentChanges,
  linkedChangeId,
  onPick,
  onStep,
  onResolve,
}: {
  visible: boolean;
  active: RichDocDiffView;
  changeCount: number;
  stepPosition: number;
  documentChanges: RichDocDocumentChange[];
  linkedChangeId: string | null;
  onPick: (view: RichDocDiffView) => void;
  onStep: (direction: number) => void;
  onResolve: (changeId: string, verb: 'accept' | 'reject') => void;
}): ReactNode {
  if (!visible) return null;
  return (
    <DiffToggle<RichDocDiffView>
      label="Agent 修订"
      segs={[
        { v: 'orig', label: '原文', title: '只看改前' },
        { v: 'mark', label: '修订', title: '红删绿增对照' },
        { v: 'clean', label: '清样', title: '清样:只留改后 + 左侧改动条' },
        { v: 'final', label: '改后', title: '只看改后' },
      ] as const}
      active={active}
      count={changeCount > 0 ? { pos: stepPosition, total: changeCount } : null}
      onPick={onPick}
      onStep={onStep}
    >
      {documentChanges.map((change) => (
        <span key={change.cid} className={'rd-dt-docchg' + (linkedChangeId === change.cid ? ' is-linked' : '')} title={'全文/版面改动:' + change.label}>
          <span className="rd-dt-docchg-glyph">¶</span>
          <span className="rd-dt-docchg-lb">{change.label}</span>
          <button className="rd-dt-docchg-btn no" onMouseDown={(event) => { event.preventDefault(); onResolve(change.cid, 'reject'); }} aria-label="拒绝该全文改动" title="拒绝">✕</button>
          <button className="rd-dt-docchg-btn ok" onMouseDown={(event) => { event.preventDefault(); onResolve(change.cid, 'accept'); }} aria-label="接受该全文改动" title="接受">✓</button>
        </span>
      ))}
    </DiffToggle>
  );
}

export function RichDocNavigationPane({ items, onNavigate }: { items: RichDocNavigationItem[]; onNavigate: (index: number) => void }): ReactNode {
  const t = useT();
  return (
    <aside className="rd-nav">
      <div className="rd-nav-h">{t('导航')}</div>
      <div className="rd-nav-list">
        {items.length === 0
          ? <div className="rd-nav-empty">{t('暂无标题')}</div>
          : items.map((item) => <button key={item.idx} className={'rd-nav-i lv' + item.level} onClick={() => onNavigate(item.idx)}>{item.text}</button>)}
      </div>
    </aside>
  );
}

export function RichDocWordCountDialog({ count, onClose }: { count: RichDocWordCount | null; onClose: () => void }): ReactNode {
  const t = useT();
  if (!count) return null;
  const rows = [
    ['页数', '1'],
    ['字数', String(count.words)],
    ['字符数(不计空格)', String(count.noSpace)],
    ['字符数(计空格)', String(count.chars)],
    ['中文字符', String(count.cjk)],
    ['段落数', String(count.paras)],
  ];
  return (
    <>
      <div className="drop-backdrop" onMouseDown={onClose} />
      <div className="rd-wc">
        <div className="rd-wc-h">{t('字数统计')}</div>
        {rows.map(([label, value]) => <div className="rd-wc-row" key={label}><span>{t(label!)}</span><b>{value}</b></div>)}
        <button className="rd-wc-close" onMouseDown={(event) => { event.preventDefault(); onClose(); }}>{t('关闭')}</button>
      </div>
    </>
  );
}

export function RichDocChangeCard({
  card,
  onKeep,
  onClose,
  onResolve,
}: {
  card: RichDocHoverCardState | null;
  onKeep: () => void;
  onClose: () => void;
  onResolve: (changeId: string, verb: 'accept' | 'reject') => void;
}): ReactNode {
  if (!card) return null;
  const kindLabel = ({ replace: '替换', insert: '插入', delete: '删除', format: '改格式' } as Record<string, string>)[card.kind] ?? '改动';
  return (
    <div className={'rd-cardwrap' + (card.below ? ' below' : '')} style={{ left: card.x, top: card.y }} onMouseEnter={onKeep} onMouseLeave={onClose}>
      <div className="rd-card">
        <div className="rd-card-h"><span className="rd-card-dot" /><span className="rd-card-kind">{kindLabel}</span></div>
        {card.kind === 'format'
          ? <div className="rd-card-fmt"><span className="rd-fmt-chip">{card.glyph}</span>{card.newText}</div>
          : <div className="rd-card-diff">{card.oldText ? <span className="rd-card-old">{card.oldText}</span> : null}{card.oldText && card.newText ? <span className="rd-card-arw">→</span> : null}{card.newText ? <span className="rd-card-new">{card.newText}</span> : null}</div>}
        <div className="rd-card-acts">
          <button className="rd-cbtn no" onMouseDown={(event) => { event.preventDefault(); onResolve(card.cid, 'reject'); }}>✕ 拒绝</button>
          <button className="rd-cbtn ok" onMouseDown={(event) => { event.preventDefault(); onResolve(card.cid, 'accept'); }}>✓ 接受</button>
        </div>
      </div>
    </div>
  );
}
