/**
 * DiffToggle — Excel/Word 共享的「改动视图」切换条:标签点 + 进度计数 + 分段滑块 + ‹› 步进 + 附加 chip。
 * 两个工作区用同一交互模型(分段数可变,thumb 按 --dt-n/data-idx 定位),文案统一走 i18n。
 */
import type { ReactNode } from 'react';
import type { CSSProperties } from 'react';
import { useT } from './i18n.js';

export interface DiffSeg<V extends string> { v: V; label: string; title: string }

export function DiffToggle<V extends string>(props: {
  /** 标签文案(中文 key,内部走 t) */
  label: string;
  segs: readonly DiffSeg<V>[];
  active: V;
  /** 步进计数(pos 从 0 起);null/total=0 不显示 */
  count?: { pos: number; total: number } | null;
  onPick(v: V): void;
  onStep?(dir: -1 | 1): void;
  className?: string;
  /** 附加件(如 Word 的全文级改动 chip) */
  children?: ReactNode;
}): ReactNode {
  const t = useT();
  const idx = Math.max(0, props.segs.findIndex((s) => s.v === props.active));
  return (
    <div className={'rd-difftoggle' + (props.className ? ' ' + props.className : '')} role="group" aria-label={t(props.label)}>
      <span className="rd-dt-lb"><span className="rd-dt-dot" />{t(props.label)}</span>
      {props.count && props.count.total > 0 ? (
        <span className="rd-dt-count">{Math.min(props.count.pos + 1, props.count.total)}<i>/</i>{props.count.total}</span>
      ) : null}
      <div className="rd-dt-seg-wrap" data-idx={idx} style={{ '--dt-n': props.segs.length } as CSSProperties}>
        <span className="rd-dt-thumb" />
        {props.segs.map((s) => (
          <button key={s.v} className={'rd-dt-seg' + (props.active === s.v ? ' on' : '')} onMouseDown={(e) => { e.preventDefault(); props.onPick(s.v); }} title={t(s.title)}>{t(s.label)}</button>
        ))}
      </div>
      {props.onStep ? (
        <span className="rd-dt-nav">
          <button className="rd-dt-step" onMouseDown={(e) => { e.preventDefault(); props.onStep!(-1); }} aria-label={t('上一处')} title={t('上一处')}>‹</button>
          <button className="rd-dt-step" onMouseDown={(e) => { e.preventDefault(); props.onStep!(1); }} aria-label={t('下一处')} title={t('下一处')}>›</button>
        </span>
      ) : null}
      {props.children}
    </div>
  );
}
