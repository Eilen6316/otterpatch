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
import type { RichDocHandle, DocFmt } from './RichDoc.js';
import { Markdown } from './Markdown.js';
import { chartToPngDataUrl, gridToChartSpec, buildChartGrid, specFromInline } from './chart.js';

/** Agent 在网格上的一步操作(用于"边画边改"的可视化播放)。 */
interface GridOp { a1: string; value?: unknown; bg?: string; color?: string; bold?: boolean; numFmt?: string; note: string; before?: unknown; editId?: string }

/** 由 applyExcelStructure 直接落网格的"结构/对象操作"kind —— 这些【不能】被 diffToOps 当作写单元格值
 *  (否则会把"插入图表"等的摘要文字写进格子);它们走 applyExcelStructure,不进 playOps。 */
const ADV_KINDS = new Set(['insertRows', 'deleteRows', 'insertCols', 'deleteCols', 'mergeCells', 'unmergeCells', 'freezePanes', 'sortRange', 'deleteRange', 'conditionalFormat', 'dataValidation', 'autoFilter', 'insertChart']);

/** 对话流里的一条消息(Cursor 式连续 thread)。 */
type Turn =
  | { role: 'user'; text: string }
  | { role: 'assistant'; kind: 'answer'; text: string; reasoning?: string; streaming?: boolean }
  | { role: 'assistant'; kind: 'clarify'; questions: ClarifyQuestion[]; reasoning?: string; answered?: boolean; answerText?: string }
  | { role: 'assistant'; kind: 'diff'; diff: AgentDiff; ops: GridOp[]; board?: BoardPatch; word?: WordEdit[]; text?: string; reasoning?: string; reverted?: boolean; committed?: boolean; committedCount?: number };

/** drawio 改动落到画板的句柄:editId→画板对象 id 映射 + 可重放的节点/连线(供逐条接受/拒绝)。 */
interface BoardPatch { byEdit: Record<string, string>; objs: Array<{ editId: string; node?: BNode; edge?: BEdge }> }

/** Word 一条改动:文本改写(replacement)或格式改动(style);还原信息由编辑器按 editId 内部保存。 */
interface WordEdit { editId: string; quote: string; replacement?: string; style?: DocFmt }

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

/** DeepSeek 式可折叠"思考过程":流式期间默认展开看它边想,结束后可折叠。 */
function ThinkingPanel({ reasoning, streaming }: { reasoning: string; streaming?: boolean }): ReactNode {
  const t = useT();
  const [open, setOpen] = useState<boolean | null>(null);
  const expanded = open ?? !!streaming;
  return (
    <div className={'thinking-panel' + (streaming ? ' live' : '')}>
      <button className="tp-head" onClick={() => setOpen(!expanded)}>
        <span className="tp-ico">{streaming ? <span className="spin sm" /> : '💭'}</span>
        <span>{streaming ? t('正在思考…') : t('思考过程')}</span>
        <span className="grow" />
        <span className="tp-chev">{expanded ? '▾' : '▸'}</span>
      </button>
      {expanded && <div className="tp-body">{reasoning || t('(无)')}</div>}
    </div>
  );
}

/** Agent 反向澄清的"引导选择"卡片(Claude Code 风):每题给候选项(单/多选)+「其他」自填;全部作答后提交。 */
function ClarifyCard({ questions, answered, answerText, onSubmit }: { questions: ClarifyQuestion[]; answered?: boolean; answerText?: string; onSubmit: (text: string) => void }): ReactNode {
  const t = useT();
  const [sel, setSel] = useState<Record<number, string[]>>({});
  const [other, setOther] = useState<Record<number, string>>({});
  const pick = (qi: number, label: string, multi?: boolean): void => {
    setSel((s) => {
      const cur = s[qi] ?? [];
      if (multi) return { ...s, [qi]: cur.includes(label) ? cur.filter((x) => x !== label) : [...cur, label] };
      return { ...s, [qi]: cur.includes(label) ? [] : [label] };
    });
  };
  const doneCount = questions.filter((_, qi) => (sel[qi]?.length ?? 0) > 0 || !!other[qi]?.trim()).length;
  const ready = doneCount === questions.length;
  const submit = (): void => {
    if (!ready) return;
    const lines = questions.map((q, qi) => {
      const picks = [...(sel[qi] ?? [])];
      const o = other[qi]?.trim();
      if (o) picks.push(o);
      return `- ${q.header || q.question}:${picks.join('、')}`;
    });
    onSubmit(t('我的选择如下,请据此继续:') + '\n' + lines.join('\n'));
  };
  if (answered) {
    return (
      <div className="clarify done">
        <div className="cl-top"><IconSelect size={13} /> {t('已回复澄清')}</div>
        {answerText ? <div className="cl-recap">{answerText}</div> : null}
      </div>
    );
  }
  return (
    <div className="clarify">
      <div className="cl-top"><IconSelect size={13} /> {t('需要你确认一下')}</div>
      {questions.map((q, qi) => (
        <div key={qi} className="cl-q">
          <div className="cl-qhead">{q.header ? <span className="cl-tag">{q.header}</span> : null}<span className="cl-qtext">{q.question}</span>{q.multi ? <span className="cl-multi">{t('可多选')}</span> : null}</div>
          <div className="cl-opts">
            {q.options.map((o, oi) => {
              const on = (sel[qi] ?? []).includes(o.label);
              return (
                <button key={oi} className={'cl-opt' + (on ? ' on' : '')} onClick={() => pick(qi, o.label, q.multi)}>
                  <span className="cl-optlabel">{o.label}{oi === 0 ? <i className="cl-rec">{t('推荐')}</i> : null}</span>
                  {o.description ? <span className="cl-optdesc">{o.description}</span> : null}
                </button>
              );
            })}
          </div>
          <input className="cl-other" placeholder={t('或自己填…')} value={other[qi] ?? ''} onChange={(ev) => setOther((s) => ({ ...s, [qi]: ev.target.value }))} onKeyDown={(ev) => { if (ev.key === 'Enter' && ready) submit(); }} />
        </div>
      ))}
      <div className="cl-acts">
        <span className="cl-prog">{doneCount}/{questions.length}</span>
        <span className="grow" />
        <button className="btn solid" disabled={!ready} onClick={submit}>{t('提交')}</button>
      </div>
    </div>
  );
}

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

const QUICKS: { t: string; kind: 'do' | 'ask'; prompt: string }[] = [
  { t: '补全缺失的计算列', kind: 'do', prompt: '检查并补齐缺失的计算列(如 金额=销量×单价、毛利率),用公式实现' },
  { t: '标红异常值', kind: 'do', prompt: '找出各数值列里偏离均值过大的异常值,标红并列出问题清单' },
  { t: '统一日期/数字格式', kind: 'do', prompt: '统一日期为 YYYY-MM-DD,把存成文本的数字转回数值,去除多余空格' },
  { t: '这张表有什么问题?', kind: 'ask', prompt: '通览整张表,指出数据质量问题(缺失、异常、格式不一致等),给出清单' },
  { t: '各产品销量合计?', kind: 'ask', prompt: '按产品分组,汇总每个产品的销量合计' },
];


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
interface ClarifyOption { label: string; description?: string }
interface ClarifyQuestion { header?: string; question: string; options: ClarifyOption[]; multi?: boolean }

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
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
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
    if (intentOverride && intentOverride !== intent) setIntent(intentOverride);
    // Excel:永远主动拉整张表(概览+数据+焦点),与是否圈选无关 —— 没圈选也能看全局、也有 read_range/aggregate 工具
    const sheetSnap = isExcel ? (univerRef.current?.getSheet() ?? uniSel) : null;
    const ctx = isExcel ? (sheetSnap?.text ?? '(表格为空)') : fmt === 'drawio' && boardSel ? boardSel.context : fmt === 'word' ? `Word 文档全文(按整篇理解;改写给 quote 必须是其中真实存在的原文片段):\n${wordRef.current?.getText() ?? '(空文档)'}` : selectionContext();
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
          body: JSON.stringify({ format: fmt, intent: theIntent, context: ctx, provider, model, apiKey, ...(isExcel && sheetSnap?.sheet ? { sheet: sheetSnap.sheet } : {}), ...(thread.length ? { history: buildHistory(thread) } : {}) }),
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
                setAccepted(new Set(diff.items.map((it) => it.editId)));
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
                    if (rec?.op?.kind === 'setStyle') return { editId: it.editId, quote, style: rec.op.style ?? {} };
                    return { editId: it.editId, quote, replacement: rec?.op?.text ?? (it.after ?? '') };
                  });
                  // 乐观落入文档(与 Excel playOps 一致);编辑器按 editId 包裹,拒绝可精确还原
                  for (const w of wordEdits) wordRef.current?.applyEdit(w.editId, w.quote, w.style ? { fmt: w.style } : { replacement: w.replacement ?? '' });
                  setThread((th) => th.map((tt, i) => (i === th.length - 1 && tt.role === 'assistant' ? { role: 'assistant', kind: 'diff', diff, ops: [], word: wordEdits, text: tt.kind === 'answer' ? tt.text : undefined, reasoning: tt.kind === 'answer' ? tt.reasoning : undefined } : tt)));
                  setReviewIdx(0);
                  if (wordEdits[0]) wordRef.current?.highlight(wordEdits[0].editId); // 审阅期定位第一条
                } else {
                  applyExcelStructure(cs); // 结构性操作(插删行列/合并/冻结/清空)先落,改变网格布局
                  const ops = diffToOps(diff);
                  const api = univerRef.current; // 采集改前值,供 git-diff 展示 + "撤销/拒绝"还原
                  if (api) for (const op of ops) { op.before = api.getValue(op.a1); }
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
  };
  /** 撤销某条改动:把该回合写过的格子还原到改前值,并清掉它加的底色。 */
  const revertTurn = (idx: number): void => {
    const turn = thread[idx];
    if (!turn || turn.role !== 'assistant' || turn.kind !== 'diff') return;
    if (turn.board) {
      boardRef.current?.removeObjects(Object.values(turn.board.byEdit)); // drawio:从画板移除该回合对象
    } else if (turn.word) {
      for (const w of turn.word) if (accepted.has(w.editId)) wordRef.current?.revert(w.editId); // 按 editId 精确还原每条
    } else {
      const api = univerRef.current;
      if (api) {
        for (const op of turn.ops) {
          if (op.value !== undefined) api.setCell(op.a1, op.before ?? '');
          if (op.bg) api.setBackground(op.a1, null);
          if (op.color) api.setFontColor(op.a1, '#1f2937');
        }
      }
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
    api.setBackground(op.a1, op.bg ?? null);
  };
  const revertGridOp = (op: GridOp): void => {
    const api = univerRef.current; if (!api) return;
    if (op.value !== undefined) api.setCell(op.a1, op.before ?? '');
    if (op.bg) api.setBackground(op.a1, null);
    if (op.color) api.setFontColor(op.a1, '#1f2937');
  };
  const reapplyBoardObj = (o: { node?: BNode; edge?: BEdge }): void =>
    boardRef.current?.addObjects(o.node ? [o.node] : [], o.edge ? [o.edge] : []);
  /** 高亮当前审阅的改动:Excel 聚焦该格、drawio 高亮该对象。 */
  const highlightItem = (turn: Extract<Turn, { kind: 'diff' }>, item: AgentDiffItem | undefined): void => {
    if (!item) return;
    if (isExcel) univerRef.current?.focus(item.ref.replace(/^.*!/, ''));
    else if (fmt === 'drawio') { const id = turn.board?.byEdit[item.editId]; if (id) boardRef.current?.highlight(id); }
    else if (fmt === 'word') wordRef.current?.highlight(item.editId); // 定位当前条
  };
  const acceptItem = (turn: Extract<Turn, { kind: 'diff' }>, idx: number): void => {
    const it = turn.diff.items[idx]; if (!it) return;
    if (!accepted.has(it.editId)) { // 之前被拒 → 重新落回工作区
      if (isExcel) { const op = turn.ops.find((o) => o.editId === it.editId); if (op) applyGridOp(op); }
      else if (fmt === 'drawio') { const o = turn.board?.objs.find((x) => x.editId === it.editId); if (o) reapplyBoardObj(o); }
      else if (fmt === 'word') { const w = turn.word?.find((x) => x.editId === it.editId); if (w) wordRef.current?.applyEdit(w.editId, w.quote, w.style ? { fmt: w.style } : { replacement: w.replacement ?? '' }); }
      toggleAccept(it.editId, true);
    }
    setReviewIdx(idx + 1);
  };
  const rejectItem = (turn: Extract<Turn, { kind: 'diff' }>, idx: number): void => {
    const it = turn.diff.items[idx]; if (!it) return;
    if (isExcel) { const op = turn.ops.find((o) => o.editId === it.editId); if (op) revertGridOp(op); }
    else if (fmt === 'drawio') { const id = turn.board?.byEdit[it.editId]; if (id) boardRef.current?.removeObjects([id]); }
    else if (fmt === 'word' && accepted.has(it.editId)) wordRef.current?.revert(it.editId); // 之前已应用 → 精确还原该条
    toggleAccept(it.editId, false);
    setReviewIdx(idx + 1);
  };
  const acceptAll = (turn: Extract<Turn, { kind: 'diff' }>, ti: number): void => {
    for (const it of turn.diff.items) {
      if (accepted.has(it.editId)) continue;
      if (isExcel) { const op = turn.ops.find((o) => o.editId === it.editId); if (op) applyGridOp(op); }
      else if (fmt === 'drawio') { const o = turn.board?.objs.find((x) => x.editId === it.editId); if (o) reapplyBoardObj(o); }
      else if (fmt === 'word') { const w = turn.word?.find((x) => x.editId === it.editId); if (w) wordRef.current?.applyEdit(w.editId, w.quote, w.style ? { fmt: w.style } : { replacement: w.replacement ?? '' }); }
    }
    const all = turn.diff.items.map((x) => x.editId);
    setAccepted(new Set(all));
    setReviewIdx(all.length);
    markCommitted(ti, all.length);
    if (isExcel && fileB64) void doCommit(all); // 有上传文件 → 外科写回并下载
    else notify((fmt === 'drawio' ? t('已采纳到画板') : fmt === 'word' ? t('已采纳到文档') : t('已采纳到表格')) + ' · ' + all.length + ' ' + t('处'));
  };
  /** 读入要写回的真实文件(.xlsx/.docx/.pdf/.drawio)为 base64。 */
  const onFile = (f: File | undefined): void => {
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const res = String(reader.result);
      setFileB64(res.slice(res.indexOf(',') + 1));
      setFileName(f.name);
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
        <header className="topbar">
          <div className="brand">
            <img className="brand-logo" src="/logo.png" alt="OtterPatch" />
            <span className="sub">{t('safe-commit layer')}</span>
          </div>
          <div className="fmttabs">
            {FORMATS.map((f) => (
              <button
                key={f.id}
                className={'fmttab' + (f.id === fmt ? ' on' : '')}
                onClick={() => {
                  setFmt(f.id);
                  lsSet('oa.fmt', f.id);
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
          <button className="icon-ghost" title={t('更多')}><IconDots size={18} /></button>
        </header>

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
                <Suspense fallback={<div className="univer-loading">{t('加载表格引擎…')}</div>}>
                  <UniverSheet ref={univerRef} onSelection={setUniSel} />
                </Suspense>
              ) : fmt === 'drawio' ? (
                <DrawioBoard ref={boardRef} onBoardSel={setBoardSel} />
              ) : fmt === 'word' ? (
                <Suspense fallback={<div className="univer-loading">{t('加载文档编辑器…')}</div>}>
                  <RichDoc ref={wordRef} />
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
              {t('选区')} <span className="ref">{isExcel ? (uniSel?.a1 ?? '—') : '—'}</span>
              <span className="grow" />
              <span>{isExcel ? (uniSel ? `${uniSel.rows} × ${uniSel.cols} ${t('单元格')}` : '—') : fmt === 'drawio' && boardSel ? `${boardSel.count} ${t('个对象')}` : fmt === 'word' ? t('文档工作区') : `${t(curFmt.label)} ${t('工作区')}`}</span>
            </div>

            <div className="rail-body">
              {thread.length === 0 && !busy && !sendErr ? (
                <div className="agent-home">
                  <div className="ai-intro">
                    <img className="ai-mark" src="/favicon.png" alt="" />
                    <div className="ai-title">{t('OtterPatch 表格助手')}</div>
                    <div className="ai-sub">{t('圈选区域,问我问题或让我改表 —— 所有改动都先给你逐条审阅')}</div>
                  </div>
                  <div className="qs-label">{t('试试')}</div>
                  <div className="qs-list">
                    {QUICKS.map((q) => (
                      <button key={q.t} className={'qs ' + q.kind} onClick={() => void send(q.prompt)}>
                        <span className="qs-tag">{q.kind === 'do' ? t('改') : t('问')}</span>
                        <span className="qs-t">{t(q.t)}</span>
                      </button>
                    ))}
                  </div>
                  {recent.length > 0 && (
                    <>
                      <div className="qs-label">{t('最近')}</div>
                      <div className="recent-list">
                        {recent.map((r, i) => (
                          <button key={i} className="recent" onClick={() => setIntent(r.t)} title={r.t}>
                            <IconClock size={13} />
                            <span className="rt">{r.t}</span>
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
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
                    const d = turn.diff;
                    const total = d.items.length;
                    const ridx = Math.min(reviewIdx, total);
                    const cur = active && ridx < total ? d.items[ridx] : undefined;
                    const badgeText = (b: string): string => (b === 'add' ? t('新增') : b === 'remove' ? t('删除') : b === 'move' ? t('移动') : t('修改'));
                    return (
                      <div key={i} className="ai-msg">
                        <img className="ai-av" src="/favicon.png" alt="" />
                        <div className="ai-stack">
                          {turn.reasoning ? <ThinkingPanel reasoning={turn.reasoning} /> : null}
                          {turn.text?.trim() ? <div className="answer-bubble md"><Markdown text={turn.text} /></div> : null}
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
                                <details className="rv-code">
                                  <summary>{t('改动明细(git diff)')} · {total} {t('处')}</summary>
                                  <table className="rv-difftable"><tbody>
                                    {d.items.map((it, k) => {
                                      const o = turn.ops.find((x) => x.editId === it.editId);
                                      const w = turn.word?.find((x) => x.editId === it.editId);
                                      const oldV = w ? (w.quote || (w.style ? '全文' : '')) : !it.style && o?.before != null && String(o.before) !== '' ? String(o.before) : '';
                                      const newV = w ? (w.replacement ?? (it.after ?? '')) : (it.after ?? '');
                                      return (
                                        <tr key={it.editId} className={'dt dt-' + it.badge} onClick={() => { if (active) setReviewIdx(k); }} title={it.label}>
                                          <td className="dt-ref">{it.ref.replace(/^.*!/, '')}</td>
                                          <td className="dt-old">{oldV}</td>
                                          <td className="dt-new">{newV}</td>
                                        </tr>
                                      );
                                    })}
                                  </tbody></table>
                                </details>
                              )
                            ) : null}
                            {total > 0 && active && <div className="rv-prog"><div className="rv-prog-fill" style={{ width: `${(ridx / total) * 100}%` }} /></div>}

                            {total === 0 ? (
                              <div className="rv-empty">{t('Agent 未提出改动')}</div>
                            ) : turn.committed ? (
                              <div className="rv-final ok"><IconCheck size={15} /> {t('已采纳')}{turn.committedCount ? ` · ${turn.committedCount} ${t('处')}` : ''}<span className="grow" /><button className="link-btn" onClick={() => revertTurn(i)}>{t('撤销')}</button></div>
                            ) : turn.reverted ? (
                              <div className="rv-final dim">↩ {t('已撤销')}</div>
                            ) : cur ? (
                              <>
                                <div className={'rv-card' + (accepted.has(cur.editId) ? '' : ' rejected')}>
                                  <div className="rv-card-h">
                                    <span className={'rv-badge ' + cur.badge}>{badgeText(cur.badge)}</span>
                                    <span className="rv-ref">{cur.ref}</span>
                                  </div>
                                  {(() => {
                                    if (cur.style) return cur.after ? <div className="rv-fmt">{cur.after}</div> : null; // 格式改动:展示格式说明
                                    const op = turn.ops.find((o) => o.editId === cur.editId);
                                    const w = turn.word?.find((x) => x.editId === cur.editId);
                                    const before = w ? w.quote : op?.before;
                                    const after = w ? w.replacement : cur.after;
                                    const hasOld = cur.badge !== 'add' && before != null && String(before) !== '';
                                    const hasNew = cur.badge !== 'remove' && after != null;
                                    if (!hasOld && !hasNew) return null;
                                    return (
                                      <div className="rv-diff">
                                        {hasOld ? <div className="rv-old"><span className="rv-sign">−</span>{String(before)}</div> : null}
                                        {hasNew ? <div className="rv-new"><span className="rv-sign">+</span>{after}</div> : null}
                                      </div>
                                    );
                                  })()}
                                  <div className="rv-why">{cur.label}</div>
                                </div>
                                <div className="rv-acts">
                                  <button className="rv-step" disabled={ridx <= 0} onClick={() => setReviewIdx(Math.max(0, ridx - 1))} title={t('上一处')}><IconChevron size={14} /></button>
                                  <button className="btn no" onClick={() => rejectItem(turn, ridx)}><IconX size={14} /> {t('拒绝')}</button>
                                  <button className="btn ok" onClick={() => acceptItem(turn, ridx)}><IconCheck size={14} /> {t('接受')}</button>
                                  <span className="grow" />
                                  <button className="btn solid" onClick={() => acceptAll(turn, i)}>{t('全部接受')}{total > 1 ? ` · ${total}` : ''}</button>
                                </div>
                              </>
                            ) : active ? (
                              <div className="rv-acts done">
                                <span className="rv-donen">{t('已逐条过完')} · {accepted.size}/{total}</span>
                                <span className="grow" />
                                <button className="rv-step" onClick={() => setReviewIdx(0)} title={t('重看')}><IconUndo size={14} /></button>
                                <button className="btn solid" onClick={() => acceptAll(turn, i)}><IconCheck size={14} /> {t('全部接受')}</button>
                              </div>
                            ) : (
                              <div className="rv-final dim">{total} {t('处改动')}<span className="grow" /><button className="link-btn" onClick={() => revertTurn(i)}>↩ {t('撤销改动')}</button></div>
                            )}
                          </div>
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
                  <label>{t('本机服务地址(默认即可,一般无需修改)')}</label>
                  <input
                    className="dim"
                    value={server}
                    onChange={(e) => {
                      setServer(e.target.value);
                      lsSet('oa.server', e.target.value);
                    }}
                    placeholder="http://localhost:4319"
                  />
                  <div className="note">
                    <IconHelp size={13} /> {t('密钥只存在你的浏览器本地,绝不上传服务器;桌面版会自动启动本机服务。')}
                  </div>
                </div>
              )}
              <div className="box">
                <div className="selchip">
                  <span className="dot" />{' '}
                  {isExcel ? (
                    uniSel ? (
                      <>
                        {t('已选')} <b>{uniSel.a1}</b> · {uniSel.rows}×{uniSel.cols}
                      </>
                    ) : (
                      <span className="muted">{t('未选区域 · 将基于整张表理解')}</span>
                    )
                  ) : fmt === 'drawio' && boardSel ? (
                    <>{boardSel.chip}</>
                  ) : (
                    <>
                      {t('当前')} <b>{t(curFmt.label)}</b> {t('工作区')}
                    </>
                  )}
                </div>
                <textarea
                  value={intent}
                  onChange={(e) => setIntent(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      if (!busy) void send();
                    }
                  }}
                  placeholder={t(PLACEHOLDERS[fmt])}
                  rows={1}
                />
                <div className="row">
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".xlsx,.docx,.pdf,.drawio"
                    style={{ display: 'none' }}
                    onChange={(e) => onFile(e.target.files?.[0] ?? undefined)}
                  />
                  <button className={'iconbtn plus' + (fileName ? ' on' : '')} title={fileName || t('附件')} onClick={() => fileRef.current?.click()}><IconPlus size={16} /></button>
                  <span className="grow" />
                  <button className={'model' + (cfgOpen ? ' on' : '')} onClick={() => setCfgOpen((v) => !v)}>
                    {curProvider.label} <IconChevron size={13} />
                  </button>
                  <button className="send" title={t('发送')} onClick={() => void send()} disabled={busy}><IconSend size={16} /></button>
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

/** drawio 顶部工具栏(仿 next-ai-drawio):单行图标,取代 Office 选项卡式功能区。 */
const DTOOLS = ['选择', '添加节点', '连线', '文本', '自由绘制', '填充色', '线条', '圆角', '阴影', '形状'];
function DrawioToolbar({ onAct }: { onAct: OnOpen }) {
  const t = useT();
  return (
    <div className="dtoolbar">
      <button className="dtool" title={t('撤销')} onClick={(e) => onAct('撤销', e.currentTarget)}><IconUndo size={16} /></button>
      <span className="dsep" />
      {DTOOLS.map((it) => {
        const Ico = FUNC_ICONS[it];
        const accent = it === '填充色' ? ' ic-amber' : '';
        return (
          <button key={it} className={'dtool' + accent} title={t(it)} onClick={(e) => onAct(it, e.currentTarget)}>
            {Ico ? <Ico size={16} /> : it.slice(0, 1)}
          </button>
        );
      })}
      <span className="grow" />
      <span className="dzoom"><IconSearch size={13} /> 100%</span>
    </div>
  );
}

/** drawio 左侧形状面板(高度还原 jgraph/drawio:可折叠 通用/杂项/高级 + 搜索 + 便笺本 + 更多图形)。 */
const PAL_CATS: { key: 'general' | 'misc' | 'advanced'; label: string }[] = [
  { key: 'general', label: '通用' },
  { key: 'misc', label: '杂项' },
  { key: 'advanced', label: '高级' },
];

function DrawioPalette({ onPick }: { onPick: (s: string) => void }) {
  const t = useT();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({ general: true, misc: false, advanced: true });
  const query = q.trim();
  return (
    <aside className="palette">
      <div className="pal-search">
        <IconSearch size={13} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('搜索形状')} />
      </div>
      <div className="pal-cat">
        <div className="pal-cat-h">{t('便笺本')}</div>
        <div className="pal-scratch">{t('把元素拖至此处')}</div>
      </div>
      {PAL_CATS.map((cat) => {
        const shapes = DRAWIO_SHAPES[cat.key].filter((s) => !query || s.name.includes(query));
        const isOpen = query ? shapes.length > 0 : open[cat.key] !== false;
        if (query && shapes.length === 0) return null;
        return (
          <div className="pal-cat" key={cat.key}>
            <button className="pal-cat-h click" onClick={() => setOpen((o) => ({ ...o, [cat.key]: !(o[cat.key] !== false) }))}>
              <span className={'tri' + (isOpen ? ' open' : '')}>▸</span> {t(cat.label)}
              <span className="pal-n">{DRAWIO_SHAPES[cat.key].length}</span>
            </button>
            {isOpen && (
              <div className="pal-grid">
                {shapes.map((s) => (
                  <button
                    key={s.name}
                    className="pal-shape"
                    title={s.name}
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData('otterpatch/shape', JSON.stringify({ name: s.name, inner: s.inner }))}
                    onClick={() => onPick(s.name)}
                  >
                    <svg viewBox="0 0 40 30" fill="none" stroke="currentColor" strokeWidth={1.4} dangerouslySetInnerHTML={{ __html: s.inner }} />
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

interface XY { x: number; y: number }
interface BNode { id: string; x: number; y: number; w: number; h: number; inner: string; label: string; kind?: string; rot?: number; fill?: string; stroke?: string; fontColor?: string; fontSize?: number; bold?: boolean; text?: boolean }
type ArrowKind = 'classic' | 'open' | 'diamond' | 'circle' | 'none';
type EdgeStyle = 'ortho' | 'straight';
interface BEdge { id: string; from: string; to: string; arrow?: ArrowKind; style?: EdgeStyle; points?: XY[] }
/** 两节点周界直连(直线线型)。 */
function straightRoute(a: BNode, b: BNode): XY[] {
  const ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
  const bc = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  return [perim(a, bc.x, bc.y), perim(b, ac.x, ac.y)];
}
/** 经过显式航点的正交折线:source周界 → 各航点 → target周界,相邻点间插直角拐点。 */
function routeWaypoints(a: BNode, b: BNode, pts: XY[]): XY[] {
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  const all = [perim(a, first.x, first.y), ...pts, perim(b, last.x, last.y)];
  const out: XY[] = [all[0]!];
  for (let i = 1; i < all.length; i++) {
    const c = out[out.length - 1]!;
    const q = all[i]!;
    if (Math.abs(c.x - q.x) > 0.5 && Math.abs(c.y - q.y) > 0.5) out.push({ x: q.x, y: c.y });
    out.push(q);
  }
  return out;
}
/** 选中边时用于摆放航点/虚拟折点手柄的控制点序列:[源周界, ...航点, 目标周界]。 */
function controlPoints(a: BNode, b: BNode, pts: XY[]): XY[] {
  if (pts.length) {
    const first = pts[0]!;
    const last = pts[pts.length - 1]!;
    return [perim(a, first.x, first.y), ...pts, perim(b, last.x, last.y)];
  }
  const ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
  const bc = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  return [perim(a, bc.x, bc.y), perim(b, ac.x, ac.y)];
}
function edgePts(a: BNode, b: BNode, style?: EdgeStyle, points?: XY[]): XY[] {
  if (points && points.length) return routeWaypoints(a, b, points);
  return style === 'straight' ? straightRoute(a, b) : ortho(a, b);
}
const ARROWS: ArrowKind[] = ['classic', 'open', 'diamond', 'circle', 'none'];
function arrowGlyph(ak: ArrowKind): ReactNode {
  const x2 = ak === 'none' ? 18 : 11;
  const head =
    ak === 'classic' ? <path d="M10,2 L17,6 L10,10 z" fill="currentColor" /> :
    ak === 'open' ? <path d="M11,2.5 L17,6 L11,9.5" fill="none" stroke="currentColor" strokeWidth={1.3} /> :
    ak === 'diamond' ? <path d="M9,6 L13,2.5 L17,6 L13,9.5 z" fill="currentColor" /> :
    ak === 'circle' ? <circle cx="14" cy="6" r="2.6" fill="currentColor" /> :
    null;
  return (
    <g stroke="currentColor">
      <line x1={1} y1={6} x2={x2} y2={6} strokeWidth={1.3} />
      {head}
    </g>
  );
}

const GRID = 10;
const snap = (v: number): number => Math.round(v / GRID) * GRID;
const ndir = (p: XY, q: XY): XY => {
  const dx = q.x - p.x, dy = q.y - p.y;
  const l = Math.hypot(dx, dy) || 1;
  return { x: dx / l, y: dy / l };
};
/** 射线从节点中心到目标点,与节点矩形边界的交点(周界连接,箭头贴边)。 */
function perim(n: BNode, tx: number, ty: number): XY {
  const cx = n.x + n.w / 2, cy = n.y + n.h / 2;
  const dx = tx - cx, dy = ty - cy;
  if (!dx && !dy) return { x: cx, y: cy };
  const sx = Math.abs(dx) > 0.001 ? n.w / 2 / Math.abs(dx) : Infinity;
  const sy = Math.abs(dy) > 0.001 ? n.h / 2 / Math.abs(dy) : Infinity;
  const s = Math.min(sx, sy);
  return { x: cx + dx * s, y: cy + dy * s };
}
/** drawio 风格正交路由:沿主轴从源侧中点出、到目标侧中点入,中段折返。 */
function ortho(a: BNode, b: BNode): XY[] {
  const acx = a.x + a.w / 2, acy = a.y + a.h / 2, bcx = b.x + b.w / 2, bcy = b.y + b.h / 2;
  const dx = bcx - acx, dy = bcy - acy;
  if (Math.abs(dx) >= Math.abs(dy)) {
    const right = dx >= 0;
    // 竖直方向有重叠 → 两端取重叠区中点做共同 y,得到一条干净的水平直线
    const oy0 = Math.max(a.y, b.y);
    const oy1 = Math.min(a.y + a.h, b.y + b.h);
    const yy = oy1 > oy0 + 2 ? (oy0 + oy1) / 2 : null;
    const p1 = { x: right ? a.x + a.w : a.x, y: yy ?? acy };
    const p2 = { x: right ? b.x : b.x + b.w, y: yy ?? bcy };
    if (Math.abs(p1.y - p2.y) < 0.5) return [{ x: p1.x, y: p1.y }, { x: p2.x, y: p1.y }];
    const mx = (p1.x + p2.x) / 2;
    return [p1, { x: mx, y: p1.y }, { x: mx, y: p2.y }, p2];
  }
  const down = dy >= 0;
  const ox0 = Math.max(a.x, b.x);
  const ox1 = Math.min(a.x + a.w, b.x + b.w);
  const xx = ox1 > ox0 + 2 ? (ox0 + ox1) / 2 : null;
  const p1 = { x: xx ?? acx, y: down ? a.y + a.h : a.y };
  const p2 = { x: xx ?? bcx, y: down ? b.y : b.y + b.h };
  if (Math.abs(p1.x - p2.x) < 0.5) return [{ x: p1.x, y: p1.y }, { x: p1.x, y: p2.y }];
  const my = (p1.y + p2.y) / 2;
  return [p1, { x: p1.x, y: my }, { x: p2.x, y: my }, p2];
}
function roundedPath(pts: XY[], r = 8): string {
  if (pts.length < 2) return '';
  let d = `M ${pts[0]!.x} ${pts[0]!.y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i]!, prev = pts[i - 1]!, next = pts[i + 1]!;
    const rr = Math.min(r, Math.hypot(prev.x - p.x, prev.y - p.y) / 2, Math.hypot(next.x - p.x, next.y - p.y) / 2);
    const a = { x: p.x + ndir(p, prev).x * rr, y: p.y + ndir(p, prev).y * rr };
    const c = { x: p.x + ndir(p, next).x * rr, y: p.y + ndir(p, next).y * rr };
    d += ` L ${a.x} ${a.y} Q ${p.x} ${p.y} ${c.x} ${c.y}`;
  }
  const last = pts[pts.length - 1]!;
  return d + ` L ${last.x} ${last.y}`;
}
export interface BoardSel { count: number; chip: string; context: string }
/** App ↔ DrawioBoard 命令式句柄:把 Agent 提案的节点/连线落到画板、移除、或高亮某个对象供审阅。 */
export interface BoardHandle {
  addObjects(nodes: BNode[], edges: BEdge[]): void;
  removeObjects(ids: string[]): void;
  updateObject(id: string, patch: { value?: string; style?: string }): void;
  moveObject(id: string, box: { x?: number; y?: number; w?: number; h?: number }): void;
  highlight(id: string): void;
}
/** drawio style 串 → 画板节点的线稿 inner SVG(覆盖常见形状,默认矩形)。 */
function innerForStyle(style?: string): string {
  const s = (style ?? '').toLowerCase();
  if (s.includes('ellipse')) return '<ellipse cx="20" cy="15" rx="16" ry="11"/>';
  if (s.includes('rhombus')) return '<polygon points="20,3 37,15 20,27 3,15"/>';
  if (s.includes('hexagon')) return '<polygon points="11,5 29,5 37,15 29,25 11,25 3,15"/>';
  if (s.includes('cylinder')) return '<ellipse cx="20" cy="7" rx="13" ry="3.5"/><line x1="7" y1="7" x2="7" y2="23"/><line x1="33" y1="7" x2="33" y2="23"/><path d="M7 23 A13 3.5 0 0 0 33 23"/>';
  if (s.includes('rounded=1') || s.includes('rounded')) return '<rect x="4" y="5" width="32" height="20" rx="4" ry="4"/>';
  return '<rect x="4" y="5" width="32" height="20"/>';
}
/** 解析 drawio style 串 → 画板节点的填充/描边/字体(借鉴 Next AI Drawio 的彩色渲染)。 */
function parseDrawioStyle(style?: string): { fill?: string; stroke?: string; fontColor?: string; fontSize?: number; bold?: boolean; text?: boolean } {
  const s = style ?? '';
  const get = (k: string): string | undefined => new RegExp(k + '=([^;]+)').exec(s)?.[1]?.trim();
  const fill = get('fillColor'); const stroke = get('strokeColor'); const fontColor = get('fontColor');
  const fs = get('fontSize'); const fontStyle = get('fontStyle');
  const isText = /(?:^|;)\s*text(?:;|$)/.test(s) || s.includes('text;html');
  return {
    ...(fill && fill !== 'none' ? { fill } : {}),
    ...(stroke && stroke !== 'none' ? { stroke } : {}),
    ...(fontColor ? { fontColor } : {}),
    ...(fs && Number.isFinite(parseFloat(fs)) ? { fontSize: Math.round(parseFloat(fs)) } : {}),
    ...(fontStyle && (parseInt(fontStyle, 10) & 1) ? { bold: true } : {}),
    ...(isText ? { text: true } : {}),
  };
}
interface RawDrawioOp { op?: string; cellId?: string; value?: string; style?: string; edge?: boolean; source?: string; target?: string; x?: number; y?: number; width?: number; height?: number }
/** 从【流式中的】propose 入参里抽出已闭合的 op 对象(容忍尾部未完成的 JSON),供"边生成边画"。 */
function extractDrawioOps(buf: string): RawDrawioOp[] {
  const m = /"ops"\s*:\s*\[/.exec(buf);
  if (!m) return [];
  let i = m.index + m[0].length;
  const out: RawDrawioOp[] = [];
  while (i < buf.length) {
    while (i < buf.length && /[\s,]/.test(buf[i]!)) i++;
    if (i >= buf.length || buf[i] !== '{') break;
    let depth = 0, inStr = false, esc = false, j = i, closed = false;
    for (; j < buf.length; j++) {
      const c = buf[j]!;
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) { j++; closed = true; break; } }
    }
    if (!closed) break;
    try { out.push(JSON.parse(buf.slice(i, j)) as RawDrawioOp); } catch { break; }
    i = j;
  }
  return out;
}
/** 流式画板转换器:把【原始 proposal op】逐个转成画板节点/连线(editId 'e'+index 与 buildChangeSet 对齐)。 */
function makeRawBoardConv(seq: number): (op: RawDrawioOp, index: number) => { editId: string; boardId: string; node?: BNode; edge?: BEdge } | null {
  const idMap = new Map<string, string>();
  const bid = (orig?: string): string => { const k = orig ?? ('?' + idMap.size); let v = idMap.get(k); if (!v) { v = `g${seq}_${idMap.size + 1}`; idMap.set(k, v); } return v; };
  let stackY = 60;
  return (op, index) => {
    if (op.op !== 'add') return null;
    if (op.edge || (op.source && op.target)) {
      const id = bid(op.cellId ?? 'e_' + index);
      return { editId: 'e' + index, boardId: id, edge: { id, from: bid(op.source), to: bid(op.target), arrow: 'classic', style: 'ortho' } };
    }
    const id = bid(op.cellId ?? 'n_' + index);
    const w = op.width ?? 160; const h = op.height ?? 48;
    const x = op.x ?? 60; const y = op.y ?? stackY; stackY = Math.max(stackY, y) + h + 40;
    const st = parseDrawioStyle(op.style);
    const node: BNode = { id, x: snap(x), y: snap(y), w, h, inner: innerForStyle(op.style), label: String(op.value ?? ''), kind: st.text ? 'text' : 'agent', ...st };
    return { editId: 'e' + index, boardId: id, node };
  };
}
/** 一组 A1 格的包围区(用于大批量改动时整体聚焦,而非逐格)。 */
function boundingA1(ops: { a1: string }[]): string | null {
  let minC = Infinity, minR = Infinity, maxC = -Infinity, maxR = -Infinity;
  for (const o of ops) {
    const m = /([A-Za-z]+)([0-9]+)/.exec(o.a1.replace(/^.*!/, ''));
    if (!m) continue;
    let c = 0;
    for (const ch of m[1]!.toUpperCase()) c = c * 26 + (ch.charCodeAt(0) - 64);
    const r = parseInt(m[2]!, 10);
    minC = Math.min(minC, c); maxC = Math.max(maxC, c); minR = Math.min(minR, r); maxR = Math.max(maxR, r);
  }
  if (!Number.isFinite(minC)) return null;
  const col = (n: number): string => { let s = ''; let x = n; while (x > 0) { const r = (x - 1) % 26; s = String.fromCharCode(65 + r) + s; x = Math.floor((x - 1) / 26); } return s; };
  return `${col(minC)}${minR}:${col(maxC)}${maxR}`;
}
const bandRect = (b: { x0: number; y0: number; x1: number; y1: number }): { x: number; y: number; w: number; h: number } => ({
  x: Math.min(b.x0, b.x1),
  y: Math.min(b.y0, b.y1),
  w: Math.abs(b.x1 - b.x0),
  h: Math.abs(b.y1 - b.y0),
});
const intersects = (r: { x: number; y: number; w: number; h: number }, n: BNode): boolean =>
  !(n.x > r.x + r.w || n.x + n.w < r.x || n.y > r.y + r.h || n.y + n.h < r.y);

function resizeNode(r: { box: BNode; k: string; sx: number; sy: number }, x: number, y: number, shift: boolean): BNode {
  const b = r.box;
  const dx = x - r.sx, dy = y - r.sy;
  let w = b.w + (r.k.includes('e') ? dx : r.k.includes('w') ? -dx : 0);
  let h = b.h + (r.k.includes('s') ? dy : r.k.includes('n') ? -dy : 0);
  w = Math.max(40, w);
  h = Math.max(30, h);
  if (shift) {
    const aspect = b.w / b.h || 1;
    if (r.k.length === 2) {
      // 角手柄:取位移更大的轴为主,另一轴按比例
      if (Math.abs(w - b.w) >= Math.abs(h - b.h)) h = w / aspect;
      else w = h * aspect;
    } else if (r.k === 'n' || r.k === 's') {
      w = h * aspect;
    } else {
      h = w / aspect;
    }
    w = Math.max(40, w);
    h = Math.max(30, h);
  }
  let nx = b.x, ny = b.y;
  if (r.k.includes('w')) nx = b.x + b.w - w; // 锚定右/对边
  if (r.k.includes('n')) ny = b.y + b.h - h;
  return { ...b, x: snap(nx), y: snap(ny), w: snap(w), h: snap(h) };
}
const HANDLES: { k: string; fx: number; fy: number }[] = [
  { k: 'nw', fx: 0, fy: 0 }, { k: 'n', fx: 0.5, fy: 0 }, { k: 'ne', fx: 1, fy: 0 },
  { k: 'e', fx: 1, fy: 0.5 }, { k: 'se', fx: 1, fy: 1 }, { k: 's', fx: 0.5, fy: 1 },
  { k: 'sw', fx: 0, fy: 1 }, { k: 'w', fx: 0, fy: 0.5 },
];
const PORTS: XY[] = [{ x: 0.5, y: 0 }, { x: 1, y: 0.5 }, { x: 0.5, y: 1 }, { x: 0, y: 0.5 }];

/** 高度复刻 drawio 的交互画板:周界正交圆角连线、悬停连接点拖拽连线(绿色目标高亮)、8 缩放手柄、网格吸附、改名、删边删点、双击空白建节点。 */
const DrawioBoard = forwardRef<BoardHandle, { onBoardSel?: (s: BoardSel | null) => void }>(function DrawioBoard({ onBoardSel }, apiRef) {
  const t = useT();
  const [nodes, setNodes] = useState<BNode[]>([]);
  const [edges, setEdges] = useState<BEdge[]>([]);
  const [selIds, setSelIds] = useState<Set<string>>(new Set());
  const [selEdge, setSelEdge] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [hi, setHi] = useState<string | null>(null);
  useImperativeHandle(apiRef, () => ({
    addObjects: (nn, ee) => {
      if (nn.length || ee.length) commit();
      if (nn.length) setNodes((ns) => [...ns, ...nn]);
      if (ee.length) setEdges((es) => [...es, ...ee]);
      setSelIds(new Set(nn.map((n) => n.id)));
      setSelEdge(null);
    },
    removeObjects: (ids) => {
      const s = new Set(ids);
      setNodes((ns) => ns.filter((n) => !s.has(n.id)));
      setEdges((es) => es.filter((ed) => !s.has(ed.id) && !s.has(ed.from) && !s.has(ed.to)));
    },
    updateObject: (id, patch) => {
      commit();
      setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, ...(patch.value != null ? { label: String(patch.value) } : {}), ...(patch.style ? parseDrawioStyle(patch.style) : {}) } : n)));
    },
    moveObject: (id, box) => {
      commit();
      setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, ...(box.x != null ? { x: snap(box.x) } : {}), ...(box.y != null ? { y: snap(box.y) } : {}), ...(box.w != null ? { w: box.w } : {}), ...(box.h != null ? { h: box.h } : {}) } : n)));
    },
    highlight: (id) => { setHi(id); setSelIds(new Set([id])); setSelEdge(null); },
  }));
  const [editing, setEditing] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ sx: number; sy: number; origins: Record<string, XY> } | null>(null);
  const [resize, setResize] = useState<{ id: string; k: string; box: BNode; sx: number; sy: number } | null>(null);
  const [conn, setConn] = useState<{ from: string; x: number; y: number; tgt: string | null } | null>(null);
  const [band, setBand] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [guides, setGuides] = useState<{ v: number[]; h: number[] } | null>(null);
  const [arrow, setArrow] = useState<{ from: string; dir: 'up' | 'right' | 'down' | 'left'; sx: number; sy: number } | null>(null);
  const [rotate, setRotate] = useState<{ id: string; cx: number; cy: number } | null>(null);
  const [panDrag, setPanDrag] = useState<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const [wpDrag, setWpDrag] = useState<{ edgeId: string; index: number } | null>(null);
  const [epDrag, setEpDrag] = useState<{ edgeId: string; end: 'from' | 'to'; tgt: string | null } | null>(null);
  const [spaceDown, setSpaceDown] = useState(false);
  const spaceRef = useRef(false);
  const clipRef = useRef<BNode[]>([]);
  const past = useRef<{ nodes: BNode[]; edges: BEdge[] }[]>([]);
  const future = useRef<{ nodes: BNode[]; edges: BEdge[] }[]>([]);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<XY>({ x: 0, y: 0 });
  const ref = useRef<HTMLDivElement | null>(null);
  const idRef = useRef(0);
  const cb = useRef(onBoardSel);
  cb.current = onBoardSel;

  // 选区变化 → 上抛给 App(Agent 感知:选中/框选的节点与连线)
  // 画板内容 → 上抛给 App。核心:不只是选中,还把【完整拓扑(每个节点 + 连接关系)】给 Agent,
  // 让 Agent 理解整张流程图的结构,从而能据此驱动修改。
  useEffect(() => {
    if (nodes.length === 0 && edges.length === 0) {
      cb.current?.(null);
      return;
    }
    const nm = (n: BNode): string => n.label || n.kind || '形状';
    const sn = nodes.filter((n) => selIds.has(n.id));
    // 关键:把【节点 id】明确给 Agent —— 改/删/移动现有节点时必须用这些 id(否则它会瞎猜 id,改不到)
    const ctx: string[] = [`[流程图] ${nodes.length} 个节点、${edges.length} 条连线。改/删/移动现有节点时,update/delete/move 的 cellId 必须用下面给出的真实 id。`];
    if (nodes.length) ctx.push('节点(id=文字): ' + nodes.map((n) => `${n.id}=${nm(n)}`).join('、'));
    if (edges.length) ctx.push('连接关系(按 id): ' + edges.map((e) => `${e.from}→${e.to}`).join(';'));
    if (sn.length) ctx.push('当前选中节点 id: ' + sn.map((n) => n.id).join('、') + '(即 ' + sn.map((n) => nm(n)).join('、') + '),用户多半是想改这些。');
    else if (selEdge) {
      const e = edges.find((x) => x.id === selEdge);
      if (e) ctx.push(`当前选中连线: ${e.from}→${e.to}`);
    }
    const chip = sn.length
      ? `画板选中 ${sn.length} 个节点: ${sn.map((n) => nm(n)).join('、')}`
      : selEdge
        ? '选中 1 条连线'
        : `流程图 ${nodes.length} 节点 · ${edges.length} 连线`;
    cb.current?.({ count: sn.length, chip, context: ctx.join('\n') });
  }, [selIds, selEdge, nodes, edges]);

  // 屏幕坐标 → 画布坐标(扣除平移/缩放),所有节点/连线都用画布坐标
  const pt = (e: { clientX: number; clientY: number }): XY => {
    const r = ref.current?.getBoundingClientRect();
    return { x: (e.clientX - (r?.left ?? 0) - pan.x) / zoom, y: (e.clientY - (r?.top ?? 0) - pan.y) / zoom };
  };
  const nodeAt = (x: number, y: number, not?: string): BNode | undefined =>
    [...nodes].reverse().find((n) => n.id !== not && x >= n.x && x <= n.x + n.w && y >= n.y && y <= n.y + n.h);
  const addNode = (x: number, y: number, inner: string, label: string, kind?: string): void => {
    commit();
    const id = 'n' + ++idRef.current;
    setNodes((ns) => [...ns, { id, x: snap(x - 45), y: snap(y - 27), w: 90, h: 54, inner, label, ...(kind ? { kind } : {}) }]);
    setSelIds(new Set([id]));
    setSelEdge(null);
  };
  // drawio 招牌:点方向箭头 → 克隆源节点放到该方向 60px 外并连上
  const cloneConnect = (fromId: string, dir: 'up' | 'right' | 'down' | 'left'): void => {
    const src = nodes.find((n) => n.id === fromId);
    if (!src) return;
    commit();
    const gap = 60;
    const off = dir === 'up' ? { dx: 0, dy: -(src.h + gap) } : dir === 'down' ? { dx: 0, dy: src.h + gap } : dir === 'left' ? { dx: -(src.w + gap), dy: 0 } : { dx: src.w + gap, dy: 0 };
    const id = 'n' + ++idRef.current;
    setNodes((ns) => [...ns, { ...src, id, x: snap(src.x + off.dx), y: snap(src.y + off.dy) }]);
    setEdges((es) => [...es, { id: 'e' + ++idRef.current, from: fromId, to: id }]);
    setSelIds(new Set([id]));
  };
  const onDrop = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    const raw = e.dataTransfer.getData('otterpatch/shape');
    if (!raw) return;
    const s = JSON.parse(raw) as { name: string; inner: string };
    const { x, y } = pt(e);
    addNode(x, y, s.inner, '', s.name); // 拖入的图形不显示中文名,但隐藏存 kind 供 Agent 感知
  };

  const onMove = (e: { clientX: number; clientY: number; shiftKey?: boolean }): void => {
    if (panDrag) {
      setPan({ x: panDrag.ox + (e.clientX - panDrag.sx), y: panDrag.oy + (e.clientY - panDrag.sy) });
      return;
    }
    if (!drag && !conn && !resize && !band && !arrow && !rotate && !wpDrag && !epDrag) return;
    const { x, y } = pt(e);
    if (wpDrag) {
      movedRef.current = true;
      setEdges((es) => es.map((ed) => (ed.id === wpDrag.edgeId && ed.points ? { ...ed, points: ed.points.map((p, i) => (i === wpDrag.index ? { x: snap(x), y: snap(y) } : p)) } : ed)));
      return;
    }
    if (epDrag) {
      movedRef.current = true;
      const tg = nodeAt(x, y);
      setEpDrag((d) => (d ? { ...d, tgt: tg?.id ?? null } : d));
      return;
    }
    if (rotate) {
      movedRef.current = true;
      let deg = (Math.atan2(y - rotate.cy, x - rotate.cx) * 180) / Math.PI + 90;
      if (e.shiftKey) deg = Math.round(deg / 15) * 15;
      deg = Math.round(((deg % 360) + 360) % 360);
      setNodes((ns) => ns.map((n) => (n.id === rotate.id ? { ...n, rot: deg } : n)));
      return;
    }
    if (arrow) {
      if (Math.hypot(x - arrow.sx, y - arrow.sy) > 5 / zoom) {
        setConn({ from: arrow.from, x, y, tgt: nodeAt(x, y, arrow.from)?.id ?? null });
        setArrow(null);
      }
      return;
    }
    if (drag) {
      movedRef.current = true;
      let dx = x - drag.sx;
      let dy = y - drag.sy;
      // 对齐参考线:把拖动选区的 左/中/右、上/中/下 吸附到其它节点的同类线
      const movingIds = new Set(Object.keys(drag.origins));
      const moved = nodes.filter((n) => movingIds.has(n.id)).map((n) => ({ ...n, x: drag.origins[n.id]!.x + dx, y: drag.origins[n.id]!.y + dy }));
      if (moved.length) {
        const bx0 = Math.min(...moved.map((n) => n.x));
        const bx1 = Math.max(...moved.map((n) => n.x + n.w));
        const by0 = Math.min(...moved.map((n) => n.y));
        const by1 = Math.max(...moved.map((n) => n.y + n.h));
        const myX = [bx0, (bx0 + bx1) / 2, bx1];
        const myY = [by0, (by0 + by1) / 2, by1];
        const others = nodes.filter((n) => !movingIds.has(n.id));
        const tol = 6 / zoom;
        const gv: number[] = [];
        const gh: number[] = [];
        let bestX = Infinity, bestY = Infinity, sxAdj = 0, syAdj = 0;
        for (const o of others) {
          for (const ox of [o.x, o.x + o.w / 2, o.x + o.w]) for (const mx of myX) {
            const d = ox - mx;
            if (Math.abs(d) <= tol && Math.abs(d) < Math.abs(bestX)) { bestX = d; sxAdj = d; }
            if (Math.abs(ox - mx) <= tol) gv.push(ox);
          }
          for (const oy of [o.y, o.y + o.h / 2, o.y + o.h]) for (const my of myY) {
            const d = oy - my;
            if (Math.abs(d) <= tol && Math.abs(d) < Math.abs(bestY)) { bestY = d; syAdj = d; }
            if (Math.abs(oy - my) <= tol) gh.push(oy);
          }
        }
        if (Number.isFinite(bestX)) dx += sxAdj;
        if (Number.isFinite(bestY)) dy += syAdj;
        setGuides(gv.length || gh.length ? { v: [...new Set(gv)], h: [...new Set(gh)] } : null);
      }
      setNodes((ns) => ns.map((n) => (drag.origins[n.id] ? { ...n, x: snap(drag.origins[n.id]!.x + dx), y: snap(drag.origins[n.id]!.y + dy) } : n)));
    }
    if (resize) {
      movedRef.current = true;
      setNodes((ns) => ns.map((n) => (n.id === resize.id ? resizeNode(resize, x, y, e.shiftKey === true) : n)));
    }
    if (conn) {
      movedRef.current = true;
      const tg = nodeAt(x, y, conn.from);
      setConn((c) => (c ? { ...c, x, y, tgt: tg?.id ?? null } : c));
    }
    if (band) setBand((b) => (b ? { ...b, x1: x, y1: y } : b));
  };
  const onUp = (): void => {
    if (panDrag) {
      setPanDrag(null);
      return;
    }
    if (epDrag) {
      if (epDrag.tgt) {
        const otherEnd = epDrag.end === 'from' ? 'to' : 'from';
        setEdges((es) => es.map((e) => (e.id === epDrag.edgeId && e[otherEnd] !== epDrag.tgt ? { ...e, [epDrag.end]: epDrag.tgt!, points: undefined } : e)));
      }
      if (movedRef.current && preGesture.current) {
        past.current.push(preGesture.current);
        if (past.current.length > 80) past.current.shift();
        future.current = [];
      }
      preGesture.current = null;
      movedRef.current = false;
      setEpDrag(null);
      return;
    }
    if (arrow) {
      cloneConnect(arrow.from, arrow.dir);
      setArrow(null);
      return;
    }
    const madeEdge = !!(conn && conn.tgt);
    if (conn && conn.tgt) {
      const to = conn.tgt;
      setEdges((es) => (es.some((d) => d.from === conn.from && d.to === to) ? es : [...es, { id: 'e' + ++idRef.current, from: conn.from, to }]));
    }
    if (band) {
      const r = bandRect(band);
      if (r.w > 3 || r.h > 3) setSelIds(new Set(nodes.filter((n) => intersects(r, n)).map((n) => n.id)));
      setBand(null);
    }
    // 手势若真的改动了内容,把开始前的快照压入撤销栈
    if ((movedRef.current || madeEdge) && preGesture.current) {
      past.current.push(preGesture.current);
      if (past.current.length > 80) past.current.shift();
      future.current = [];
    }
    preGesture.current = null;
    movedRef.current = false;
    setDrag(null);
    setConn(null);
    setResize(null);
    setGuides(null);
    setRotate(null);
    setWpDrag(null);
  };
  const capture = (e: { pointerId: number }): void => {
    try {
      ref.current?.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  // ── 撤销/重做 + 手势历史 ──
  const preGesture = useRef<{ nodes: BNode[]; edges: BEdge[] } | null>(null);
  const movedRef = useRef(false);
  const arrowNudging = useRef(false);
  const snapshot = (): { nodes: BNode[]; edges: BEdge[] } => ({ nodes: nodes.map((n) => ({ ...n })), edges: edges.map((e) => ({ ...e })) });
  const commit = (): void => {
    past.current.push(snapshot());
    if (past.current.length > 80) past.current.shift();
    future.current = [];
  };
  const beginGesture = (): void => {
    preGesture.current = snapshot();
    movedRef.current = false;
  };
  const undo = (): void => {
    const prev = past.current.pop();
    if (!prev) return;
    future.current.push(snapshot());
    setNodes(prev.nodes);
    setEdges(prev.edges);
    setSelIds(new Set());
    setSelEdge(null);
  };
  const redo = (): void => {
    const next = future.current.pop();
    if (!next) return;
    past.current.push(snapshot());
    setNodes(next.nodes);
    setEdges(next.edges);
    setSelIds(new Set());
    setSelEdge(null);
  };
  const duplicate = (offset: number): void => {
    const sel = nodes.filter((n) => selIds.has(n.id));
    if (!sel.length) return;
    commit();
    const idMap = new Map<string, string>();
    const clones = sel.map((n) => {
      const id = 'n' + ++idRef.current;
      idMap.set(n.id, id);
      return { ...n, id, x: snap(n.x + offset), y: snap(n.y + offset) };
    });
    const newEdges = edges
      .filter((ed) => idMap.has(ed.from) && idMap.has(ed.to))
      .map((ed) => ({ ...ed, id: 'e' + ++idRef.current, from: idMap.get(ed.from)!, to: idMap.get(ed.to)! }));
    setNodes((ns) => [...ns, ...clones]);
    if (newEdges.length) setEdges((es) => [...es, ...newEdges]);
    setSelIds(new Set(clones.map((c) => c.id)));
    setSelEdge(null);
  };

  useEffect(() => {
    const k = (e: KeyboardEvent): void => {
      if (editing) return;
      const meta = e.ctrlKey || e.metaKey;
      if (e.code === 'Space' && !meta) {
        if (!spaceRef.current) {
          spaceRef.current = true;
          setSpaceDown(true);
        }
        e.preventDefault();
        return;
      }
      if (meta && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (meta && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); redo(); return; }
      if (meta && (e.key === 'a' || e.key === 'A')) { e.preventDefault(); setSelIds(new Set(nodes.map((n) => n.id))); setSelEdge(null); return; }
      if (meta && (e.key === 'd' || e.key === 'D')) { e.preventDefault(); duplicate(20); return; }
      if (meta && (e.key === 'c' || e.key === 'C')) { clipRef.current = nodes.filter((n) => selIds.has(n.id)).map((n) => ({ ...n })); return; }
      if (meta && (e.key === 'v' || e.key === 'V')) {
        if (!clipRef.current.length) return;
        e.preventDefault();
        commit();
        const clones = clipRef.current.map((n) => ({ ...n, id: 'n' + ++idRef.current, x: snap(n.x + 24), y: snap(n.y + 24) }));
        setNodes((ns) => [...ns, ...clones]);
        setSelIds(new Set(clones.map((c) => c.id)));
        setSelEdge(null);
        return;
      }
      if (e.key === 'Escape') { setSelIds(new Set()); setSelEdge(null); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selIds.size) {
          commit();
          setNodes((ns) => ns.filter((n) => !selIds.has(n.id)));
          setEdges((es) => es.filter((ed) => !selIds.has(ed.from) && !selIds.has(ed.to)));
          setSelIds(new Set());
        } else if (selEdge) {
          commit();
          setEdges((es) => es.filter((ed) => ed.id !== selEdge));
          setSelEdge(null);
        }
        return;
      }
      if (e.key.startsWith('Arrow') && selIds.size) {
        e.preventDefault();
        const step = e.shiftKey ? GRID : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        if (!arrowNudging.current) {
          commit();
          arrowNudging.current = true;
        }
        setNodes((ns) => ns.map((n) => (selIds.has(n.id) ? { ...n, x: n.x + dx, y: n.y + dy } : n)));
      }
    };
    const up = (e: KeyboardEvent): void => {
      if (e.code === 'Space') {
        spaceRef.current = false;
        setSpaceDown(false);
      }
      if (e.key.startsWith('Arrow')) arrowNudging.current = false;
    };
    window.addEventListener('keydown', k);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', k);
      window.removeEventListener('keyup', up);
    };
  }, [selIds, selEdge, editing, nodes, edges]);

  // Ctrl + 滚轮:朝光标位置缩放画布(光标下的点保持不动)
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const mx = e.clientX - r.left;
      const my = e.clientY - r.top;
      const nz = Math.min(4, Math.max(0.25, zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
      const cx = (mx - pan.x) / zoom;
      const cy = (my - pan.y) / zoom;
      setPan({ x: mx - cx * nz, y: my - cy * nz });
      setZoom(nz);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoom, pan]);

  return (
    <div
      className={'drawio-board' + (panDrag ? ' grabbing' : spaceDown ? ' grab' : '')}
      ref={ref}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerDown={(e) => {
        if (spaceRef.current || e.button === 1) {
          capture(e);
          setPanDrag({ sx: e.clientX, sy: e.clientY, ox: pan.x, oy: pan.y });
          return;
        }
        const cl = (e.target as HTMLElement).classList;
        if (e.target === ref.current || cl.contains('board-svg') || cl.contains('board-canvas')) {
          setSelIds(new Set());
          setSelEdge(null);
          capture(e);
          const { x, y } = pt(e);
          setBand({ x0: x, y0: y, x1: x, y1: y });
        }
      }}
      onDoubleClick={(e) => {
        const cl = (e.target as HTMLElement).classList;
        if (e.target === ref.current || cl.contains('board-svg') || cl.contains('board-canvas')) {
          const { x, y } = pt(e);
          addNode(x, y, '<rect x="4" y="5" width="32" height="20" rx="2"/>', t('文本'));
        }
      }}
    >
      <div className="board-canvas" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
      <svg className="board-svg">
        <defs>
          <marker id="otterpatch-arr" markerWidth="11" markerHeight="11" refX="8" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="context-stroke" /></marker>
          <marker id="otterpatch-arr-sel" markerWidth="11" markerHeight="11" refX="8" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="var(--accent)" /></marker>
          <marker id="m-classic" markerWidth="11" markerHeight="11" refX="8" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="context-stroke" /></marker>
          <marker id="m-open" markerWidth="11" markerHeight="11" refX="8" refY="4" orient="auto"><path d="M1,0.5 L8,4 L1,7.5" fill="none" stroke="context-stroke" strokeWidth="1.4" /></marker>
          <marker id="m-diamond" markerWidth="13" markerHeight="11" refX="9.5" refY="4" orient="auto"><path d="M0,4 L4.7,0.5 L9.4,4 L4.7,7.5 z" fill="context-stroke" /></marker>
          <marker id="m-circle" markerWidth="11" markerHeight="11" refX="7.6" refY="4" orient="auto"><circle cx="4" cy="4" r="3" fill="context-stroke" /></marker>
        </defs>
        {edges.map((ed) => {
          const a = nodes.find((n) => n.id === ed.from);
          const b = nodes.find((n) => n.id === ed.to);
          if (!a || !b) return null;
          const pts = edgePts(a, b, ed.style, ed.points);
          const d = ed.style === 'straight' && !ed.points?.length ? `M ${pts[0]!.x} ${pts[0]!.y} L ${pts[1]!.x} ${pts[1]!.y}` : roundedPath(pts);
          const on = selEdge === ed.id;
          const arrow = ed.arrow ?? 'classic';
          return (
            <g key={ed.id}>
              <path d={d} fill="none" stroke="transparent" strokeWidth={12} style={{ pointerEvents: 'stroke', cursor: 'pointer' }} onPointerDown={(e) => { e.stopPropagation(); setSelEdge(ed.id); setSelIds(new Set()); }} />
              <path d={d} fill="none" stroke={on ? 'var(--accent)' : '#5f6673'} strokeWidth={on ? 2 : 1.5} markerEnd={arrow === 'none' ? undefined : `url(#m-${arrow})`} style={{ pointerEvents: 'none' }} />
            </g>
          );
        })}
        {/* 选中边的手柄(端点/航点/虚拟折点)移到节点之上的覆盖层 board-overlay,避免被节点 div 遮挡 */}
        {conn
          ? (() => {
              const a = nodes.find((n) => n.id === conn.from);
              if (!a) return null;
              const tgt = conn.tgt ? nodes.find((n) => n.id === conn.tgt) : null;
              if (tgt) return <path d={roundedPath(ortho(a, tgt))} fill="none" stroke="#16a34a" strokeWidth={2} strokeDasharray="6 3" markerEnd="url(#otterpatch-arr-sel)" />;
              const p1 = perim(a, conn.x, conn.y);
              return <line x1={p1.x} y1={p1.y} x2={conn.x} y2={conn.y} stroke="var(--accent)" strokeWidth={1.6} strokeDasharray="5 3" markerEnd="url(#otterpatch-arr-sel)" />;
            })()
          : null}
        {guides ? (
          <g stroke="#ff5a5a" strokeWidth={1} strokeDasharray="4 4" vectorEffect="non-scaling-stroke" style={{ pointerEvents: 'none' }}>
            {guides.v.map((vx, i) => (
              <line key={'v' + i} x1={vx} y1={0} x2={vx} y2={6000} />
            ))}
            {guides.h.map((hy, i) => (
              <line key={'h' + i} x1={0} y1={hy} x2={6000} y2={hy} />
            ))}
          </g>
        ) : null}
      </svg>

      {nodes.map((n) => {
        const isSel = selIds.has(n.id);
        const isHover = hover === n.id;
        const isTgt = conn?.tgt === n.id || epDrag?.tgt === n.id;
        return (
          <div
            key={n.id}
            className={'bnode' + (isSel ? ' sel' : '') + (isHover && !isSel ? ' hover' : '') + (isTgt ? ' tgt' : '') + (n.id === hi ? ' hi' : '')}
            style={{ left: n.x, top: n.y, width: n.w, height: n.h, ...(n.rot ? { transform: `rotate(${n.rot}deg)` } : {}) }}
            onPointerEnter={() => setHover(n.id)}
            onPointerLeave={() => setHover((h) => (h === n.id ? null : h))}
            onPointerDown={(e) => {
              e.stopPropagation();
              capture(e);
              beginGesture();
              const ids = e.shiftKey ? new Set(selIds).add(n.id) : selIds.has(n.id) ? selIds : new Set([n.id]);
              setSelIds(ids);
              setSelEdge(null);
              const { x, y } = pt(e);
              const origins: Record<string, XY> = {};
              nodes.forEach((nd) => {
                if (ids.has(nd.id)) origins[nd.id] = { x: nd.x, y: nd.y };
              });
              setDrag({ sx: x, sy: y, origins });
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              setEditing(n.id);
            }}
          >
            {n.text ? null : n.fill || n.stroke || n.kind === 'agent' ? (
              <div className="bnode-box" style={{ background: n.fill ?? '#ffffff', borderColor: n.stroke ?? '#9aa3b2' }} />
            ) : (
              <svg viewBox="3 3 34 24" preserveAspectRatio="none" fill="none" stroke="#3a3f4b" strokeWidth={0.9} dangerouslySetInnerHTML={{ __html: n.inner }} />
            )}
            {editing === n.id ? (
              <input
                className="bnode-edit"
                autoFocus
                defaultValue={n.label}
                onBlur={(e) => {
                  const v = e.target.value;
                  setNodes((ns) => ns.map((m) => (m.id === n.id ? { ...m, label: v } : m)));
                  setEditing(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                }}
                onPointerDown={(e) => e.stopPropagation()}
              />
            ) : (
              <span className={'bnode-label' + (n.text ? ' txt' : '')} style={{ ...(n.fontColor ? { color: n.fontColor } : {}), ...(n.fontSize ? { fontSize: n.fontSize } : {}), ...(n.bold ? { fontWeight: 700 } : {}) }}>{n.label}</span>
            )}
            {(isHover || isSel) && !drag && !resize
              ? PORTS.map((p, i) => (
                  <span
                    key={i}
                    className="bport"
                    style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      capture(e);
                      beginGesture();
                      const { x, y } = pt(e);
                      setConn({ from: n.id, x, y, tgt: null });
                    }}
                  />
                ))
              : null}
            {isSel && selIds.size === 1
              ? HANDLES.map((h) => (
                  <span
                    key={h.k}
                    className={'bhandle h-' + h.k}
                    style={{ left: `${h.fx * 100}%`, top: `${h.fy * 100}%` }}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      capture(e);
                      beginGesture();
                      const { x, y } = pt(e);
                      setResize({ id: n.id, k: h.k, box: n, sx: x, sy: y });
                    }}
                  />
                ))
              : null}
            {isSel && selIds.size === 1 ? (
              <span
                className="brot"
                title={t('拖动旋转,按住 Shift 吸附 15°')}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  capture(e);
                  beginGesture();
                  setRotate({ id: n.id, cx: n.x + n.w / 2, cy: n.y + n.h / 2 });
                }}
              >
                ↻
              </span>
            ) : null}
            {isHover && selIds.size <= 1 && !drag && !resize && !conn && !band && !rotate
              ? (['up', 'right', 'down', 'left'] as const).map((dir) => (
                  <span
                    key={dir}
                    className={'barrow ba-' + dir}
                    title={t('点=克隆并连接,拖=连线')}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      capture(e);
                      beginGesture();
                      const { x, y } = pt(e);
                      setArrow({ from: n.id, dir, sx: x, sy: y });
                    }}
                  />
                ))
              : null}
          </div>
        );
      })}
      <svg className="board-svg board-overlay">
        {selEdge
          ? (() => {
              const ed = edges.find((x) => x.id === selEdge);
              const a = ed && nodes.find((n) => n.id === ed.from);
              const b = ed && nodes.find((n) => n.id === ed.to);
              if (!ed || !a || !b) return null;
              const pts = edgePts(a, b, ed.style, ed.points);
              const s = pts[0]!;
              const e2 = pts[pts.length - 1]!;
              const wps = ed.points ?? [];
              const ctrl = controlPoints(a, b, wps);
              const removeWp = (i: number): void => {
                commit();
                setEdges((es) => es.map((x) => (x.id === ed.id ? { ...x, points: wps.length > 1 ? wps.filter((_, k) => k !== i) : undefined } : x)));
              };
              const addWpAt = (segIdx: number, p: XY, e: { stopPropagation: () => void; pointerId: number }): void => {
                e.stopPropagation();
                capture(e);
                beginGesture();
                movedRef.current = true;
                const np = [...wps];
                np.splice(segIdx, 0, { x: snap(p.x), y: snap(p.y) });
                setEdges((es) => es.map((x) => (x.id === ed.id ? { ...x, points: np } : x)));
                setWpDrag({ edgeId: ed.id, index: segIdx });
              };
              const epStart = (end: 'from' | 'to', e: { stopPropagation: () => void; pointerId: number }): void => {
                e.stopPropagation();
                capture(e);
                beginGesture();
                setEpDrag({ edgeId: ed.id, end, tgt: null });
              };
              return (
                <g>
                  <g style={{ cursor: 'pointer', pointerEvents: 'all' }} onPointerDown={(e) => epStart('from', e)}>
                    <circle cx={s.x} cy={s.y} r={9} fill="transparent" />
                    <circle cx={s.x} cy={s.y} r={5} fill="#fff" stroke="var(--accent)" strokeWidth={2} />
                  </g>
                  <g style={{ cursor: 'pointer', pointerEvents: 'all' }} transform={`translate(${e2.x},${e2.y})`} onPointerDown={(e) => epStart('to', e)}>
                    <circle r={10} fill="transparent" />
                    <circle r={6} fill="#fff" stroke="#00c853" strokeWidth={1.5} />
                    <line x1={-3.4} y1={-3.4} x2={3.4} y2={3.4} stroke="#00c853" strokeWidth={2.2} strokeLinecap="round" />
                    <line x1={3.4} y1={-3.4} x2={-3.4} y2={3.4} stroke="#00c853" strokeWidth={2.2} strokeLinecap="round" />
                  </g>
                  {ctrl.slice(0, -1).map((c, i) => {
                    const q = ctrl[i + 1]!;
                    const mid = { x: (c.x + q.x) / 2, y: (c.y + q.y) / 2 };
                    return (
                      <g key={'vb' + i} style={{ cursor: 'crosshair', pointerEvents: 'all' }} onPointerDown={(e) => addWpAt(i, mid, e)}>
                        <circle cx={mid.x} cy={mid.y} r={10} fill="transparent" />
                        <circle cx={mid.x} cy={mid.y} r={4.5} fill="var(--accent)" fillOpacity={0.18} stroke="var(--accent)" strokeOpacity={0.65} strokeWidth={1.2} />
                      </g>
                    );
                  })}
                  {wps.map((p, i) => (
                    <circle
                      key={'wp' + i}
                      cx={p.x}
                      cy={p.y}
                      r={5}
                      fill="var(--accent)"
                      stroke="#fff"
                      strokeWidth={1.6}
                      style={{ cursor: 'move', pointerEvents: 'all' }}
                      onPointerDown={(e) => { e.stopPropagation(); capture(e); beginGesture(); setWpDrag({ edgeId: ed.id, index: i }); }}
                      onDoubleClick={(e) => { e.stopPropagation(); removeWp(i); }}
                    />
                  ))}
                </g>
              );
            })()
          : null}
      </svg>
      {band ? (() => { const r = bandRect(band); return <div className="band" style={{ left: r.x, top: r.y, width: r.w, height: r.h }} />; })() : null}
      </div>
      {selEdge
        ? (() => {
            const ed = edges.find((x) => x.id === selEdge);
            const a = ed && nodes.find((n) => n.id === ed.from);
            const b = ed && nodes.find((n) => n.id === ed.to);
            if (!ed || !a || !b) return null;
            const pts = edgePts(a, b, ed.style, ed.points);
            const mid = pts[Math.floor(pts.length / 2)] ?? pts[0]!;
            const setEdge = (patch: Partial<BEdge>): void => {
              commit();
              setEdges((es) => es.map((x) => (x.id === ed.id ? { ...x, ...patch } : x)));
            };
            return (
              <div className="etoolbar" style={{ left: mid.x * zoom + pan.x, top: mid.y * zoom + pan.y - 44 }} onPointerDown={(e) => e.stopPropagation()}>
                <button className={'etb' + (ed.style !== 'straight' ? ' on' : '')} title={t('正交')} onClick={() => setEdge({ style: 'ortho' })}>⌐</button>
                <button className={'etb' + (ed.style === 'straight' ? ' on' : '')} title={t('直线')} onClick={() => setEdge({ style: 'straight' })}>╱</button>
                <span className="etb-sep" />
                {ARROWS.map((ak) => (
                  <button key={ak} className={'etb' + ((ed.arrow ?? 'classic') === ak ? ' on' : '')} title={t('箭头') + ' ' + ak} onClick={() => setEdge({ arrow: ak })}>
                    <svg width="20" height="12" viewBox="0 0 20 12">{arrowGlyph(ak)}</svg>
                  </button>
                ))}
              </div>
            );
          })()
        : null}
      {nodes.length === 0 && <div className="board-hint">{t('从左侧拖拽形状到画板,或双击空白处新建;拖节点边缘圆点连线;框选多选;Ctrl+滚轮缩放')}</div>}
      <div className="board-zoom">{Math.round(zoom * 100)}%</div>
    </div>
  );
});
