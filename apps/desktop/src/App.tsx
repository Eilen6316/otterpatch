import { lazy, Suspense, forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { CSSProperties, DragEvent, ReactNode } from 'react';
import {
  IconSelect, IconArrow, IconStrike, IconPencil, IconHelp,
  IconFilter, IconFlag, IconSigma, IconClock,
  IconSend, IconChevron, IconSearch, IconDots, IconUndo, IconCheck, IconX,
  IconDoc, IconPlus,
  FUNC_ICONS,
} from './icons.js';
import { LANGS, makeT, TContext, useT, type Lang } from './i18n.js';
import { DRAWIO_SHAPES } from './drawio-shapes.js';
import type { UniSel, SheetHandle } from './UniverSheet.js';
import type { RichDocHandle, DocFmt, WordSel } from './RichDoc.js';
import { docxToHtml } from './docximport.js';
import { akey, BATCH_RX, AUTO_BATCH_CAP } from './review-shared.js';
import { ReviewBox } from './ReviewBox.js';
import { AgentHome } from './AgentHome.js';
import { Composer } from './Composer.js';
import { TopBar } from './TopBar.js';
import { DrawioBoard, DrawioToolbar, DrawioPalette, parseDrawioStyle, innerForStyle, snap, extractDrawioOps, makeRawBoardConv, boundingA1 } from './DrawioBoard.js';
import type { BNode, BEdge, BoardSel, BoardHandle } from './DrawioBoard.js';
import { ThinkingPanel, ClarifyCard } from './ThreadCards.js';
import type { ClarifyQuestion } from './ThreadCards.js';
import { Markdown } from './Markdown.js';
import { chartToPngDataUrl, gridToChartSpec, buildChartGrid, specFromInline } from './chart.js';

/** Agent 在网格上的一步操作(用于"边画边改"的可视化播放)。 */
interface GridOp { a1: string; value?: unknown; bg?: string; color?: string; bold?: boolean; numFmt?: string; note: string; before?: unknown; beforeState?: CellState; editId?: string }
/** 提案到达时采集的整格改前状态(值/公式/填充/字色/加粗)——拒绝/原文视图按"改了哪个维度还原哪个维度"精确回放。 */
interface CellState { v?: unknown; f?: string | null; bg?: string | null; color?: string | null; bold?: boolean }
// akey / BATCH_RX / AUTO_BATCH_CAP moved to ./review-shared.ts (god-file decomposition).

/** 由 applyExcelStructure 直接落网格的"结构/对象操作"kind —— 这些【不能】被 diffToOps 当作写单元格值
 *  (否则会把"插入图表"等的摘要文字写进格子);它们走 applyExcelStructure,不进 playOps。 */
const ADV_KINDS = new Set(['insertRows', 'deleteRows', 'insertCols', 'deleteCols', 'mergeCells', 'unmergeCells', 'freezePanes', 'sortRange', 'deleteRange', 'conditionalFormat', 'dataValidation', 'autoFilter', 'insertChart']);

/** 对话流里的一条消息(Cursor 式连续 thread)。Exported for the extracted review components. */
export type Turn =
  | { role: 'user'; text: string }
  | { role: 'assistant'; kind: 'answer'; text: string; reasoning?: string; streaming?: boolean }
  | { role: 'assistant'; kind: 'clarify'; questions: ClarifyQuestion[]; reasoning?: string; answered?: boolean; answerText?: string }
  | { role: 'assistant'; kind: 'diff'; diff: AgentDiff; ops: GridOp[]; board?: BoardPatch; word?: WordEdit[]; text?: string; reasoning?: string; reverted?: boolean; committed?: boolean; committedCount?: number };
/** The diff-review turn shape consumed by ReviewBox. */
export type DiffTurn = Extract<Turn, { kind: 'diff' }>;

/** drawio 改动落到画板的句柄:editId→画板对象 id 映射 + 可重放的节点/连线(供逐条接受/拒绝)。 */
interface BoardPatch { byEdit: Record<string, string>; objs: Array<{ editId: string; node?: BNode; edge?: BEdge }> }

/** Word 一条改动:文本改写(replacement)或格式改动(style)。domId 为跨回合唯一的 DOM 标记(避免 editId 撞名误还原)。 */
export interface WordEdit { editId: string; domId: string; quote: string; replacement?: string; style?: DocFmt }

/**
 * 把对话流投影成模型历史(Pi 的 projection 模式:thread 是单一数据源)。
 * - diff 回合只发紧凑摘要 + 处置结果(接受/拒绝/撤销),不发整段 diff;
 * - 超长时保留最近 KEEP 条,更早要点并入最旧一条保留消息(不破坏 user/assistant 交替,不在 proposal/outcome 间切断)。
 */
function buildHistory(thread: Turn[]): Array<{ role: 'user' | 'assistant'; content: string }> {
  const proj = thread.map((turn): { role: 'user' | 'assistant'; content: string } => {
    if (turn.role === 'user') return { role: 'user', content: turn.text };
    if (turn.kind === 'answer') return { role: 'assistant', content: turn.text };
    if (turn.kind === 'clarify') return { role: 'assistant', content: '我向你澄清提问: ' + turn.questions.map((q) => q.question + '(候选: ' + q.options.map((o) => o.label).join('/') + ')').join(' | ') + (turn.answered ? '' : '(等待你的回答)') };
    const summary = '提出改动: ' + turn.diff.items.map((it) => `${it.ref} ${it.label}`).join('; ');
    const outcome = turn.reverted ? '(用户已撤销这些改动,文档未保留它们)' : turn.committed ? `(用户已接受并写入${turn.committedCount ?? turn.diff.items.length}处)` : '(已提出,待用户审阅,尚未确定写入)';
    return { role: 'assistant', content: summary + outcome };
  });
  const KEEP = 12;
  if (proj.length <= KEEP) return proj;
  const dropped = proj.slice(0, proj.length - KEEP);
  const kept = proj.slice(-KEEP);
  const userPts = dropped.filter((m) => m.role === 'user').map((m) => m.content).slice(-6);
  // 关键:被裁掉回合里"已接受/已撤销"的净状态不能丢,否则模型会重复提已写入的改动或在已撤销的状态上续推
  const outcomes = dropped.filter((m) => m.role === 'assistant' && /已接受并写入|已撤销/.test(m.content)).map((m) => m.content).slice(-6);
  const gist = '[此前对话要点] ' + [...userPts, ...outcomes].join(' / ');
  const first = kept[0];
  if (first) kept[0] = { ...first, content: gist + '\n' + first.content };
  return kept;
}

/** 载入持久化对话时净化:清掉流式残留(刷新后卡在"正在思考"),丢弃空占位回合。 */
function sanitizeThread(th: Turn[]): Turn[] {
  return th
    .map((t) => (t.role === 'assistant' && t.kind === 'answer' && t.streaming ? { ...t, streaming: false } : t))
    .filter((t) => !(t.role === 'assistant' && t.kind === 'answer' && !t.text?.trim() && !t.reasoning?.trim()));
}

// ThinkingPanel / ClarifyCard moved to ./ThreadCards.tsx (decomposition phase 5).

/** 真 Univer 表格(体积大 → 懒加载,仅 Excel 用)。 */
const UniverSheet = lazy(() => import('./UniverSheet.js'));
/** Word 文档工作区:自控富文本编辑器(懒加载,仅 Word 用)。 */
const RichDoc = lazy(() => import('./RichDoc.js'));

/** 渐进披露驾驶舱。风格参照 Next AI Drawio:纯白、分区块、线性图标、无 emoji。五语 i18n(t 包裹显示文案)。 */

/** 工作区格式:文件名 + 工具栏随之联动。 */
const FORMATS = [
  { id: 'excel', label: 'Excel', file: '月度销售表.xlsx' },
  { id: 'word', label: 'Word', file: '实训报告.docx' },
  { id: 'ppt', label: 'PPT', file: '季度汇报.pptx' },
  { id: 'drawio', label: '流程图', file: '系统架构.drawio' },
] as const;
type Fmt = (typeof FORMATS)[number]['id'];

/** 仿 Office 功能区:选项卡 → 分组(模块)→ 功能。 */
interface RibGroup { name: string; items: string[] }
interface RibTab { name: string; groups: RibGroup[] }

const RIBBONS: Record<Fmt, RibTab[]> = {
  excel: [
    {
      name: '开始',
      groups: [
        { name: '剪贴板', items: ['粘贴', '剪切', '复制', '格式刷'] },
        { name: '字体', items: ['字体', '字号', '增大字号', '减小字号', '拼音指南', 'B', 'I', 'U', '边框', '填充色', '字体颜色'] },
        { name: '对齐方式', items: ['顶端对齐', '居中', '左对齐', '右对齐', '自动换行', '增加缩进', '合并后居中'] },
        { name: '数字', items: ['常规', '货币', '百分比', '千分位', '增加小数', '减少小数'] },
        { name: '样式', items: ['条件格式', '套用表格格式', '单元格样式'] },
        { name: '单元格', items: ['插入', '删除', '格式'] },
        { name: '编辑', items: ['自动求和', '填充', '清除', '排序和筛选', '查找和选择'] },
      ],
    },
    {
      name: '插入',
      groups: [
        { name: '表格', items: ['数据透视表', '推荐的数据透视表', '表格'] },
        { name: '插图', items: ['图片', '形状', '图标', 'SmartArt', '屏幕截图'] },
        { name: '图表', items: ['推荐的图表', '柱形图', '折线图', '饼图', '数据透视图'] },
        { name: '迷你图', items: ['折线', '柱形', '盈亏'] },
        { name: '筛选器', items: ['切片器', '日程表'] },
        { name: '文本', items: ['文本框', '页眉和页脚', '艺术字', '对象'] },
        { name: '符号', items: ['公式', '符号'] },
      ],
    },
    {
      name: '页面布局',
      groups: [
        { name: '主题', items: ['主题', '颜色', '字体', '效果'] },
        { name: '页面设置', items: ['页边距', '纸张方向', '纸张大小', '打印区域', '分隔符', '背景', '打印标题'] },
        { name: '调整为合适大小', items: ['宽度', '高度', '缩放比例'] },
        { name: '工作表选项', items: ['网格线', '标题'] },
        { name: '排列', items: ['上移一层', '下移一层', '对齐', '组合', '旋转'] },
      ],
    },
    {
      name: '公式',
      groups: [
        { name: '函数库', items: ['插入函数', '自动求和', '财务', '逻辑', '文本', '日期和时间', '查找与引用', '数学和三角', '其他函数'] },
        { name: '定义的名称', items: ['名称管理器', '定义名称', '根据所选内容创建'] },
        { name: '公式审核', items: ['追踪引用单元格', '追踪从属单元格', '显示公式', '错误检查', '公式求值'] },
        { name: '计算', items: ['计算选项', '开始计算', '计算工作表'] },
      ],
    },
    {
      name: '数据',
      groups: [
        { name: '获取和转换数据', items: ['获取数据', '从文本/CSV', '自网站', '来自表格/区域', '现有连接'] },
        { name: '查询和连接', items: ['全部刷新', '查询和连接', '属性'] },
        { name: '排序和筛选', items: ['升序', '降序', '排序', '筛选', '清除', '高级'] },
        { name: '数据工具', items: ['分列', '快速填充', '删除重复值', '数据验证', '合并计算'] },
        { name: '预测', items: ['模拟分析', '预测工作表'] },
        { name: '分级显示', items: ['组合', '取消组合', '分类汇总'] },
      ],
    },
    {
      name: '审阅',
      groups: [
        { name: '校对', items: ['拼写检查'] },
        { name: '批注', items: ['新建批注', '显示批注', '删除'] },
        { name: '保护', items: ['保护工作表', '保护工作簿'] },
      ],
    },
    {
      name: '视图',
      groups: [
        { name: '工作簿视图', items: ['普通', '分页预览', '页面布局'] },
        { name: '显示', items: ['网格线', '编辑栏', '标题'] },
        { name: '缩放', items: ['缩放', '100%', '缩放到选定区域'] },
        { name: '窗口', items: ['新建窗口', '全部重排', '冻结窗格', '拆分'] },
      ],
    },
  ],
  word: [
    {
      name: '开始',
      groups: [
        { name: '剪贴板', items: ['粘贴', '剪切', '复制', '格式刷'] },
        { name: '字体', items: ['字体', '字号', '增大字号', '减小字号', '拼音指南', '清除格式', 'B', 'I', 'U', '删除线', '下标', '上标', '文本效果', '突出显示', '字体颜色'] },
        { name: '段落', items: ['项目符号', '编号', '多级列表', '减少缩进', '增加缩进', '中文版式', '排序', '左对齐', '居中', '右对齐', '两端对齐', '行距', '底纹', '边框'] },
        { name: '样式', items: ['正文', '无间隔', '标题1', '标题2', '标题3', '标题', '副标题'] },
        { name: '编辑', items: ['查找', '替换', '选择'] },
      ],
    },
    {
      name: '插入',
      groups: [
        { name: '页面', items: ['封面', '空白页', '分页'] },
        { name: '表格', items: ['表格'] },
        { name: '插图', items: ['图片', '形状', '图标', 'SmartArt', '图表', '屏幕截图'] },
        { name: '链接', items: ['链接', '书签', '交叉引用'] },
        { name: '批注', items: ['批注'] },
        { name: '页眉和页脚', items: ['页眉', '页脚', '页码'] },
        { name: '文本', items: ['文本框', '文档部件', '艺术字', '首字下沉', '签名行', '日期和时间', '对象'] },
        { name: '符号', items: ['公式', '符号', '编号'] },
      ],
    },
    {
      name: '布局',
      groups: [
        { name: '页面设置', items: ['文字方向', '页边距', '纸张方向', '纸张大小', '栏', '分隔符', '行号', '断字'] },
        { name: '稿纸', items: ['稿纸设置'] },
        { name: '段落', items: ['左缩进', '右缩进', '段前间距', '段后间距'] },
        { name: '排列', items: ['位置', '环绕文字', '上移一层', '下移一层', '选择窗格', '对齐', '组合', '旋转'] },
      ],
    },
    {
      name: '引用',
      groups: [
        { name: '目录', items: ['目录', '添加文字', '更新目录'] },
        { name: '脚注', items: ['插入脚注', '插入尾注', '下一条脚注', '显示备注'] },
        { name: '引文与书目', items: ['插入引文', '管理源', '样式', '书目'] },
        { name: '题注', items: ['插入题注', '插入表目录', '交叉引用'] },
        { name: '索引', items: ['标记条目', '插入索引', '更新索引'] },
      ],
    },
    {
      name: '审阅',
      groups: [
        { name: '校对', items: ['拼写和语法', '字数统计'] },
        { name: '批注', items: ['新建批注', '删除', '上一条', '下一条'] },
        { name: '修订', items: ['修订', '显示标记', '接受', '拒绝'] },
      ],
    },
    {
      name: '视图',
      groups: [
        { name: '视图', items: ['阅读视图', '页面视图', 'Web 版式', '大纲'] },
        { name: '显示', items: ['标尺', '网格线', '导航窗格'] },
        { name: '缩放', items: ['缩放', '100%', '单页', '多页'] },
      ],
    },
  ],
  ppt: [
    {
      name: '开始',
      groups: [
        { name: '幻灯片', items: ['新建幻灯片', '版式', '重置', '节'] },
        { name: '字体', items: ['字体', '字号', 'B', 'I', 'U', '字体颜色'] },
        { name: '段落', items: ['项目符号', '编号', '对齐', '行距', '转换为 SmartArt'] },
        { name: '绘图', items: ['形状', '排列', '快速样式', '填充', '轮廓'] },
      ],
    },
    {
      name: '插入',
      groups: [
        { name: '图像', items: ['图片', '屏幕截图', '相册'] },
        { name: '插图', items: ['形状', 'SmartArt', '图表', '图标'] },
        { name: '文本', items: ['文本框', '页眉和页脚', '艺术字'] },
        { name: '媒体', items: ['视频', '音频'] },
      ],
    },
    {
      name: '设计',
      groups: [
        { name: '主题', items: ['主题', '变体'] },
        { name: '自定义', items: ['幻灯片大小', '设置背景格式'] },
      ],
    },
  ],
  drawio: [
    {
      name: '开始',
      groups: [
        { name: '工具', items: ['选择', '添加节点', '连线', '文本', '自由绘制'] },
        { name: '样式', items: ['填充色', '线条', '字体', '圆角', '阴影'] },
        { name: '形状库', items: ['通用', '流程图', 'UML', '云架构'] },
      ],
    },
    {
      name: '排列',
      groups: [
        { name: '对齐', items: ['左对齐', '水平居中', '右对齐', '顶对齐', '垂直居中', '底对齐'] },
        { name: '布局', items: ['水平树', '垂直树', '有机布局', '圆形布局'] },
        { name: '层次', items: ['上移一层', '下移一层', '置于顶层', '置于底层', '组合'] },
      ],
    },
    {
      name: '插入',
      groups: [
        { name: '元素', items: ['形状', '图片', '连线', '模板'] },
        { name: '导入', items: ['从 CSV', '从 Mermaid'] },
      ],
    },
  ],
};

/** 点击功能后展开的面板。键 = 功能名。 */
type Drop =
  | { type: 'list'; items: string[] }
  | { type: 'colors' }
  | { type: 'menu'; sections: string[][] }
  | { type: 'gallery'; title: string; cells: Array<{ label: string; cls?: string }> };

const COLORS = [
  '#000000', '#ffffff', '#e7e6e6', '#d0cece', '#44546a', '#4472c4', '#ed7d31', '#a5a5a5', '#ffc000', '#5b9bd5', '#70ad47',
  '#c00000', '#ff0000', '#ffc000', '#ffff00', '#92d050', '#00b050', '#00b0f0', '#0070c0', '#002060', '#7030a0',
];

const DROPDOWNS: Record<string, Drop> = {
  字体: { type: 'list', items: ['宋体', '微软雅黑', '等线', '黑体', '楷体', '仿宋', 'Times New Roman', 'Arial', 'Calibri'] },
  字号: { type: 'list', items: ['8', '9', '10', '10.5', '11', '12', '14', '16', '18', '20', '24', '28', '36', '48', '72'] },
  字体颜色: { type: 'colors' },
  填充色: { type: 'colors' },
  突出显示: { type: 'colors' },
  常规: { type: 'list', items: ['常规', '数字', '货币', '会计专用', '短日期', '长日期', '时间', '百分比', '分数', '科学记数', '文本'] },
  自动求和: { type: 'list', items: ['求和', '平均值', '计数', '最大值', '最小值', '其他函数…'] },
  插入: { type: 'list', items: ['插入单元格…', '插入工作表行', '插入工作表列', '插入工作表'] },
  删除: { type: 'list', items: ['删除单元格…', '删除工作表行', '删除工作表列', '删除工作表'] },
  格式: { type: 'list', items: ['行高…', '自动调整行高', '列宽…', '自动调整列宽', '重命名工作表', '保护工作表…'] },
  填充: { type: 'list', items: ['向下', '向右', '向上', '向左', '序列…', '快速填充'] },
  清除: { type: 'list', items: ['全部清除', '清除格式', '清除内容', '清除批注', '清除超链接'] },
  排序和筛选: { type: 'list', items: ['升序', '降序', '自定义排序…', '筛选', '清除', '重新应用'] },
  查找和选择: { type: 'list', items: ['查找…', '替换…', '定位…', '定位条件…', '公式', '批注'] },
  排序: { type: 'list', items: ['升序', '降序', '自定义排序…'] },
  数据透视表: { type: 'list', items: ['表格和区域…', '来自外部数据源', '推荐的数据透视表'] },
  样式: { type: 'list', items: ['GB/T 7714', 'APA', 'MLA', 'IEEE', 'Chicago'] },
  边框: { type: 'menu', sections: [['下框线', '上框线', '左框线', '右框线'], ['无框线', '所有框线', '外侧框线', '粗匣框线'], ['绘制边框', '线条颜色', '线型', '其他边框…']] },
  条件格式: { type: 'menu', sections: [['突出显示单元格规则', '最前/最后规则', '数据条', '色阶', '图标集'], ['新建规则…', '清除规则', '管理规则…']] },
  单元格样式: {
    type: 'gallery',
    title: '单元格样式',
    cells: [
      { label: '常规' }, { label: '差', cls: 'bad' }, { label: '好', cls: 'good' }, { label: '适中', cls: 'neutral' },
      { label: '计算', cls: 'calc' }, { label: '检查单元格', cls: 'check' }, { label: '解释性文本', cls: 'note' }, { label: '警告文本', cls: 'warn' },
      { label: '输入', cls: 'input' }, { label: '输出', cls: 'output' }, { label: '标题 1', cls: 'h1' }, { label: '汇总', cls: 'total' },
    ],
  },
  套用表格格式: {
    type: 'gallery',
    title: '表格样式',
    cells: [
      { label: '浅色 1', cls: 'tbl-l' }, { label: '浅色 2', cls: 'tbl-l' }, { label: '中等 1', cls: 'tbl-m' },
      { label: '中等 2', cls: 'tbl-m' }, { label: '深色 1', cls: 'tbl-d' }, { label: '深色 2', cls: 'tbl-d' },
    ],
  },
  主题: { type: 'gallery', title: '主题', cells: [{ label: 'Office' }, { label: '切片' }, { label: '丝状' }, { label: '回顾' }, { label: '基础' }, { label: '木头型' }] },
};

const BIG = new Set<string>([
  '粘贴', '条件格式', '套用表格格式', '单元格样式', '插入', '删除', '格式', '自动求和', '排序和筛选', '查找和选择',
  '数据透视表', '推荐的数据透视表', '表格', '主题', '拼写检查', '获取数据', '全部刷新', '名称管理器', '插入函数',
  '目录', '修订', '保护工作表', '模拟分析', '删除重复值', '数据验证', 'SmartArt', '分类汇总', '页边距', '图表',
  '新建幻灯片', '版式',
]);
const COMBO: Record<string, string> = { 字体: '宋体', 字号: '11', 常规: '常规' };
const COMBO_W: Record<string, number> = { 字体: 104, 字号: 54, 常规: 92 };
const STYLE_KIND: Record<string, string> = {
  正文: 'body', 无间隔: 'body', 标题1: 'h1', 标题2: 'h2', 标题3: 'h3', 标题: 'title', 副标题: 'sub',
};

type Cell = { t: 'combo'; it: string } | { t: 'big'; it: string } | { t: 'small'; items: string[] };
function buildCells(items: string[]): Cell[] {
  const cells: Cell[] = [];
  let run: string[] = [];
  const flush = (): void => {
    if (run.length) {
      cells.push({ t: 'small', items: run });
      run = [];
    }
  };
  for (const it of items) {
    if (COMBO[it]) {
      flush();
      cells.push({ t: 'combo', it });
    } else if (BIG.has(it)) {
      flush();
      cells.push({ t: 'big', it });
    } else {
      run.push(it);
    }
  }
  flush();
  return cells;
}

const PLACEHOLDERS: Record<Fmt, string> = {
  excel: '圈一块区域,说说你想怎么改…',
  word: '选中文字,说说你想怎么改…',
  drawio: '选中节点/连线,说说你想怎么改…',
  ppt: '选中对象,说说你想怎么改…',
};
const CANVAS_HINT: Record<Fmt, string> = {
  excel: '',
  word: '流式文档:选中文字 → 指令 → 红线修订(@otterpatch/adapter-word)',
  drawio: '流程图:选中节点/连线 → 指令 → 按 mxCell id 改(@otterpatch/adapter-drawio)',
  ppt: '幻灯片:选中对象 → 指令 → 版式/文本(适配器规划中)',
};

const NCOLS = 14;
const NROWS = 30;
const COLS = Array.from({ length: NCOLS }, (_, i) => String.fromCharCode(65 + i)); // A..N
const ROWS = Array.from({ length: NROWS }, (_, i) => i);
const HEADERS = ['日期', '产品', '销量', '单价', '金额', '毛利率'];
const DATA = [
  ['01-03', 'A型', '120', '38'],
  ['01-05', 'B型', '86', '52'],
  ['01-09', 'A型', '1500', '38'],
  ['01-12', 'C型', '64', '70'],
  ['01-15', 'B型', '92', '52'],
];
const AMOUNT = ['4560', '4472', '57000', '4480', '4784'];
const MARGIN = ['41%', '37%', '41%', '28%', '37%'];
const ANOMALY_ROWIDX = 3;

// QUICKS moved into ./AgentHome.tsx (god-file decomposition).


const MODEL_PROVIDERS = [
  { id: 'claude', label: 'Claude', model: 'claude-opus-4-8' },
  { id: 'openai', label: 'ChatGPT', model: 'gpt-5.5' },
  { id: 'deepseek', label: 'DeepSeek', model: 'deepseek-v4-flash' },
  { id: 'glm', label: '智谱 GLM', model: 'glm-4.6' },
  { id: 'kimi', label: 'Kimi', model: 'kimi-latest' },
  { id: 'doubao', label: '豆包', model: 'doubao-seed-1-6-251015' },
  { id: 'minimax', label: 'MiniMax', model: 'MiniMax-M2' },
  { id: 'gemini', label: 'Gemini', model: 'gemini-2.5-pro' },
];
const lsGet = (k: string, d: string): string =>
  typeof localStorage !== 'undefined' ? (localStorage.getItem(k) ?? d) : d;
const lsSet = (k: string, v: string): void => {
  if (typeof localStorage !== 'undefined') localStorage.setItem(k, v);
};

interface Sel { ar: number; ac: number; br: number; bc: number }

/** 单元格格式:功能区按钮真实套用到选中区(B/I/U、颜色、填充、对齐、字体/字号、数字格式)。 */
interface CellFmt {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string;
  bg?: string;
  align?: 'left' | 'center' | 'right';
  numFmt?: string;
  size?: string;
  font?: string;
}
const FMT_BIU: Record<string, 'bold' | 'italic' | 'underline'> = { B: 'bold', I: 'italic', U: 'underline' };
const FMT_ALIGN: Record<string, 'left' | 'center' | 'right'> = { 左对齐: 'left', 居中: 'center', 右对齐: 'right' };

/** otterpatch-serve 的 /propose 返回的可审阅 diff(结构对齐 @otterpatch/runtime 的 OtterPatchDiff;此处只取 JSON 形状,不引 Node 包)。 */
interface AgentStyle { bold?: boolean; italic?: boolean; color?: string; bgColor?: string; align?: string; numberFormat?: string }
interface AgentDiffItem { editId: string; ref: string; kind?: string; badge: string; label: string; after?: string; style?: AgentStyle }
interface AgentDiff { changeSetId: string; hostId: string; intent: string; items: AgentDiffItem[] }
/** Agent 反向澄清:像 Claude Code 那样给引导选择表(2-4 项)+ 允许自填。 */
// ClarifyOption / ClarifyQuestion moved to ./ThreadCards.tsx.

function Section({ label, children, defaultOpen = true }: { label: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="sect">
      <button className="sect-head" onClick={() => setOpen(!open)}>
        <span className="lbl">{label}</span>
        <span className={'chev' + (open ? '' : ' closed')}><IconChevron size={14} /></span>
      </button>
      {open && <div className="sect-body">{children}</div>}
    </div>
  );
}

export function App() {
  const [lang, setLang] = useState<Lang>(() => lsGet('oa.lang', 'zh') as Lang);
  const t = makeT(lang);
  const [sent, setSent] = useState(false);
  const [fmt, setFmt] = useState<Fmt>(() => (lsGet('oa.fmt', 'excel') as Fmt));
  const [tab, setTab] = useState(0);
  const [drop, setDrop] = useState<{ key: string; x: number; y: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [intent, setIntent] = useState('');
  const [cfgOpen, setCfgOpen] = useState(false);
  const [provider, setProvider] = useState(() => lsGet('oa.provider', 'claude'));
  const [model, setModel] = useState(() => lsGet('oa.model', 'claude-opus-4-8'));
  const [apiKey, setApiKey] = useState(() => lsGet('oa.apiKey', ''));
  const [server, setServer] = useState(() => lsGet('oa.server', 'http://localhost:4319'));
  const [uniSel, setUniSel] = useState<UniSel | null>(null);
  const [excelDiff, setExcelDiff] = useState<'orig' | 'final'>('final'); // Excel 改动的 原文/改后 速览
  const [wordSel, setWordSel] = useState<WordSel | null>(null);
  const [hoverCid, setHoverCid] = useState<string | null>(null); // 文档里/rail 悬停联动的改动 domId
  const [boardSel, setBoardSel] = useState<BoardSel | null>(null);
  const univerRef = useRef<SheetHandle>(null);
  const boardRef = useRef<BoardHandle>(null);
  const wordRef = useRef<RichDocHandle>(null);
  const applySeqRef = useRef(0);
  // drawio「边生成边画」流式状态
  const draftBufRef = useRef('');
  const drawnOpsRef = useRef(0);
  const streamConvRef = useRef<ReturnType<typeof makeRawBoardConv> | null>(null);
  const streamObjsRef = useRef<Array<{ editId: string; node?: BNode; edge?: BEdge }>>([]);
  const streamByEditRef = useRef<Record<string, string>>({});
  const [reviewIdx, setReviewIdx] = useState(0);
  const threadEndRef = useRef<HTMLDivElement>(null);
  const sendingRef = useRef(false); // 同步重入锁:异步 busy state 拦不住同一帧内的连发
  const [playList, setPlayList] = useState<GridOp[]>([]);
  const [playIdx, setPlayIdx] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [sendErr, setSendErr] = useState<string | null>(null);
  const [answer, setAnswer] = useState<string | null>(null);
  const lsJson = <T,>(k: string, fb: T): T => { try { const v = JSON.parse(localStorage.getItem(k) ?? 'null'); return v == null ? fb : (v as T); } catch { return fb; } };
  // Cursor 式连续对话流 + 模型历史,持久化到当前工作区(localStorage)
  const [thread, setThread] = useState<Turn[]>(() => sanitizeThread(lsJson<Turn[]>('oa.thread', [])));
  const [recent, setRecent] = useState<{ t: string; time: string }[]>([]);
  const [realDiff, setRealDiff] = useState<AgentDiff | null>(null);
  const [realCs, setRealCs] = useState<unknown>(null);
  const [accepted, setAccepted] = useState<Set<string>>(() => { try { return new Set(JSON.parse(localStorage.getItem('oa.accepted') ?? '[]') as string[]); } catch { return new Set(); } }); // 随 thread 持久化:刷新后审批处置不丢
  useEffect(() => { try { localStorage.setItem('oa.accepted', JSON.stringify([...accepted])); } catch { /* 配额忽略 */ } }, [accepted]);
  useEffect(() => { // 接受率遥测读取口:控制台 __otterTelemetry() 看 格式×改动类型 的 accept/reject 分布
    (window as unknown as { __otterTelemetry?: () => unknown }).__otterTelemetry = () => { try { return JSON.parse(localStorage.getItem('oa.telemetry') ?? '{}'); } catch { return {}; } };
  }, []);
  // 自动续批(opt-in):plan 声明分批 + 用户开着开关 → 全部接受后自动续发"下一批";每批仍走完整 propose→verify→审阅,写是串行的
  const [autoBatch, setAutoBatch] = useState(() => localStorage.getItem('oa.autobatch') === '1');
  useEffect(() => { try { localStorage.setItem('oa.autobatch', autoBatch ? '1' : '0'); } catch { /* 忽略 */ } }, [autoBatch]);
  const autoBatchRun = useRef(0); // 连续自动批次计数(手动指令即清零,上限 AUTO_BATCH_CAP)
  const [fileB64, setFileB64] = useState('');
  const [fileName, setFileName] = useState('');
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState<Sel>({ ar: 1, ac: 2, br: 5, bc: 5 });
  const dragRef = useRef(false);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<{ ri: number; ci: number } | null>(null);
  const [editVal, setEditVal] = useState('');
  const [styles, setStyles] = useState<Record<string, CellFmt>>({});
  const cellKey = (ri: number, ci: number): string => ri + ',' + ci;

  const curProvider = MODEL_PROVIDERS.find((p) => p.id === provider) ?? MODEL_PROVIDERS[0]!;
  const pickProvider = (id: string): void => {
    const p = MODEL_PROVIDERS.find((x) => x.id === id) ?? MODEL_PROVIDERS[0]!;
    setProvider(p.id);
    lsSet('oa.provider', p.id);
    setModel(p.model);
    lsSet('oa.model', p.model);
  };
  const pickLang = (l: Lang): void => {
    setLang(l);
    lsSet('oa.lang', l);
  };

  useEffect(() => {
    const up = (): void => {
      dragRef.current = false;
    };
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, []);
  // 对话历史持久化到当前工作区
  useEffect(() => {
    try {
      localStorage.setItem('oa.thread', JSON.stringify(thread));
    } catch {
      /* 配额满时忽略 */
    }
  }, [thread]);
  // 新消息时滚到底部(Cursor 式)
  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [thread, busy]);

  const r1 = Math.min(sel.ar, sel.br);
  const r2 = Math.max(sel.ar, sel.br);
  const c1 = Math.min(sel.ac, sel.bc);
  const c2 = Math.max(sel.ac, sel.bc);
  const inSel = (ri: number, ci: number): boolean => ri >= r1 && ri <= r2 && ci >= c1 && ci <= c2;
  const a1 = (ri: number, ci: number): string => `${COLS[ci]}${ri + 1}`;
  const rangeLabel = r1 === r2 && c1 === c2 ? a1(r1, c1) : `${a1(r1, c1)}:${a1(r2, c2)}`;
  const selRows = r2 - r1 + 1;
  const selCols = c2 - c1 + 1;
  const curFmt = FORMATS.find((f) => f.id === fmt) ?? FORMATS[0];
  const isExcel = fmt === 'excel';

  const selCells = (): string[] => {
    const out: string[] = [];
    for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) out.push(cellKey(r, c));
    return out;
  };
  const applyFmt = (patch: CellFmt): void => {
    setStyles((prev) => {
      const next = { ...prev };
      for (const k of selCells()) next[k] = { ...(next[k] ?? {}), ...patch };
      return next;
    });
  };
  const toggleFmt = (key: 'bold' | 'italic' | 'underline'): void => {
    setStyles((prev) => {
      const next = { ...prev };
      for (const k of selCells()) {
        const c = next[k] ?? {};
        next[k] = { ...c, [key]: !c[key] };
      }
      return next;
    });
  };
  const cellFmtStyle = (ri: number, ci: number): CSSProperties => {
    const s = styles[cellKey(ri, ci)];
    if (!s) return {};
    return {
      fontWeight: s.bold ? 700 : undefined,
      fontStyle: s.italic ? 'italic' : undefined,
      textDecoration: s.underline ? 'underline' : undefined,
      color: s.color,
      background: s.bg,
      textAlign: s.align,
      fontFamily: s.font,
      fontSize: s.size ? `${s.size}px` : undefined,
    };
  };
  const fmtValue = (raw: string, nf?: string): string => {
    if (!nf || !raw) return raw;
    if (nf === '货币') return '¥' + raw;
    if (nf === '百分比') return /%$/.test(raw) ? raw : raw + '%';
    if (nf === '千分位') {
      const n = Number(raw);
      return Number.isFinite(n) ? n.toLocaleString('en-US') : raw;
    }
    return raw;
  };

  const gridValue = (ri: number, ci: number): string => {
    const ov = overrides[cellKey(ri, ci)];
    if (ov !== undefined) return ov;
    if (ri === 0) return HEADERS[ci] ?? '';
    const di = ri - 1;
    const row = DATA[di] ?? [];
    if (ci <= 3) return row[ci] ?? '';
    if (ci === 4) return sent ? (AMOUNT[di] ?? '') : '';
    if (ci === 5) return sent ? (MARGIN[di] ?? '') : '';
    return '';
  };
  const cellClass = (ri: number, ci: number): string => {
    const cls: string[] = [];
    if (inSel(ri, ci)) cls.push('sel');
    if (sent && ri >= 1) {
      if (ci === 4 || ci === 5) cls.push('add');
      else if (ci === 2 && ri === ANOMALY_ROWIDX) cls.push('del');
    }
    return cls.join(' ');
  };

  const onDown = (ri: number, ci: number): void => {
    setSel({ ar: ri, ac: ci, br: ri, bc: ci });
    dragRef.current = true;
  };
  const onEnter = (ri: number, ci: number): void => {
    if (dragRef.current) setSel((s) => ({ ...s, br: ri, bc: ci }));
  };
  const selColumn = (ci: number): void => setSel({ ar: 0, ac: ci, br: NROWS - 1, bc: ci });
  const selRow = (ri: number): void => setSel({ ar: ri, ac: 0, br: ri, bc: NCOLS - 1 });

  const beginEdit = (ri: number, ci: number): void => {
    setEditing({ ri, ci });
    setEditVal(gridValue(ri, ci));
  };
  const commitEdit = (): void => {
    if (editing) setOverrides((o) => ({ ...o, [cellKey(editing.ri, editing.ci)]: editVal }));
    setEditing(null);
  };
  const cellInner = (ri: number, ci: number): ReactNode =>
    editing && editing.ri === ri && editing.ci === ci ? (
      <input
        className="celledit"
        autoFocus
        value={editVal}
        onChange={(e) => setEditVal(e.target.value)}
        onBlur={commitEdit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commitEdit();
          else if (e.key === 'Escape') setEditing(null);
        }}
        onMouseDown={(e) => e.stopPropagation()}
      />
    ) : (
      fmtValue(t(gridValue(ri, ci)), styles[cellKey(ri, ci)]?.numFmt)
    );

  const selectionContext = (): string => {
    const lines = [`选区 ${rangeLabel}`];
    for (let r = r1; r <= r2; r++) {
      const cells: string[] = [];
      for (let c = c1; c <= c2; c++) cells.push(gridValue(r, c) || '(空)');
      lines.push(cells.join('\t'));
    }
    return lines.join('\n');
  };
  /** 配了 otterpatch-serve 端点 + API Key → 走真实 runtime(propose→diff);否则用内置演示。 */
  const send = async (intentOverride?: string): Promise<void> => {
    if (sendingRef.current) return; // 同步拦截同一帧内的连发,避免把 thread 写成背靠背同角色
    const theIntent = (intentOverride ?? intent).trim();
    if (!theIntent) return; // 空指令不发(否则产生空 user 消息污染历史)
    if (theIntent !== '下一批') autoBatchRun.current = 0; // 手动指令 = 新任务,自动续批计数清零
    if (intentOverride && intentOverride !== intent) setIntent(intentOverride);
    // Excel:永远主动拉整张表(概览+数据+焦点),与是否圈选无关 —— 没圈选也能看全局、也有 read_range/aggregate 工具
    const sheetSnap = isExcel ? (univerRef.current?.getSheet() ?? uniSel) : null;
    // Word:同理主动拉全文快照(逐段全文+样式),供 read_blocks/find_text/get_outline/get_style_usage 按需取 —— 上下文里的截断不再是感知天花板
    const docSnap = fmt === 'word' ? (wordRef.current?.getDocSnapshot() ?? null) : null;
    const selDesc = wordSel ? `${wordSel.block}${wordSel.font ? ' · ' + wordSel.font : ''}${wordSel.size ? ' ' + wordSel.size + 'pt' : ''}${wordSel.bold ? ' 加粗' : ''}${wordSel.italic ? ' 斜体' : ''}${wordSel.align && wordSel.align !== '左对齐' ? ' ' + wordSel.align : ''}` : '';
    const ctx = isExcel ? (sheetSnap?.text ?? '(表格为空)') : fmt === 'drawio' && boardSel ? boardSel.context : fmt === 'word'
      ? `${wordRef.current?.getContext() ?? '(空文档)'}\n(改写正文:给 quote=文档中真实存在的原文片段 + replacement;改格式:给 quote + setStyle 字段,别给 replacement。)`
        + (wordSel ? `\n[当前选区·用户此刻圈选了这段(${selDesc})]:"${wordSel.text}"\n若指令含"这段/这句/这里/选中的/选中/它",优先针对它;quote 用这段真实原文定位。` : '\n[未圈选文字]:请基于整篇文档理解。')
      : selectionContext();
    setSendErr(null);
    const ep = server.trim().replace(/\/$/, '');
    if (ep && apiKey) {
      sendingRef.current = true;
      setBusy(true);
      setSendErr(null);
      setThread((th) => [...th, { role: 'user', text: theIntent }]); // 用户气泡立刻进流
      setIntent('');
      try {
        const resp = await fetch(ep + '/propose-stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ format: fmt, intent: theIntent, context: ctx, provider, model, apiKey, ...(isExcel && sheetSnap?.sheet ? { sheet: sheetSnap.sheet } : {}), ...(docSnap ? { doc: docSnap } : {}), ...(thread.length ? { history: buildHistory(thread) } : {}) }),
        });
        if (!resp.ok || !resp.body) throw new Error('propose failed (' + resp.status + ')');
        if (theIntent.trim()) setRecent((rr) => [{ t: theIntent.trim(), time: t('刚刚') }, ...rr.filter((x) => x.t !== theIntent.trim())].slice(0, 6));
        setSent(true);
        // 占位的流式回答气泡(reasoning + 正文边到边渲染)
        setThread((th) => [...th, { role: 'assistant', kind: 'answer', text: '', reasoning: '', streaming: true }]);
        const upd = (fn: (t: Extract<Turn, { role: 'assistant' }>) => Turn): void => setThread((th) => th.map((tt, i) => (i === th.length - 1 && tt.role === 'assistant' ? fn(tt) : tt)));
        const reader = resp.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        let finished = false;
        // 重置「边生成边画」流式状态
        draftBufRef.current = '';
        drawnOpsRef.current = 0;
        streamConvRef.current = null;
        streamObjsRef.current = [];
        streamByEditRef.current = {};
        while (!finished) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const chunks = buf.split('\n\n');
          buf = chunks.pop() ?? '';
          for (const c of chunks) {
            const line = c.split('\n').find((l) => l.startsWith('data: '));
            if (!line) continue;
            let e: { type: string; delta?: string; name?: string; kind?: string; text?: string; diff?: AgentDiff; changeSet?: unknown; questions?: ClarifyQuestion[]; message?: string };
            try { e = JSON.parse(line.slice(6)); } catch { continue; }
            if (e.type === 'reasoning') upd((tt) => (tt.kind === 'answer' ? { ...tt, reasoning: (tt.reasoning ?? '') + (e.delta ?? '') } : tt));
            else if (e.type === 'answer') upd((tt) => (tt.kind === 'answer' ? { ...tt, text: (tt.text ?? '') + (e.delta ?? '') } : tt));
            else if (e.type === 'tool') upd((tt) => (tt.kind === 'answer' ? { ...tt, reasoning: (tt.reasoning ?? '') + `\n〔查表 ${e.name}〕\n` } : tt));
            else if (e.type === 'draft' && fmt === 'drawio') {
              // 边生成边画:每到一段 propose 入参,抽出已闭合的 op 即时画到左侧画板
              draftBufRef.current += e.delta ?? '';
              const conv = streamConvRef.current ?? (streamConvRef.current = makeRawBoardConv(++applySeqRef.current));
              const ops = extractDrawioOps(draftBufRef.current);
              for (let k = drawnOpsRef.current; k < ops.length; k++) {
                const r = conv(ops[k]!, k);
                if (!r) continue;
                boardRef.current?.addObjects(r.node ? [r.node] : [], r.edge ? [r.edge] : []);
                streamObjsRef.current.push({ editId: r.editId, ...(r.node ? { node: r.node } : {}), ...(r.edge ? { edge: r.edge } : {}) });
                streamByEditRef.current[r.editId] = r.boardId;
              }
              drawnOpsRef.current = ops.length;
            }
            else if (e.type === 'error') throw new Error(e.message ?? 'stream error');
            else if (e.type === 'done') {
              finished = true;
              if (e.kind === 'changeset' && e.diff) {
                const diff = e.diff;
                const cs = e.changeSet ?? null;
                setRealCs(cs);
                setRealDiff(diff);
                setAccepted((prev) => new Set([...prev, ...diff.items.map((it) => akey(diff.changeSetId, it.editId))])); // 合并而非覆写:老回合的处置不被新提案冲掉
                setReviewIdx(0);
                if (fmt === 'drawio') {
                  // drawio:先把【改/删/移动现有节点】落到画板;新增节点则复用流式已画的、或一次性补画
                  const mutBy = applyDrawioMutations(cs);
                  let board: { byEdit: Record<string, string>; objs: Array<{ editId: string; node?: BNode; edge?: BEdge }> };
                  if (streamObjsRef.current.length) {
                    board = { byEdit: { ...streamByEditRef.current, ...mutBy }, objs: streamObjsRef.current };
                  } else {
                    const b = drawioCsToBoard(cs);
                    board = { byEdit: { ...b.byEdit, ...mutBy }, objs: b.objs };
                    if (b.nodes.length || b.edges.length) void playBoard(b.nodes, b.edges); // 兜底:逐个补图
                  }
                  setThread((th) => th.map((tt, i) => (i === th.length - 1 && tt.role === 'assistant' ? { role: 'assistant', kind: 'diff', diff, ops: [], board: { byEdit: board.byEdit, objs: board.objs }, text: tt.kind === 'answer' ? tt.text : undefined, reasoning: tt.kind === 'answer' ? tt.reasoning : undefined } : tt)));
                } else if (fmt === 'word') {
                  // Word:从 changeSet 取每条 edit —— 文本改写(replaceText)或格式(setStyle),按 diff 顺序建审阅项
                  const wcs = cs as { edits?: Array<{ id: string; target: string; op?: { kind?: string; text?: string; style?: DocFmt } }>; anchors?: Record<string, { portable?: { quote?: { text?: string } } }> } | null;
                  const byId = new Map((wcs?.edits ?? []).map((e) => [e.id, { quote: wcs?.anchors?.[e.target]?.portable?.quote?.text ?? '', op: e.op }]));
                  const wordEdits: WordEdit[] = diff.items.map((it) => {
                    const rec = byId.get(it.editId);
                    const quote = rec?.quote ?? it.ref;
                    const domId = `${diff.changeSetId}::${it.editId}`; // 跨回合唯一,避免 e0/e1 撞名误还原
                    if (rec?.op?.kind === 'setStyle') return { editId: it.editId, domId, quote, style: rec.op.style ?? {} };
                    return { editId: it.editId, domId, quote, replacement: rec?.op?.text ?? (it.after ?? '') };
                  });
                  // 乐观落入文档(与 Excel playOps 一致);编辑器按 domId 包裹,拒绝可精确还原
                  wordRef.current?.closeUndoWindow(); // 新提案=上一轮撤销窗口关闭,旧 data-undo 剥净后再落新标记
                  for (const w of wordEdits) wordRef.current?.applyEdit(w.domId, w.quote, w.style ? { fmt: w.style } : { replacement: w.replacement ?? '' });
                  setThread((th) => th.map((tt, i) => (i === th.length - 1 && tt.role === 'assistant' ? { role: 'assistant', kind: 'diff', diff, ops: [], word: wordEdits, text: tt.kind === 'answer' ? tt.text : undefined, reasoning: tt.kind === 'answer' ? tt.reasoning : undefined } : tt)));
                  setReviewIdx(0);
                  if (wordEdits[0]) wordRef.current?.highlight(wordEdits[0].domId); // 审阅期定位第一条
                } else {
                  applyExcelStructure(cs); // 结构性操作(插删行列/合并/冻结/清空)先落,改变网格布局
                  const ops = diffToOps(diff);
                  const api = univerRef.current; // 采集整格改前状态(值/公式/填充/字色/加粗),供 git-diff 展示 + "撤销/拒绝"精确还原
                  if (api) for (const op of ops) { op.before = api.getValue(op.a1); op.beforeState = api.getCellState(op.a1); }
                  setExcelDiff('final'); // 新提案到达,速览条回到"改后"基准
                  setThread((th) => th.map((tt, i) => (i === th.length - 1 && tt.role === 'assistant' ? { role: 'assistant', kind: 'diff', diff, ops, text: tt.kind === 'answer' ? tt.text : undefined, reasoning: tt.kind === 'answer' ? tt.reasoning : undefined } : tt)));
                  if (ops.length) void playOps(ops); // 边画边改
                }
              } else if (e.kind === 'clarify' && e.questions?.length) {
                const qs = e.questions;
                // 把流式占位气泡替换成"引导选择"卡片(保留刚才的思考过程)
                setThread((th) => th.map((tt, i) => (i === th.length - 1 && tt.role === 'assistant' ? { role: 'assistant', kind: 'clarify', questions: qs, reasoning: tt.kind === 'answer' ? tt.reasoning : undefined } : tt)));
              } else {
                upd((tt) => (tt.kind === 'answer' ? { ...tt, text: e.text ?? tt.text, streaming: false } : tt));
              }
            }
          }
        }
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        const refused = /failed to fetch|refused|ECONNREFUSED|networkerror|load failed/i.test(m);
        // 回滚乐观追加的占位气泡 + user 气泡,避免 thread 残留(下次会拼成背靠背)
        setThread((th) => {
          let r = th;
          const last = r[r.length - 1];
          if (last?.role === 'assistant' && last.kind === 'answer' && last.streaming) r = r.slice(0, -1);
          if (r[r.length - 1]?.role === 'user') r = r.slice(0, -1);
          return r;
        });
        setIntent(theIntent); // 把指令放回输入框,方便重试
        setSendErr(
          refused
            ? `连不上本机 Agent 服务(${ep})。改了代码后请在项目根目录跑 npm run serve 重启它(会先重新构建再启动,确保用上最新能力)。`
            : 'Agent · ' + m,
        );
      } finally {
        setBusy(false);
        sendingRef.current = false;
      }
      return;
    }
    // 未配置 serve+Key:不再用 mock,提示连接真实 Agent
    setCfgOpen(true);
    setSendErr('未填写 API Key。请在下方「模型」里粘贴你所选厂商的 API Key(本机服务地址已默认填好),即可用真实大模型驱动表格。');
  };
  /** 退出「本次改动」回到建议视图,可发起新指令。 */
  const resetDiff = (): void => {
    setSent(false);
    setRealDiff(null);
    setRealCs(null);
    setAccepted(new Set());
    setPlayList([]);
    setPlayIdx(-1);
    setAnswer(null);
  };
  /** 开启新对话:清空多轮历史 + 当前视图。 */
  const newConversation = (): void => {
    setThread([]);
    resetDiff();
    setSendErr(null);
    setAccepted(new Set()); // 处置记账随对话清零
    wordRef.current?.closeUndoWindow();
  };
  /** 撤销某条改动:把该回合写过的格子还原到改前值,并清掉它加的底色。 */
  const revertTurn = (idx: number): void => {
    const turn = thread[idx];
    if (!turn || turn.role !== 'assistant' || turn.kind !== 'diff') return;
    if (turn.board) {
      boardRef.current?.removeObjects(Object.values(turn.board.byEdit)); // drawio:从画板移除该回合对象
    } else if (turn.word) {
      let missed = 0;
      for (const w of turn.word) if (accepted.has(akey(turn.diff.changeSetId, w.editId))) { if (!wordRef.current?.revert(w.domId)) missed++; } // 按 domId 精确还原每条(undoMap 缺失走 DOM 兜底)
      if (missed) notify(t('部分改动已定稿,无法自动回退') + ` · ${missed}`);
    } else {
      for (const op of turn.ops) revertGridOp(op); // 走维度级精确回放(公式/填充/加粗不丢)
    }
    setThread((th) => th.map((tt, i) => (i === idx ? ({ ...tt, reverted: true } as Turn) : tt)));
    notify(t('已撤销该回合改动'));
  };
  /** 标记某条改动已被用户接受(写进投影历史,让 Agent 知道改动已采纳)。 */
  const markCommitted = (idx: number, count: number): void => {
    setThread((th) => th.map((tt, i) => (i === idx && tt.role === 'assistant' && tt.kind === 'diff' ? ({ ...tt, committed: true, committedCount: count } as Turn) : tt)));
  };
  /** 用户提交澄清选择:锁定该卡片 + 把选择作为新一轮指令发回(thread 续接,Agent 据此继续或再追问)。 */
  const submitClarify = (idx: number, text: string): void => {
    setThread((th) => th.map((tt, i) => (i === idx && tt.role === 'assistant' && tt.kind === 'clarify' ? ({ ...tt, answered: true, answerText: text } as Turn) : tt)));
    void send(text);
  };

  // ── Agent「边画边改」可视化:把操作逐步播放到 Univer 网格,用户看着它一格格地改 ──
  const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
  const CINEMATIC_MAX = 10; // ≤ 此数才逐格电影感;更多则区域整体 + 分块快速应用,避免一格格爬
  const playOps = async (ops: GridOp[]): Promise<void> => {
    const api = univerRef.current;
    if (!api || !ops.length) return;
    setPlayList(ops);
    setPlaying(true);
    setSent(true);
    if (ops.length <= CINEMATIC_MAX) {
      // 少量:逐格电影感(光标移动 + 落笔闪蓝 + 落定)
      for (let i = 0; i < ops.length; i++) {
        const op = ops[i]!;
        setPlayIdx(i);
        api.focus(op.a1);
        await delay(220);
        api.setBackground(op.a1, '#dbeafe');
        await delay(120);
        if (op.value !== undefined) api.setCell(op.a1, op.value);
        if (op.bold) api.setBold(op.a1);
        if (op.color) api.setFontColor(op.a1, op.color);
        if (op.numFmt) api.setNumberFormat(op.a1, op.numFmt);
        await delay(240);
        api.setBackground(op.a1, op.bg ?? null);
        await delay(140);
      }
    } else {
      // 大批量:先聚焦整体区域(让用户看到"在改这一片"),再分块成批写入 + 进度条
      const region = boundingA1(ops);
      if (region) api.focus(region);
      await delay(120);
      const CHUNK = 24;
      for (let i = 0; i < ops.length; i += CHUNK) {
        const end = Math.min(i + CHUNK, ops.length);
        for (let k = i; k < end; k++) applyGridOp(ops[k]!); // 一块内同步写,Univer 合并渲染
        setPlayIdx(end);
        await delay(20); // 让进度条刷新一帧
      }
    }
    setPlayIdx(ops.length);
    setPlaying(false);
  };
  /** drawio 兜底:provider 不流式吐入参时,在 done 后把对象逐个补到画板(保留"边画"观感)。 */
  const playBoard = async (nodes: BNode[], edges: BEdge[]): Promise<void> => {
    for (const n of nodes) { boardRef.current?.addObjects([n], []); await delay(75); }
    for (const ed of edges) { boardRef.current?.addObjects([], [ed]); await delay(45); }
  };
  /** 把结构性改动(插删行列/合并/冻结/清空)从 ChangeSet 直接落到真实 Univer 网格(不走单元格播放)。 */
  const a1RowCol = (a1: string): { row: number; col: number } => {
    const m = /([A-Za-z]+)([0-9]+)/.exec((a1.replace(/^.*!/, '').split(':')[0]) ?? 'A1');
    let c = 0;
    if (m) for (const ch of m[1]!.toUpperCase()) c = c * 26 + (ch.charCodeAt(0) - 64);
    return { col: m ? c - 1 : 0, row: m ? parseInt(m[2]!, 10) - 1 : 0 };
  };
  const applyExcelStructure = (cs: unknown): void => {
    const api = univerRef.current;
    const c = cs as { edits?: Array<{ target: string; op: { kind?: string; count?: number; before?: boolean; rows?: number; cols?: number; by?: number; asc?: boolean; when?: string; v1?: number | string; v2?: number; rule?: string; list?: string[]; min?: number; max?: number; v?: number; style?: { bgColor?: string; color?: string; bold?: boolean; italic?: boolean }; chartType?: 'bar' | 'line' | 'pie'; title?: string; range?: string; categories?: string[]; series?: { name?: string; data?: number[] }[]; anchor?: string } }>; anchors?: Record<string, { portable?: { a1?: string } }> } | null;
    if (!api || !c?.edits) return;
    const colA = (n: number): string => { let s = ''; let x = n + 1; while (x > 0) { const r = (x - 1) % 26; s = String.fromCharCode(65 + r) + s; x = Math.floor((x - 1) / 26); } return s; };
    for (const e of c.edits) {
      const k = e.op?.kind ?? '';
      if (!ADV_KINDS.has(k)) continue;
      const a1 = (c.anchors?.[e.target]?.portable?.a1 ?? 'A1').replace(/^.*!/, '');
      const { row, col } = a1RowCol(a1);
      const n = e.op?.count ?? 1;
      if (k === 'insertRows') api.insertRows(e.op?.before === false ? row + 1 : row, n);
      else if (k === 'deleteRows') api.deleteRows(row, n);
      else if (k === 'insertCols') api.insertCols(e.op?.before === false ? col + 1 : col, n);
      else if (k === 'deleteCols') api.deleteCols(col, n);
      else if (k === 'mergeCells') api.mergeRange(a1);
      else if (k === 'unmergeCells') api.unmergeRange(a1);
      else if (k === 'freezePanes') api.freeze(e.op?.rows ?? 0, e.op?.cols ?? 0);
      else if (k === 'sortRange') api.sortRange(a1, e.op?.by ?? 0, e.op?.asc ?? true);
      else if (k === 'deleteRange') api.clearRange(a1);
      else if (k === 'conditionalFormat') api.conditionalFormat(a1, { when: e.op?.when ?? 'notEmpty', v1: e.op?.v1, v2: e.op?.v2 }, e.op?.style ?? {});
      else if (k === 'dataValidation') api.dataValidation(a1, { kind: e.op?.rule ?? 'list', list: e.op?.list, min: e.op?.min, max: e.op?.max, v: e.op?.v });
      else if (k === 'autoFilter') api.createFilter(a1);
      else if (k === 'insertChart') {
        const inline = (e.op?.categories?.length ?? 0) > 0;
        let spec = null;
        if (inline) {
          // 内联模式(透视图首选):Agent 直接给 categories/series,不往表里写汇总表,主表保持干净。
          spec = specFromInline(e.op?.chartType ?? 'bar', e.op?.title ?? '图表', e.op?.categories, e.op?.series);
        } else {
          // 范围模式:对已有/同 changeset 写入的数据范围画图。用"本次写入值优先 + 改前实时值"叠加,避开落值时序。
          const written = new Map<string, unknown>();
          for (const ed of c.edits) {
            const ek = ed.op?.kind;
            if (ek !== 'setValue' && ek !== 'setFormula') continue;
            const ea1 = (c.anchors?.[ed.target]?.portable?.a1 ?? '').replace(/^.*!/, '').toUpperCase();
            const ev = (ed.op as { value?: unknown; formula?: string }).value ?? (ed.op as { formula?: string }).formula;
            if (ea1 && ev !== undefined) written.set(ea1, ev);
          }
          const grid = buildChartGrid(a1, written, (cell) => api.getValue(cell)); // a1 = 含表头的数据范围
          if (grid.length && (grid[0]?.length ?? 0)) spec = gridToChartSpec(grid, e.op?.chartType ?? 'bar', e.op?.title ?? '图表');
        }
        if (spec && spec.categories.length && spec.series.length) {
          const png = chartToPngDataUrl(spec);
          let place: string;
          if (inline) {
            place = a1; // 内联模式:a1 = Agent 给的放置锚点格
          } else {
            const end = (a1.split(':')[1] ?? a1.split(':')[0] ?? 'A1'); // 范围模式:放到数据范围右侧两列处
            const ec = a1RowCol(end);
            place = colA(ec.col + 2) + (a1RowCol(a1.split(':')[0] ?? 'A1').row + 1);
          }
          api.insertChartImage(place, png, 640, 400);
        }
      }
    }
  };
  /** 把 Agent 返回的 diff 转成可播放的网格操作:setStyle→真实底色/字色/加粗;否则写值。 */
  const diffToOps = (d: AgentDiff): GridOp[] =>
    d.items
      .filter((it) => it.ref && !ADV_KINDS.has(it.kind ?? '')) // 结构/对象操作(插图表/条件格式/筛选…)走 applyExcelStructure,别当单元格值写
      .map((it) => {
        const a1 = it.ref.replace(/^.*!/, ''); // 去掉 Sheet1! 前缀,落到当前表
        const s = it.style;
        // 数字格式:只改格式、绝不写值(否则会把 "0%" 当文本覆盖数据)
        if (s?.numberFormat) {
          return { a1, numFmt: s.numberFormat, note: it.label ?? it.badge, editId: it.editId };
        }
        if (s && (s.bgColor || s.color || s.bold)) {
          return {
            a1,
            ...(s.bgColor ? { bg: s.bgColor } : {}),
            ...(s.color ? { color: s.color } : {}),
            ...(s.bold ? { bold: true } : {}),
            note: it.label ?? it.badge,
            editId: it.editId,
          };
        }
        return { a1, ...(it.after != null ? { value: it.after } : {}), note: it.label ?? it.badge, editId: it.editId };
      });
  /** drawio:把 Agent 的 ChangeSet 转成画板节点/连线(画板内唯一 id,保持 source/target 一致映射)。 */
  const drawioCsToBoard = (cs: unknown): { nodes: BNode[]; edges: BEdge[]; byEdit: Record<string, string>; objs: Array<{ editId: string; node?: BNode; edge?: BEdge }> } => {
    const seq = ++applySeqRef.current;
    const edits = (cs as { edits?: Array<{ id: string; op: { kind: string; payload?: unknown } }> } | null)?.edits ?? [];
    const idMap = new Map<string, string>();
    const bid = (orig?: string): string => { const k = orig ?? ('?' + idMap.size); let v = idMap.get(k); if (!v) { v = `g${seq}_${idMap.size + 1}`; idMap.set(k, v); } return v; };
    const nodes: BNode[] = []; const edges: BEdge[] = []; const byEdit: Record<string, string> = {}; const objs: Array<{ editId: string; node?: BNode; edge?: BEdge }> = [];
    let stackY = 60;
    for (const e of edits) {
      if (e.op?.kind !== 'addObject') continue;
      const p = (e.op.payload ?? {}) as { id?: string; value?: string; style?: string; edge?: boolean; source?: string; target?: string; geometry?: { x?: number; y?: number; width?: number; height?: number } };
      if (p.edge || (p.source && p.target)) {
        const id = bid(p.id ?? 'e_' + e.id);
        const edge: BEdge = { id, from: bid(p.source), to: bid(p.target), arrow: 'classic', style: 'ortho' };
        edges.push(edge); byEdit[e.id] = id; objs.push({ editId: e.id, edge });
      } else {
        const id = bid(p.id ?? 'n_' + e.id);
        const g = p.geometry ?? {};
        const w = g.width ?? 160; const h = g.height ?? 48;
        const x = g.x ?? 60; const y = g.y ?? stackY; stackY = Math.max(stackY, y) + h + 40;
        const st = parseDrawioStyle(p.style);
        const node: BNode = { id, x: snap(x), y: snap(y), w, h, inner: innerForStyle(p.style), label: String(p.value ?? ''), kind: st.text ? 'text' : 'agent', ...st };
        nodes.push(node); byEdit[e.id] = id; objs.push({ editId: e.id, node });
      }
    }
    return { nodes, edges, byEdit, objs };
  };
  /** drawio:把【改/删/移动现有节点】op 落到画板(用上下文给 Agent 的真实节点 id 定位),返回 editId→节点id 供审阅高亮。 */
  const applyDrawioMutations = (cs: unknown): Record<string, string> => {
    const c = cs as { edits?: Array<{ id: string; target: string; op: { kind?: string; props?: { value?: unknown; style?: unknown }; box?: { left?: number; top?: number; width?: number; height?: number } } }>; anchors?: Record<string, { portable?: { elementId?: string } }> } | null;
    const byEdit: Record<string, string> = {};
    if (!c?.edits) return byEdit;
    for (const e of c.edits) {
      const k = e.op?.kind;
      if (k !== 'setObjectProps' && k !== 'deleteObject' && k !== 'moveObject') continue;
      const id = c.anchors?.[e.target]?.portable?.elementId;
      if (!id) continue;
      byEdit[e.id] = id;
      if (k === 'setObjectProps') boardRef.current?.updateObject(id, { value: e.op.props?.value as string | undefined, style: e.op.props?.style as string | undefined });
      else if (k === 'deleteObject') boardRef.current?.removeObjects([id]);
      else if (k === 'moveObject') boardRef.current?.moveObject(id, { x: e.op.box?.left, y: e.op.box?.top, w: e.op.box?.width, h: e.op.box?.height });
    }
    return byEdit;
  };
  // ── 逐条审阅:把单条改动应用/还原到左侧工作区(Excel 网格 / drawio 画板)+ 高亮当前条 ──
  const applyGridOp = (op: GridOp): void => {
    const api = univerRef.current; if (!api) return;
    if (op.value !== undefined) api.setCell(op.a1, op.value);
    if (op.bold) api.setBold(op.a1);
    if (op.color) api.setFontColor(op.a1, op.color);
    if (op.numFmt) api.setNumberFormat(op.a1, op.numFmt);
    if (op.bg != null) api.setBackground(op.a1, op.bg); // 只有真提了底色才动背景,别把用户原有填充抹掉
  };
  const revertGridOp = (op: GridOp): void => {
    const api = univerRef.current; if (!api) return;
    const bs = op.beforeState; // 改了哪个维度还原哪个维度(两条 op 同格时互不误伤)
    if (op.value !== undefined) { if (bs?.f) api.setCell(op.a1, bs.f); else api.setCell(op.a1, (bs ? bs.v : op.before) ?? ''); } // 公式格回公式,不落算后值
    if (op.bg != null) api.setBackground(op.a1, bs?.bg ?? null);
    if (op.color) api.setFontColor(op.a1, bs?.color ?? '#1f2937');
    if (op.bold) api.setBold(op.a1, bs?.bold ?? false);
  };
  /** Excel 改动的"原文/改后"速览:原文=全部回改前;改后=按当前处置回放(被拒的不复活)。 */
  const applyExcelDiffView = (view: 'orig' | 'final'): void => {
    let turn: Extract<Turn, { kind: 'diff' }> | undefined;
    for (let i = thread.length - 1; i >= 0; i--) { const tt = thread[i]; if (tt && tt.role === 'assistant' && tt.kind === 'diff' && tt.ops.length) { turn = tt; break; } }
    if (!turn) return;
    for (const op of turn.ops) {
      if (view === 'orig') revertGridOp(op);
      else if (op.editId && accepted.has(akey(turn.diff.changeSetId, op.editId))) applyGridOp(op);
      else revertGridOp(op);
    }
    setExcelDiff(view);
  };
  const reapplyBoardObj = (o: { node?: BNode; edge?: BEdge }): void =>
    boardRef.current?.addObjects(o.node ? [o.node] : [], o.edge ? [o.edge] : []);
  /** 高亮当前审阅的改动:Excel 聚焦该格、drawio 高亮该对象。 */
  const highlightItem = (turn: Extract<Turn, { kind: 'diff' }>, item: AgentDiffItem | undefined): void => {
    if (!item) return;
    if (isExcel) univerRef.current?.focus(item.ref.replace(/^.*!/, ''));
    else if (fmt === 'drawio') { const id = turn.board?.byEdit[item.editId]; if (id) boardRef.current?.highlight(id); }
    else if (fmt === 'word') { const w = turn.word?.find((x) => x.editId === item.editId); if (w) wordRef.current?.highlight(w.domId); } // 定位当前条
  };
  /** 接受率飞轮:按 格式×改动类型 统计逐条处置,localStorage 持久化;接受率最低的类别就是 skills/prompt 下一轮的靶子。
   *  控制台 window.__otterTelemetry() 可随时查看汇总。 */
  const telemetry = (verb: 'accept' | 'reject', kind: string): void => {
    try {
      const t = JSON.parse(localStorage.getItem('oa.telemetry') ?? '{}') as Record<string, Record<string, { accept: number; reject: number }>>;
      const f = (t[fmt] ??= {});
      const k = (f[kind] ??= { accept: 0, reject: 0 });
      k[verb]++;
      localStorage.setItem('oa.telemetry', JSON.stringify(t));
    } catch { /* 配额/解析问题不影响主流程 */ }
  };
  /** 一条审阅项的改动类型(遥测口径):word=text/style,excel=value/style/structure,drawio=object。 */
  const itemKind = (turn: Extract<Turn, { kind: 'diff' }>, it: AgentDiffItem): string => {
    if (fmt === 'word') { const w = turn.word?.find((x) => x.editId === it.editId); return w?.style || it.style ? 'style' : 'text'; }
    if (isExcel) { const op = turn.ops.find((o) => o.editId === it.editId); if (!op) return 'structure'; return op.value !== undefined ? 'value' : 'style'; }
    if (fmt === 'drawio') return 'object';
    return 'other';
  };
  const acceptItem = (turn: Extract<Turn, { kind: 'diff' }>, idx: number, silent = false): void => {
    const it = turn.diff.items[idx]; if (!it) return;
    const k = akey(turn.diff.changeSetId, it.editId);
    if (!accepted.has(k)) { // 之前被拒 → 重新落回工作区(applyEdit 幂等,重复接受不叠标记)
      if (isExcel) { const op = turn.ops.find((o) => o.editId === it.editId); if (op) applyGridOp(op); }
      else if (fmt === 'drawio') { const o = turn.board?.objs.find((x) => x.editId === it.editId); if (o) reapplyBoardObj(o); }
      else if (fmt === 'word') { const w = turn.word?.find((x) => x.editId === it.editId); if (w) wordRef.current?.applyEdit(w.domId, w.quote, w.style ? { fmt: w.style } : { replacement: w.replacement ?? '' }); }
      toggleAccept(k, true);
    }
    if (fmt === 'word') { const w = turn.word?.find((x) => x.editId === it.editId); if (w) wordRef.current?.markResolved(w.domId, 'accepted'); } // 物理定稿:删 del、ins 落地
    telemetry('accept', itemKind(turn, it));
    if (!silent) setReviewIdx(idx + 1);
  };
  /** 行内卡片 ✓/✕ → 复用 rail 的接受/拒绝(按 domId 找回条目);老回合的处置不动当前回合的审阅游标。 */
  const resolveByCid = (domId: string, verb: 'accept' | 'reject'): void => {
    let lastDiff = -1;
    for (let i = thread.length - 1; i >= 0; i--) { const tt = thread[i]; if (tt && tt.role === 'assistant' && tt.kind === 'diff') { lastDiff = i; break; } }
    for (let i = thread.length - 1; i >= 0; i--) {
      const tt = thread[i];
      if (!tt || tt.role !== 'assistant' || tt.kind !== 'diff' || !tt.word) continue;
      const w = tt.word.find((x) => x.domId === domId); if (!w) continue;
      const idx = tt.diff.items.findIndex((it) => it.editId === w.editId); if (idx < 0) return;
      const silent = i !== lastDiff;
      if (verb === 'accept') acceptItem(tt, idx, silent); else rejectItem(tt, idx, silent);
      return;
    }
  };
  const rejectItem = (turn: Extract<Turn, { kind: 'diff' }>, idx: number, silent = false): void => {
    const it = turn.diff.items[idx]; if (!it) return;
    const k = akey(turn.diff.changeSetId, it.editId);
    if (isExcel) { const op = turn.ops.find((o) => o.editId === it.editId); if (op) revertGridOp(op); }
    else if (fmt === 'drawio') { const id = turn.board?.byEdit[it.editId]; if (id) boardRef.current?.removeObjects([id]); }
    else if (fmt === 'word') { const w = turn.word?.find((x) => x.editId === it.editId); if (w && !wordRef.current?.revert(w.domId) && accepted.has(k)) notify(t('该改动已定稿,未找到可还原的位置')); } // undoMap 缺失时 revert 自带 DOM 兜底
    toggleAccept(k, false);
    telemetry('reject', itemKind(turn, it));
    if (!silent) setReviewIdx(idx + 1);
  };
  const acceptAll = (turn: Extract<Turn, { kind: 'diff' }>, ti: number): void => {
    for (const it of turn.diff.items) {
      if (accepted.has(akey(turn.diff.changeSetId, it.editId))) continue;
      if (isExcel) { const op = turn.ops.find((o) => o.editId === it.editId); if (op) applyGridOp(op); }
      else if (fmt === 'drawio') { const o = turn.board?.objs.find((x) => x.editId === it.editId); if (o) reapplyBoardObj(o); }
      else if (fmt === 'word') { const w = turn.word?.find((x) => x.editId === it.editId); if (w) wordRef.current?.applyEdit(w.domId, w.quote, w.style ? { fmt: w.style } : { replacement: w.replacement ?? '' }); }
    }
    if (fmt === 'word') for (const w of turn.word ?? []) wordRef.current?.markResolved(w.domId, 'accepted'); // 全部接受同样物理定稿,与逐条路径一致
    for (const it of turn.diff.items) telemetry('accept', itemKind(turn, it)); // 批量确认也计入接受
    const all = turn.diff.items.map((x) => x.editId);
    setAccepted((prev) => new Set([...prev, ...turn.diff.items.map((x) => akey(turn.diff.changeSetId, x.editId))]));
    setReviewIdx(all.length);
    markCommitted(ti, all.length);
    if (isExcel && fileB64) void doCommit(all); // 有上传文件 → 外科写回并下载
    else notify((fmt === 'drawio' ? t('已采纳到画板') : fmt === 'word' ? t('已采纳到文档') : t('已采纳到表格')) + ' · ' + all.length + ' ' + t('处'));
    // 自动续批:plan 声明了分批 + 开关开着 → 采纳后自动续发(串行,每批重新锚定+校验+审阅;上限防失控)
    if (autoBatch && BATCH_RX.test(turn.diff.intent ?? '')) {
      if (autoBatchRun.current >= AUTO_BATCH_CAP) { notify(t('自动续批已达上限,请确认后手动继续')); return; }
      autoBatchRun.current++;
      window.setTimeout(() => { void send('下一批'); }, 900);
    }
  };
  /** 读入要写回的真实文件(.xlsx/.docx/.pdf/.drawio)为 base64;Word 的 .docx 同时解析渲染进工作区(hero 闭环)。 */
  const onFile = (f: File | undefined): void => {
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const res = String(reader.result);
      const b64 = res.slice(res.indexOf(',') + 1);
      setFileB64(b64);
      setFileName(f.name);
      if (fmt === 'word' && /\.docx$/i.test(f.name)) {
        try {
          const bin = atob(b64);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          const r = docxToHtml(bytes);
          wordRef.current?.loadHTML(r.html);
          notify(t('已载入并渲染') + ' · ' + f.name + (r.skipped.length ? `(${r.skipped.join('、')}${t('以占位显示')})` : ''));
          return;
        } catch (e) {
          notify(t('已载入(渲染失败,仍可写回)') + ':' + (e instanceof Error ? e.message : String(e)));
          return;
        }
      }
      notify(t('已载入') + ' · ' + f.name);
    };
    reader.readAsDataURL(f);
  };
  const downloadB64 = (b64: string, name: string): void => {
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([arr]));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };
  const outName = (n: string): string => {
    const dot = n.lastIndexOf('.');
    return dot > 0 ? n.slice(0, dot) + '.otterpatch' + n.slice(dot) : (n || 'out') + '.otterpatch';
  };
  const toggleAccept = (id: string, on: boolean): void =>
    setAccepted((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  /** 接受子集 → otterpatch-serve /commit → 外科写回 → 下载结果文件。 */
  const doCommit = async (ids: string[]): Promise<void> => {
    const ep = server.trim().replace(/\/$/, '');
    if (!ep || !realCs) {
      notify(t('请先用 otterpatch-serve 生成提案'));
      return;
    }
    if (!fileB64) {
      notify(t('请先上传要写回的文件'));
      return;
    }
    if (!ids.length) {
      notify(t('没有要接受的改动'));
      return;
    }
    setBusy(true);
    try {
      const r = await fetch(ep + '/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format: fmt, fileBase64: fileB64, changeSet: realCs, acceptedEditIds: ids }),
      });
      const data = (await r.json()) as { ok?: boolean; fileBase64?: string; touchedParts?: string[]; fidelity?: { score: number }; appliedEditIds?: string[]; droppedEdits?: Array<{ editId: string; reason: string }>; error?: string };
      if (!r.ok || !data.fileBase64) throw new Error(data.error ?? 'commit failed');
      downloadB64(data.fileBase64, outName(fileName));
      const droppedN = data.droppedEdits?.length ?? 0;
      if (droppedN > 0) {
        // 诚实写回:有 edit 没落盘就不报"成功",明确写了几条、丢了几条、为什么。
        notify('⚠ ' + t('部分写回') + ' · ' + t('已写') + ' ' + (data.appliedEditIds?.length ?? 0) + ' · ' + t('丢弃') + ' ' + droppedN + ' · ' + (data.droppedEdits?.[0]?.reason ?? ''));
      } else {
        notify(t('已写回') + ' · ' + (data.touchedParts?.join(', ') ?? '') + ' · ' + Math.round((data.fidelity?.score ?? 1) * 100) + '%');
      }
    } catch (e) {
      notify('Commit · ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  };
  const openDrop = (it: string, el: HTMLElement): void => {
    const r = el.getBoundingClientRect();
    setDrop({ key: it, x: Math.min(r.left, window.innerWidth - 250), y: r.bottom + 3 });
  };
  const notify = (msg: string): void => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 1600);
  };
  /** 每个功能都可用:格式化命令真实套用到选区,有下拉的开面板,其余给执行反馈。 */
  const act = (it: string, el: HTMLElement): void => {
    if (isExcel && FMT_BIU[it]) {
      toggleFmt(FMT_BIU[it]);
      notify(t('执行') + ' · ' + t(it));
      return;
    }
    if (isExcel && FMT_ALIGN[it]) {
      applyFmt({ align: FMT_ALIGN[it] });
      notify(t('执行') + ' · ' + t(it));
      return;
    }
    if (DROPDOWNS[it]) openDrop(it, el);
    else notify(t('执行') + ' · ' + t(it));
  };
  const pick = (v: string): void => {
    const key = drop?.key;
    if (isExcel && key) {
      if (key === '字体颜色') applyFmt({ color: v });
      else if (key === '填充色' || key === '突出显示') applyFmt({ bg: v });
      else if (key === '常规') applyFmt({ numFmt: v });
      else if (key === '字号') applyFmt({ size: v });
      else if (key === '字体') applyFmt({ font: v });
    }
    notify(t('应用') + ' · ' + t(v));
    setDrop(null);
  };

  // 对话流里最后一条改动(仅它可交互:接受/提交);更早的改动转为只读 + 可撤销
  let lastDiffIdx = -1;
  for (let i = thread.length - 1; i >= 0; i--) {
    const tt = thread[i];
    if (tt && tt.role === 'assistant' && tt.kind === 'diff') {
      lastDiffIdx = i;
      break;
    }
  }

  // 审阅当前条 → 在左侧工作区高亮它(Excel 聚焦该格 / drawio 高亮该对象),逐条引导
  useEffect(() => {
    let li = -1;
    for (let i = thread.length - 1; i >= 0; i--) { const tt = thread[i]; if (tt && tt.role === 'assistant' && tt.kind === 'diff') { li = i; break; } }
    if (li < 0) return;
    const turn = thread[li];
    if (!turn || turn.role !== 'assistant' || turn.kind !== 'diff' || turn.committed || turn.reverted) return;
    if (reviewIdx >= turn.diff.items.length) return;
    highlightItem(turn, turn.diff.items[reviewIdx]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewIdx, lastDiffIdx, thread.length, fmt]);

  return (
    <TContext.Provider value={t}>
      <div className="app">
        <TopBar
          formats={FORMATS}
          fmt={fmt}
          fileLabel={curFmt.file}
          lang={lang}
          onPickFormat={(id) => { setFmt(id as typeof fmt); lsSet('oa.fmt', id); setTab(0); }}
          onPickLang={pickLang}
        />

        <main className={'body' + (fmt === 'drawio' ? ' three' : '')}>
          {fmt === 'drawio' && <DrawioPalette onPick={(s) => notify(t('插入形状') + ' · ' + s)} />}
          <section className="editor">
            {fmt === 'drawio' ? (
              <DrawioToolbar onAct={act} />
            ) : fmt === 'excel' || fmt === 'word' ? null : (
            <div className="ribbon">
              <div className="ribbon-tabs">
                {RIBBONS[fmt].map((rt, i) => (
                  <button key={rt.name} className={'rtab' + (i === tab ? ' on' : '')} onClick={() => setTab(i)}>
                    {t(rt.name)}
                  </button>
                ))}
              </div>
              <div className="ribbon-bar">
                {(RIBBONS[fmt][tab] ?? RIBBONS[fmt][0]!).groups.map((g) => {
                  const isStyle = g.items.some((it) => STYLE_KIND[it]);
                  return (
                    <div className="rgroup" key={g.name}>
                      <div className="rgbody">
                        {isStyle ? (
                          <div className="rstyles">
                            {g.items.map((it) => (
                              <button
                                key={it}
                                className={'rstyle st-' + (STYLE_KIND[it] ?? 'body')}
                                title={t(it)}
                                onClick={() => notify(t('应用样式') + ' · ' + t(it))}
                              >
                                {t(it)}
                              </button>
                            ))}
                          </div>
                        ) : (
                          buildCells(g.items).map((cell, ci) =>
                            cell.t === 'combo' ? (
                              <ComboCell key={ci} it={cell.it} onOpen={act} />
                            ) : cell.t === 'big' ? (
                              <BigCell key={ci} it={cell.it} onOpen={act} />
                            ) : (
                              <div className="rsmall-grid" key={ci}>
                                {cell.items.map((it) => (
                                  <SmallCell key={it} it={it} onOpen={act} />
                                ))}
                              </div>
                            ),
                          )
                        )}
                      </div>
                      <div className="rgname">{t(g.name)}</div>
                    </div>
                  );
                })}
              </div>
            </div>
            )}
            <div className={'canvas' + (isExcel ? ' excel' : fmt === 'drawio' ? ' board' : fmt === 'word' ? ' worddoc' : ' doc')}>
              {isExcel ? (
                <>
                  {thread.some((tt) => tt.role === 'assistant' && tt.kind === 'diff' && tt.ops.length > 0) ? (
                    <div className="rd-difftoggle excel-difftoggle" role="group" aria-label="Excel 改动视图">
                      <span className="rd-dt-lb"><span className="rd-dt-dot" />Agent 改动</span>
                      {([['orig', '原文'], ['final', '改后']] as const).map(([v, lb]) => (
                        <button key={v} className={'rd-dt-seg' + (excelDiff === v ? ' on' : '')} onMouseDown={(e) => { e.preventDefault(); applyExcelDiffView(v); }} title={v === 'orig' ? '看改前的值' : '看改后的值'}>{lb}</button>
                      ))}
                    </div>
                  ) : null}
                  <Suspense fallback={<div className="univer-loading">{t('加载表格引擎…')}</div>}>
                    <UniverSheet ref={univerRef} onSelection={setUniSel} />
                  </Suspense>
                </>
              ) : fmt === 'drawio' ? (
                <DrawioBoard ref={boardRef} onBoardSel={setBoardSel} />
              ) : fmt === 'word' ? (
                <Suspense fallback={<div className="univer-loading">{t('加载文档编辑器…')}</div>}>
                  <RichDoc ref={wordRef} onSelection={setWordSel} onChangeHover={setHoverCid} onChangeResolve={resolveByCid} />
                </Suspense>
              ) : (
                <div className="doc-page">
                  <div className="canvas-ph">
                    <div className="ph-badge"><IconDoc size={26} /></div>
                    <div className="ph-t">{t(curFmt.label)} · {t('渲染区')}</div>
                    <div className="ph-d">{t(CANVAS_HINT[fmt])}</div>
                  </div>
                </div>
              )}
            </div>
          </section>

          <aside className="rail">
            <div className="selbar">
              <span className="dot" />
              {t('选区')} <span className="ref">{isExcel ? (uniSel?.a1 ?? '—') : fmt === 'word' ? (wordSel ? t('已选') : '—') : '—'}</span>
              <span className="grow" />
              <span>{isExcel ? (uniSel ? `${uniSel.rows} × ${uniSel.cols} ${t('单元格')}` : '—') : fmt === 'drawio' && boardSel ? `${boardSel.count} ${t('个对象')}` : fmt === 'word' ? (wordSel ? `${wordSel.chars} ${t('字')} · ${t(wordSel.block)}` : t('文档工作区')) : `${t(curFmt.label)} ${t('工作区')}`}</span>
            </div>

            <div className="rail-body">
              {thread.length === 0 && !busy && !sendErr ? (
                <AgentHome recent={recent} onSend={(p) => { void send(p); }} onPick={setIntent} />
              ) : (
                <div className="chat-thread">
                  {thread.length > 0 && (
                    <div className="convo-bar">
                      <span className="dot" /> {t('对话')} · {thread.filter((x) => x.role === 'user').length} {t('轮')}
                      <span className="grow" />
                      <button className="convo-new" onClick={newConversation}>{t('新对话')}</button>
                    </div>
                  )}
                  {thread.map((turn, i) => {
                    if (turn.role === 'user') return <div key={i} className="msg-user">{turn.text}</div>;
                    if (turn.kind === 'answer')
                      return (
                        <div key={i} className="ai-msg">
                          <img className="ai-av" src="/favicon.png" alt="" />
                          <div className="ai-stack">
                            {turn.reasoning ? <ThinkingPanel reasoning={turn.reasoning} streaming={turn.streaming} /> : null}
                            {(turn.text || !turn.streaming) && <div className="answer-bubble md">{turn.text ? <Markdown text={turn.text} /> : <span className="dim">{t('(无内容)')}</span>}</div>}
                            {turn.streaming && !turn.text && !turn.reasoning && <div className="thinking"><span className="spin" /> {t('Agent 正在分析…')}</div>}
                          </div>
                        </div>
                      );
                    if (turn.kind === 'clarify')
                      return (
                        <div key={i} className="ai-msg">
                          <img className="ai-av" src="/favicon.png" alt="" />
                          <div className="ai-stack">
                            {turn.reasoning ? <ThinkingPanel reasoning={turn.reasoning} /> : null}
                            <ClarifyCard questions={turn.questions} answered={turn.answered} answerText={turn.answerText} onSubmit={(text) => submitClarify(i, text)} />
                          </div>
                        </div>
                      );
                    const active = i === lastDiffIdx && !turn.committed && !turn.reverted;
                    return (
                      <div key={i} className="ai-msg">
                        <img className="ai-av" src="/favicon.png" alt="" />
                        <div className="ai-stack">
                          {turn.reasoning ? <ThinkingPanel reasoning={turn.reasoning} /> : null}
                          {turn.text?.trim() ? <div className="answer-bubble md"><Markdown text={turn.text} /></div> : null}
                          <ReviewBox
                            turn={turn}
                            index={i}
                            active={active}
                            reviewIdx={reviewIdx}
                            accepted={accepted}
                            hoverCid={hoverCid}
                            autoBatch={autoBatch}
                            wordRef={wordRef}
                            onSetReviewIdx={setReviewIdx}
                            onHoverCid={setHoverCid}
                            onAccept={(k) => acceptItem(turn, k)}
                            onReject={(k) => rejectItem(turn, k)}
                            onAcceptAll={() => acceptAll(turn, i)}
                            onRevertTurn={() => revertTurn(i)}
                            onSend={(s) => { void send(s); }}
                            onSetAutoBatch={setAutoBatch}
                          />
                        </div>
                      </div>
                    );
                  })}
                  {sendErr && (
                    <div className="agent-err">
                      <div className="ae-i"><IconX size={18} /></div>
                      <div className="ae-t">{t('Agent 调用失败')}</div>
                      <div className="ae-m">{sendErr}</div>
                      <div className="ae-acts">
                        <button className="btn solid" onClick={() => setSendErr(null)}>{t('返回')}</button>
                      </div>
                    </div>
                  )}
                  <div ref={threadEndRef} />
                </div>
              )}
            </div>

            <Composer
              cfgOpen={cfgOpen}
              onToggleCfg={() => setCfgOpen((v) => !v)}
              providers={MODEL_PROVIDERS}
              providerId={provider}
              providerLabel={curProvider.label}
              defaultModel={curProvider.model}
              onPickProvider={pickProvider}
              model={model}
              onModel={(v) => { setModel(v); lsSet('oa.model', v); }}
              apiKey={apiKey}
              onApiKey={(v) => { setApiKey(v); lsSet('oa.apiKey', v); }}
              server={server}
              onServer={(v) => { setServer(v); lsSet('oa.server', v); }}
              selChip={
                isExcel ? (
                  uniSel ? (
                    <>{t('已选')} <b>{uniSel.a1}</b> · {uniSel.rows}×{uniSel.cols}</>
                  ) : (
                    <span className="muted">{t('未选区域 · 将基于整张表理解')}</span>
                  )
                ) : fmt === 'drawio' && boardSel ? (
                  <>{boardSel.chip}</>
                ) : fmt === 'word' ? (
                  wordSel ? (
                    <>{t('已选')} <b>{wordSel.chars} {t('字')}</b> · <span className="sel-quote">{wordSel.text}</span></>
                  ) : (
                    <span className="muted">{t('未选文字 · 将基于整篇文档理解')}</span>
                  )
                ) : (
                  <>{t('当前')} <b>{t(curFmt.label)}</b> {t('工作区')}</>
                )
              }
              intent={intent}
              onIntent={setIntent}
              placeholder={t(PLACEHOLDERS[fmt])}
              busy={busy}
              onSend={() => { void send(); }}
              fileRef={fileRef}
              fileName={fileName}
              onFile={onFile}
            />
          </aside>
        </main>
        {drop && DROPDOWNS[drop.key] && (
          <Dropdown spec={DROPDOWNS[drop.key]!} x={drop.x} y={drop.y} onClose={() => setDrop(null)} onPick={pick} />
        )}
        {toast && <div className="toast">{toast}</div>}
      </div>
    </TContext.Provider>
  );
}

function Dropdown({ spec, x, y, onClose, onPick }: { spec: Drop; x: number; y: number; onClose: () => void; onPick: (v: string) => void }) {
  const t = useT();
  return (
    <>
      <div className="drop-backdrop" onMouseDown={onClose} />
      <div className="dropdown" style={{ left: x, top: y }}>
        {spec.type === 'list' && (
          <div className="drop-list">
            {spec.items.map((i) => (
              <button className="drop-item" key={i} onClick={() => onPick(i)}>{t(i)}</button>
            ))}
          </div>
        )}
        {spec.type === 'menu' && (
          <div className="drop-list">
            {spec.sections.map((sec, si) => (
              <div key={si} className={si ? 'drop-sec' : ''}>
                {sec.map((i) => (
                  <button className="drop-item" key={i} onClick={() => onPick(i)}>{t(i)}</button>
                ))}
              </div>
            ))}
          </div>
        )}
        {spec.type === 'colors' && (
          <div className="drop-colors">
            {COLORS.map((c, i) => (
              <button key={c + i} className="swatch" style={{ background: c }} title={c} onClick={() => onPick(c)} />
            ))}
          </div>
        )}
        {spec.type === 'gallery' && (
          <div className="drop-gallery">
            <div className="dg-title">{t(spec.title)}</div>
            <div className="dg-cells">
              {spec.cells.map((c) => (
                <button key={c.label} className={'dgcell ' + (c.cls ?? '')} onClick={() => onPick(c.label)}>{t(c.label)}</button>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function Change(props: { tag: string; title: string; before: string; after: string; why: string }) {
  return (
    <div className="change">
      <div className="head">
        <span className="tag">{props.tag}</span>
        <span className="ttl">{props.title}</span>
      </div>
      <div className="body2">
        <div className="ba">
          <span className="before">{props.before}</span>
          <span className="arr">→</span>
          <span className="after">{props.after}</span>
        </div>
        <div className="why">{props.why}</div>
      </div>
      <div className="acts">
        <button className="btn ok"><IconCheck size={14} /> <T s="接受" /></button>
        <button className="btn no"><IconX size={14} /> <T s="拒绝" /></button>
      </div>
    </div>
  );
}

function T({ s }: { s: string }) {
  return <>{useT()(s)}</>;
}

type OnOpen = (it: string, el: HTMLElement) => void;

function SmallCell({ it, onOpen }: { it: string; onOpen: OnOpen }) {
  const t = useT();
  const Ico = FUNC_ICONS[it];
  const biu = it === 'B' || it === 'I' || it === 'U';
  const txt = !biu && !Ico;
  const accent = it === '字体颜色' ? ' ic-red' : it === '填充色' || it === '突出显示' ? ' ic-amber' : '';
  return (
    <button
      className={'rs' + (biu ? ' biu biu-' + it.toLowerCase() : '') + (txt ? ' rs-txt' : '') + accent}
      title={t(it)}
      onClick={(e) => onOpen(it, e.currentTarget)}
    >
      {biu ? it : txt ? t(it) : Ico ? <Ico size={15} /> : null}
      {DROPDOWNS[it] ? <span className="caret">▾</span> : null}
    </button>
  );
}

function BigCell({ it, onOpen }: { it: string; onOpen: OnOpen }) {
  const t = useT();
  const Ico = FUNC_ICONS[it];
  return (
    <button className="rbig" title={t(it)} onClick={(e) => onOpen(it, e.currentTarget)}>
      <span className="rbig-ic">{Ico ? <Ico size={20} /> : null}</span>
      <span className="rbig-lb">
        {t(it)}
        {DROPDOWNS[it] ? ' ▾' : ''}
      </span>
    </button>
  );
}

function ComboCell({ it, onOpen }: { it: string; onOpen: OnOpen }) {
  const t = useT();
  return (
    <button className="rcombo" style={{ minWidth: COMBO_W[it] ?? 88 }} title={t(it)} onClick={(e) => onOpen(it, e.currentTarget)}>
      <span className="rc-val">{t(COMBO[it] ?? '')}</span>
      <span className="caret">▾</span>
    </button>
  );
}

// Drawio workspace moved to ./DrawioBoard.tsx (decomposition phase 4).
