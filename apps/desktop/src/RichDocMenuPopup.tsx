import type { ReactNode } from 'react';
import { useT } from './i18n.js';
import {
  BORDERS,
  CASES,
  CN_LAYOUTS,
  COLORS,
  COLUMNS,
  DATE_FMTS,
  EFFECTS,
  EQUATIONS,
  FONTS,
  HILITES,
  LINE_SPACINGS,
  MARGINS,
  PAPERS,
  RichDocMenuItem,
  RichDocSymbolGrid,
  RichDocTableGrid,
  SHAPES,
  SIZES,
  SYMBOLS,
  WORDARTS,
  ZOOMS,
} from './RichDocMenus.js';
import type { RichDocMenuItemProps } from './RichDocMenus.js';
import type { RichDocPageState } from './richdoc-page-state.js';

export interface RichDocMenuActions {
  paste: (mode: 'rich' | 'merge' | 'text') => void | Promise<void>;
  setFont: (font: string) => void;
  setSize: (size: string) => void;
  changeCase: (mode: string) => void;
  exec: (command: string, value?: string) => void;
  wrapSelection: (mutate: (element: HTMLElement) => void, className?: string) => void;
  applyColor: (kind: 'foreground' | 'highlight' | 'shade', color: string) => void;
  insertEnclosed: () => void;
  sortBlocks: (direction: number) => void;
  setLineSpacing: (value: string) => void;
  styleBlocks: (mutate: (element: HTMLElement) => void) => void;
  findNext: (term: string) => void;
  findReplace: () => void;
  clearSelection: () => void;
  insertCover: (variant: string) => void;
  insertTable: (rows: number, columns: number) => void;
  insertTablePrompt: () => void;
  insertShape: (svg: string) => void;
  insertText: (text: string) => void;
  insertHTML: (html: string) => void;
  insertPageNumber: (position: 'footer-center' | 'footer-right' | 'header-right') => void;
  insertWordArt: (className: string) => void;
  dropCap: (mode: string) => void;
  updatePage: (patch: Partial<RichDocPageState>) => void;
  setGridPaper: (mode: 'squares' | 'lines' | 'none') => void;
  arrangeImage: (mutate: (element: HTMLElement) => void) => void;
  ungroupSelection: () => void;
  rotateImage: (kind: 'right' | 'left' | 'flipH' | 'flipV') => void;
  buildToc: () => void;
  updateToc: () => void;
  notify: (message: string) => void;
  fitZoom: (mode: 'page' | 'width') => void;
  run: (label: string) => void;
}

export interface RichDocMenuPopupProps {
  menuKey: string;
  page: RichDocPageState;
  actions: RichDocMenuActions;
  onClose: () => void;
}

export function RichDocMenuPopup({ menuKey, page, actions, onClose }: RichDocMenuPopupProps): ReactNode {
  const t = useT();
  const PopItem = (props: Omit<RichDocMenuItemProps, 'onClose'>): ReactNode => <RichDocMenuItem {...props} onClose={onClose} />;
  const closeAfter = (run: () => void): void => { run(); onClose(); };

  switch (menuKey) {
    case '粘贴': return <div className="drop-list">
      <PopItem label="保留源格式粘贴" onPick={() => void actions.paste('rich')} />
      <PopItem label="合并格式" onPick={() => void actions.paste('merge')} />
      <PopItem label="只保留文本" onPick={() => void actions.paste('text')} />
    </div>;
    case '字体': return <div className="drop-list">{FONTS.map((font) => <button key={font} className="drop-item" style={{ fontFamily: font }} onMouseDown={(event) => { event.preventDefault(); closeAfter(() => actions.setFont(font)); }}>{font}</button>)}</div>;
    case '字号': return <div className="drop-list">{SIZES.map((size) => <PopItem key={size} label={String(size)} onPick={() => actions.setSize(String(size))} />)}</div>;
    case '更改大小写': return <div className="drop-list">{CASES.map(([label, mode]) => <PopItem key={mode} label={label} onPick={() => actions.changeCase(mode)} />)}</div>;
    case '文本效果': return <div className="drop-list">{EFFECTS.map(([label, style]) => <button key={label} className="drop-item" onMouseDown={(event) => { event.preventDefault(); closeAfter(() => label === '无' ? actions.exec('removeFormat') : actions.wrapSelection((element) => Object.assign(element.style, style))); }}>{t(label)}</button>)}</div>;
    case '突出显示':
    case '底纹':
    case '字体颜色': {
      const kind = menuKey === '字体颜色' ? 'foreground' : menuKey === '底纹' ? 'shade' : 'highlight';
      const palette = menuKey === '突出显示' ? HILITES : COLORS;
      const apply = (color: string): void => actions.applyColor(kind, color);
      return <div>
        <div className="drop-colors">{palette.map((color) => <button key={color} className="swatch" style={{ background: color }} title={color} onMouseDown={(event) => { event.preventDefault(); closeAfter(() => apply(color)); }} />)}</div>
        <div className="drop-list">
          <PopItem label={kind === 'shade' ? '无填充' : '无颜色'} onPick={() => apply('transparent')} />
          {kind === 'foreground' ? <label className="drop-item drop-sec" onMouseDown={(event) => event.preventDefault()}>{t('更多颜色…')}<input type="color" style={{ marginLeft: 8 }} onChange={(event) => closeAfter(() => apply(event.target.value))} /></label> : null}
        </div>
      </div>;
    }
    case '多级列表': return <div className="drop-list"><PopItem label="转为编号列表" onPick={() => actions.exec('insertOrderedList')} /><PopItem label="增加一级(缩进)" onPick={() => actions.exec('indent')} /><PopItem label="减少一级" onPick={() => actions.exec('outdent')} /></div>;
    case '中文版式': return <div className="drop-list">{CN_LAYOUTS.map(([label, mode]) => <PopItem key={mode} label={label} onPick={() => {
      if (mode === 'enclose') actions.insertEnclosed();
      else if (mode === 'twolines') actions.wrapSelection((element) => { element.style.display = 'inline-block'; element.style.lineHeight = '1'; element.style.fontSize = '.6em'; element.style.whiteSpace = 'pre-line'; });
      else actions.wrapSelection((element) => { element.style.display = 'inline-block'; element.style.transform = `scaleX(${mode === 'scale80' ? 0.8 : 1.5})`; });
    }} />)}</div>;
    case '排序': return <div className="drop-list"><PopItem label="升序" onPick={() => actions.sortBlocks(1)} /><PopItem label="降序" onPick={() => actions.sortBlocks(-1)} /></div>;
    case '行距': return <div className="drop-list">{LINE_SPACINGS.map((value) => <PopItem key={value} label={value} onPick={() => actions.setLineSpacing(value)} />)}<div className="drop-sec"><PopItem label="增加段前间距" onPick={() => actions.styleBlocks((element) => { element.style.marginTop = (parseFloat(element.style.marginTop || '0') + 6) + 'pt'; })} /><PopItem label="增加段后间距" onPick={() => actions.styleBlocks((element) => { element.style.marginBottom = (parseFloat(element.style.marginBottom || '0') + 6) + 'pt'; })} /></div></div>;
    case '边框': return <div className="drop-list">{BORDERS.map(([label, side]) => <PopItem key={label} label={label} onPick={() => actions.styleBlocks((element) => {
      element.style.border = ''; element.style.borderTop = element.style.borderBottom = element.style.borderLeft = element.style.borderRight = '';
      const border = '1px solid #333';
      if (side === 'all') element.style.border = border;
      else if (side === 'top') element.style.borderTop = border;
      else if (side === 'bottom') element.style.borderBottom = border;
      else if (side === 'left') element.style.borderLeft = border;
      else if (side === 'right') element.style.borderRight = border;
      if (side !== 'none') element.style.padding = '2px 6px';
    })} />)}</div>;
    case '查找': return <div className="rd-find"><input className="rd-find-in" placeholder={t('查找内容')} autoFocus onKeyDown={(event) => { if (event.key === 'Enter') actions.findNext((event.target as HTMLInputElement).value); }} /><button className="rd-find-btn" onMouseDown={(event) => { event.preventDefault(); const input = event.currentTarget.previousSibling as HTMLInputElement; actions.findNext(input.value); }}>{t('查找下一个')}</button></div>;
    case '替换': return <div className="drop-list"><PopItem label="打开查找和替换" onPick={actions.findReplace} /></div>;
    case '选择': return <div className="drop-list"><PopItem label="全选" onPick={() => actions.exec('selectAll')} /><PopItem label="取消选择" onPick={actions.clearSelection} /></div>;
    case '封面': return <div className="drop-gallery"><div className="dg-title">{t('封面样式')}</div><div className="dg-cells" style={{ width: 300 }}>{['rd-cover--a', 'rd-cover--b', 'rd-cover--c'].map((variant, index) => <button key={variant} className="dgcell" style={{ height: 76 }} onMouseDown={(event) => { event.preventDefault(); closeAfter(() => actions.insertCover(variant)); }}>{t('封面')} {index + 1}</button>)}</div></div>;
    case '表格': return <RichDocTableGrid onPick={(rows, columns) => closeAfter(() => actions.insertTable(rows, columns))} onMore={() => closeAfter(actions.insertTablePrompt)} />;
    case '形状': return <div className="drop-gallery"><div className="dg-cells" style={{ gridTemplateColumns: 'repeat(3,1fr)', width: 180 }}>{SHAPES.map(([name, svg]) => <button key={name} className="dgcell" title={t(name)} style={{ padding: 6 }} onMouseDown={(event) => { event.preventDefault(); closeAfter(() => actions.insertShape(svg)); }}><svg width="46" height="30" viewBox="0 0 120 80" fill="none" stroke="currentColor" strokeWidth="4" /><span style={{ display: 'block', fontSize: 10 }}>{t(name)}</span></button>)}</div></div>;
    case '图标': return <RichDocSymbolGrid sets={{ 图标: SYMBOLS.箭头 ?? [] }} onPick={(character) => closeAfter(() => actions.insertText(character))} />;
    case 'SmartArt': return <div className="drop-list">{['流程', '列表', '循环', '层次'].map((kind) => <PopItem key={kind} label={'SmartArt · ' + kind} onPick={() => actions.insertHTML(`<div class="rd-smartart" contenteditable="false"><span>${kind}①</span><span>${kind}②</span><span>${kind}③</span></div>`)} />)}</div>;
    case '图表': return <div className="drop-list">{['柱形图', '折线图', '饼图'].map((kind) => <PopItem key={kind} label={kind} onPick={() => actions.insertHTML(`<div class="rd-chart" contenteditable="false">${kind === '饼图' ? '<svg width="120" height="90" viewBox="0 0 42 42"><circle r="16" cx="21" cy="21" fill="#2563eb"/><path d="M21 5 A16 16 0 0 1 37 21 L21 21 Z" fill="#8b5cf6"/></svg>' : '<svg width="140" height="90" viewBox="0 0 140 90"><rect x="16" y="40" width="18" height="42" fill="#2563eb"/><rect x="46" y="24" width="18" height="58" fill="#60a5fa"/><rect x="76" y="52" width="18" height="30" fill="#8b5cf6"/><rect x="106" y="14" width="18" height="68" fill="#2563eb"/></svg>'}<div class="rd-chart-cap">${kind} · 示意</div></div><p><br></p>`)} />)}</div>;
    case '页码': return <div className="drop-list"><PopItem label="页脚居中" onPick={() => actions.insertPageNumber('footer-center')} /><PopItem label="页脚居右" onPick={() => actions.insertPageNumber('footer-right')} /><PopItem label="页眉居右" onPick={() => actions.insertPageNumber('header-right')} /></div>;
    case '文档部件': return <div className="drop-list">{[['作者', '作者姓名'], ['文档标题', document.title || '实训报告'], ['当前日期', DATE_FMTS()[1]?.[1] ?? '']].map(([label, value]) => <PopItem key={label} label={label!} onPick={() => actions.insertText(value!)} />)}</div>;
    case '艺术字': return <div className="drop-gallery"><div className="dg-cells" style={{ gridTemplateColumns: 'repeat(2,1fr)', width: 220 }}>{WORDARTS.map((className, index) => <button key={className} className={'dgcell rd-wordart ' + className} style={{ fontSize: 18, padding: 10 }} onMouseDown={(event) => { event.preventDefault(); closeAfter(() => actions.insertWordArt(className)); }}>A{index + 1}</button>)}</div></div>;
    case '首字下沉': return <div className="drop-list">{['无', '下沉', '悬挂'].map((mode) => <PopItem key={mode} label={mode} onPick={() => actions.dropCap(mode)} />)}</div>;
    case '日期和时间': return <div className="drop-list">{DATE_FMTS().map(([label, value]) => <PopItem key={label} label={label} onPick={() => actions.insertText(value)} />)}</div>;
    case '公式': return <div className="drop-list">{EQUATIONS.map((equation) => <button key={equation} className="drop-item" onMouseDown={(event) => { event.preventDefault(); closeAfter(() => actions.insertHTML(`<span class="rd-eq">${equation}</span>`)); }}>{equation}</button>)}</div>;
    case '符号': return <RichDocSymbolGrid sets={SYMBOLS} onPick={(character) => closeAfter(() => actions.insertText(character))} />;
    case '文字方向': return <div className="drop-list"><PopItem label="水平" check={page.writing !== 'v'} onPick={() => actions.updatePage({ writing: undefined })} /><PopItem label="垂直(从右向左)" check={page.writing === 'v'} onPick={() => actions.updatePage({ writing: 'v' })} /></div>;
    case '页边距': return <div className="drop-list">{MARGINS.map(([label, , sub]) => <PopItem key={label} label={label} sub={sub} check={page.margin === label} onPick={() => actions.updatePage({ margin: label })} />)}<div className="drop-sec"><PopItem label="恢复默认" onPick={() => actions.updatePage({ margin: undefined })} /></div></div>;
    case '纸张方向': return <div className="drop-list"><PopItem label="纵向" check={page.orient !== 'landscape'} onPick={() => actions.updatePage({ orient: 'portrait' })} /><PopItem label="横向" check={page.orient === 'landscape'} onPick={() => actions.updatePage({ orient: 'landscape' })} /></div>;
    case '纸张大小': return <div className="drop-list">{Object.keys(PAPERS).map((paper) => <PopItem key={paper} label={paper} sub={`${PAPERS[paper]![0]}×${PAPERS[paper]![1]}`} check={(page.size ?? 'A4') === paper} onPick={() => actions.updatePage({ size: paper })} />)}</div>;
    case '栏': return <div className="drop-list">{COLUMNS.map(([label, columns]) => <PopItem key={label} label={label} check={(page.columns ?? 1) === columns} onPick={() => actions.updatePage({ columns })} />)}</div>;
    case '分隔符': return <div className="drop-list"><PopItem label="分页符" onPick={() => actions.insertHTML('<div class="rd-pagebreak" contenteditable="false"></div>')} /><PopItem label="分栏符" onPick={() => actions.insertHTML('<span style="break-after:column"></span>')} /><PopItem label="自动换行符" onPick={() => actions.insertHTML('<br>')} /></div>;
    case '行号': return <div className="drop-list"><PopItem label="无" check={!page.lineNums} onPick={() => actions.updatePage({ lineNums: false })} /><PopItem label="连续" check={!!page.lineNums} onPick={() => actions.updatePage({ lineNums: true })} /></div>;
    case '断字': return <div className="drop-list"><PopItem label="无" check={!page.hyphens} onPick={() => actions.updatePage({ hyphens: false })} /><PopItem label="自动" check={!!page.hyphens} onPick={() => actions.updatePage({ hyphens: true })} /></div>;
    case '稿纸设置': return <div className="drop-list"><PopItem label="方格式稿纸" onPick={() => actions.setGridPaper('squares')} /><PopItem label="行线式稿纸" onPick={() => actions.setGridPaper('lines')} /><PopItem label="非稿纸文档" onPick={() => actions.setGridPaper('none')} /></div>;
    case '位置': return <div className="drop-list"><PopItem label="居左环绕" onPick={() => actions.arrangeImage((element) => { element.style.cssText += ';float:left;margin:4px 12px 4px 0'; })} /><PopItem label="居中" onPick={() => actions.arrangeImage((element) => { element.style.cssText += ';display:block;float:none;margin:8px auto'; })} /><PopItem label="居右环绕" onPick={() => actions.arrangeImage((element) => { element.style.cssText += ';float:right;margin:4px 0 4px 12px'; })} /></div>;
    case '环绕文字': return <div className="drop-list"><PopItem label="嵌入型" onPick={() => actions.arrangeImage((element) => { element.style.float = 'none'; element.style.display = 'inline'; })} /><PopItem label="四周型" onPick={() => actions.arrangeImage((element) => { element.style.float = 'left'; element.style.margin = '4px 12px'; })} /><PopItem label="上下型" onPick={() => actions.arrangeImage((element) => { element.style.float = 'none'; element.style.display = 'block'; element.style.margin = '8px 0'; })} /></div>;
    case '对齐': return <div className="drop-list"><PopItem label="左对齐" onPick={() => actions.arrangeImage((element) => { element.style.display = 'block'; element.style.margin = '4px auto 4px 0'; })} /><PopItem label="水平居中" onPick={() => actions.arrangeImage((element) => { element.style.display = 'block'; element.style.margin = '4px auto'; })} /><PopItem label="右对齐" onPick={() => actions.arrangeImage((element) => { element.style.display = 'block'; element.style.margin = '4px 0 4px auto'; })} /></div>;
    case '组合': return <div className="drop-list"><PopItem label="组合" onPick={() => actions.wrapSelection((element) => { element.style.display = 'inline-block'; }, 'rd-group')} /><PopItem label="取消组合" onPick={actions.ungroupSelection} /></div>;
    case '旋转': return <div className="drop-list"><PopItem label="向右旋转 90°" onPick={() => actions.rotateImage('right')} /><PopItem label="向左旋转 90°" onPick={() => actions.rotateImage('left')} /><PopItem label="水平翻转" onPick={() => actions.rotateImage('flipH')} /><PopItem label="垂直翻转" onPick={() => actions.rotateImage('flipV')} /></div>;
    case '目录': return <div className="drop-gallery"><div className="dg-title">{t('自动目录')}</div><div className="drop-list"><PopItem label="插入自动目录" onPick={actions.buildToc} /><PopItem label="更新目录" onPick={actions.updateToc} /></div></div>;
    case '添加文字': return <div className="drop-list">{[['级别 1', 'h1'], ['级别 2', 'h2'], ['级别 3', 'h3'], ['不在目录中显示', 'p']].map(([label, tag]) => <PopItem key={label} label={label!} onPick={() => actions.exec('formatBlock', tag!)} />)}</div>;
    case '插入引文': return <div className="drop-list"><PopItem label="(作者, 2026)" onPick={() => actions.insertHTML('<span class="rd-cite">(作者, 2026)</span>')} /><PopItem label="添加新源…" onPick={() => actions.notify(t('可在文档内直接编辑引文'))} /></div>;
    case '样式': return <div className="drop-list">{['GB/T 7714', 'APA', 'MLA', 'Chicago', 'IEEE'].map((style) => <PopItem key={style} label={style} onPick={() => actions.notify(t('引文样式') + ' · ' + style)} />)}</div>;
    case '语言': return <div className="drop-list">{([
      ['中文(简体)', 'zh-CN'],
      ['English', 'en-US'],
      ['日本語', 'ja-JP'],
    ] satisfies Array<[string, NonNullable<RichDocPageState['lang']>]>).map(([label, code]) => <PopItem key={code} label={label} check={(page.lang ?? 'zh-CN') === code} onPick={() => actions.updatePage({ lang: code })} />)}</div>;
    case '缩放': return <div className="drop-list">{ZOOMS.map((zoom) => <PopItem key={zoom} label={zoom + '%'} check={Math.round((page.zoom ?? 1) * 100) === zoom} onPick={() => actions.updatePage({ zoom: zoom / 100 })} />)}<div className="drop-sec"><PopItem label="页宽" onPick={() => actions.fitZoom('width')} /><PopItem label="整页" onPick={() => actions.fitZoom('page')} /></div></div>;
    default: return <div className="drop-list"><PopItem label={menuKey} onPick={() => actions.run(menuKey)} /></div>;
  }
}
