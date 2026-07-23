# 架构

OtterPatch 是 LLM Agent 与结构化文档之间的审阅和提交边界。Agent 只提议意图级操作；
校验、审批、写回和验证均由可信代码负责。

## 产品生命周期

- Excel 和 Word 是 active、默认注册的产品格式。
- drawio 默认注册，但只作为次要兼容集成。
- PDF 已从仓库和依赖图中删除。
- PPTX 的 Adapter、dialect、manifest 与单元测试以 `opt-in` / `frozen` 状态保留。宿主必须
  导入 `pptxAdapterRegistration` 并调用 `runtime.registerAdapter(...)`；stock 宿主不会注册它。

## 端到端流水线

```text
 可信宿主身份 + 用户意图                  不可信文档投影
              |                                |
              +---------------+----------------+
                              v
                       有界 Agent 循环
              answer_user | ask_user | propose_changeset
                              |
                              v
                   UUIDv7 ChangeSet + provenance
                              |
             结构/语义/预算/能力清单校验
                              |
               Adapter 提案检查 + shadow 预览
                              |
                              v
          与源文件 SHA-256 绑定的签名 ProposalEnvelope
                              |
                       人工逐编辑审阅
                              |
                              v
              签名、限时、单次使用的 ReviewReceipt
                              |
       源文件/revision/hash/策略/风险检查 + 文档锁
                              |
                              v
                   Adapter 选择的写回后端
                              |
                 重新读取输出 + backend.verify(...)
                              |
                              v
             package | locality | semantic | compatibility
                              |
                              v
                     已验证字节返回宿主
```

Runtime 永远不会把工作区中的乐观预览当作已提交文件。Commit 会从 proposal 和 receipt
绑定的精确源字节重新开始。

## 职责划分

| 包 | 职责 |
|---|---|
| `packages/core` | `Anchor`、`ChangeSet`、语义校验、UUIDv7、资源预算、能力/风险模型、Adapter 与写回契约 |
| `packages/agent` | 有界 Provider 循环、由能力生成的格式 dialect、只读工具、不可信上下文封装、Provider 控制、来源证明采集 |
| `packages/skills` | 不可变内置能力卡、构建期生成的 playbook 清单、能力感知匹配、外部技能文本隔离 |
| `packages/runtime` | Adapter 路由、提案检查、diff、proposal/review 签名、风险执行、按文档加锁、后端执行、强制验证 |
| `packages/adapter-*` | 单一格式控制面：manifest、validator、proposal verifier、preview、预期部件和有序写回候选 |
| `packages/writeback-surgical` | 带预算的 OOXML ZIP/XML 处理、目标部件补丁、字节局部性比较 |
| `apps/mcp-server` | MCP stdio、显式确认 CLI、带鉴权的 loopback HTTP 桥 |
| `apps/desktop` | Excel/Word/drawio 工作区、逐项审阅、浏览器开发客户端、sandboxed Electron 主进程/renderer 边界 |

## 信任边界

### 请求与模型

宿主提供文档、用户和会话身份；文件型请求还提供源 SHA-256。这些值在模型调用前准备。
文档上下文以 `{ untrusted_data: true, kind: "document_context", content: ... }` 序列化到
user message，绝不拼入 system prompt。只读工具结果和外部技能正文使用同样的不可信数据边界。

Agent 产生的 ChangeSet 会记录 Provider、模型、Provider 响应 ID、提示策略版本、源 hash、
父 proposal、修复次数、技能版本/checksum 和 actor 身份。模型不能填写或替换这些字段。
Proposal 签名还会将 provenance 与可信宿主身份及源 hash 交叉校验。

### Proposal 与审阅

`ProposalEnvelope` 签名规范化 ChangeSet hash、document ID、格式、base revision、能力版本、
审阅策略版本、源 hash 和过期时间。`ReviewReceipt` 签名 accepted edit ID、proposal/hash/source
绑定、reviewer session、过期时间和 nonce。

默认 commit 必须同时提供两者。Receipt 在单个 runtime 进程内只能使用一次；成功 commit 后，
精确源文件也会被记录，防止旧源再次提交。缺失、过期、篡改、不匹配或重放都会失败关闭。

### Commit

Runtime 从已审阅 ChangeSet 重建接受子集，并在 write-back 阶段再次通过选中 Adapter 校验。
随后执行上下文风险策略，按 `[documentId, format]` 串行 commit，拒绝陈旧 revision，并选择
第一个声明能处理完整子集的后端。只有在后端开始执行前才允许 fallback；执行开始后的失败是
终止性错误，避免部分副作用后重复回放。

Commit 后，runtime 调用 `backend.verify(before, after, acceptedChangeSet)`。验证器必须把每个
接受 edit 恰好归入 `verified`、`unverifiable` 或 `failed`。Runtime 会拒绝旧式/不完整报告、
无效包、后端声称成功时的语义失败和意外漂移；最终回读报告会覆盖 commit 阶段的乐观报告。

## Fidelity 报告

旧的标量 score 不是通用质量分数，只保留为“目标外部件不变比例”的兼容别名。

| 维度 | 含义 |
|---|---|
| `packageValid` | 输出能通过后端的包或解析器重新打开 |
| `locality` | 预期部件、意外改动部件，以及目标外部件的字节不变比例 |
| `semantic` | 互斥且完整的 verified、unverifiable、failed edit ID 列表 |
| `compatibility` | 明确的后端限制与应用兼容性警告 |

OOXML 和 drawio 可以给出有意义的局部性。在格式专用输出回读实现之前，Excel 与 Word 会
保守地把已应用 edit 标为 `unverifiable`。Excel 的审阅前 grid simulation 是有价值的提案证据，
但不是对写后文件的回读。冻结的 opt-in PPTX Adapter 保留同样的保守语义状态，但不在默认
产品路径中。

## Adapter 控制面

`AdapterRegistry` 负责格式别名与优先级。一个 `HostAdapter` 提供：

- 版本化能力清单；
- 默认/opt-in availability 与 active/frozen lifecycle；
- 格式专用语义校验；
- 当前最强的提案验证器；
- shadow 预览或明确的 unavailable 原因；
- 有序写回候选。

同一 `capabilities-v2` manifest 驱动模型 schema 暴露、proposal/review 门禁、write-back 校验、
`/health` 和 conformance test。Stock registry 只包含 availability 为 default 的 manifest。
兼容注册方法只会装饰已选择的 Adapter，不会在 runtime 建立第二份格式表。

## 宿主职责

Runtime 是进程内核。它返回已验证字节，但不负责原子替换用户文件，也不持久化长期审计账本。
嵌入宿主必须：

- 写入新文件，或采用原子替换策略；
- 按文档价值保留备份；
- 在需要跨进程重启或多节点防重放时持久化审计记录；
- 源文件发生任何变化后重新生成 proposal。OtterPatch 会拒绝陈旧锚点，不自动 rebase。

威胁模型见 [security.md](./security.md)，回归覆盖见 [testing.md](./testing.md)。
