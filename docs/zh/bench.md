# Capability Bench（能力基准）— 校准记录

`test/expert-bench.mjs` 用真实模型跑专家任务集（8 个单轮 + 4 个多轮对话场景），两层评分：
客观不变量（回应类型 / 必调工具 / changeset 形状，含锚点）+ LLM-judge（1-5）。
逐轮结果追加在 `test/bench-results.jsonl`。运行方式见文件头注释（无 key 自动 SKIP，CI 安全）。

## 2026-07-02 · deepseek / deepseek-v4-pro · 六轮校准

| 轮 | 任务 | 不变量失败 | judge 均分 | 本轮动作与发现 |
|---|---|---|---|---|
| R1 | 8 | 2 | 2.75 | 基线。发现：模糊请求不澄清直接大改 ×2；judge 不适配思考模型 |
| R2 | 8 | 1 | 3.38 | 修复：路由③加"连做哪类事都没说必须 ask_user"硬标准 → 两个 ambiguous 任务 5/5；judge 加 reasoning_content 兜底。新发现：w-gongwen 撞 8 步上限 |
| R3 | 8 | **0** | 4.00 | 修复：STEP_LIMIT 8→12（load_skill+样式审计+自检的专家流程需要步数）→ 全过 |
| R4 | 12 | 1* | 4.42 | 新增 4 个多轮场景（澄清后落地/续批不重复/追改锚新文/撤销后回原文），3 个首跑即 5/5。弱点修复生效：w-polish 1→5（润色金样例+病因硬要求）、w-gongwen 3→5（公文首刀五字段）。*唯一失败是 bench 自身断言 bug（quote 在 anchors 不在 edits） |
| R5 | 12 | 3 | 4.67 | 修复续批声明（mt-next-batch 3→5）、图型默认规则（x-chart 2→5）、bench 锚点断言。新发现：**裸文本收尾模式** ×3（方案/澄清写成散文不调工具，judge 被漂亮文字骗到 5 分——客观不变量的价值） |
| R6 | 12 | **0** | **4.58** | 修复：NUDGE_TOOLIFY（通道层：非空文本收尾催一次工具化）→ 裸文本模式清零；readRange 类型可见性（文本数字渲染成 `"71"(文本数字⚠SUM会漏加)`）→ x-sum 两轮 3 分顽疾 **5/5**（"发现 C7 为文本数字并主动修正"） |

### 修复全清单（六轮沉淀）
1. 澄清硬标准（prompt·路由③）：目标缺失的请求必须 ask_user
2. STEP_LIMIT 8→12（loop）：专家流程步数预算
3. 续批声明（prompt·路由⑥）：续批回合必须声明批次并不重复已写入项
4. 图型默认（prompt·excel④）：分类比较默认 bar，没说"占比"不用 pie
5. **readRange 类型可见性（工具层）**：文本数字显式标记——关键正确性信息不能靠技能匹配，要在工具输出里长眼睛
6. **NUDGE_TOOLIFY（通道层）**：裸文本收尾催一次工具化——路由契约"每回合一次工具调用"由代码兜底
7. bench 锚点断言（测试自身）：opsMust 覆盖 anchors

### 方法论沉淀
- 修复分三层下刀：**提示词**（行为偏好）→ **工具输出**（信息可见性）→ **通道代码**（契约兜底）；越靠后越确定
- judge 会被漂亮散文骗分，客观不变量不会——两层都要
- 单轮分数有方差（x-anomaly 在 5/2/5/4 间波动），连续两轮复现才算真弱点

### 剩余观察项
- mt-next-batch 3/5：续批仍偶有与上批重叠的敏感项——plan 声明了但 edits 未完全规避
- w-gongwen 4/5：小标宋等字体近似的落地边界
- 真正的北极星仍是桌面端逐条接受率遥测（`__otterTelemetry()`）

### 复现

```bash
OTTERPATCH_BENCH_KEY=<key> OTTERPATCH_BENCH_PROVIDER=deepseek BENCH_MODEL=deepseek-v4-pro node test/expert-bench.mjs
```
