# Capability Bench — 校准记录

`test/expert-bench.mjs` 用真实模型跑 8 个专家任务,两层评分:客观不变量(回应类型/必调工具/op 形状)+ LLM-judge(1-5)。
逐轮结果追加在 `test/bench-results.jsonl`。运行方式见文件头注释(无 key 自动 SKIP,CI 安全)。

## 2026-07-02 · deepseek / deepseek-v4-pro · 三轮校准

| 轮 | 不变量失败 | judge 均分 | 本轮动作 |
|---|---|---|---|
| R1 | 2/8 | 2.75 | 基线。发现:两个模糊任务(w/x-ambiguous)都没走 ask_user 直接大改;judge 对思考模型解析失败 |
| R2 | 1/8 | 3.38 | 修复:路由 ③ 加"连做哪类事都没说的请求必须先澄清"硬标准 → **两个 ambiguous 任务 5/5**;judge 加思考模型适配。新发现:w-gongwen 撞 8 步上限(load_skill+样式审计+自检把步数吃满) |
| R3 | **0/8** | **4.00** | 修复:STEP_LIMIT 8→12 → w-gongwen 通过(3/5) |

### R3 分数细目
w-polish 1 · w-gongwen 3 · w-structure 5 · w-ambiguous 5 · x-sum 3 · x-anomaly 5 · x-chart 5 · x-ambiguous 5

### 已知弱点(下一轮校准靶子)
- **w-polish(1/5)**:润色类任务 plan 不讲病因、替换句质量不稳——DeepSeek 上 word 润色是当前最弱项
- **x-sum(3/5)**:两轮稳定复现"没发现 C7 是文本数字"——`xlsx-authoring` 手册已加"同列混文本数字必转数/提醒"条目,待下一轮验证命中率(该任务意图不含财务关键词,靠通用手册兜)
- **w-gongwen(3/5)**:公文落地"标题未居中、未用真 block"——手册有此要求但模型执行打折;可考虑金样例里补公文示例

### 复现

```bash
OTTERPATCH_BENCH_KEY=<key> OTTERPATCH_BENCH_PROVIDER=deepseek BENCH_MODEL=deepseek-v4-pro node test/expert-bench.mjs
```

方法论:一轮 bench = 基线;修复必须指向具体失败;下一轮验证修复且盯住回归。分数是过程指标,
真正的北极星是桌面端的逐条接受率遥测(`__otterTelemetry()`)。
