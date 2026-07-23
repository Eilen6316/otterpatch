# OtterPatch

[English](./README.md) · **中文**

> **O**ffice **T**ransforms · **T**racked · **E**dited & **R**eviewed · surgical **Patch**。
> 圈选区域，描述诉求，逐条审阅，再写回原格式文件。

> **开发预览版（`0.0.1`）。** 下文描述的安全边界已经由代码强制执行，但格式能力仍然
> 有意保持收敛，API 也可能变化。处理重要文档时请保留备份，并先查看能力表。

**产品范围：** Excel 和 Word 是当前产品主线；drawio 只作为次要兼容集成保留，不再扩展。
PDF 支持已经删除。PPTX 适配器仅冻结保留并要求显式 opt-in；stock runtime、桌面端、MCP、
HTTP 和 CLI 均不暴露 PPTX。

## OtterPatch 做什么

Agent 不会获得一个通用的文件修改工具。它只能回答、请求澄清，或提议一份结构化的
`ChangeSet`。随后由 OtterPatch：

1. 将文档内容放入明确标记为不可信的用户数据封装中；
2. 校验 ChangeSet 的结构、语义、资源预算和格式能力清单；
3. 执行当前格式最强的确定性提案检查，并生成可审阅 diff；
4. 签发与 ChangeSet、格式、策略、源文件 SHA-256 和 revision 绑定的 proposal；
5. 只提交签名、限时、单次使用的 review receipt 中列出的 edit ID；
6. 按文档串行写入，执行选定后端，重新读取输出，并要求结构化验证报告后才把字节交还宿主。

对于当前启用的 OOXML 写回与未压缩 drawio，外科式写回只修改预期部件或 diagram。在一个
531 KB 的 `.docx` 样本上，31 个包部件中有 30 个保持逐字节一致。

## 当前支持范围

[`packages/core/src/capabilities.ts`](./packages/core/src/capabilities.ts) 中的
`capabilities-v2` 清单，是 availability、lifecycle、propose、preview、verify 和 write-back
门禁的唯一事实来源。

| 格式 | 可用性 | 当前写回操作 | 提案预览/检查 | 关键边界 |
|---|---|---|---|---|
| Excel（`xlsx`） | 主线、默认启用 | 值、公式、样式、数字格式、清空范围 | 无头网格 shadow + 确定性模拟 | 只支持已实现的公式子集；未知函数、循环、缺失观测和超大范围均失败关闭；写后逐 edit 回读为 `unverifiable` |
| Word（`docx`） | 主线、默认启用 | 锚定文本替换/删除、局部字符与段落样式、页面分栏/边距/方向、图片删除/缩放、插表 | 唯一引文/段号锚点检查；富预览由桌面宿主渲染 | 在 `word/document.xml` 中写原生修订；通用逐编辑输出回读会如实标为 `unverifiable` |
| drawio | 次要兼容、默认启用 | 标签/属性更新、移动、新增、删除 | 无头画板重放 + 拓扑验证 | 仅支持未压缩 diagram；身份与拓扑字段受约束；不计划扩展功能 |
| PowerPoint（`pptx`） | 冻结、显式 opt-in | 唯一单 run 文本替换 | 精确到 slide/paragraph/run 的边界检查 | 只为显式注册的宿主保留；所有 stock 产品入口均不可用 |

PDF 已不受支持，Adapter、依赖、Agent dialect、技能、schema 和写回测试均已删除；它不再是
“实验性产品选项”。

不支持的操作不会暴露给模型，并且会在 runtime 再次拒绝。宿主不能靠手工构造一个
看似合法的 ChangeSet 绕过能力边界。

## 本地运行

前置要求：Node.js 22 和 npm。

```bash
npm ci
npm run typecheck
npm test
npm run build
```

### 浏览器开发模式

使用两个终端：

```bash
# 终端 A：构建 TypeScript、启动 loopback HTTP 服务、显示一次性本机令牌
npm run serve

# 终端 B：启动驾驶舱，地址为 http://localhost:5173
npm run dev
```

在驾驶舱模型设置中填写 Provider API Key，以及 `npm run serve` 显示的**本机服务令牌**和
**审阅令牌**。浏览器开发令牌只按本机 Vite Origin 保存；服务重启并生成新值后需要更新。
每个本机 `POST` 都必须携带 `X-OtterPatch-Token`，`/review` 还必须携带
`X-OtterPatch-Review-Token`。只有 `GET /health` 可匿名访问。

如需固定开发凭据或 Origin，而不是使用自动生成值：

```text
OtterPatch_TOKEN
OtterPatch_REVIEW_TOKEN
OtterPatch_ALLOWED_ORIGINS
OtterPatch_PORT
```

`OtterPatch_ALLOWED_ORIGINS` 只接受精确的 loopback HTTP(S) Origin 或 `null`，用逗号分隔。
服务始终绑定 `127.0.0.1`。

### Electron 桌面版

```bash
npm run build
npm run app --workspace @otterpatch/desktop

# 构建未安装的打包目录
npm run app:pack:dir --workspace @otterpatch/desktop
```

Electron 会自行启动本机服务。服务令牌和审阅令牌只存在主进程；启用 sandbox 的 renderer
只能调用有界的提案、取消和已审阅提交 IPC。

## 集成方式

`apps/mcp-server` 通过 MCP stdio、无头 CLI 和本机 HTTP 桥复用同一个 runtime。这些 stock
接口只接受 Excel、Word、drawio 及 `xlsx`/`docx` 别名。

```text
otterpatch_skills   列出不可变的内置技能元数据
otterpatch_propose  意图 + 可信请求身份 + 只读快照 -> ChangeSet、diff、签名 proposal
otterpatch_diff     ChangeSet + 宿主快照 -> shadow diff 或明确的 unavailable 原因
otterpatch_commit   源文件 + ChangeSet + 签名 proposal + review receipt -> 已验证输出
```

Stock MCP stdio 接口不会签发人工审阅收据。直接嵌入 `@otterpatch/runtime` 的宿主可以让可信
审阅 UI 与同一个 `ReviewAuthority` 协作；普通 stdio 客户端只能独立完成 propose/diff，不能单靠
自身调用默认的已审阅 commit。HTTP/Electron 是当前内置的完整审阅闭环。未审阅 MCP commit
默认关闭，只能通过 `OTTERPATCH_ALLOW_UNREVIEWED_COMMIT=1` 显式开启；即便开启，也必须传入
`acceptedEditIds` 和实时观测的 `currentRev`。

构建后，将 stdio 入口注册到 MCP 客户端：

```json
{
  "mcpServers": {
    "otterpatch": {
      "command": "node",
      "args": ["/absolute/path/to/otterpatch/apps/mcp-server/dist/mcp.js"],
      "env": { "OtterPatch_API_KEY": "your-provider-key" }
    }
  }
}
```

通过显式确认运行一次无头写回：

```bash
npm run run --workspace @otterpatch/mcp-server -- \
  --yes --format excel --intent "金额 = 数量 * 单价" \
  --in book.xlsx --out book.out.xlsx
```

不带 `--yes` 时，CLI 会输出 proposal 和 diff，但拒绝写文件。

## 验证结果

`FidelityReport.score` 只保留为局部性兼容别名。消费者应读取结构化维度：

```text
verification.packageValid
verification.locality       预期部件、意外部件、目标外部件不变比例
verification.semantic       verified / unverifiable / failed edit ID
verification.compatibility  明确的格式与后端警告
```

Runtime 会拒绝旧式或编辑覆盖不完整的报告、无效包和意外漂移；返回的是最终回读报告，
不是后端在 commit 时给出的乐观估计。

## 仓库结构

```text
packages/core/                ChangeSet、校验、能力、风险、预算、Adapter 契约
packages/agent/               有界多 Provider Agent 循环、只读工具、来源证明
packages/skills/              不可变内置技能、生成式 playbook 清单、外部技能隔离
packages/adapter-univer/      Excel shadow、验证器与 worksheet 编译器
packages/adapter-word/        Word 锚点、原生修订、样式/页面/表格/图片写回
packages/adapter-drawio/      mxCell 模型、拓扑验证器、diagram 写回
packages/adapter-pptx/        冻结的 opt-in 单 run 幻灯片文本写回（stock 不注册）
packages/writeback-surgical/  带资源预算的 OOXML 读写与局部性验证
packages/runtime/             由 Adapter 驱动的 propose/diff/review/commit 编排
apps/mcp-server/              MCP、CLI、带鉴权的 loopback HTTP 服务
apps/desktop/                 Vite/React 驾驶舱与 sandboxed Electron 壳
```

## 文档

从 [`docs/`](./docs/README.md) 开始：
[架构](./docs/zh/architecture.md) · [安全模型](./docs/zh/security.md) ·
[Agent 循环](./docs/zh/agent.md) · [技能](./docs/zh/skills.md) ·
[审阅体验](./docs/zh/review-ux.md) · [测试](./docs/zh/testing.md) ·
[Word OOXML 笔记](./docs/zh/ooxml-redline-notes.md)

## 许可证

[Apache-2.0](./LICENSE)。
