# 技能与打法手册

`packages/skills` 提供领域做法，但不授予修改权限。格式 capability manifest 始终是硬边界；
技能可以收窄或改善工作流，不能新增操作。

## 内置目录

默认库包含两类不可变内置内容：

| 类型 | 用途 | System prompt 暴露内容 |
|---|---|---|
| 能力卡 | `xlsx`、`docx`、`pptx`、`pdf`、`drawio` 的简要格式能力说明 | 仅可信且有 checksum 的元数据：ID、version、checksum、locale、description、兼容操作 |
| Playbook | 任务专用检查清单和操作惯用法 | 只暴露可信 L0 元数据；完整正文按需以不可信工具数据加载 |

当前 7 份 playbook：

| Playbook | 范围 |
|---|---|
| `docx-gongwen` | 在当前有锚点 Word 格式能力内落实 GB/T 9704 公文规范 |
| `docx-conventions` | 通用 Word 字体、层级、间距和一致性检查 |
| `docx-coauthoring` | 协同写作的串行提纲、起草与审阅工作流 |
| `xlsx-financial` | 勾稽关系、公式、金额/百分比格式和先读后写检查 |
| `xlsx-authoring` | 当前单元格操作范围内的表格建模与呈现规则 |
| `chart-selection` | 图表选择建议；因图表写回不支持，`allowed_ops` 为空 |
| `pptx-design` | 演示设计建议，以及当前单 run 文本替换边界 |

源文件位于 `packages/skills/skills/<name>/SKILL.md`。构建期生成器产出
`packages/skills/src/playbooks.generated.ts`；运行时 import 不执行文件系统 I/O。

```bash
npm run generate:playbooks --workspace @otterpatch/skills
```

Skills 包会在 build/test 前自动运行生成器。应修改 `SKILL.md` 源文件，不直接编辑生成的
TypeScript。

## 匹配与渐进披露

卡片包含 namespace、version、locale、formats、trigger/keyword、`allowed_ops`、checksum、
trust level 和可选正文。匹配依次考虑：

1. 精确 namespaced 引用；
2. 有边界的 trigger/keyword 信号；
3. 格式与 locale 兼容性；
4. `allowed_ops` 与当前格式 write-back 操作的交集；
5. 按信号特异度、trust、version 和 ID 确定性打破平局。

只有 `promptBundle()` 选出的不可变内置项能进入 system prompt。需要更多做法时，模型可以调用：

- `find_skills(query)`：以 `untrusted_data` 返回有界目录；
- `load_skill(namespace/name)`：解析与当前 capability 兼容的正文，并以 `untrusted_data` 返回。

加载过的技能 ID/version/checksum 会写入 Agent provenance。正文始终只是参考数据，不能覆盖策略、
工具权限、审阅要求或能力门禁。

## 外部技能

宿主可以在运行时安装外部文本 playbook：

```ts
library.install(skillMdText, 'file:./skills/my-company-report/SKILL.md');
```

外部技能有意保持低信任：

- 默认使用 `user` namespace，不能占用保留的 `otterpatch` namespace；
- 不能声明 built-in trust/immutability，也不能替换不可变内置技能；
- description 永远不进入 system prompt；
- 目录元数据和正文只通过不可信工具结果返回；
- discovery/load 前将 `allowed_ops` 与当前 capability manifest 取交集；
- 默认 conflict policy 会拒绝同 ID、不同 checksum 的安装；宿主若显式允许替换，也必须提供
  严格更新的 version；
- frontmatter、文本大小、数组、ID、version、locale 和 checksum 形状在安装前均被校验并限额；
- 不启用可执行 L2 script。

纯建议技能可以使用 `allowed_ops: []`。当图表选型等专业建议没有对应写回操作时，这是正确表达。

## 编写规则

- 先写模型在修改前必须收集的观测项。
- 明确当前支持的操作与 scope。不能把尚不支持的结构、图表、母版或全文格式编辑写成可提交能力。
- 使用稳定唯一锚点：A1 范围、受 block number 约束的原文 quote，或 object ID。
- 编辑会影响后续锚点时，明确串行顺序。
- 写出反模式与失败关闭行为。
- 元数据保持 versioned 和 locale-specific；行为变化时提升 version。
- 修改后运行 `npm test --workspace @otterpatch/skills`。测试会确保所有内置技能都有 checksum、
  namespace、能力边界，并不包含陈旧操作声明。
