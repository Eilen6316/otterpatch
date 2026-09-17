import { useState } from 'react';
import type { ReactNode } from 'react';
import { IconCheck } from './icons.js';
import { useT } from './i18n.js';
import type { TextCaseMode } from './richdoc-text-case.js';

export const FONTS = ['宋体', '黑体', '微软雅黑', '楷体', '仿宋', '等线', 'Arial', 'Times New Roman', 'Calibri', 'Georgia'];
export const SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 22, 26, 28, 36, 48, 72];
export const LINE_SPACINGS = ['1.0', '1.15', '1.5', '2.0', '2.5', '3.0'];
export const HILITES = ['#ffe600', '#a6ff00', '#00ffff', '#ff66cc', '#63d2ff', '#ffaa00', '#ff5555', '#c9c9c9'];
export const COLORS = [
  '#000000', '#404040', '#7f7f7f', '#bfbfbf', '#ffffff', '#c00000', '#ff0000', '#ffc000', '#ffff00', '#92d050', '#00b050',
  '#00b0f0', '#0070c0', '#002060', '#7030a0', '#e7492e', '#f0a500', '#2563eb', '#1a7f37', '#8b5cf6', '#0891b2',
];
export const CASES: [string, TextCaseMode][] = [['句首字母大写', 'sentence'], ['全部小写', 'lower'], ['全部大写', 'upper'], ['每个单词首字母大写', 'title'], ['切换大小写', 'toggle']];
export const EFFECTS: [string, Partial<CSSStyleDeclaration>][] = [
  ['无', {}],
  ['阴影', { textShadow: '1px 1px 2px rgba(0,0,0,.45)' }],
  ['发光', { textShadow: '0 0 6px #2563eb' }],
  ['描边', { WebkitTextStroke: '1px #2563eb', color: 'transparent' } as Partial<CSSStyleDeclaration>],
  ['渐变填充', { background: 'linear-gradient(90deg,#2563eb,#8b5cf6)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' } as Partial<CSSStyleDeclaration>],
];
export const CN_LAYOUTS: [string, string][] = [['带圈字符', 'enclose'], ['双行合一', 'twolines'], ['字符缩放 80%', 'scale80'], ['字符缩放 150%', 'scale150']];
export const BORDERS: [string, string][] = [['无框线', 'none'], ['所有框线', 'all'], ['外侧框线', 'all'], ['上框线', 'top'], ['下框线', 'bottom'], ['左框线', 'left'], ['右框线', 'right']];
export const MARGINS: [string, string, string][] = [['普通', '64px 72px', '上下 2.54 · 左右 3.18 cm'], ['窄', '24px 30px', '上下 1.27 · 左右 1.27 cm'], ['适中', '48px 60px', '上下 2.54 · 左右 1.91 cm'], ['宽', '96px 120px', '上下 2.54 · 左右 5.08 cm']];
export const PAPERS: Record<string, [number, number]> = { A4: [794, 1123], Letter: [816, 1056], Legal: [816, 1344], A5: [559, 794], A3: [1123, 1587] };
export const COLUMNS: [string, number][] = [['一栏', 1], ['两栏', 2], ['三栏', 3]];
export const ZOOMS = [50, 75, 100, 125, 150, 200];

export const DATE_FMTS = (): [string, string][] => {
  const date = new Date();
  const pad = (value: number): string => String(value).padStart(2, '0');
  const weekday = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'][date.getDay()] ?? '';
  return [
    [`${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())}`, `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())}`],
    [`${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`, `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`],
    [`${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${weekday}`, `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${weekday}`],
    [`${pad(date.getHours())}:${pad(date.getMinutes())}`, `${pad(date.getHours())}:${pad(date.getMinutes())}`],
  ];
};

export const SYMBOLS: Record<string, string[]> = {
  常用: ['—', '–', '·', '…', '、', '。', '“', '”', '‘', '’', '《', '》', '〈', '〉', '「', '」', '『', '』', '【', '】', '§', '¶', '№', '℃', '℉', '™', '©', '®'],
  数学: ['±', '×', '÷', '≠', '≈', '≤', '≥', '∞', '∑', '∏', '∫', '√', '∂', '∆', '∇', 'π', '∈', '∉', '⊂', '⊃', '∪', '∩', '∀', '∃', '°', '′', '″', '‰'],
  货币: ['¥', '$', '€', '£', '¢', '₩', '₫', '₽', '₹', '฿', '₺', '₴'],
  希腊: ['α', 'β', 'γ', 'δ', 'ε', 'ζ', 'η', 'θ', 'λ', 'μ', 'ξ', 'π', 'ρ', 'σ', 'τ', 'φ', 'χ', 'ψ', 'ω', 'Γ', 'Δ', 'Θ', 'Λ', 'Ξ', 'Π', 'Σ', 'Φ', 'Ω'],
  箭头: ['←', '→', '↑', '↓', '↔', '↕', '⇐', '⇒', '⇑', '⇓', '⇔', '➜', '▶', '◀', '▲', '▼', '★', '☆', '✦', '✓', '✗', '●', '○', '◆', '◇', '■', '□', '♠'],
};
export const EQUATIONS = ['a² + b² = c²', '(a + b)² = a² + 2ab + b²', 'E = mc²', 'x = (−b ± √(b² − 4ac)) / 2a', 'a/b', '√x', '∑ᵢ₌₁ⁿ xᵢ', '∫ f(x) dx', 'lim (x→∞)', 'π ≈ 3.14159'];
export const SHAPES: [string, string][] = [
  ['矩形', '<rect x="4" y="10" width="112" height="60" rx="4"/>'],
  ['圆角矩形', '<rect x="4" y="10" width="112" height="60" rx="16"/>'],
  ['椭圆', '<ellipse cx="60" cy="40" rx="56" ry="30"/>'],
  ['三角形', '<path d="M60 8 L114 72 L6 72 Z"/>'],
  ['直线', '<path d="M6 40 L114 40"/>'],
  ['箭头', '<path d="M6 40 L104 40 M88 26 L114 40 L88 54"/>'],
];
export const WORDARTS = ['rd-wa-1', 'rd-wa-2', 'rd-wa-3', 'rd-wa-4'];

export interface RichDocMenuItemProps {
  label: string;
  sub?: string;
  onPick: () => void;
  check?: boolean;
  onClose: () => void;
}

export function RichDocMenuItem({ label, sub, onPick, check, onClose }: RichDocMenuItemProps): ReactNode {
  const t = useT();
  return (
    <button className="drop-item" onMouseDown={(event) => { event.preventDefault(); onPick(); onClose(); }}>
      {check ? <IconCheck size={13} /> : null}<span>{t(label)}</span>{sub ? <em className="di-sub">{sub}</em> : null}
    </button>
  );
}

export function RichDocTableGrid({ onPick, onMore }: { onPick: (rows: number, columns: number) => void; onMore: () => void }): ReactNode {
  const t = useT();
  const [hot, setHot] = useState<[number, number]>([0, 0]);
  const rows = 8;
  const columns = 10;
  return (
    <div>
      <div className="rd-tgrid" onMouseLeave={() => setHot([0, 0])}>
        {Array.from({ length: rows * columns }, (_, index) => {
          const row = Math.floor(index / columns) + 1;
          const column = (index % columns) + 1;
          const active = row <= hot[0] && column <= hot[1];
          return <i key={index} className={active ? 'hot' : ''} onMouseEnter={() => setHot([row, column])} onMouseDown={(event) => { event.preventDefault(); onPick(row, column); }} />;
        })}
      </div>
      <div className="rd-tgrid-cap">{hot[0] ? `${hot[1]} × ${hot[0]} ${t('表格')}` : t('插入表格')}</div>
      <div className="drop-list"><button className="drop-item drop-sec" onMouseDown={(event) => { event.preventDefault(); onMore(); }}>{t('插入表格…')}</button></div>
    </div>
  );
}

export function RichDocSymbolGrid({ sets, onPick }: { sets: Record<string, string[]>; onPick: (character: string) => void }): ReactNode {
  const t = useT();
  const keys = Object.keys(sets);
  const [category, setCategory] = useState(keys[0] ?? '');
  return (
    <div>
      <div className="rd-symtabs">{keys.map((key) => <button key={key} className={'rd-symtab' + (key === category ? ' on' : '')} onMouseDown={(event) => { event.preventDefault(); setCategory(key); }}>{t(key)}</button>)}</div>
      <div className="rd-symgrid">{(sets[category] ?? []).map((character, index) => <button key={character + index} onMouseDown={(event) => { event.preventDefault(); onPick(character); }}>{character}</button>)}</div>
    </div>
  );
}
