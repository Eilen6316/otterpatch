import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { useT } from './i18n.js';
import {
  IconClipboard, IconScissors, IconCopy, IconFormatBrush,
  IconFontGrow, IconFontShrink, IconChangeCase, IconClearFormat, IconStrikethrough,
  IconSubscript, IconSuperscript, IconWordArt, IconTextEffect, IconHighlighter, IconFontColor, IconPhonetic, IconEncloseChar,
  IconBulletsRb, IconNumberingRb, IconMultilevelListRb, IconIndentDecrease, IconIndentIncrease,
  IconChineseLayoutRb, IconSortAsc, IconAlignLeft, IconAlignCenter, IconAlignRight, IconAlignJustify,
  IconLineSpacing, IconShadingRb, IconBorders, IconSearch, IconReplace, IconSelect,
  IconCoverPageRb, IconBlankPageRb, IconPageBreakRb, IconTable, IconImage, IconShapes, IconStar,
  IconSmartArt, IconBarChart, IconScreenshot, IconObject, IconAddin, IconVariantsRb, IconHelp,
  IconLink, IconBookmark, IconCrossRef, IconHeader, IconFooter, IconPageNumber, IconTextBox, IconDocPartsRb, IconDropCapRb,
  IconDateTime, IconSignatureLineRb, IconRoot, IconOmega, IconHorizontalRule,
  IconTextDirectionRb, IconMargins, IconOrientation, IconPaperSize, IconColumnsRb, IconSeparator,
  IconLineNumbersRb, IconHyphenationRb, IconGridPaperRb, IconIndentLeftRb, IconIndentRightRb,
  IconSpaceBeforeRb, IconSpaceAfterRb, IconPositionRb, IconWrapTextRb, IconBringForwardRb,
  IconSendBackwardRb, IconSelectionPaneRb, IconAlignRb, IconGroupRb, IconRotateRb,
  IconTocRb, IconAddTextRb, IconUpdateTocRb, IconFootnoteRb, IconEndnoteRb, IconNextFootnoteRb,
  IconShowNotesRb, IconCitationRb, IconManageSourcesRb, IconStylesRb, IconBibliographyRb,
  IconCaptionRb, IconTableOfFiguresRb, IconMarkEntryRb, IconIndexRb, IconUpdateIndexRb,
  IconSpellingRb, IconWordCountRb, IconTranslate, IconLanguage, IconComment, IconShowComments, IconEraser, IconPreviousRb,
  IconNextItemRb, IconTrackChangesRb, IconShowMarkupRb, IconAcceptRb, IconRejectRb,
  IconReadingViewRb, IconPageViewRb, IconWebLayoutRb, IconOutlineRb, IconRulerRb, IconGridlines,
  IconNavPaneRb, IconZoomRb, IconZoom100Rb, IconSinglePageRb, IconMultiPageRb, IconWidthRb,
} from './icons.js';

type IconComponent = (props: { size?: number }) => ReactNode;

type RibbonCell =
  | { kind: 'big'; label: string; icon: IconComponent }
  | { kind: 'row'; items: { label: string; icon?: IconComponent; accent?: 'red' | 'amber' }[] }
  | { kind: 'combo'; label: string; className: string }
  | { kind: 'split'; label: string; icon: IconComponent; color: 'fore' | 'hi' }
  | { kind: 'styles' }
  | { kind: 'spin'; label: string; icon: IconComponent };

interface RibbonGroup { name: string; cells: RibbonCell[] }
export interface RichDocRibbonTab { name: string; groups: RibbonGroup[] }

export const RICH_DOC_MENU_COMMANDS = new Set([
  '粘贴', '字体', '字号', '更改大小写', '文本效果', '多级列表', '中文版式', '排序', '行距', '底纹', '边框',
  '查找', '替换', '选择', '封面', '表格', '形状', '图标', 'SmartArt', '图表', '页码', '文档部件', '艺术字',
  '首字下沉', '日期和时间', '公式', '符号', '文字方向', '页边距', '纸张方向', '纸张大小', '栏', '分隔符',
  '行号', '断字', '稿纸设置', '位置', '环绕文字', '对齐', '组合', '旋转', '目录', '添加文字', '插入引文',
  '样式', '语言', '缩放',
]);

const STYLE_CELLS: [string, string, string][] = [
  ['正文', 'st-body', '正文'], ['无间隔', 'st-body', '无间隔'], ['标题1', 'st-h1', '标题 1'], ['标题2', 'st-h2', '标题 2'],
  ['标题3', 'st-h3', '标题 3'], ['标题', 'st-title', '标题'], ['副标题', 'st-sub', '副标题'], ['引用', 'st-body', '❝ 引用'], ['强调', 'st-sub', '强调'],
];

export const RICH_DOC_RIBBON_TABS: RichDocRibbonTab[] = [
  { name: '开始', groups: [
    { name: '剪贴板', cells: [{ kind: 'big', label: '粘贴', icon: IconClipboard }, { kind: 'row', items: [{ label: '剪切', icon: IconScissors }, { label: '复制', icon: IconCopy }, { label: '格式刷', icon: IconFormatBrush }] }] },
    { name: '字体', cells: [
      { kind: 'combo', label: '字体', className: 'font' }, { kind: 'combo', label: '字号', className: 'size' },
      { kind: 'row', items: [{ label: '增大字号', icon: IconFontGrow }, { label: '减小字号', icon: IconFontShrink }, { label: '更改大小写', icon: IconChangeCase }, { label: '清除格式', icon: IconClearFormat }] },
      { kind: 'row', items: [{ label: '加粗' }, { label: '斜体' }, { label: '下划线' }, { label: '删除线', icon: IconStrikethrough }, { label: '下标', icon: IconSubscript }, { label: '上标', icon: IconSuperscript }, { label: '文本效果', icon: IconTextEffect }, { label: '拼音指南', icon: IconPhonetic }, { label: '带圈字符', icon: IconEncloseChar }] },
      { kind: 'split', label: '字体颜色', icon: IconFontColor, color: 'fore' }, { kind: 'split', label: '突出显示', icon: IconHighlighter, color: 'hi' },
    ] },
    { name: '段落', cells: [
      { kind: 'row', items: [{ label: '项目符号', icon: IconBulletsRb }, { label: '编号', icon: IconNumberingRb }, { label: '多级列表', icon: IconMultilevelListRb }, { label: '减少缩进', icon: IconIndentDecrease }, { label: '增加缩进', icon: IconIndentIncrease }, { label: '中文版式', icon: IconChineseLayoutRb }, { label: '排序', icon: IconSortAsc }] },
      { kind: 'row', items: [{ label: '左对齐', icon: IconAlignLeft }, { label: '居中', icon: IconAlignCenter }, { label: '右对齐', icon: IconAlignRight }, { label: '两端对齐', icon: IconAlignJustify }, { label: '行距', icon: IconLineSpacing }, { label: '底纹', icon: IconShadingRb }, { label: '边框', icon: IconBorders }] },
    ] },
    { name: '样式', cells: [{ kind: 'styles' }] },
    { name: '编辑', cells: [{ kind: 'row', items: [{ label: '查找', icon: IconSearch }, { label: '替换', icon: IconReplace }, { label: '选择', icon: IconSelect }] }] },
  ] },
  { name: '插入', groups: [
    { name: '页面', cells: [{ kind: 'big', label: '封面', icon: IconCoverPageRb }, { kind: 'row', items: [{ label: '空白页', icon: IconBlankPageRb }, { label: '分页', icon: IconPageBreakRb }] }] },
    { name: '表格', cells: [{ kind: 'big', label: '表格', icon: IconTable }] },
    { name: '插图', cells: [{ kind: 'row', items: [{ label: '图片', icon: IconImage }, { label: '形状', icon: IconShapes }, { label: '图标', icon: IconStar }, { label: 'SmartArt', icon: IconSmartArt }, { label: '图表', icon: IconBarChart }, { label: '屏幕截图', icon: IconScreenshot }] }] },
    { name: '加载项', cells: [{ kind: 'row', items: [{ label: '获取加载项', icon: IconAddin }, { label: '我的加载项', icon: IconVariantsRb }, { label: '维基百科', icon: IconHelp }] }] },
    { name: '链接', cells: [{ kind: 'row', items: [{ label: '链接', icon: IconLink }, { label: '书签', icon: IconBookmark }, { label: '交叉引用', icon: IconCrossRef }] }] },
    { name: '页眉页脚', cells: [{ kind: 'row', items: [{ label: '页眉', icon: IconHeader }, { label: '页脚', icon: IconFooter }, { label: '页码', icon: IconPageNumber }] }] },
    { name: '文本', cells: [{ kind: 'row', items: [{ label: '文本框', icon: IconTextBox }, { label: '文档部件', icon: IconDocPartsRb }, { label: '艺术字', icon: IconWordArt }, { label: '首字下沉', icon: IconDropCapRb }, { label: '签名行', icon: IconSignatureLineRb }, { label: '日期和时间', icon: IconDateTime }, { label: '对象', icon: IconObject }] }] },
    { name: '符号', cells: [{ kind: 'row', items: [{ label: '公式', icon: IconRoot }, { label: '符号', icon: IconOmega }, { label: '水平线', icon: IconHorizontalRule }] }] },
  ] },
  { name: '布局', groups: [
    { name: '页面设置', cells: [
      { kind: 'big', label: '页边距', icon: IconMargins },
      { kind: 'row', items: [{ label: '文字方向', icon: IconTextDirectionRb }, { label: '纸张方向', icon: IconOrientation }, { label: '纸张大小', icon: IconPaperSize }, { label: '栏', icon: IconColumnsRb }] },
      { kind: 'row', items: [{ label: '分隔符', icon: IconSeparator }, { label: '行号', icon: IconLineNumbersRb }, { label: '断字', icon: IconHyphenationRb }] },
    ] },
    { name: '稿纸', cells: [{ kind: 'big', label: '稿纸设置', icon: IconGridPaperRb }] },
    { name: '段落', cells: [{ kind: 'spin', label: '左缩进', icon: IconIndentLeftRb }, { kind: 'spin', label: '右缩进', icon: IconIndentRightRb }, { kind: 'spin', label: '段前间距', icon: IconSpaceBeforeRb }, { kind: 'spin', label: '段后间距', icon: IconSpaceAfterRb }] },
    { name: '排列', cells: [{ kind: 'row', items: [{ label: '位置', icon: IconPositionRb }, { label: '环绕文字', icon: IconWrapTextRb }, { label: '上移一层', icon: IconBringForwardRb }, { label: '下移一层', icon: IconSendBackwardRb }, { label: '选择窗格', icon: IconSelectionPaneRb }, { label: '对齐', icon: IconAlignRb }, { label: '组合', icon: IconGroupRb }, { label: '旋转', icon: IconRotateRb }] }] },
  ] },
  { name: '引用', groups: [
    { name: '目录', cells: [{ kind: 'big', label: '目录', icon: IconTocRb }, { kind: 'row', items: [{ label: '添加文字', icon: IconAddTextRb }, { label: '更新目录', icon: IconUpdateTocRb }] }] },
    { name: '脚注', cells: [{ kind: 'row', items: [{ label: '插入脚注', icon: IconFootnoteRb }, { label: '插入尾注', icon: IconEndnoteRb }, { label: '下一条脚注', icon: IconNextFootnoteRb }, { label: '显示备注', icon: IconShowNotesRb }] }] },
    { name: '引文与书目', cells: [{ kind: 'row', items: [{ label: '插入引文', icon: IconCitationRb }, { label: '管理源', icon: IconManageSourcesRb }, { label: '样式', icon: IconStylesRb }, { label: '书目', icon: IconBibliographyRb }] }] },
    { name: '题注', cells: [{ kind: 'row', items: [{ label: '插入题注', icon: IconCaptionRb }, { label: '插入表目录', icon: IconTableOfFiguresRb }, { label: '交叉引用', icon: IconCrossRef }] }] },
    { name: '索引', cells: [{ kind: 'row', items: [{ label: '标记条目', icon: IconMarkEntryRb }, { label: '插入索引', icon: IconIndexRb }, { label: '更新索引', icon: IconUpdateIndexRb }] }] },
  ] },
  { name: '审阅', groups: [
    { name: '校对', cells: [{ kind: 'big', label: '字数统计', icon: IconWordCountRb }, { kind: 'row', items: [{ label: '拼写和语法', icon: IconSpellingRb }] }] },
    { name: '语言', cells: [{ kind: 'row', items: [{ label: '翻译', icon: IconTranslate }, { label: '语言', icon: IconLanguage }] }] },
    { name: '批注', cells: [{ kind: 'row', items: [{ label: '新建批注', icon: IconComment }, { label: '删除', icon: IconEraser }, { label: '上一条', icon: IconPreviousRb }, { label: '下一条', icon: IconNextItemRb }, { label: '显示批注', icon: IconShowComments }] }] },
    { name: '修订', cells: [{ kind: 'big', label: '修订', icon: IconTrackChangesRb }, { kind: 'row', items: [{ label: '显示标记', icon: IconShowMarkupRb }, { label: '接受', icon: IconAcceptRb }, { label: '拒绝', icon: IconRejectRb }] }] },
  ] },
  { name: '视图', groups: [
    { name: '视图', cells: [{ kind: 'row', items: [{ label: '阅读视图', icon: IconReadingViewRb }, { label: '页面视图', icon: IconPageViewRb }, { label: 'Web 版式', icon: IconWebLayoutRb }, { label: '大纲', icon: IconOutlineRb }] }] },
    { name: '显示', cells: [{ kind: 'row', items: [{ label: '标尺', icon: IconRulerRb }, { label: '网格线', icon: IconGridlines }, { label: '导航窗格', icon: IconNavPaneRb }] }] },
    { name: '缩放', cells: [{ kind: 'big', label: '缩放', icon: IconZoomRb }, { kind: 'row', items: [{ label: '100%', icon: IconZoom100Rb }, { label: '单页', icon: IconSinglePageRb }, { label: '页宽', icon: IconWidthRb }, { label: '多页', icon: IconMultiPageRb }] }] },
  ] },
];

export interface RichDocRibbonProps {
  tab: number;
  font: string;
  fontSize: number;
  openMenuKey: string | null;
  foregroundColor: string;
  highlightColor: string;
  wordCount: number;
  zoomPercent: number;
  isActive: (label: string) => boolean;
  onTabChange: (tab: number) => void;
  onCommand: (label: string) => void;
  onOpenMenu: (label: string, target: HTMLElement) => void;
  onApplyStyle: (name: string) => void;
  onApplyColor: (color: 'fore' | 'hi', value: string) => void;
  onSpin: (label: string, direction: number) => void;
  onMouseOver: (event: ReactMouseEvent<HTMLDivElement>) => void;
  onMouseOut: (event: ReactMouseEvent<HTMLDivElement>) => void;
  onMouseDownCapture: () => void;
}

export function RichDocRibbon(props: RichDocRibbonProps): ReactNode {
  const t = useT();
  const activeTab = RICH_DOC_RIBBON_TABS[props.tab] ?? RICH_DOC_RIBBON_TABS[0]!;
  const glyphs: Record<string, ReactNode> = { 加粗: <b>B</b>, 斜体: <i>I</i>, 下划线: <u>U</u> };

  const activate = (label: string, event: ReactMouseEvent<HTMLElement>): void => {
    event.preventDefault();
    if (RICH_DOC_MENU_COMMANDS.has(label)) props.onOpenMenu(label, event.currentTarget);
    else props.onCommand(label);
  };
  const renderCell = (cell: RibbonCell, index: number): ReactNode => {
    if (cell.kind === 'big') {
      const Icon = cell.icon;
      return <button key={index} className="rbig" aria-label={t(cell.label)} data-cmd={cell.label} onMouseDown={(event) => activate(cell.label, event)}><span className="rbig-ic"><Icon size={20} /></span><span className="rbig-lb">{t(cell.label)}{RICH_DOC_MENU_COMMANDS.has(cell.label) ? ' ▾' : ''}</span></button>;
    }
    if (cell.kind === 'combo') {
      const value = cell.label === '字体' ? (props.font || t('字体')) : props.fontSize ? String(props.fontSize) : t('字号');
      return <button key={index} className={'rcombo ' + cell.className + (props.openMenuKey === cell.label ? ' open' : '')} aria-label={t(cell.label)} data-cmd={cell.label} onMouseDown={(event) => { event.preventDefault(); props.onOpenMenu(cell.label, event.currentTarget); }}><span className="rc-val">{value}</span><span className="caret">▾</span></button>;
    }
    if (cell.kind === 'split') {
      const Icon = cell.icon;
      const current = cell.color === 'fore' ? props.foregroundColor : props.highlightColor;
      return <span key={index} className="rd-split" aria-label={t(cell.label)} data-cmd={cell.label}>
        <button className={'rd-split-main' + (cell.color === 'fore' ? ' ic-red' : ' ic-amber')} onMouseDown={(event) => { event.preventDefault(); props.onApplyColor(cell.color, current); }}><Icon size={15} /><span className="rd-underbar" style={{ background: current }} /></button>
        <button className="rd-split-caret" onMouseDown={(event) => { event.preventDefault(); props.onOpenMenu(cell.label, event.currentTarget); }}>▾</button>
      </span>;
    }
    if (cell.kind === 'spin') {
      const Icon = cell.icon;
      return <span key={index} className="rd-num" aria-label={t(cell.label)} data-cmd={cell.label}><span className="rd-num-ic"><Icon size={13} /></span><span className="rd-num-lb">{t(cell.label)}</span><button onMouseDown={(event) => { event.preventDefault(); props.onSpin(cell.label, -1); }}>−</button><button onMouseDown={(event) => { event.preventDefault(); props.onSpin(cell.label, 1); }}>＋</button></span>;
    }
    if (cell.kind === 'styles') {
      return <div className="rstyles" key={index}>{STYLE_CELLS.map(([name, kind, sample]) => <button key={name} className={'rstyle ' + kind} aria-label={t(name)} data-cmd={name} onMouseDown={(event) => { event.preventDefault(); props.onApplyStyle(name); }}>{t(sample)}</button>)}</div>;
    }
    return <div className="rsmall-grid" key={index}>{cell.items.map((item) => {
      const Icon = item.icon;
      const glyph = glyphs[item.label];
      const className = 'rs' + (glyph ? ' biu biu-' + (item.label === '加粗' ? 'b' : item.label === '斜体' ? 'i' : 'u') : '') + (item.accent === 'red' ? ' ic-red' : item.accent === 'amber' ? ' ic-amber' : '') + (props.isActive(item.label) ? ' on' : '');
      return <button key={item.label} className={className} aria-label={t(item.label)} data-cmd={item.label} onMouseDown={(event) => activate(item.label, event)}>{glyph ?? (Icon ? <Icon size={15} /> : t(item.label))}{RICH_DOC_MENU_COMMANDS.has(item.label) ? <span className="caret">▾</span> : null}</button>;
    })}</div>;
  };

  return <div className="ribbon rd-ribbon" onMouseOver={props.onMouseOver} onMouseOut={props.onMouseOut} onMouseDownCapture={props.onMouseDownCapture}>
    <div className="ribbon-tabs">
      {RICH_DOC_RIBBON_TABS.map((item, index) => <button key={item.name} className={'rtab' + (index === props.tab ? ' on' : '')} onClick={() => props.onTabChange(index)}>{t(item.name)}</button>)}
      <span className="rd-tabs-grow" />
      <button className="rd-chip" aria-label={t('字数统计')} data-cmd="字数统计" onMouseDown={(event) => { event.preventDefault(); props.onCommand('字数统计'); }}><IconWordCountRb size={13} />{t('字数')} {props.wordCount}</button>
      <button className="rd-chip" aria-label={t('缩放')} data-cmd="缩放" onMouseDown={(event) => { event.preventDefault(); props.onOpenMenu('缩放', event.currentTarget); }}>{props.zoomPercent}%</button>
    </div>
    <div className="ribbon-bar">
      {activeTab.groups.map((group) => <div className="rgroup" key={group.name}><div className="rgbody">{group.cells.map(renderCell)}</div><div className="rgname">{t(group.name)}</div></div>)}
    </div>
  </div>;
}
