/**
 * 能力级 bench —— 用真实模型给 Excel/Word Agent 的"专家成色"打分,可反复跑、分数落趋势文件。
 * 每个任务两层评分:
 *   ① 客观不变量:回应类型(changeset/clarify)、必须调用的取数工具(read_blocks/aggregate/load_skill…)、changeset 里必须/禁止出现的形状;
 *   ② LLM-judge:按任务 rubric 给 1-5 分(专业性/洞见/方案质量)。
 * 结果逐行追加到 test/bench-results.jsonl,可比对历史看回归。
 *
 * 运行(需先 npm run build 各包):
 *   OTTERPATCH_BENCH_KEY=sk-ant-... node test/expert-bench.mjs        # 全量
 *   OTTERPATCH_BENCH_KEY=... BENCH_ONLY=w-gongwen node test/expert-bench.mjs  # 单任务
 * 无 key 时直接 SKIP(exit 0),CI 安全。
 */
import { appendFileSync } from 'node:fs';

const KEY = process.env.OTTERPATCH_BENCH_KEY;
if (!KEY) {
  console.log('SKIP expert-bench: 未设置 OTTERPATCH_BENCH_KEY(需要真实模型)。');
  process.exit(0);
}
const { AnthropicModelClient } = await import('@otterpatch/agent');
const { OtterPatchRuntime } = await import('@otterpatch/runtime');
const MODEL = process.env.BENCH_MODEL || 'claude-opus-4-8';
const JUDGE_MODEL = process.env.BENCH_JUDGE_MODEL || MODEL;

// ── 素材 ──
const SHEET = {
  a1: 'A1:C7',
  values: [
    ['产品', '地区', '销量'],
    ['A 型', '华东', 120], ['A 型', '华北', 95], ['B 型', '华东', 892],
    ['B 型', '华北', 88], ['C 型', '华东', 64], ['C 型', '华北', '71'], // 故意:C7 文本冒充数字 + B 型华东疑似异常
  ],
};
const sheetCtx = '表格 A1:C7,表头 产品/地区/销量;样本:A 型 华东 120…(全表可用 read_range/aggregate 取)';
const LONG = '本项目于本年度第一季度启动,先后完成了需求调研、方案设计、原型验证与两轮内部评审,期间同步推进了与三家外部供应商的技术对接与合同谈判,并针对评审中暴露的性能与安全问题组织了专项攻关,目前各项里程碑总体符合计划,预计可在第三季度末进入试运行阶段,试运行期间将重点验证峰值负载下的稳定性与数据一致性,并同步准备正式上线所需的运维手册与应急预案。';
const DOC = {
  blocks: [
    { style: '标题1', text: '项目进展报告', font: '宋体', size: 18, align: '居中' },
    { style: '正文', text: LONG, font: '宋体', size: 12 },
    { style: '正文', text: '三、下一步安排', font: '宋体', size: 15 }, // 手动大字冒充标题
    { style: '正文', text: '尽快推进试运行准备工作,确保按期上线。', font: '仿宋', size: 12 },
  ],
};
const docCtx = (truncAt = 60) =>
  `[Word 文档 · 4 段]\n第1段 [标题1 · 宋体 18pt · 居中]: 项目进展报告\n第2段 [正文 · 宋体 12pt]: ${LONG.slice(0, truncAt)}…(已截断)\n第3段 [正文 · 宋体 15pt]: 三、下一步安排\n第4段 [正文 · 仿宋 12pt]: 尽快推进试运行准备工作,确保按期上线。\n(有 1 段超长已截断:改写/引用前先用 read_blocks 取该段全文;检索 find_text,大纲 get_outline,排版审计 get_style_usage。)`;

// ── 任务集(id / 请求 / 客观不变量 / rubric)──
const TASKS = [
  { id: 'w-polish-truncated', format: 'word', intent: '把第2段润色得更精炼', context: docCtx(), doc: DOC,
    expect: { kind: 'changeset', mustTools: ['read_blocks'] },
    rubric: '是否先取全文再改写(quote 来自真实原文而非截断文本);改写是否更精炼且不丢信息;plan 是否讲清病因。' },
  { id: 'w-gongwen', format: 'word', intent: '把这份文档排成规范的公文格式', context: docCtx(), doc: DOC,
    expect: { kind: 'changeset', mustToolsAny: ['load_skill', 'get_style_usage'] },
    rubric: '是否加载公文手册/审计样式后按 GB/T 9704 落地(标题居中、正文仿宋三号或合理近似、层级序号);是否用 block 套真标题而非手动大字。' },
  { id: 'w-structure', format: 'word', intent: '这篇文档结构乱,帮我理顺', context: docCtx(), doc: DOC,
    expect: { kind: 'changeset', mustToolsAny: ['get_outline', 'get_style_usage'], opsMust: [/"block"/] },
    rubric: '是否发现"三、下一步安排"是假标题并用 block 套真样式;是否指出正文字体基线不一。' },
  { id: 'w-ambiguous', format: 'word', intent: '帮我弄一下这个文档', context: docCtx(), doc: DOC,
    expect: { kind: 'clarify' },
    rubric: '模糊请求是否用引导选择表澄清(而非瞎猜大改);候选是否覆盖润色/排版/结构等合理方向。' },
  { id: 'x-sum-formula', format: 'excel', intent: '在 C8 写上销量合计', context: sheetCtx, sheet: SHEET,
    expect: { kind: 'changeset', opsMust: [/SUM/i] },
    rubric: '合计是否用公式(=SUM)而非死值;是否发现 C7 是文本数字并顺手修正/提醒。' },
  { id: 'x-anomaly', format: 'excel', intent: '帮我把销量里的异常值标出来', context: sheetCtx, sheet: SHEET,
    expect: { kind: 'changeset', mustToolsAny: ['read_range', 'aggregate'] },
    rubric: '是否先实算(均值/分布)再定义"异常"并标注 B 型华东 892;是否用 condFormat 或明确说明标注口径。' },
  { id: 'x-chart', format: 'excel', intent: '各产品销量合计画一张图', context: sheetCtx, sheet: SHEET,
    expect: { kind: 'changeset', mustTools: ['aggregate'], opsMust: [/chart/i] },
    rubric: '是否先 aggregate 实算各组、图表走内联模式不污染主表;图型选择是否合理(分类比较→柱状)。' },
  { id: 'x-ambiguous', format: 'excel', intent: '把这张表做成一个报告', context: sheetCtx, sheet: SHEET,
    expect: { kind: 'clarify' },
    rubric: '产出形态未指定时是否先澄清(报告形式/口径/放哪),候选是否具体可选。' },
];

// ── 执行 ──
const rt = new OtterPatchRuntime();
const model = new AnthropicModelClient({ apiKey: KEY, model: MODEL });
const judgeClient = new AnthropicModelClient({ apiKey: KEY, model: JUDGE_MODEL });

async function judge(task, resultDesc) {
  // 复用 Anthropic 通道的底层 SDK 太绕,直接走一次最小 messages 调用
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const c = new Anthropic({ apiKey: KEY });
  const res = await c.messages.create({
    model: JUDGE_MODEL, max_tokens: 500,
    messages: [{ role: 'user', content: `你是 Office Agent 输出的严格评审。任务:「${task.intent}」\n评分标准:${task.rubric}\nAgent 的产出(工具调用轨迹+结果):\n${resultDesc}\n\n只输出 JSON:{"score":1-5,"reason":"一句话"}(5=资深专家水平,3=能用但平庸,1=错误/答非所问)` }],
  });
  const txt = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  try { const m = /\{[\s\S]*\}/.exec(txt); return m ? JSON.parse(m[0]) : { score: 0, reason: 'judge 无 JSON' }; }
  catch { return { score: 0, reason: 'judge 解析失败' }; }
}

const only = process.env.BENCH_ONLY;
let sum = 0, n = 0, fails = 0;
for (const task of TASKS) {
  if (only && task.id !== only) continue;
  const tools = [];
  let result;
  try {
    result = await rt.respondStream(
      { hostId: 'bench', format: task.format, intent: task.intent, baseRev: 0, anchors: [], context: task.context,
        ...(task.sheet ? { sheet: task.sheet } : {}), ...(task.doc ? { doc: task.doc } : {}) },
      model,
      (e) => { if (e.type === 'tool') tools.push(e.name); },
    );
  } catch (e) {
    console.log(`  ✗ ${task.id} 请求失败: ${e.message}`); fails++; continue;
  }
  const ops = result.kind === 'changeset' ? JSON.stringify(result.changeSet.edits) : '';
  const kindOk = result.kind === task.expect.kind;
  const toolsOk = (task.expect.mustTools ?? []).every((t) => tools.includes(t))
    && (!task.expect.mustToolsAny || task.expect.mustToolsAny.some((t) => tools.includes(t)));
  const opsOk = (task.expect.opsMust ?? []).every((rx) => rx.test(ops));
  const desc = `工具轨迹: ${tools.join(' → ') || '(无)'}\n回应类型: ${result.kind}\n` +
    (result.kind === 'changeset' ? `plan: ${result.changeSet.meta.planSummary ?? ''}\nedits(${result.changeSet.edits.length}): ${ops.slice(0, 3000)}`
      : result.kind === 'clarify' ? `questions: ${JSON.stringify(result.questions).slice(0, 1500)}` : `answer: ${result.text.slice(0, 1500)}`);
  const j = await judge(task, desc);
  const pass = kindOk && toolsOk && opsOk;
  if (!pass) fails++;
  sum += j.score; n++;
  console.log(`  ${pass ? '✓' : '✗'} ${task.id}  kind:${kindOk ? 'ok' : result.kind} tools:${toolsOk ? 'ok' : '缺[' + tools.join(',') + ']'} ops:${opsOk ? 'ok' : 'miss'}  judge:${j.score}/5 —— ${j.reason}`);
  appendFileSync(new URL('./bench-results.jsonl', import.meta.url), JSON.stringify({ ts: new Date().toISOString(), model: MODEL, task: task.id, kindOk, toolsOk, opsOk, judge: j.score, reason: j.reason }) + '\n');
}
console.log(`\nBENCH: ${n} 任务 · 不变量失败 ${fails} · judge 均分 ${(n ? sum / n : 0).toFixed(2)}/5`);
void judgeClient; // 保留引用位(后续 judge 走通道时切换)
process.exit(fails ? 1 : 0);
