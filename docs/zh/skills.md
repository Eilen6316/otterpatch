# 技能与打法手册

`packages/skills` 提供领域做法，但不授予修改权限。格式 capability manifest 始终是硬边界；
技能可以收窄或改善工作流，不能新增操作。

## 内置目录

默认库包含两类不可变内置内容：

| 类型 | 用途 | System prompt 暴露内容 |
|---|---|---|
| 能力卡 | 默认 `xlsx`、`docx`、`drawio` 支持的简要格式能力说明 | 仅可信且有 checksum 的元数据：ID、version、checksum、locale、description、兼容操作 |
| Playbook | 任务专用检查清单和操作惯用法 | 只暴露可信 L0 元数据；完整正文按需以不可信工具数据加载 |

默认加载 6 份 playbook：

| Playbook | 范围 |
|---|---|
| `docx-gongwen` | 在当前有锚点 Word 格式能力内落实 GB/T 9704 公文规范 |
| `docx-conventions` | 通用 Word 字体、层级、间距和一致性检查 |
| `docx-coauthoring` | 协同写作的串行提纲、起草与审阅工作流 |
| `xlsx-financial` | 勾稽关系、公式、金额/百分比格式和先读后写检查 |
| `xlsx-authoring` | 当前单元格操作范围内的表格建模与呈现规则 |
| `chart-selection` | 图表选择建议；因图表写回不支持，`allowed_ops` 为空 |

生成器仍保留第 7 份源 `pptx-design` 和 PPTX 能力卡，但它们只通过 `PPTX_OPT_IN_SKILLS`
导出给显式启用冻结 Adapter 的宿主，不进入 `defaultLibrary()`、MCP 技能列表或 stock Agent
prompt。PDF 不再保留任何技能元数据。

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

## 受控导入标准 Agent Skills

YAML 兼容层支持引号、多行描述、列表和嵌套元数据，拒绝重复键、alias、未知 tag、原型污染键及
超限内容；旧技能中的数值关键词 `9704` 仍按字符串匹配。元数据与正文始终是不可信数据。
`allowed_ops` 只是兼容限制，不能授予模型权限。

`importAllowedSkill` 是独立的**离线管理员操作**，不会 clone/fetch、安装依赖、执行仓库代码或运行
`npx skills add`。人工审核的 `SkillImportConfig` 必须包含私有 registry、来源 allowlist、本地 checkout、
GitHub `owner/repository`、完整 40 位 commit SHA、选定 `SKILL.md` 路径/hash、namespace/版本/格式/
操作限制、`mode: "text-only"`、`approvedBy`，以及许可证标识/文件/hash 和逐个批准的 references。
hash 格式为 `sha256:<64 位小写十六进制>`；快照保存原文、元数据、许可证全文和来源信息。

导入器核对 GitHub HTTPS/SCP 风格 SSH origin，禁用 lazy fetch，从固定 Git 对象读取，忽略工作区
未提交修改。Git 必须支持 `--no-lazy-fetch`（本次验证版本 2.52）。origin 配置不证明作者身份或许可，
管理员须单独核实。拒绝 gitlink、可执行 blob、符号链接、路径穿越、Windows/绝对路径、控制字符、
非法 UTF-8 和二进制 NUL。SKILL/许可证各限 128 KiB，references 最多 8 个，只允许 `.md`/`.txt`，
每个 32 KiB，整个序列化快照限 256 KiB；不会跟随链接下载内容。

所有批准格式必须属于 capability manifest 的默认活动格式；PDF 和默认 PPTX 保持关闭。
不支持的操作、与原文声明冲突的格式/操作映射、工具权限、脚本、hook、依赖及运行时要求均拒绝，
不会悄悄删掉要求来“兼容”。无法安全适配时须独立重写并重新批准；人工也必须检查正文，解析器
无法自动证明任意自然语言的语义安全。未解释的元数据只保留为惰性数据，不作为授权。

### 独立创作试点与管理员流程

`examples/agent-skills/` 提供 Excel 数据质量审阅、Word 技术文档规范检查及各自清单，均独立创作，
按项目 Apache-2.0 许可证提供。没有复用专有 Office Skills 或许可未核实的插件正文，来源清单见
[THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md)。

先确保这些文件已包含在审核过的 commit 中，再生成供人工审阅的配置；该命令只输出配置，不安装：

```bash
npm run typecheck
node scripts/prepare-pilot-import.mjs --checkout /absolute/otterpatch \
  --revision <完整commit-SHA> --registry /private/skill-registry \
  --approved-by <审核者标识> > /private/skill-import.json
```

检查来源、许可证、操作范围和参考文件后，逐个导入，检查返回的 release hash，再显式启用：

```bash
npm run skills --workspace @otterpatch/mcp-server -- import --config /private/skill-import.json --source otterpatch-pilots --path examples/agent-skills/excel-data-quality/SKILL.md
npm run skills --workspace @otterpatch/mcp-server -- inspect --config /private/skill-import.json --release <release-hash>
npm run skills --workspace @otterpatch/mcp-server -- enable --config /private/skill-import.json --id pilot/excel-data-quality --release <release-hash>
```

如批准 Word 试点，明确对 `word-technical-review` 重复上述流程。导入不改变已有启用指针，新版本
不会自动启用。设置 `OtterPatch_SKILL_REGISTRY=/private/skill-registry` 并重启宿主。Runtime、HTTP、
MCP、CLI 统一走 `skillLibraryFromEnv`；Electron 启动 HTTP 服务时继承该环境。显式传入 Runtime
library 时仍优先使用它。旧 `OtterPatch_SKILLS_DIR` 保持本地创作/蒸馏兼容，不是第三方导入审批路径，
加载时不会把 `references/` 或 `scripts/` 当作独立技能。已批准的锁定技能优先于同 ID 的松散外部
文件，冲突会报告；CLI 可用 `--list-skills` 无密钥查看目录。仅删除 allowlist 条目不撤销已导入
版本，须禁用该版本并重启宿主。

启用技能仅进入不可信发现目录，不进入可信 System Prompt。`load_skill` 返回正文与批准参考索引，
可选的 `load_skill_reference(name,path)` 只返回精确批准的内存快照，标记 `untrusted_data`，不提供
文件系统或网络寻址。bundle checksum 写入 Agent provenance。模型、HTTP、MCP 都没有导入或
启用接口；Proposal、ReviewReceipt、Commit 和写后验证规则不受技能内容改变。

### 禁用、回滚与边界

```bash
npm run skills --workspace @otterpatch/mcp-server -- disable --config /private/skill-import.json --id pilot/excel-data-quality --release <当前release-hash>
npm run skills --workspace @otterpatch/mcp-server -- rollback --config /private/skill-import.json --id pilot/excel-data-quality --release <旧release-hash>
```

每次改变启用状态后须重启**全部宿主**，已有 library 是快照。旧版本保留供显式回滚，加载时重新
校验 checksum、ID、许可和当前 capability；禁用指导内容不会撤销已经签名审阅的 proposal。
配置和 registry 必须私有、备份，管理员操作须串行执行。指针原子替换，但未实现多管理员 CAS、
分布式存储、远程自动更新或垃圾回收。损坏快照/指针会被报告并跳过，不自动修复或提升信任等级。

Runtime 的确定性试点回归用模拟模型对比启用前后：6 个简繁中文查询中，目标试点首位命中从
0/6 到 6/6；实际加载正文和参考，记录 provenance，生成合法 ChangeSet，验证必须人工审阅、
签名/重放拒绝以及 XLSX/DOCX 真实写回回读。Excel mock 读取清单后把建议格式从 `0` 改为 `0.00`，
Word 保持用户要求的术语替换并记录清单加载。这证明接入链路，不代表真实模型质量提升；真实
Provider 评测和原生平台打包启动须单独验证。`npm run test:skill-surfaces` 另行启动真实 HTTP、
MCP、CLI，检查批准 registry 的发现与禁用；CI 在构建后执行。

## 编写规则

- 先写模型在修改前必须收集的观测项。
- 明确当前支持的操作与 scope。不能把尚不支持的结构、图表、母版或全文格式编辑写成可提交能力。
- 使用稳定唯一锚点：A1 范围、受 block number 约束的原文 quote，或 object ID。
- 编辑会影响后续锚点时，明确串行顺序。
- 写出反模式与失败关闭行为。
- 元数据保持 versioned 和 locale-specific；行为变化时提升 version。
- 修改后运行 `npm test --workspace @otterpatch/skills`。测试会确保所有内置技能都有 checksum、
  namespace、能力边界，并不包含陈旧操作声明；同时验证冻结的 PPTX 元数据不会泄漏进默认库。
