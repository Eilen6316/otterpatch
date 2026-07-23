# 安全模型

本文描述当前代码已经强制执行的边界，以及仍由嵌入宿主承担的职责。它不表示一个 `0.0.1`
开发预览版适用于所有生产环境。

## 资产与攻击面

OtterPatch 保护源文档字节、审阅决定、Provider 凭据和写入修改后文件的权限。以下输入均按
潜在恶意处理：文档文本/XML/ZIP、外部技能文件、模型输出、MCP/HTTP payload、renderer IPC
和 Provider 响应。

设计假设本机应用代码与 runtime 进程可信且未被攻破。它不防御已经控制该进程、用户操作系统
账户或嵌入宿主审阅权限的攻击者。

## 已执行的控制

### Prompt 与技能隔离

- 请求专属文档内容是 user data，绝不进入 system text。
- System prompt 只包含固定策略、当前能力约束和不可变内置技能元数据。
- 外部 `SKILL.md` description 不能进入 system prompt，也不能占用保留的 `otterpatch`
  namespace；正文只以 `untrusted_data` 工具结果返回。
- 技能匹配/加载会将 `allowed_ops` 与当前格式 manifest 取交集；技能不能授予后端不支持的操作。
- 不启用可执行的 L2 技能脚本。

### Agent 身份与 provenance

- Agent ChangeSet ID 使用单调的 RFC 9562 UUIDv7。
- 可信请求代码记录 Provider、模型、Provider 响应 ID、提示策略版本、源 SHA-256、父 proposal、
  修复次数、技能版本/checksum、session、user 和 document identity。
- `assertChangeSet` 会拒绝不完整 provenance、占位 `mock` session、畸形 hash、重复 edit ID、
  非法操作 payload 和资源超限。
- Proposal 签名会交叉校验 Agent actor/source 绑定，不信任模型输出。

### 审阅权限

- Proposal 和 receipt 使用域分离的 HMAC-SHA256 对规范化 JSON 签名。
- Proposal/receipt TTL 默认 30 分钟。
- Receipt 绑定精确 proposal、ChangeSet hash、源 SHA-256、accepted edit ID、reviewer session、
  policy version 和 nonce。
- Runtime 拒绝 receipt 重放、成功 commit 后的旧源重放、陈旧策略/能力版本、被改动的文件、
  ChangeSet 或接受子集。
- 未审阅 commit 默认关闭。MCP 开关 `OTTERPATCH_ALLOW_UNREVIEWED_COMMIT=1` 有意被视为高风险；
  即便开启，仍要求明确 edit ID 和实时 revision。

### Runtime 与写回

- 能力和语义校验在审阅前以及 write-back 前各执行一次。
- 范围感知风险策略由 runtime 强制执行，而不只是 UI 展示。
- 同一 `[documentId, format]` 的 commit 串行执行。
- 只有后端开始执行前才允许选择 fallback。
- 输出验证是强制步骤，分别报告包有效性、局部性、逐 edit 语义状态和兼容性警告；未知语义
  状态必须是 `unverifiable`，不能静默写成 `verified`。
- 事件 listener 与 commit 主路径隔离。

### 资源与 Provider 控制

- HTTP body、解码文档、ZIP entry 数量/大小/压缩比/总展开量、XML 深度、ChangeSet
  大小/深度/节点/字符串、A1 面积、工具结果、context/history、模型输出、总耗时和并发均有硬上限。
- Provider 调用使用显式 timeout、有界重试/退避、熔断、稳定错误分类和端到端取消。响应流一旦
  开始输出就不会被重放。
- 公共流只暴露有界状态和最终答案，不暴露原始 reasoning/thinking delta。

### 本机 HTTP 与 Electron

- `otterpatch-serve` 只绑定 `127.0.0.1`。
- 每个 `POST` 都需要自动生成或显式配置的本机令牌；`/review` 另需独立审阅令牌。令牌比较
  使用 timing-safe 方式，错误消息会抹去已知 secret。
- CORS 只接受精确配置的 loopback Origin。通配符、远程 Origin 和畸形 Origin 均被拒绝；
  POST 在开始工作前还受速率和并发门禁。
- 浏览器开发模式由用户显式填写两个本机令牌，保存在该本机开发 Origin 的 storage。
- Electron 的令牌只存在主进程。Renderer 开启 `contextIsolation` 和 sandbox、关闭 Node
  integration；preload 只暴露有 schema/大小限制的窄 IPC，不暴露凭据或通用鉴权 fetch。

## 当前限制

- Review secret、nonce 防重放状态和已提交源状态都是进程内状态。生产级多进程部署需要共享
  authority 与持久化 replay/audit store。
- Runtime 只返回字节；宿主负责原子文件替换、备份、访问控制和长期审计保存。
- OtterPatch 会拒绝陈旧 proposal，不会自动把 edit rebase 到已变化的文件。
- Excel、Word、PPTX 当前能做包和局部性验证，但写回后会保守地把已应用 edit 标为语义
  不可验证；PDF 验证也明确不完整。
- Stock MCP stdio server 没有签发 review receipt 的工具。默认已审阅 commit 需要共享 runtime
  review authority 的进程内嵌入；当前内置完整审阅路径是 HTTP/Electron。
  `OTTERPATCH_ALLOW_UNREVIEWED_COMMIT=1` 会削弱该边界。
- OOXML 校验是有资源上限的结构/包校验，不是完整的 Microsoft Office 或 ISO conformance 证明。
- 浏览器开发路径将本机服务令牌保存在 localStorage。需要 renderer 隔离时使用 Electron 路径。
- Provider API Key 会经本机服务发送给所选 Provider。请保护本机，并使用最小权限、可撤销的 key。

## 报告问题

Issue、日志、fixture 或截图中不要包含真实文档、Provider Key、本机服务令牌或审阅令牌。
任何已经粘贴到聊天或终端记录中的凭据都应立即撤销。
