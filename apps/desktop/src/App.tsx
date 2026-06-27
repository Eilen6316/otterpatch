import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  IconGrid, IconSelect, IconArrow, IconStrike, IconPencil, IconHelp,
  IconFilter, IconFlag, IconSigma, IconPaperclip, IconImage, IconClock,
  IconSend, IconChevron, IconSearch, IconDots, IconUndo, IconCheck, IconX,
  IconDoc, IconPlus,
  FUNC_ICONS,
} from './icons.js';
import { LANGS, makeT, TContext, useT, type Lang } from './i18n.js';

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
  word: '流式文档:选中文字 → 指令 → 红线修订(@opal/adapter-word)',
  drawio: '流程图:选中节点/连线 → 指令 → 按 mxCell id 改(@opal/adapter-drawio)',
  ppt: '幻灯片:选中对象 → 指令 → 版式/文本(适配器规划中)',
};

const COLS = ['A', 'B', 'C', 'D', 'E', 'F'];
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

const EXAMPLES = [
  { Icon: IconFilter, t: '清洗这张表', d: '统一日期格式、修复被存成文本的数字、去空值' },
  { Icon: IconFlag, t: '标红异常值', d: '高亮偏离均值过大的数据,生成问题清单' },
  { Icon: IconSigma, t: '补公式 + 摘要', d: '按 销量×单价 补齐金额与毛利率,逐项确认' },
];

const RECENT = [
  { t: '清洗销售表', time: '刚刚' },
  { t: '改公式 E2:E6', time: '2 分钟前' },
  { t: '标红异常值', time: '今天 09:14' },
];

const MODEL_PROVIDERS = [
  { id: 'claude', label: 'Claude', model: 'claude-opus-4-8' },
  { id: 'openai', label: 'ChatGPT', model: 'gpt-5.5' },
  { id: 'deepseek', label: 'DeepSeek', model: 'deepseek-chat' },
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
  const [fmt, setFmt] = useState<Fmt>('excel');
  const [tab, setTab] = useState(0);
  const [drop, setDrop] = useState<{ key: string; x: number; y: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [intent, setIntent] = useState('');
  const [cfgOpen, setCfgOpen] = useState(false);
  const [provider, setProvider] = useState(() => lsGet('oa.provider', 'claude'));
  const [model, setModel] = useState(() => lsGet('oa.model', 'claude-opus-4-8'));
  const [apiKey, setApiKey] = useState(() => lsGet('oa.apiKey', ''));
  const [sel, setSel] = useState<Sel>({ ar: 1, ac: 2, br: 5, bc: 5 });
  const dragRef = useRef(false);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<{ ri: number; ci: number } | null>(null);
  const [editVal, setEditVal] = useState('');
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

  const gridValue = (ri: number, ci: number): string => {
    const ov = overrides[cellKey(ri, ci)];
    if (ov !== undefined) return ov;
    if (ri === 0) return HEADERS[ci] ?? '';
    const di = ri - 1;
    const row = DATA[di] ?? [];
    if (ci <= 3) return row[ci] ?? '';
    if (ci === 4) return sent ? (AMOUNT[di] ?? '') : '';
    return sent ? (MARGIN[di] ?? '') : '';
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
  const selColumn = (ci: number): void => setSel({ ar: 0, ac: ci, br: 5, bc: ci });
  const selRow = (ri: number): void => setSel({ ar: ri, ac: 0, br: ri, bc: 5 });

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
      t(gridValue(ri, ci))
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
  const send = (): void => {
    void selectionContext();
    setSent(true);
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
  /** 每个功能都可用:有下拉的开面板,其余给执行反馈。 */
  const act = (it: string, el: HTMLElement): void => {
    if (DROPDOWNS[it]) openDrop(it, el);
    else notify(t('执行') + ' · ' + t(it));
  };
  const pick = (v: string): void => {
    notify(t('应用') + ' · ' + t(v));
    setDrop(null);
  };

  return (
    <TContext.Provider value={t}>
      <div className="app">
        <header className="topbar">
          <div className="brand">
            <span className="mark"><IconGrid size={18} /></span>
            OPAL <span className="sub">{t('safe-commit layer')}</span>
          </div>
          <div className="fmttabs">
            {FORMATS.map((f) => (
              <button
                key={f.id}
                className={'fmttab' + (f.id === fmt ? ' on' : '')}
                onClick={() => {
                  setFmt(f.id);
                  setTab(0);
                }}
              >
                {t(f.label)}
              </button>
            ))}
          </div>
          <div className="file">
            <span className="name">{t(curFmt.file)}</span>
            <span className="saved">{t('已保存')}</span>
          </div>
          <div className="grow" />
          <select className="langsel" value={lang} onChange={(e) => pickLang(e.target.value as Lang)} title="Language">
            {LANGS.map((l) => (
              <option key={l.id} value={l.id}>{l.label}</option>
            ))}
          </select>
          <button className="zoom"><IconSearch size={14} /> 100%</button>
          <button className="icon-ghost" title={t('更多')}><IconDots size={18} /></button>
        </header>

        <main className="body">
          <section className="editor">
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
            <div className="canvas">
              {isExcel ? (
                <table className="sheet">
                  <thead>
                    <tr>
                      <th className="colh corner" />
                      {COLS.map((c, ci) => (
                        <th key={c} className="colh" onMouseDown={() => selColumn(ci)}>{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="rowh" onMouseDown={() => selRow(0)}>1</td>
                      {HEADERS.map((_, ci) => (
                        <td
                          key={ci}
                          className={('name ' + cellClass(0, ci)).trim()}
                          onMouseDown={() => onDown(0, ci)}
                          onMouseEnter={() => onEnter(0, ci)}
                          onDoubleClick={() => beginEdit(0, ci)}
                        >
                          {cellInner(0, ci)}
                        </td>
                      ))}
                    </tr>
                    {DATA.map((_, di) => {
                      const ri = di + 1;
                      return (
                        <tr key={di}>
                          <td className="rowh" onMouseDown={() => selRow(ri)}>{ri + 1}</td>
                          {COLS.map((_, ci) => (
                            <td
                              key={ci}
                              className={cellClass(ri, ci)}
                              onMouseDown={() => onDown(ri, ci)}
                              onMouseEnter={() => onEnter(ri, ci)}
                              onDoubleClick={() => beginEdit(ri, ci)}
                            >
                              {cellInner(ri, ci)}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <div className="canvas-ph">
                  <div className="ph-badge"><IconDoc size={26} /></div>
                  <div className="ph-t">{t(curFmt.label)} · {t('渲染区')}</div>
                  <div className="ph-d">{t(CANVAS_HINT[fmt])}</div>
                </div>
              )}
            </div>
          </section>

          <aside className="rail">
            <div className="selbar">
              <span className="dot" />
              {t('选区')} <span className="ref">{isExcel ? rangeLabel : '—'}</span>
              <span className="grow" />
              <span>{isExcel ? `${selRows} × ${selCols} ${t('单元格')}` : `${t(curFmt.label)} ${t('工作区')}`}</span>
            </div>

            <div className="rail-body">
              {!sent ? (
                <>
                  <Section label={t('建议操作')}>
                    {EXAMPLES.map((e) => {
                      const Ico = e.Icon;
                      return (
                        <button key={e.t} className="example" onClick={() => setSent(true)}>
                          <span className="ico"><Ico size={17} /></span>
                          <span>
                            <div className="t">{t(e.t)}</div>
                            <div className="d">{t(e.d)}</div>
                          </span>
                        </button>
                      );
                    })}
                  </Section>

                  <Section label={t('指令模板')}>
                    <div className="tmpl-empty">
                      <div className="badge"><IconDoc size={20} /></div>
                      <div className="te-t">{t('暂无模板')}</div>
                      <div className="te-d">{t('把常用指令存成模板,下次圈选后一键复用')}</div>
                      <button className="btn solid"><IconPlus size={14} /> {t('新建模板')}</button>
                    </div>
                  </Section>

                  <Section label={t('最近')}>
                    {RECENT.map((r) => (
                      <button key={r.t} className="recent">
                        <span className="ic"><IconCheck size={15} /></span>
                        <span>
                          <div className="t">{t(r.t)}</div>
                          <div className="time">{t(r.time)}</div>
                        </span>
                      </button>
                    ))}
                  </Section>
                </>
              ) : (
                <Section label={t('本次改动') + ' · 3'}>
                  <ul className="plan">
                    <li>{t('按 销量×单价 补齐「金额」列')}</li>
                    <li>{t('新增「毛利率」列')}</li>
                    <li>{t('标记偏离均值过大的异常值')}</li>
                  </ul>
                  <div className="summary">{t('+10 单元格 · +1 列公式 · 1 处标记')}</div>

                  <Change tag={t('公式')} title="E2:E6" before={t('空')} after="=C×D" why={t('按 销量×单价 自动补齐金额')} />
                  <Change tag={t('新列')} title="F2:F6" before={t('空')} after="41% / 37% …" why={t('新增毛利率列')} />
                  <Change tag={t('标记')} title="C4" before="1500" after="1500" why={t('偏离均值约 8 倍,疑似录入错误')} />

                  <div className="bulk">
                    <button className="btn ok"><IconCheck size={14} /> {t('全部接受')}</button>
                    <button className="btn">{t('部分接受')}</button>
                    <button className="btn no"><IconX size={14} /> {t('拒绝')}</button>
                  </div>
                </Section>
              )}
            </div>

            <div className="composer">
              {cfgOpen && (
                <div className="modelcfg">
                  <h4>{t('模型')} · BYOK</h4>
                  <div className="prov">
                    {MODEL_PROVIDERS.map((p) => (
                      <button
                        key={p.id}
                        className={'pchip' + (p.id === provider ? ' on' : '')}
                        onClick={() => pickProvider(p.id)}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                  <label>{t('模型')}</label>
                  <input
                    value={model}
                    onChange={(e) => {
                      setModel(e.target.value);
                      lsSet('oa.model', e.target.value);
                    }}
                    placeholder={curProvider.model}
                  />
                  <label>API Key(BYOK)</label>
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => {
                      setApiKey(e.target.value);
                      lsSet('oa.apiKey', e.target.value);
                    }}
                    placeholder="sk-..."
                  />
                  <div className="note">
                    <IconHelp size={13} /> {t('密钥只存在你的浏览器本地,绝不上传服务器。')}
                  </div>
                </div>
              )}
              <div className="box">
                <div className="selchip">
                  <span className="dot" />{' '}
                  {isExcel ? (
                    <>
                      {t('已选')} <b>{rangeLabel}</b> · {selRows}×{selCols}
                    </>
                  ) : (
                    <>
                      {t('当前')} <b>{t(curFmt.label)}</b> {t('工作区')}
                    </>
                  )}
                  {t(',发送时随选区一并给 Agent')}
                </div>
                <textarea
                  value={intent}
                  onChange={(e) => setIntent(e.target.value)}
                  placeholder={t(PLACEHOLDERS[fmt])}
                  rows={1}
                />
                <div className="row">
                  <button className="iconbtn" title={t('附件')}><IconPaperclip size={17} /></button>
                  <button className="iconbtn" title={t('图片')}><IconImage size={17} /></button>
                  <button className="iconbtn" title={t('历史')}><IconClock size={17} /></button>
                  <span className="grow" />
                  <button className={'model' + (cfgOpen ? ' on' : '')} onClick={() => setCfgOpen((v) => !v)}>
                    {curProvider.label} <IconChevron size={13} />
                  </button>
                  <button className="send" title={t('发送')} onClick={send}><IconSend size={16} /></button>
                </div>
              </div>
            </div>
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
