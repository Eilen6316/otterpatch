# 测试

权威测试矩阵是 [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)。文档不再维护易过期的
断言数量；行为契约比数字更有价值。

## 本地 CI 基线

使用 Node.js 22。可复现的本地基线：

```bash
npm ci
npm run typecheck
npm test
npm run test:real-writeback
npm run build
npm run test:serve-security
npm run test:ui
```

`npm test` 会运行所有声明了 test script 的 workspace。`npm run build` 构建所有 workspace，
并在编译 skills 包前生成静态 playbook manifest。

## Workspace 测试

| 区域 | 当前契约 |
|---|---|
| `core` | UUIDv7、严格 ChangeSet 语义/provenance、资源/范围限制、范围感知风险、能力清单、registry 与 revision hash |
| `agent` | 可信/不可信 prompt 边界、Provider 响应身份、dialect/能力一致、类型化只读工具、独立修复预算、重试/熔断/取消、reasoning 抑制、Word/drawio 提案验证 |
| `skills` | 生成目录、namespace/trust/version/checksum 规则、外部技能隔离、locale/匹配、能力交集、陈旧操作声明回归 |
| `runtime` | Adapter conformance、签名 proposal/review 绑定、源/revision 检查、单次 receipt、风险执行、文档锁、fallback 规则、listener 隔离、结构化 Fidelity 校验 |
| 各格式 Adapter | 精确写回、dropped-edit 诚实性、锚点歧义、公式重算、XML tokenizer、drawio 拓扑、PDF 字段回读、PPTX run 边界 |
| desktop | 审阅状态代数、snapshot 绑定、浏览器令牌接线、IPC schema/大小边界、干净 Word 投影、Excel/drawio 回放、commit receipt 流程 |
| MCP/HTTP | 文档解码限制、客户端断连传播、token/origin/rate/concurrency 安全 helper |

运行器是 `node --import tsx --test`。包级命令使用 workspace 名称，例如：

```bash
npm test --workspace @otterpatch/runtime
npm test --workspace @otterpatch/desktop
```

## 真实写回与服务安全

`npm run test:real-writeback` 会创建并修改 XLSX、DOCX 文本、DOCX 表格、PPTX、未压缩 drawio
和 PDF 真实格式 fixture，验证请求结果与关键局部性不变量。

`npm run test:serve-security` 启动隔离服务实例，检查自动/固定 token、精确 Origin CORS、匿名/
授权行为、review token、proposal/source 绑定、revision 欺骗、body 上限和 rate limit。无需 Provider Key。

安全敏感单元回归还覆盖恶意 prompt 文本、畸形/超大 ChangeSet、ZIP/path/XML 语料、未知公式/
循环、恶意技能元数据、receipt 重放、非法 Fidelity 报告和不可信 Electron IPC payload。

## 浏览器行为契约

`npm run build` 后，CI 安装 Playwright Chromium，并针对 `apps/desktop/dist` 使用模拟本机服务响应
运行以下脚本：

```text
ui-smoke
drawio-review-e2e
richdoc-toolbar
richdoc-projection-e2e
richdoc-editing-e2e
richdoc-revisions-e2e
word-agent-mock
word-review-e2e
word-table-e2e
word-docfmt-e2e
word-autobatch-e2e
word-docx-import-e2e
excel-agent-mock
```

这些测试断言实际效果，而不是组件存在性：值/公式能回放、接受的 Word 修订会压平、拒绝会恢复
before-state、table/block 顺序在导入后保持、审阅状态可持久化，并且没有 console/page error。
直接运行单项：

```bash
node test/word-review-e2e.mjs
```

`npm run test:ui` 只是快速 `ui-smoke` 子集，不是完整浏览器矩阵。

## 打包桌面冒烟

CI 另有 Windows 和 macOS job：

1. 安装 Electron runtime；
2. 构建打包内本机服务；
3. 创建未安装的桌面应用；
4. 启动生产应用并验证其加载预期本机 UI。

相关本地命令：

```bash
npm run build --workspace @otterpatch/mcp-server
npm run app:pack:dir --workspace @otterpatch/desktop
npm run test:packaged --workspace @otterpatch/desktop
```

## 真实模型检查

CI 的 `real-model-smoke` 只在 `main` 且仓库配置 `OtterPatch_API_KEY` secret 时运行：

```bash
OtterPatch_API_KEY=... OtterPatch_PROVIDER=claude npm run smoke
```

能力 bench 是无头测试，评分结果追加到 `test/bench-results.jsonl`：

```bash
OTTERPATCH_BENCH_KEY=... node test/expert-bench.mjs
BENCH_ONLY=w-gongwen OTTERPATCH_BENCH_KEY=... node test/expert-bench.mjs
```

它结合客观不变量和 LLM judge。缺少 `OTTERPATCH_BENCH_KEY` 时打印 `SKIP` 并成功退出。

`eval:*`、`excel-agent.mjs` 和 `expert-eval.mjs` 是人工开发工具，不是 CI 门禁。部分 UI live-eval
脚本早于当前 Electron/浏览器本机令牌分流，仍会在 Electron 之外托管 production Vite bundle；
在把它们迁移到已鉴权的浏览器开发或 Electron bridge 前，不应把结果当成权威信号。其模型 Key
（`OA_EVAL_KEY` 或 `OTTERPATCH_TEST_KEY`）绝不能提交。

## 测试卫生

- 确定性 fixture 与脚本放在 `test/` 或所属 package。
- Fixture 不得包含真实 Provider Key、服务 token、review token 或私人文档。
- CI 与锁文件验证优先使用 `npm ci`。
- 断言失败关闭行为和返回结构，不只断言 happy-path UI 元素。
- 有意 skip 的测试必须说明原因，并使用独立 key gate。
