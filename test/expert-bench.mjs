/**
 * 能力级 bench —— 用真实模型给 Excel/Word Agent 的"专家成色"打分,可反复跑、分数落趋势文件。
 * 每个任务两层评分:
 *   ① 客观不变量:回应类型(changeset/clarify)、必须调用的取数工具(read_blocks/aggregate/load_skill…)、changeset 里必须/禁止出现的形状;
 *   ② LLM-judge:按任务 rubric 给 1-5 分(专业性/洞见/方案质量)。
 * 结果逐行追加到 test/bench-results.jsonl,可比对历史看回归。
 *
 * 运行(需先 npm run build 各包;provider 任选,8 家 BYOK 同一套任务):
 *   OTTERPATCH_BENCH_KEY=sk-ant-... node test/expert-bench.mjs                       # Claude(默认)
 *   OTTERPATCH_BENCH_KEY=sk-... OTTERPATCH_BENCH_PROVIDER=deepseek BENCH_MODEL=deepseek-chat node test/expert-bench.mjs
 *   OTTERPATCH_BENCH_KEY=... BENCH_ONLY=w-gongwen node test/expert-bench.mjs         # 单任务
 * 无 key 时直接 SKIP(exit 0),CI 安全。
 */
import { appendFileSync } from 'node:fs';

const KEY = process.env.OTTERPATCH_BENCH_KEY;
if (!KEY) {
  console.log('SKIP expert-bench: 未设置 OTTERPATCH_BENCH_KEY(需要真实模型)。');
  process.exit(0);
}
const { createModelClient, PROVIDERS } = await import('@otterpatch/agent');
const { OtterPatchRuntime } = await import('@otterpatch/runtime');
const PROVIDER = process.env.OTTERPATCH_BENCH_PROVIDER || 'claude';
const MODEL = process.env.BENCH_MODEL || PROVIDERS[PROVIDER]?.defaultModel || 'claude-opus-4-8';
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

// ── 素材②:结构清理 + 图片操作(空段/垃圾段/含图段——deletePara/para 锚定/img op 的靶场)──
const DOC2 = {
  blocks: [
    { style: '标题1', text: '产品验收报告', font: '宋体', size: 18 },
    { style: '正文', text: '[图片 验收流程图 120×90]验收范围包括表格、文档与画板三个模块。', font: '宋体', size: 12 },
    { style: '正文', text: '', font: '宋体', size: 12 },
    { style: '正文', text: '', font: '宋体', size: 12 },
    { style: '正文', text: '阿斯顿撒 deSSD 测试残留文字', font: '宋体', size: 12 },
    { style: '正文', text: '结论:三个模块均达到验收标准。', font: '宋体', size: 12 },
  ],
};
const doc2Ctx = '[Word 文档 · 6 段]\n第1段 [标题1 · 宋体 18pt]: 产品验收报告\n第2段 [正文 · 宋体 12pt]: [图片 验收流程图 120×90]验收范围包括表格、文档与画板三个模块。\n第3段 [正文 · 宋体 12pt]: (空段)\n第4段 [正文 · 宋体 12pt]: (空段)\n第5段 [正文 · 宋体 12pt]: 阿斯顿撒 deSSD 测试残留文字\n第6段 [正文 · 宋体 12pt]: 结论:三个模块均达到验收标准。';
// ── 素材③:值×格式耦合(毛利率小数 + 0% 格式——mock 口径自检的靶场)──
const SHEET2 = {
  a1: 'A1:F4',
  values: [
    ['日期', '产品', '销量', '单价', '金额', '毛利率'],
    ['01-03', 'A 型', 120, 38, 4560, 0.41], ['01-05', 'B 型', 86, 52, 4472, 0.37], ['01-09', 'A 型', 150, 38, 5700, 0.41],
  ],
};
const sheet2Ctx = '表格 A1:F4,表头 日期/产品/销量/单价/金额/毛利率;毛利率列存小数(如 0.41)配 0% 数字格式显示为 41%;数据末行为第 4 行。';

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

  // ── 多轮场景(history 驱动):澄清后落地 / 分批不重复 / 追改锚新文 / 撤销后回原文 ──
  { id: 'mt-clarify-then-do', format: 'word', intent: '我的选择如下,请据此继续:\n- 处理方向:排版规范化', context: docCtx(), doc: DOC,
    history: [
      { role: 'user', content: '帮我弄一下这个文档' },
      { role: 'assistant', content: '我向你澄清提问: 你想优先处理哪个方向?(候选: 排版规范化/文字润色/结构理顺/先做诊断)(等待你的回答)' },
    ],
    expect: { kind: 'changeset' },
    rubric: '上一轮已澄清、用户已作答:本轮【不得】再问,应直接落地排版规范化;方案是否覆盖假标题转真样式与正文基线统一。' },
  { id: 'mt-next-batch', format: 'word', intent: '下一批', context: docCtx(), doc: DOC,
    history: [
      { role: 'user', content: '把全文排版规范化,可以分批' },
      { role: 'assistant', content: '提出改动: 第3段 假标题"三、下一步安排"套真标题样式; 全文 正文统一宋体12pt(用户已接受并写入2处)' },
    ],
    expect: { kind: 'changeset' },
    rubric: '续批是否【不重复】上一批已写入的两处(假标题/全文字体),而是做剩余项(如第1段字号规范、标点/空格、行距);plan 是否说明这是第二批。' },
  { id: 'mt-followup-refine', format: 'word', intent: '把你刚才改过的那句话再精简一点', context: docCtx().replace('尽快推进试运行准备工作,确保按期上线。', '加快试运行准备,确保按期如期完成上线目标。'),
    doc: { blocks: DOC.blocks.map((b, i) => (i === 3 ? { ...b, text: '加快试运行准备,确保按期如期完成上线目标。' } : b)) },
    history: [
      { role: 'user', content: '把第4段那句话改得更有力' },
      { role: 'assistant', content: '提出改动: 正文 "尽快推进试运行准备工作,确保按期上线。"→"加快试运行准备,确保按期如期完成上线目标。"(用户已接受并写入1处)' },
    ],
    expect: { kind: 'changeset', opsMust: [/加快试运行准备/] },
    rubric: '追改必须锚定在【改后的新句】上(quote 含"加快试运行准备"),不能引用已被替换的旧句;新 replacement 是否更精简(如修掉"按期如期"的语义重复)。' },
  { id: 'mt-reverted', format: 'word', intent: '刚才那版撤销了,换个轻一点的思路:把第4段这句话精简一些但保留原意', context: docCtx(),
    doc: DOC,
    history: [
      { role: 'user', content: '把第4段那句话改得更有力' },
      { role: 'assistant', content: '提出改动: 正文 "尽快推进试运行准备工作,确保按期上线。"→"加快试运行准备,确保按期如期完成上线目标。"(用户已撤销这些改动,文档未保留它们)' },
    ],
    expect: { kind: 'changeset', opsMust: [/尽快推进试运行准备工作/] },
    rubric: '上一轮改动已撤销:quote 必须锚定【原句】("尽快推进试运行准备工作…"),不得把已撤销的版本当作现存文本引用。' },

  // ── 新能力:结构清理(deletePara + para 段号锚定)/ 图片操作(img op)/ 值×格式口径自检 ──
  { id: 'w-cleanup-empty', format: 'word', intent: '清理文档:删掉所有空段落,以及那段无意义的测试残留文字', context: doc2Ctx, doc: DOC2,
    expect: { kind: 'changeset', opsMust: [/deleteRange/],
      check: (cs) => {
        const dels = cs.edits.filter((e) => e.op.kind === 'deleteRange');
        if (dels.length < 3) return `删段 edits 只有 ${dels.length} 条(应 ≥3:两个空段+残留文字段)`;
        for (const e of dels) {
          const a = cs.anchors[e.target]; const p = a?.portable;
          if (p?.kind !== 'flow') continue;
          if (p.path[0] === 1 || (p.quote.text && p.quote.text.includes('验收范围'))) return '把含图片的第2段也删了(应保留)';
          if (!p.quote.text && p.path[0] == null) return '空段删除没有给 para 段号锚(空 quote 无法定位)';
        }
        return null;
      } },
    rubric: '空段落是否用 para 段号锚定 + deletePara(而非说"空字符串无法定位"跳过);残留文字段是否一并删除;含图片的第2段与正文是否保留。' },
  { id: 'w-img-resize', format: 'word', intent: '第2段那张验收流程图太大了,缩小到 100 像素宽', context: doc2Ctx, doc: DOC2,
    expect: { kind: 'changeset', opsMust: [/imgAction/, /resize/, /100/], opsForbid: [/deleteRange/] },
    rubric: '是否用 img=resize + imgWidth=100 精确执行(而非说不支持/删除重来);锚定是否落在第2段(para 或该段 quote)。' },
  { id: 'w-img-remove', format: 'word', intent: '把第2段里的图片删掉,段内文字要保留', context: doc2Ctx, doc: DOC2,
    expect: { kind: 'changeset', opsMust: [/imgAction/, /"remove"/], opsForbid: [/deleteRange/, /replaceText/] },
    rubric: '是否用 img=remove 只删图不删段(deletePara/replacement 都会伤到段内文字);plan 是否说明文字保留。' },
  { id: 'x-pct-mock', format: 'excel', intent: '在数据下方续写 2 行 2 月的 mock 数据,口径与上面一致', context: sheet2Ctx, sheet: SHEET2,
    expect: { kind: 'changeset',
      check: (cs) => {
        for (const e of cs.edits) {
          if (e.op.kind !== 'setValue') continue;
          const a = cs.anchors[e.target]; const a1 = a?.portable?.kind === 'grid' ? a.portable.a1 : '';
          if (!/^F\d+$/i.test(a1.replace(/^.*!/, ''))) continue;
          const n = typeof e.op.value === 'number' ? e.op.value : parseFloat(String(e.op.value));
          if (Number.isFinite(n) && n > 2) return `毛利率格 ${a1} 写入 ${e.op.value} —— 配 0% 格式会显示成 ${n * 100}%(口径事故,应写小数)`;
        }
        return null;
      } },
    rubric: 'mock 数据是否口径正确(毛利率写小数如 0.4 而非 40/120)、有合理波动(非全同值)、金额列优先公式(=销量×单价);是否先探明末行再续写。' },
];

// ── 执行 ──
const rt = new OtterPatchRuntime();
const model = createModelClient(PROVIDER, { apiKey: KEY, model: MODEL });

/** judge 走最小的裸补全调用:claude 用 Anthropic SDK,其余 7 家走 OpenAI 兼容(baseURL 来自 provider 注册表)。 */
async function judge(task, resultDesc) {
  const prompt = `你是 Office Agent 输出的严格评审。任务:「${task.intent}」\n评分标准:${task.rubric}\nAgent 的产出(工具调用轨迹+结果):\n${resultDesc}\n\n只输出 JSON:{"score":1-5,"reason":"一句话"}(5=资深专家水平,3=能用但平庸,1=错误/答非所问)`;
  let txt = '';
  try {
    if (PROVIDER === 'claude') {
      const { default: Anthropic } = await import('@anthropic-ai/sdk');
      const c = new Anthropic({ apiKey: KEY });
      const res = await c.messages.create({ model: JUDGE_MODEL, max_tokens: 500, messages: [{ role: 'user', content: prompt }] });
      txt = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    } else {
      const { default: OpenAI } = await import('openai');
      const c = new OpenAI({ apiKey: KEY, baseURL: PROVIDERS[PROVIDER]?.baseURL });
      // 思考模型会先花 token 想:给足预算,并兜底从 reasoning_content 里捞 JSON
      const res = await c.chat.completions.create({ model: JUDGE_MODEL, max_tokens: 2500, messages: [{ role: 'user', content: prompt + '\n(直接输出 JSON,不要输出思考过程)' }] });
      const msg = res.choices[0]?.message ?? {};
      txt = msg.content || msg.reasoning_content || '';
    }
  } catch (e) {
    return { score: 0, reason: 'judge 调用失败: ' + e.message };
  }
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
        ...(task.sheet ? { sheet: task.sheet } : {}), ...(task.doc ? { doc: task.doc } : {}), ...(task.history ? { history: task.history } : {}) },
      model,
      (e) => { if (e.type === 'tool') tools.push(e.name); },
    );
  } catch (e) {
    console.log(`  ✗ ${task.id} 请求失败: ${e.message}`); fails++; continue;
  }
  // Include anchors: quote anchors live in changeSet.anchors, not in edits — opsMust patterns often target the quote (R4 false negative on mt-reverted).
  const ops = result.kind === 'changeset' ? JSON.stringify({ edits: result.changeSet.edits, anchors: result.changeSet.anchors }) : '';
  const kindOk = result.kind === task.expect.kind;
  const toolsOk = (task.expect.mustTools ?? []).every((t) => tools.includes(t))
    && (!task.expect.mustToolsAny || task.expect.mustToolsAny.some((t) => tools.includes(t)));
  const opsOk = (task.expect.opsMust ?? []).every((rx) => rx.test(ops))
    && !(task.expect.opsForbid ?? []).some((rx) => rx.test(ops));
  // 结构化自定义不变量(正则够不着的:数值区间/锚点交叉校验),返回 null=通过、字符串=失败原因
  const checkMsg = task.expect.check && result.kind === 'changeset' ? task.expect.check(result.changeSet) : null;
  const desc = `工具轨迹: ${tools.join(' → ') || '(无)'}\n回应类型: ${result.kind}\n` +
    (result.kind === 'changeset' ? `plan: ${result.changeSet.meta.planSummary ?? ''}\nedits(${result.changeSet.edits.length}): ${ops.slice(0, 3000)}`
      : result.kind === 'clarify' ? `questions: ${JSON.stringify(result.questions).slice(0, 1500)}` : `answer: ${result.text.slice(0, 1500)}`);
  const j = await judge(task, desc);
  const pass = kindOk && toolsOk && opsOk && !checkMsg;
  if (!pass) fails++;
  sum += j.score; n++;
  console.log(`  ${pass ? '✓' : '✗'} ${task.id}  kind:${kindOk ? 'ok' : result.kind} tools:${toolsOk ? 'ok' : '缺[' + tools.join(',') + ']'} ops:${opsOk ? 'ok' : 'miss'}${checkMsg ? ' check:' + checkMsg : ''}  judge:${j.score}/5 —— ${j.reason}`);
  appendFileSync(new URL('./bench-results.jsonl', import.meta.url), JSON.stringify({ ts: new Date().toISOString(), provider: PROVIDER, model: MODEL, task: task.id, kindOk, toolsOk, opsOk, ...(checkMsg ? { check: checkMsg } : {}), judge: j.score, reason: j.reason }) + '\n');
}
console.log(`\nBENCH(${PROVIDER}/${MODEL}): ${n} 任务 · 不变量失败 ${fails} · judge 均分 ${(n ? sum / n : 0).toFixed(2)}/5`);
process.exit(fails ? 1 : 0);
