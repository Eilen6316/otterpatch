import { useState } from 'react';
import { useT } from './i18n.js';
import { FUNC_ICONS, IconPlus, IconSearch, IconUndo } from './icons.js';
import { shapeSvg, SHAPE_DEFS } from './shape-engine.js';

export type OnOpen = (item: string, element: HTMLElement) => void;
export type PaletteCategory = 'general' | 'flow' | 'arrows' | 'icons';

const DRAWIO_TOOLS = ['选择', '添加节点', '连线', '文本', '自由绘制', '填充色', '线条', '圆角', '阴影', '形状'];
const PALETTE_CATEGORIES: Array<{ key: PaletteCategory; label: string }> = [
  { key: 'general', label: '通用' },
  { key: 'flow', label: '流程图' },
  { key: 'arrows', label: '箭头' },
  { key: 'icons', label: '图标' },
];

export function filterPaletteShapes(category: PaletteCategory, query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  return SHAPE_DEFS.filter((shape) => shape.cat === category && (
    !normalizedQuery
    || shape.name.includes(query.trim())
    || shape.kind.toLowerCase().includes(normalizedQuery)
  ));
}

export function DrawioToolbar({ onAct }: { onAct: OnOpen }) {
  const t = useT();
  return (
    <div className="dtoolbar">
      <button className="dtool" title={t('撤销')} onClick={(event) => onAct('撤销', event.currentTarget)}><IconUndo size={16} /></button>
      <span className="dsep" />
      {DRAWIO_TOOLS.map((item) => {
        const Icon = FUNC_ICONS[item];
        const accent = item === '填充色' ? ' ic-amber' : '';
        return (
          <button key={item} className={'dtool' + accent} title={t(item)} onClick={(event) => onAct(item, event.currentTarget)}>
            {Icon ? <Icon size={16} /> : item.slice(0, 1)}
          </button>
        );
      })}
      <span className="grow" />
      <span className="dzoom"><IconSearch size={13} /> 100%</span>
    </div>
  );
}

export function DrawioPalette({ onPick }: { onPick: (shape: string) => void }) {
  const t = useT();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<Record<PaletteCategory, boolean>>({ general: true, flow: true, arrows: false, icons: false });
  const trimmedQuery = query.trim();
  return (
    <aside className="palette">
      <div className="pal-search">
        <IconSearch size={13} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('搜索形状')} />
      </div>
      <div className="pal-cat">
        <div className="pal-cat-h">{t('便笺本')}</div>
        <div className="pal-scratch">{t('把元素拖至此处')}</div>
      </div>
      {PALETTE_CATEGORIES.map((category) => {
        const shapes = filterPaletteShapes(category.key, trimmedQuery);
        const isOpen = trimmedQuery ? shapes.length > 0 : open[category.key];
        if (trimmedQuery && shapes.length === 0) return null;
        return (
          <div className="pal-cat" key={category.key}>
            <button className="pal-cat-h click" onClick={() => setOpen((current) => ({ ...current, [category.key]: !current[category.key] }))}>
              <span className={'tri' + (isOpen ? ' open' : '')}>▸</span> {t(category.label)}
              <span className="pal-n">{shapes.length}</span>
            </button>
            {isOpen && (
              <div className="pal-grid">
                {shapes.map((shape) => (
                  <button
                    key={shape.kind}
                    className="pal-shape"
                    title={shape.name}
                    draggable
                    onDragStart={(event) => event.dataTransfer.setData('otterpatch/shape', JSON.stringify({ name: shape.name, shape: shape.kind }))}
                    onClick={() => onPick(shape.name)}
                  >
                    <svg viewBox="0 0 40 30" fill="none" stroke="currentColor" strokeWidth={1.2} dangerouslySetInnerHTML={{ __html: shapeSvg(shape.kind, 40, 30) }} />
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
      <button className="pal-more"><IconPlus size={13} /> {t('更多图形')}</button>
    </aside>
  );
}
