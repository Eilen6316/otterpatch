import { lazy, Suspense, forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { CSSProperties, DragEvent, ReactNode } from 'react';
import {
  IconSelect, IconArrow, IconStrike, IconPencil, IconHelp,
  IconFilter, IconFlag, IconSigma, IconClock,
  IconSend, IconChevron, IconSearch, IconDots, IconUndo, IconCheck, IconX,
  IconDoc, IconPlus,
  FUNC_ICONS,
} from './icons.js';
import { asLang, LANGS, makeT, TContext, useT, type Lang } from './i18n.js';
import { DRAWIO_SHAPES } from './drawio-shapes.js';
import type { UniSel, SheetHandle } from './UniverSheet.js';
import type { RichDocHandle, WordSel } from './RichDoc.js';
import { akey } from './review-shared.js';
import { LocalServiceHttpError, streamPropose } from './agent-client.js';
import {
  browserLocalCredential,
  browserLocalCredentialsAvailable,
  setBrowserLocalCredential,
} from './electron-bridge.js';
import {
  countAddedBoardObjects,
  materializeAddedBoardObjects,
  materializeGridOps,
  materializeWordEdits,
  wordEditOpts,
} from './proposal-materializers.js';
import { applyDrawioMutations } from './drawio-proposal-adapter.js';
import { applyBoardPatchView, revertBoardPatch, setBoardEditState } from './drawio-review-adapter.js';
import type {
  AgentDiff,
  AgentDiffItem,
  BoardPatch,
  WordEdit,
} from './proposal-materializers.js';
import type {
  AssistantTurn,
  ClarifyQuestion,
  DiffTurn,
  Turn,
  WorkspaceFormat as Fmt,
} from './app-thread-types.js';
import { useFileImport } from './use-file-import.js';
import { fileSnapshotDocumentId, proposalMatchesFileSnapshot } from './file-snapshot.js';
import { useCommitWriteback } from './use-commit-writeback.js';
import { useReviewState } from './use-review-state.js';
import { useReviewActions } from './use-review-actions.js';
import { reviewItemKind } from './review-policy.js';
import { ReviewBox } from './ReviewBox.js';
import { DiffToggle } from './DiffToggle.js';
import { AgentHome } from './AgentHome.js';
import { Composer } from './Composer.js';
import { TopBar } from './TopBar.js';
import { DrawioBoard, DrawioToolbar, DrawioPalette, extractDrawioOps, makeRawBoardConv } from './DrawioBoard.js';
import type { BNode, BEdge, BoardSel, BoardHandle } from './DrawioBoard.js';
import { AgentStatusLine, ClarifyCard } from './ThreadCards.js';
import { Markdown } from './Markdown.js';
import { chartToPngDataUrl } from './chart.js';
import { applyExcelStructure, type ChartPlacement } from './excel-structure-adapter.js';
import {
  applyGridOp,
  findLatestExcelDiffTurn,
  gridOpBackground,
  playGridOps,
  renderExcelDiffView,
  revertGridOp,
  type ExcelDiffView,
} from './excel-review-adapter.js';
import { buildHistory as buildAppHistory, sanitizeThread as sanitizeAppThread } from './app-history.js';
import {
  appendAnswerDelta,
  appendStreamingAnswerTurn,
  appendUserTurn,
  finalizeLastAnswer,
  interruptLastStreamingAnswer,
  replaceLastWithClarify,
  setStreamStatus,
  updateLastAssistantTurn,
} from './app-proposal-flow.js';
import {
  captureGridOpBeforeState,
  orderWordEditsForApply,
  replaceLastWithWorkspaceDiff,
} from './app-workspace-proposals.js';

// Shared review ids and batch guards live in ./review-shared.ts (god-file decomposition).
// AgentStatusLine / ClarifyCard moved to ./ThreadCards.tsx (decomposition phase 5).

/** 真 Univer 表格(体积大 → 懒加载,仅 Excel 用)。 */
const UniverSheet = lazy(() => import('./UniverSheet.js'));
/** Word 文档工作区:自控富文本编辑器(懒加载,仅 Word 用)。 */
const RichDoc = lazy(() => import('./RichDoc.js'));

function freshLocalId(): string {
  const value = globalThis.crypto?.randomUUID?.();
  if (!value) throw new Error('secure UUID generation is unavailable');
  return value;
}

function persistedLocalId(key: string): string {
  try {
    const existing = localStorage.getItem(key)?.trim();
    if (existing && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(existing)) return existing;
    const value = freshLocalId();
    localStorage.setItem(key, value);
    return value;
  } catch {
    return freshLocalId();
  }
}

function latestProposalId(thread: readonly Turn[]): string | undefined {
  for (let index = thread.length - 1; index >= 0; index--) {
    const turn = thread[index];
    if (!turn || turn.role !== 'assistant' || turn.kind !== 'diff' || !turn.proposal || typeof turn.proposal !== 'object') continue;
    const proposalId = (turn.proposal as { proposalId?: unknown }).proposalId;
    if (typeof proposalId === 'string' && proposalId.trim()) return proposalId;
  }
  return undefined;
}

/** 渐进披露驾驶舱。风格参照 Next AI Drawio:纯白、分区块、线性图标、无 emoji。五语 i18n(t 包裹显示文案)。 */

/** 工作区格式:文件名 + 工具栏随之联动。 */
const FORMATS = [
  { id: 'excel', label: 'Excel', file: '月度销售表.xlsx' },
  { id: 'word', label: 'Word', file: '实训报告.docx' },
  { id: 'ppt', label: 'PPT', file: '季度汇报.pptx' },
  { id: 'drawio', label: '流程图', file: '系统架构.drawio' },
] as const satisfies ReadonlyArray<{ id: Fmt; label: string; file: string }>;

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

function normalizeLocalEndpoint(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    const host = u.hostname.replace(/^\[|\]$/g, '');
    if (!['http:', 'https:'].includes(u.protocol)) return null;
    if (!['localhost', '127.0.0.1', '::1'].includes(host)) return null;
    u.hash = '';
    u.search = '';
    return u.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}
/** Agent 反向澄清:像 Claude Code 那样给引导选择表(2-4 项)+ 允许自填。 */
// ClarifyOption / ClarifyQuestion live in ./app-thread-types.ts.

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
  const browserCredentialsEnabled = browserLocalCredentialsAvailable();
  const [lang, setLang] = useState<Lang>(() => asLang(lsGet('oa.lang', 'zh')));
  const t = makeT(lang);
  const [sent, setSent] = useState(false);
  const [fmt, setFmt] = useState<Fmt>(() => (lsGet('oa.fmt', 'excel') as Fmt));
  const [tab, setTab] = useState(0);
  const [drop, setDrop] = useState<{ key: string; x: number; y: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notify = (msg: string): void => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 1600);
  };
  const [intent, setIntent] = useState('');
  const [cfgOpen, setCfgOpen] = useState(false);
  const [provider, setProvider] = useState(() => lsGet('oa.provider', 'claude'));
  const [model, setModel] = useState(() => lsGet('oa.model', 'claude-opus-4-8'));
  const [apiKey, setApiKey] = useState('');
  const [server, setServer] = useState(() => lsGet('oa.server', 'http://localhost:4319'));
  const [serveToken, setServeToken] = useState(() => browserLocalCredential('oa.serveToken'));
  const [reviewToken, setReviewToken] = useState(() => browserLocalCredential('oa.reviewToken'));
  useEffect(() => { try { localStorage.removeItem('oa.apiKey'); } catch { /* ignore */ } }, []);
  const [uniSel, setUniSel] = useState<UniSel | null>(null);
  const [excelDiff, setExcelDiff] = useState<ExcelDiffView>('final'); // Excel 改动视图:原文/对照(改动格着色)/改后
  const [boardDiff, setBoardDiff] = useState<'orig' | 'final'>('final'); // drawio 改动视图:原文(隐提案)/改后
  const [wordSel, setWordSel] = useState<WordSel | null>(null);
  const [hoverCid, setHoverCid] = useState<string | null>(null); // 文档里/rail 悬停联动的改动 domId
  const [boardSel, setBoardSel] = useState<BoardSel | null>(null);
  const univerRef = useRef<SheetHandle>(null);
  const boardRef = useRef<BoardHandle>(null);
  const wordRef = useRef<RichDocHandle>(null);
  const { fileB64, fileName, fileSnapshot, onFile } = useFileImport({
    format: fmt,
    wordRef,
    boardRef,
    notify,
    t,
  });
  const applySeqRef = useRef(0);
  const chartRects = useRef<ChartPlacement[]>([]); // 已插入图表的锚点(会话级):新图撞上就下移,别叠在一起
  // drawio「边生成边画」流式状态
  const draftBufRef = useRef('');
  const drawnOpsRef = useRef(0);
  const streamConvRef = useRef<ReturnType<typeof makeRawBoardConv> | null>(null);
  const staleStreamRef = useRef(false); // 提案被回炉(截断/verify 失败)后置位:新 draft 到达时先清上一轮的流式残画
  const streamObjsRef = useRef<Array<{ editId: string; node?: BNode; edge?: BEdge }>>([]);
  const streamByEditRef = useRef<Record<string, string>>({});
  const [reviewIdx, setReviewIdx] = useState(0);
  const threadEndRef = useRef<HTMLDivElement>(null);
  const sendingRef = useRef(false); // 同步重入锁:异步 busy state 拦不住同一帧内的连发
  const streamAbortRef = useRef<AbortController | null>(null);
  const [sendErr, setSendErr] = useState<string | null>(null);
  const [answer, setAnswer] = useState<string | null>(null);
  const lsJson = <T,>(k: string, fb: T): T => { try { const v = JSON.parse(localStorage.getItem(k) ?? 'null'); return v == null ? fb : (v as T); } catch { return fb; } };
  const [localUserId] = useState(() => persistedLocalId('oa.auditUserId'));
  const [conversationSessionId, setConversationSessionId] = useState(() => persistedLocalId('oa.auditSessionId'));
  // Cursor 式连续对话流 + 模型历史,持久化到当前工作区(localStorage)
  const [thread, setThread] = useState<Turn[]>(() => sanitizeAppThread(lsJson<Turn[]>('oa.thread', [])));
  const [recent, setRecent] = useState<{ t: string; time: string }[]>([]);
  const [realDiff, setRealDiff] = useState<AgentDiff | null>(null);
  const [realCs, setRealCs] = useState<unknown>(null);
  const [accepted, setAccepted] = useState<Set<string>>(() => { try { return new Set(JSON.parse(localStorage.getItem('oa.accepted') ?? '[]') as string[]); } catch { return new Set(); } }); // 随 thread 持久化:刷新后审批处置不丢
  const [rejected, setRejected] = useState<Set<string>>(() => { try { return new Set(JSON.parse(localStorage.getItem('oa.rejected') ?? '[]') as string[]); } catch { return new Set(); } });
  const { clearAccepted, toggleAccept, acceptMany, markCommitted, markReverted, markClarifyAnswered } = useReviewState({ setThread, setAccepted, setRejected });
  useEffect(() => { try { localStorage.setItem('oa.accepted', JSON.stringify([...accepted])); } catch { /* 配额忽略 */ } }, [accepted]);
  useEffect(() => { try { localStorage.setItem('oa.rejected', JSON.stringify([...rejected])); } catch { /* 配额忽略 */ } }, [rejected]);
  useEffect(() => { // 接受率遥测读取口:控制台 __otterTelemetry() 看 格式×改动类型 的 accept/reject 分布
    (window as unknown as { __otterTelemetry?: () => unknown }).__otterTelemetry = () => { try { return JSON.parse(localStorage.getItem('oa.telemetry') ?? '{}'); } catch { return {}; } };
  }, []);
  // 自动续批(opt-in):plan 声明分批 + 用户开着开关 → 全部接受后自动续发"下一批";每批仍走完整 propose→verify→审阅,写是串行的
  const [autoBatch, setAutoBatch] = useState(() => localStorage.getItem('oa.autobatch') === '1');
  useEffect(() => { try { localStorage.setItem('oa.autobatch', autoBatch ? '1' : '0'); } catch { /* 忽略 */ } }, [autoBatch]);
  const autoBatchRun = useRef(0); // 连续自动批次计数(手动指令即清零,上限 AUTO_BATCH_CAP)
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const { ensureCommitFile, doCommit } = useCommitWriteback({
    server,
    realChangeSet: realCs,
    fileBase64: fileB64,
    fileName,
    fileSnapshot,
    notify,
    t,
    setBusy,
    normalizeLocalEndpoint,
  });
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
  useEffect(() => () => streamAbortRef.current?.abort(), []);

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
    const selDesc = wordSel ? `${wordSel.block}${wordSel.para ? ' · 第' + wordSel.para + '段' : ''}${wordSel.font ? ' · ' + wordSel.font : ''}${wordSel.size ? ' ' + wordSel.size + 'pt' : ''}${wordSel.bold ? ' 加粗' : ''}${wordSel.italic ? ' 斜体' : ''}${wordSel.align && wordSel.align !== '左对齐' ? ' ' + wordSel.align : ''}` : '';
    const ctx = isExcel ? (sheetSnap?.text ?? '(表格为空)') : fmt === 'drawio' && boardSel ? boardSel.context : fmt === 'word'
      ? `${wordRef.current?.getContext() ?? '(空文档)'}\n(改写正文:给 quote=文档中真实存在的原文片段 + replacement;改格式:显式给 scope，字符范围用 selection、整段用 paragraph、页面设置用 document;空段落/整段结构操作用 para=段号;对照表/矩阵必须用 table 二维数组生成真实表格,禁止竖线或制表符伪造。)`
        + (wordSel ? (wordSel.block === '图片'
          ? `\n[当前选区·用户此刻点选了一张图片(${selDesc})]:${wordSel.text}\n若指令含"这张图/这个图片/它",目标就是这张图所在的第${wordSel.para ?? '?'}段;整段操作用 para=${wordSel.para ?? '?'} 锚定。`
          : `\n[当前选区·用户此刻圈选了这段(${selDesc})]:"${wordSel.text}"\n若指令含"这段/这句/这里/选中的/选中/它",优先针对它;quote 用这段真实原文定位。`) : '\n[未圈选文字]:请基于整篇文档理解。')
      : selectionContext();
    const proposalFile = fileSnapshot?.format === fmt ? fileSnapshot : null;
    const proposalDocumentId = proposalFile ? fileSnapshotDocumentId(proposalFile) : `desktop:${fmt}`;
    const parentProposalId = latestProposalId(thread);
    const proposalBoard = fmt === 'drawio' && boardSel?.board
      ? { ...boardSel.board, ...(proposalFile?.drawioSourceEncoding ? { sourceEncoding: proposalFile.drawioSourceEncoding } : {}) }
      : undefined;
    setSendErr(null);
    const ep = normalizeLocalEndpoint(server);
    if (server.trim() && !ep) {
      setCfgOpen(true);
      setSendErr('Agent 服务地址必须是本机地址: http://localhost、http://127.0.0.1 或 http://[::1]');
      return;
    }
    if (ep && apiKey && browserCredentialsEnabled && !serveToken) {
      setCfgOpen(true);
      setSendErr(t('未填写本机服务令牌。请在模型设置中粘贴服务启动时显示的 POST token。'));
      return;
    }
    if (ep && apiKey) {
      const requestController = new AbortController();
      streamAbortRef.current = requestController;
      sendingRef.current = true;
      setBusy(true);
      setSendErr(null);
      setThread((th) => appendUserTurn(th, theIntent)); // 用户气泡立刻进流
      setIntent('');
      try {
        const upd = (fn: (t: AssistantTurn) => Turn): void => setThread((th) => updateLastAssistantTurn(th, fn));
        // Reset the draw-while-streaming state before the stream opens.
        draftBufRef.current = '';
        drawnOpsRef.current = 0;
        streamConvRef.current = null;
        streamObjsRef.current = [];
        streamByEditRef.current = {};
        staleStreamRef.current = false;
        type StreamEvt = { type: string; status?: unknown; delta?: string; kind?: string; text?: string; diff?: AgentDiff; changeSet?: unknown; proposal?: unknown; questions?: ClarifyQuestion[]; message?: string; error?: { kind?: string } };
        await streamPropose<StreamEvt>(
          ep,
          { format: fmt, intent: theIntent, context: ctx, baseRev: proposalFile?.revision ?? 0, provider, model, apiKey, documentId: proposalDocumentId, sessionId: conversationSessionId, userId: localUserId, ...(proposalFile ? { sourceFileSha256: proposalFile.sha256 } : {}), ...(parentProposalId ? { parentProposalId } : {}), ...(isExcel && sheetSnap?.sheet ? { sheet: sheetSnap.sheet } : {}), ...(proposalBoard ? { board: proposalBoard } : {}), ...(docSnap ? { doc: docSnap } : {}), ...(thread.length ? { history: buildAppHistory(thread) } : {}) },
          () => {
            if (theIntent.trim()) setRecent((rr) => [{ t: theIntent.trim(), time: t('刚刚') }, ...rr.filter((x) => x.t !== theIntent.trim())].slice(0, 6));
            setSent(true);
            // Optimistic streaming bubble; progress is a bounded status object, never provider reasoning.
            setThread((th) => appendStreamingAnswerTurn(th));
          },
          (e) => {
            if (e.type === 'status') {
              setThread((th) => setStreamStatus(th, e.status));
              if (fmt === 'drawio' && streamObjsRef.current.length) staleStreamRef.current = true;
            }
            else if (e.type === 'answer') setThread((th) => appendAnswerDelta(th, e.delta));
            else if (e.type === 'draft' && fmt === 'drawio') {
              if (staleStreamRef.current) {
                // 上一轮提案被回炉(截断/verify 失败),它流式画的是废案:清掉,否则残节点与重提的整图叠加
                boardRef.current?.removeObjects(Object.values(streamByEditRef.current));
                streamObjsRef.current = []; streamByEditRef.current = {}; draftBufRef.current = ''; drawnOpsRef.current = 0; streamConvRef.current = null; staleStreamRef.current = false;
              }
              // 边生成边画:每到一段 propose 入参,抽出已闭合的 op 即时画到左侧画板
              draftBufRef.current += e.delta ?? '';
              const conv = streamConvRef.current ?? (streamConvRef.current = makeRawBoardConv(++applySeqRef.current, (id) => !!boardRef.current?.getObject(id)));
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
            else if (e.type === 'error') {
              const providerMessage: Record<string, string> = {
                authentication: t('API Key 未通过 Provider 验证'),
                permission: t('当前 API Key 无权使用该模型'),
                invalid_request: t('Provider 拒绝了模型请求'),
                rate_limit: t('Provider 限流,请稍后重试'),
                timeout: t('Provider 请求超时'),
                unavailable: t('Provider 暂时不可用'),
                network: t('无法连接 Provider'),
                circuit_open: t('Provider 暂时熔断,请稍后重试'),
                unknown: t('Provider 请求失败'),
              };
              throw new Error(providerMessage[e.error?.kind ?? ''] ?? e.message ?? 'stream error');
            }
            else if (e.type === 'done') {
              if (e.kind === 'changeset' && e.diff) {
                const diff = e.diff;
                const cs = e.changeSet ?? null;
                const proposal = e.proposal ?? null;
                if (proposalFile && !proposalMatchesFileSnapshot(proposal, proposalFile)) {
                  throw new Error('The local service returned a proposal that is not bound to the imported file. Regenerate after updating the service.');
                }
                setRealCs(cs);
                setRealDiff(diff);
                setReviewIdx(0);
                if (fmt === 'drawio') {
                  // drawio:先把【改/删/移动现有节点】落到画板;新增节点则复用流式已画的、或一次性补画
                  setBoardDiff('final'); // 新提案到达,视图回到"改后"基准
                  const mut = applyDrawioMutations(cs, boardRef.current, {
                    excludedObjectIds: new Set(Object.values(streamByEditRef.current)),
                  });
                  let board: BoardPatch;
                  // 完整性守卫:长提案的流式解析可能截断(实测 18 处只吐出 8 个)——流式画的少于提案对象数,
                  // 就清掉残画、按最终 changeSet 全量重画,别把"画了一半"当成品交付
                  const addCount = countAddedBoardObjects(cs);
                  if (streamObjsRef.current.length >= addCount && streamObjsRef.current.length > 0) {
                    board = { byEdit: { ...streamByEditRef.current, ...mut.byEdit }, objs: streamObjsRef.current, muts: mut.muts };
                  } else {
                    if (streamObjsRef.current.length) boardRef.current?.removeObjects(Object.values(streamByEditRef.current));
                    const b = materializeAddedBoardObjects(cs, {
                      sequence: ++applySeqRef.current,
                      getObject: (id) => boardRef.current?.getObject(id) ?? null,
                    });
                    board = { byEdit: { ...b.byEdit, ...mut.byEdit }, objs: b.objs, muts: mut.muts };
                    if (b.nodes.length || b.edges.length) void playBoard(b.nodes, b.edges); // 兜底:逐个补图
                  }
                  setThread((th) => replaceLastWithWorkspaceDiff(th, { format: fmt, fileSnapshot: proposalFile ?? undefined, changeSet: cs, proposal, diff, board }));
                } else if (fmt === 'word') {
                  const wordEdits = materializeWordEdits(diff, cs);
                  // 乐观落入文档(与 Excel 播放一致);编辑器按 domId 包裹,拒绝可精确还原
                  wordRef.current?.closeUndoWindow(); // 新提案=上一轮撤销窗口关闭,旧 data-undo 剥净后再落新标记
                  // 落地顺序:先非删段(段号锚不受影响),删段按段号【降序】——升序会让先删的段把后续段号顶前,删错段(实测会误删含图段)
                  for (const w of orderWordEditsForApply(wordEdits)) wordRef.current?.applyEdit(w.domId, w.quote, wordEditOpts(w));
                  setThread((th) => replaceLastWithWorkspaceDiff(th, { format: fmt, fileSnapshot: proposalFile ?? undefined, changeSet: cs, proposal, diff, word: wordEdits }));
                  setReviewIdx(0);
                  if (wordEdits[0]) wordRef.current?.highlight(wordEdits[0].domId); // 审阅期定位第一条
                } else {
                  applyExcelStructure(cs, {
                    sheet: univerRef.current,
                    chartPlacements: chartRects.current,
                    renderChart: chartToPngDataUrl,
                  }); // 结构性操作先落,改变网格布局
                  // 采集整格改前状态(值/公式/填充/字色/加粗/数字格式/对齐),供 git-diff 展示 + "撤销/拒绝"精确还原
                  const ops = captureGridOpBeforeState(materializeGridOps(diff), univerRef.current);
                  setExcelDiff('final'); // 新提案到达,速览条回到"改后"基准
                  setThread((th) => replaceLastWithWorkspaceDiff(th, { format: fmt, fileSnapshot: proposalFile ?? undefined, changeSet: cs, proposal, diff, ops }));
                  if (ops.length) void playGridOps(univerRef.current, ops, { onStart: () => setSent(true) }); // 边画边改
                }
              } else if (e.kind === 'clarify' && e.questions?.length) {
                const qs = e.questions;
                // 把流式占位气泡替换成"引导选择"卡片。
                setThread((th) => replaceLastWithClarify(th, qs));
              } else {
                setThread((th) => finalizeLastAnswer(th, e.text));
              }
            }
          },
          requestController.signal,
        );
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        const cancelled = requestController.signal.aborted;
        const localAuthFailed = e instanceof LocalServiceHttpError && e.status === 401;
        const displayMessage = localAuthFailed ? t('本机服务令牌无效。请更新模型设置中的 POST token。') : m;
        const refused = /failed to fetch|refused|ECONNREFUSED|networkerror|load failed/i.test(m);
        if (localAuthFailed) setCfgOpen(true);
        if (fmt === 'drawio' && streamObjsRef.current.length) {
          boardRef.current?.removeObjects(Object.values(streamByEditRef.current));
          streamObjsRef.current = [];
          streamByEditRef.current = {};
        }
        // 出错不回滚对话:此前把 user 气泡也删掉,用户看到"对话断开/消失"——改为把占位气泡定格成错误说明,
        // 对话完整保留(user/assistant 交替不破坏),指令放回输入框方便重试
        setThread((th) => interruptLastStreamingAnswer(th, cancelled ? t('本轮请求已取消。') : `⚠ 本轮请求中断(${refused ? '连不上本机 Agent 服务' : displayMessage}),对话已保留,可直接重发。`));
        setIntent(theIntent); // 把指令放回输入框,方便重试
        setSendErr(cancelled
          ? null
          : refused
            ? `连不上本机 Agent 服务(${ep})。改了代码后请在项目根目录跑 npm run serve 重启它(会先重新构建再启动,确保用上最新能力)。`
            : localAuthFailed
              ? displayMessage
              : 'Agent · ' + m);
      } finally {
        if (streamAbortRef.current === requestController) streamAbortRef.current = null;
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
    clearAccepted();
    setAnswer(null);
  };
  /** 开启新对话:清空多轮历史 + 当前视图。 */
  const newConversation = (): void => {
    const nextSessionId = freshLocalId();
    try { localStorage.setItem('oa.auditSessionId', nextSessionId); } catch { /* persistence is best-effort */ }
    setConversationSessionId(nextSessionId);
    setThread([]);
    resetDiff();
    setSendErr(null);
    clearAccepted(); // 处置记账随对话清零
    wordRef.current?.closeUndoWindow();
  };
  /** 撤销某条改动:把该回合写过的格子还原到改前值,并清掉它加的底色。 */
  const revertTurn = (idx: number): void => {
    const turn = thread[idx];
    if (!turn || turn.role !== 'assistant' || turn.kind !== 'diff') return;
    if (turn.board) {
      revertBoardPatch(
        turn.board,
        boardRef.current,
        turn.diff.items.filter((item) => !rejected.has(akey(turn.diff.changeSetId, item.editId))).map((item) => item.editId),
      );
    } else if (turn.word) {
      let missed = 0;
      for (const w of turn.word) if (!rejected.has(akey(turn.diff.changeSetId, w.editId))) { if (!wordRef.current?.revert(w.domId)) missed++; } // 按 domId 精确还原仍在预览/已接受的改动
      if (missed) notify(t('部分改动已定稿,无法自动回退') + ` · ${missed}`);
    } else {
      for (const op of [...turn.ops].reverse()) {
        if (!op.editId || !rejected.has(akey(turn.diff.changeSetId, op.editId))) revertGridOp(univerRef.current, op);
      }
    }
    markReverted(idx);
    notify(t('已撤销该回合改动'));
  };
  /** 用户提交澄清选择:锁定该卡片 + 把选择作为新一轮指令发回(thread 续接,Agent 据此继续或再追问)。 */
  const submitClarify = (idx: number, text: string): void => {
    markClarifyAnswered(idx, text);
    void send(text);
  };

  const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
  /** drawio 兜底:provider 不流式吐入参时,在 done 后把对象逐个补到画板(保留"边画"观感)。 */
  const playBoard = async (nodes: BNode[], edges: BEdge[]): Promise<void> => {
    for (const n of nodes) { boardRef.current?.addObjects([n], []); await delay(75); }
    for (const ed of edges) { boardRef.current?.addObjects([], [ed]); await delay(45); }
  };
  /** drawio 改动视图:原文=隐掉本轮提案(新增移除、改动还原改前快照);改后=按当前处置呈现。 */
  const applyBoardDiffView = (view: 'orig' | 'final'): void => {
    let turn: DiffTurn | undefined;
    for (let i = thread.length - 1; i >= 0; i--) { const tt = thread[i]; if (tt && tt.role === 'assistant' && tt.kind === 'diff' && tt.board && tt.diff.items.length) { turn = tt; break; } }
    const b = turn?.board;
    if (!turn || !b) return;
    applyBoardPatchView(b, {
      editIds: turn.diff.items.map((item) => item.editId),
      view,
      isAccepted: (editId) => !rejected.has(akey(turn.diff.changeSetId, editId)),
      board: boardRef.current,
    });
    setBoardDiff(view);
  };
  const applyExcelDiffView = (view: ExcelDiffView): void => {
    const turn = findLatestExcelDiffTurn(thread);
    if (!turn) return;
    renderExcelDiffView(
      univerRef.current,
      turn,
      view,
      (editId) => !rejected.has(akey(turn.diff.changeSetId, editId)),
    );
    setExcelDiff(view);
  };
  /** 高亮当前审阅的改动:Excel 聚焦该格、drawio 高亮该对象。 */
  const highlightItem = (turn: DiffTurn, item: AgentDiffItem | undefined): void => {
    if (!item) return;
    if (turn.format === 'excel') univerRef.current?.focus(item.ref.replace(/^.*!/, ''));
    else if (turn.format === 'drawio') { const id = turn.board?.byEdit[item.editId]; if (id) boardRef.current?.highlight(id); }
    else if (turn.format === 'word') { const w = turn.word?.find((x) => x.editId === item.editId); if (w) wordRef.current?.highlight(w.domId); } // 定位当前条
  };
  /** 接受率飞轮:按 格式×改动类型 统计逐条处置,localStorage 持久化;接受率最低的类别就是 skills/prompt 下一轮的靶子。
   *  控制台 window.__otterTelemetry() 可随时查看汇总。 */
  const telemetry = (format: Fmt, verb: 'accept' | 'reject', kind: string): void => {
    try {
      const t = JSON.parse(localStorage.getItem('oa.telemetry') ?? '{}') as Record<string, Record<string, { accept: number; reject: number }>>;
      const f = (t[format] ??= {});
      const k = (f[kind] ??= { accept: 0, reject: 0 });
      k[verb]++;
      localStorage.setItem('oa.telemetry', JSON.stringify(t));
    } catch { /* 配额/解析问题不影响主流程 */ }
  };
  const applyWordEdit = (w: WordEdit): void => {
    wordRef.current?.applyEdit(w.domId, w.quote, wordEditOpts(w));
  };
  const acceptItem = (turn: DiffTurn, idx: number, silent = false): void => {
    if (turn.format !== fmt) { notify('请先切回 ' + turn.format + ' 工作区再处理该提案'); return; }
    const it = turn.diff.items[idx]; if (!it) return;
    const k = akey(turn.diff.changeSetId, it.editId);
    if (!accepted.has(k)) {
      if (rejected.has(k)) { // Only rejected edits were removed from the optimistic preview and need replay.
        if (turn.format === 'excel') { const op = turn.ops.find((o) => o.editId === it.editId); if (op) applyGridOp(univerRef.current, op); }
        else if (turn.format === 'drawio' && turn.board) setBoardEditState(turn.board, it.editId, 'next', boardRef.current);
        else if (turn.format === 'word') { const w = turn.word?.find((x) => x.editId === it.editId); if (w) applyWordEdit(w); }
      }
      toggleAccept(k, true);
    }
    if (turn.format === 'excel' && excelDiff === 'mark') { const op = turn.ops.find((o) => o.editId === it.editId); if (op) univerRef.current?.setBackground(op.a1, gridOpBackground(op, true)); } // 已处置的格退出着色 → 网格上直观看到审阅进度
    if (turn.format === 'word') { const w = turn.word?.find((x) => x.editId === it.editId); if (w) wordRef.current?.markResolved(w.domId, 'accepted'); } // 物理定稿:删 del、ins 落地
    telemetry(turn.format, 'accept', reviewItemKind(turn, it));
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
  const rejectItem = (turn: DiffTurn, idx: number, silent = false): void => {
    if (turn.format !== fmt) { notify('请先切回 ' + turn.format + ' 工作区再处理该提案'); return; }
    const it = turn.diff.items[idx]; if (!it) return;
    const k = akey(turn.diff.changeSetId, it.editId);
    if (!rejected.has(k)) {
      if (turn.format === 'excel') { const op = turn.ops.find((o) => o.editId === it.editId); if (op) { revertGridOp(univerRef.current, op); if (excelDiff === 'mark') univerRef.current?.setBackground(op.a1, gridOpBackground(op, false)); } }
      else if (turn.format === 'drawio' && turn.board) setBoardEditState(turn.board, it.editId, 'prior', boardRef.current);
      else if (turn.format === 'word') { const w = turn.word?.find((x) => x.editId === it.editId); if (w && !wordRef.current?.revert(w.domId) && accepted.has(k)) notify(t('该改动已定稿,未找到可还原的位置')); }
    }
    toggleAccept(k, false);
    telemetry(turn.format, 'reject', reviewItemKind(turn, it));
    if (!silent) setReviewIdx(idx + 1);
  };
  const { acceptAll, commitAccepted } = useReviewActions({
    format: fmt,
    accepted,
    rejected,
    autoBatch,
    autoBatchRun,
    excelDiff,
    fileBase64: fileB64,
    wordRef,
    univerRef,
    notify,
    t,
    acceptMany,
    setReviewIdx,
    setExcelDiff,
    ensureCommitFile,
    doCommit,
    markCommitted,
    applyWordEdit,
    boardRef,
    telemetry,
    confirmAcceptAll: (message) => window.confirm(message),
    send,
  });
  const openDrop = (it: string, el: HTMLElement): void => {
    const r = el.getBoundingClientRect();
    setDrop({ key: it, x: Math.min(r.left, window.innerWidth - 250), y: r.bottom + 3 });
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
                  {(() => {
                    // 与 Word 同一交互模型的切换条:原文/对照/改后 + 逐格步进(游标与右侧审阅列表同步)
                    const dt = lastDiffIdx >= 0 ? thread[lastDiffIdx] : undefined;
                    const dturn = dt && dt.role === 'assistant' && dt.kind === 'diff' && dt.ops.length > 0 ? dt : undefined;
                    if (!dturn && !thread.some((tt) => tt.role === 'assistant' && tt.kind === 'diff' && tt.ops.length > 0)) return null;
                    const total = dturn && !dturn.committed && !dturn.reverted ? dturn.diff.items.length : 0;
                    return (
                      <DiffToggle<'orig' | 'mark' | 'final'>
                        label="Agent 改动"
                        className="excel-difftoggle"
                        segs={[
                          { v: 'orig', label: '原文', title: '回看改前的表格' },
                          { v: 'mark', label: '对照', title: '改后 + 着色标记被改动的单元格' },
                          { v: 'final', label: '改后', title: '只看改后' },
                        ] as const}
                        active={excelDiff}
                        count={total > 0 ? { pos: Math.min(reviewIdx, total - 1), total } : null}
                        onPick={applyExcelDiffView}
                        onStep={total > 0 ? (dir) => setReviewIdx((total + Math.min(reviewIdx, total - 1) + dir) % total) : undefined}
                      />
                    );
                  })()}
                  <Suspense fallback={<div className="univer-loading">{t('加载表格引擎…')}</div>}>
                    <UniverSheet ref={univerRef} onSelection={setUniSel} />
                  </Suspense>
                </>
              ) : fmt === 'drawio' ? (
                <>
                  {(() => {
                    const dt = lastDiffIdx >= 0 ? thread[lastDiffIdx] : undefined;
                    const dturn = dt && dt.role === 'assistant' && dt.kind === 'diff' && dt.board && dt.diff.items.length > 0 ? dt : undefined;
                    if (!dturn) return null;
                    const total = !dturn.committed && !dturn.reverted ? dturn.diff.items.length : 0;
                    return (
                      <DiffToggle<'orig' | 'final'>
                        label="Agent 改动"
                        className="board-difftoggle"
                        segs={[
                          { v: 'orig', label: '原文', title: '隐藏本轮提案,回看改前画板' },
                          { v: 'final', label: '改后', title: '按当前处置呈现提案' },
                        ] as const}
                        active={boardDiff}
                        count={total > 0 ? { pos: Math.min(reviewIdx, total - 1), total } : null}
                        onPick={applyBoardDiffView}
                        onStep={total > 0 ? (dir) => setReviewIdx((total + Math.min(reviewIdx, total - 1) + dir) % total) : undefined}
                      />
                    );
                  })()}
                  <DrawioBoard ref={boardRef} onBoardSel={setBoardSel} />
                </>
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
                            {turn.streaming && turn.status ? <AgentStatusLine status={turn.status} /> : null}
                            {(turn.text || !turn.streaming) && <div className="answer-bubble md">{turn.text ? <Markdown text={turn.text} /> : <span className="dim">{t('(无内容)')}</span>}</div>}
                            {turn.streaming && !turn.text && !turn.status && <div className="thinking"><span className="spin" /> {t('正在生成回复')}</div>}
                          </div>
                        </div>
                      );
                    if (turn.kind === 'clarify')
                      return (
                        <div key={i} className="ai-msg">
                          <img className="ai-av" src="/favicon.png" alt="" />
                          <div className="ai-stack">
                            <ClarifyCard questions={turn.questions} answered={turn.answered} answerText={turn.answerText} onSubmit={(text) => submitClarify(i, text)} />
                          </div>
                        </div>
                      );
                    const active = i === lastDiffIdx && turn.format === fmt && !turn.committed && !turn.reverted;
                    return (
                      <div key={i} className="ai-msg">
                        <img className="ai-av" src="/favicon.png" alt="" />
                        <div className="ai-stack">
                          {turn.text?.trim() ? <div className="answer-bubble md"><Markdown text={turn.text} /></div> : null}
                          <ReviewBox
                            turn={turn}
                            index={i}
                            active={active}
                            reviewIdx={reviewIdx}
                            accepted={accepted}
                            rejected={rejected}
                            hoverCid={hoverCid}
                            autoBatch={autoBatch}
                            wordRef={wordRef}
                            lockedEdits={(() => { // 历史重审守卫:该条的格子被后续回合改过 → 锁行内 ✓/✕(先撤销后面的回合)
                              if (turn.format !== 'excel' || i === lastDiffIdx) return undefined;
                              const laterA1 = new Set<string>();
                              for (let j = i + 1; j < thread.length; j++) { const t2 = thread[j]; if (t2 && t2.role === 'assistant' && t2.kind === 'diff') for (const op of t2.ops) laterA1.add(op.a1); }
                              return new Set(turn.ops.filter((o) => o.editId && laterA1.has(o.a1)).map((o) => o.editId!));
                            })()}
                            onSetReviewIdx={setReviewIdx}
                            onHoverCid={setHoverCid}
                            onAccept={(k) => acceptItem(turn, k, !active)}
                            onReject={(k) => rejectItem(turn, k, !active)}
                            onAcceptAll={() => acceptAll(turn, i)}
                            onCommitAccepted={() => commitAccepted(turn, i)}
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
              onApiKey={(v) => setApiKey(v)}
              server={server}
              onServer={(v) => { setServer(v); lsSet('oa.server', v); }}
              localCredentials={browserCredentialsEnabled ? {
                serveToken,
                reviewToken,
                onServeToken: (v) => { setServeToken(v); setBrowserLocalCredential('oa.serveToken', v); },
                onReviewToken: (v) => { setReviewToken(v); setBrowserLocalCredential('oa.reviewToken', v); },
              } : undefined}
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
              onCancel={() => streamAbortRef.current?.abort()}
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
