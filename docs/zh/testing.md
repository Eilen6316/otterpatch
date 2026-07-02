# 测试

三个层次：包级单元测试（快速，始终运行）、针对构建产物驾驶舱的无头 e2e 测试
（模拟模型），以及需要密钥门控的能力基准测试（真实模型，打分）。

## 包级单元测试（`npm test -w @otterpatch/<pkg>`）

| 包 | 覆盖内容 |
|---|---|
| `agent` | dialect 构建、provider 工厂、消息规范化、修复循环、json 抢救、**文档工具**（read_blocks/find_text/outline/style-usage）、**word 校验器**（引文可落地性）、**drawio 校验器**（悬空边 / 幽灵 id） |
| `skills` | SKILL.md 解析、匹配与排序（含 playbook 平局裁决）、render/L0、`instructionsFor`、playbook 内容 |
| `runtime` | 事件流、校验器注册表接线、**最终自检**协议（大变更集复查轮次） |
| `adapter-*`、`writeback-surgical` | 编译 + 外科式回写保真度 |

运行器：`node --import tsx --test`（见各 package.json）。注意：package.json 文件必须保持
**无 BOM** —— tsx 的 JSON 读取器会拒绝 UTF-8 BOM。

## 无头 e2e（`node test/<name>.mjs`）

`test/harness.mjs` 静态托管 `apps/desktop/dist` 并驱动无头 Chromium
（Playwright）；`/propose-stream` 被固定 SSE 拦截 —— 不用模型、不用密钥。**先构建**
（`npm run build -w @otterpatch/desktop`）。

| 测试套件 | 断言内容 |
|---|---|
| `word-agent-mock`（23） | 上下文包含逐段格式 + 选区；宽松匹配落地；行内标记；4 状态切换；全部接受后物理清除所有标记 |
| `word-review-e2e`（10） | 悬浮卡片接受会压平一处变更；任意视图状态下文本都不消失；第二轮上下文排除已删除文本；评审中途刷新后审批仍然可用 |
| `word-docfmt-e2e`（10） | `all=true` 的文档级 chip + 页面级（双栏）变更；真实的前后切换；chip 接受/拒绝；批次继续按钮 |
| `word-autobatch-e2e`（5） | ⚡自动继续在接受后无需点击即发送“下一批”；当计划不再声明批次时停止 |
| `excel-agent-mock`（14） | git 风格 diff；通过 `__univerGet` 钩子读取真实表格值：拒绝会恢复 120，视图切换不会复活已拒绝的编辑，全部接受会重新落地它们 |
| `richdoc-toolbar`（21） | 功能区命令真正修改文档；图标去重；即时提示气泡 |
| `ui-smoke`（7） | 应用启动、网格渲染、选区 chip、drawio 拖放、控制台零错误 |

约定：断言**效果，而非存在性**（一张能打开的卡片被点击时也必须*能用* ——
只断言存在性曾掩盖过一个失效的接受按钮）；尽可能读取真实状态（计算样式、通过测试钩子获取的
网格值）而不是类名。

## 能力基准（`test/expert-bench.mjs`，密钥门控）

用真实模型跑 8 个任务（Word 润色/结构/公文（政府公文）/歧义，Excel
公式/异常/图表/歧义），并从两个层次打分：

1. **客观不变量** —— 响应类型（changeset 还是 clarify）、必需的工具调用
   （`read_blocks`、`aggregate`、`load_skill`……）、必需的操作形态（`=SUM`、`chart`）。
2. **LLM 评审** —— 每个任务按 1–5 分评分标准打分。

结果追加到 `test/bench-results.jsonl` 用于趋势跟踪。没有 `OTTERPATCH_BENCH_KEY`
时打印 SKIP 并以 0 退出（对 CI 安全）。

```bash
OTTERPATCH_BENCH_KEY=sk-ant-... node test/expert-bench.mjs
BENCH_ONLY=w-gongwen OTTERPATCH_BENCH_KEY=... node test/expert-bench.mjs   # single task
```

## 接受度遥测（生产环境信号）

桌面端按格式 × 变更类型统计每一次逐项接受/拒绝
（`localStorage['oa.telemetry']`，控制台：`__otterTelemetry()`）。某个类别的接受率下降
是任何离线测试都给不了你的回归信号 —— 把它反馈回 playbook 和提示词中。
