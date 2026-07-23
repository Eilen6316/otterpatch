# Agent 循环

模型可以分析文档，但只有可信代码能决定哪些操作存在、提案是否有效，以及内容是否允许提交。

## 三个出口

每个对话回合必须通过且只通过一个工具结束：

- `answer_user`：回答或分析，不修改文档；
- `ask_user`：猜错代价高时，给出小型引导选择；
- `propose_changeset`：唯一变更出口。返回计划和结构化操作，绝不返回原始 OOXML/XML 或
  直接文件系统命令。

各 Provider 通道共享同一套 dialect、只读工具、预算记账、提案验证器和修复协议。若模型只给
散文而未调用工具，系统只催收一次对应工具；仍无法产出可用结果时明确失败。

## Prompt 边界

固定策略、当前能力约束和不可变内置技能元数据属于可信 system text。请求专属文档内容编码在
user message 中：

```json
{"untrusted_data":true,"kind":"document_context","content":"..."}
```

因此文档里的“忽略之前规则”等文字始终只是数据。完整快照只对有界只读工具可见；外部技能正文
同样以不可信工具数据返回。详见 [security.md](./security.md)。

## 独立预算与传输控制

默认循环上限：

| 预算 | 上限 |
|---|---:|
| 模型调用总数 | 12 |
| 只读工具调用 | 8 |
| 提案修复 | 由调用方设置，最高 4 |
| 截断修复 | 1 |
| 累计输出 | 65,536 token |
| 总耗时 | 120 秒 |

各计数器不能互相借用。Provider 单次输出还受 16,384 token 和 300,000 字符上限约束。

每次 Provider 尝试取 90 秒 timeout 与剩余回合预算中的较小值，并关闭 SDK 自带重试。符合条件的
网络错误、timeout、409、429 和 5xx 最多进行两次受控重试，使用带抖动的指数退避；
`Retry-After` 最多遵守到 60 秒。连续失败会打开 Provider/模型熔断，之后只允许一次半开探测。
错误统一为稳定分类：`authentication`、`permission`、`invalid_request`、`rate_limit`、
`timeout`、`network`、`unavailable`、`aborted`。

同一个 `AbortSignal` 从 UI 取消或 HTTP 断连贯穿 runtime、Provider 请求和重试等待。响应流一旦
产出内容就不会被重放。原始 Provider reasoning/thinking delta 不会暴露；调用者只收到系统生成的
有界状态事件和最终答案数据。

## 只读工具

| 格式 | 工具 | 用途 |
|---|---|---|
| Excel | `read_range` | 读取有界 A1 区域的精确类型值 |
| Excel | `aggregate` | 带显式 `headerRows`、`groupBy` 和 `where` 的类型安全聚合 |
| Word | `read_blocks` | 读取有界块范围的完整文本 |
| Word | `find_text` | 返回所有出现位置与块号，用于唯一性检查 |
| Word | `get_outline` | 标题树与层级跳级诊断 |
| Word | `get_style_usage` | 样式/字体/字号/对齐分布 |
| 任意 | `load_skill` | 以不可信工具数据加载与当前能力兼容的 playbook |

表格单元格保留宿主观测的数值、百分比、货币、日期、文本、空值、错误和布尔类型。聚合绝不会
把 `"50%"` 等显示字符串转换成数字。Word 快照保留块边界和图片元数据。工具结果大小和源范围
在执行前均受预算限制。

## 能力驱动的提案构造

每种格式 dialect 都围绕 runtime 使用的同一份版本化 manifest 构建。只有当前同时支持 propose
和 write-back 的操作才进入模型 schema。Dialect builder 随后创建锚点/操作、附加可信 provenance，
并立即执行 `assertChangeSet`。

Agent provenance 包括 Provider/模型身份、真实 Provider 响应 ID、源 hash、提示策略版本、父
proposal、修复次数、已加载技能版本/checksum、session、user 和 document identity。ChangeSet ID
使用单调 UUIDv7。修复回合保留相同可信绑定，同时记录新的响应身份和 attempt 序号。

## 提案检查与修复

选中的 `HostAdapter` 提供它当前能支持的最强确定性提案验证器：

| 格式 | 当前提案检查 |
|---|---|
| Excel | 将受支持范围展开到隔离 grid shadow，应用值/公式/样式/清空，再重算已支持公式子集；未知函数、循环、观测不完整、冲突和快照越界均失败关闭 |
| Word | 要求真实唯一 quote，或结构化快照中有效的段号锚点；两者同时存在时，段号约束 quote |
| drawio | 重放画板编辑，拒绝重复 ID、缺失 parent、parent 循环、自引用和悬空边 |
| PowerPoint | 按精确 slide、paragraph、run 边界解析文本；缺失、重复或跨 run 目标均失败 |
| PDF | 只有能力/payload 校验；不宣称存在面向模型的语义提案验证器 |

确定性失败会在同一回合以结构化 code/report 返回模型。Runtime 内置路径最多允许两次提案修复。

当 ChangeSet 至少包含五个 edit 时，`withFinalModelReview` 会在确定性检查通过后请求一次整体模型
复盘。它明确标为非确定性的 `model_review`，可以改善完整性，但不是 semantic verification，
也绝不替代后端输出回读。

## Word 操作细节

- Flow anchor 可以组合原文 quote 与从 1 开始的顶层 block index。顶层 table 算一个 block，
  表内段落不单独计数；这与 importer/writer 镜像一致。
- 整段删除以可审阅 delete 操作表达，并按 block 降序落地，避免索引漂移。
- 图片操作当前支持删除 image run，或按比例修改 `wp:extent`/`a:ext`。
- 局部字符样式必须有非空 quote；段落样式必须有段号锚。页面分栏、边距、方向必须使用空的
  文档级 anchor 和显式 document scope。不支持无锚点的全文字符/段落样式。
- 插表使用有界、规则的二维字符串数据和明确文档位置。

## 技能、分批与历史

内置 playbook 按格式、意图、locale 与当前操作能力匹配，其版本和 checksum 会进入 provenance。
外部技能不能进入可信 system text，也不能扩展能力。详见 [skills.md](./skills.md)。

大任务拆成串行批次。每个已接受批次都会基于当前文档状态发起新请求；自动续批需主动开启，
最多连续五批。并行读取是安全的，但并行写者会针对陈旧 revision 解析锚点。

对话历史保存“接受/拒绝了哪些 edit”等压缩净结果，而不是瞬态 UI 状态。这样下一轮能避免重复
提议已落地工作，同时保持在固定 history 预算内。

Anthropic 只缓存稳定 system block。请求专属文档数据仍留在 user message，不会为缓存效率跨越
信任边界。
