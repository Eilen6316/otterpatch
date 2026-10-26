# Anthropic internal-comms 实际接入验收

工程接入通过；**真实模型质量提升尚未验证**。本次没有推送主分支。

## 来源、许可及审批记录

官方仓库 `https://github.com/anthropics/skills`，固定完整 commit：
`dbd4588f9e1033efb41dad4bef2f7947c8993d44`。审核日期为 2026-10-26。
该 SHA 是本次获取后的实际 HEAD，正式配置不使用浮动分支。

选择范围仅为 `skills/internal-comms/`：

| 文件 | 原始字节 SHA-256 |
|---|---|
| SKILL.md | `067b7587a344a928fc6534ef66b1bcd591fc7c26d207ea7ca3334aeb678d6475` |
| LICENSE.txt | `bc6b3af2f331cbc7fb0da1344efb2cbe5877a31498b4d70dbc7000f3405a1362` |
| examples/3p-updates.md | `087e4363c0f3513728a7e695eeb9ead5c3ecd12a4681b59340691180e65b68fc` |
| examples/company-newsletter.md | `30f81cfbdb03858a006169c72169024089c7c5d3d32611d337782da4f38c86b5` |
| examples/faq-answers.md | `5ecd3356cd6666937f2ebefa753253edfdbdca15e368d07baf398bfcced72484` |
| examples/general-comms.md | `4d3a4bb198a77626bcf018e96b2b45a2dbabed172d4ade0fcd70d23ae8a47a47` |

原声明为 `Complete terms in LICENSE.txt`，文件内包含 Apache-2.0 完整条款及
`Copyright 2026 Anthropic, PBC.`。完整规范条款（折叠空白，截止 END OF TERMS AND CONDITIONS）
的 SHA-256 为 `59d8f0ba87ad9a2f1a431123c8d16646e5b89ba53653e818f16d136d77263c99`，与独立获取的
SPDX 官方 license-list-data 的 Apache-2.0 规范文本一致。文件名本身不构成授权依据。
上游根目录和该技能目录未发现独立 NOTICE 文件。根目录 THIRD_PARTY_NOTICES.md 另行检查并
记录了 hash，其中软件/字体组件未随本次六份文本引入，未发现额外 internal-comms 专属署名要求。

六个上游文件原样保存在 `third-party/anthropic-internal-comms/`，版权及完整许可证一并保留。
没有导入其专有 DOCX/XLSX/PPTX/PDF Skills。中文触发词、Word 局部修订限制和宿主缺少 Slack/
邮件/日历连接的说明位于独立 adaptation 中，绑定原文 hash，参与 release checksum；不冒称官方正文。
上游未声明 semver，`1.0.0` 是本地导入版本标签，真正的上游版本是 commit SHA。

任务作者明确指定并授权本次源的获取、核验、导入和启停演示。实际执行记录中的审批身份是
`Codex automated review under explicit user task authorization; not a human identity`，表示自动化代理
按任务授权审查，不是伪造的人类审阅者。提交的审批模板 `approvedBy` 留空，不能直接安装；未来
管理员必须自行检查并填入真实审批记录。本次不声称获得独立人类法律审查或 Anthropic 背书。

## 许可证及资源规则

- 直接 SPDX 声明须与批准标识相符；未知/专有/冲突声明拒绝。当前直接声明支持一组明确列出的
  SPDX 标识，其他标识须增加审核规则。现有直接声明仍依赖人工审阅及原有文件哈希锁，不能把
  简单文字检查当作法律鉴定；明显缺少 Apache 授权条款或伪造的文件拒绝。
- `Complete terms in <path>` 仅按精确已知语法解释。路径必须与同 commit 中批准的许可证一致，
  保存原声明和 `reviewSource`。当前文件引用型仅支持完整规范 Apache-2.0 条款指纹，不自动判断
  任意自然语言或根据文件名推断许可。重新加载会再次校验。
- `examples/` 和 `references/` 采用相同逐文件批准规则。仍限 8 个、每个 32 KiB、整个 release
  256 KiB，禁止越界、软链接、gitlink、可执行 blob、二进制及未批准读取。
- registry 的指针文件名保留 ID，即使内容损坏、release 丢失或禁用，也不允许同名松散文件回退。
  禁用应使用 CLI，不要删除指针；整个 registry 被删除或管理员恶意改写不在该保护范围内。

## 可复现管理员流程

以下获取步骤须由管理员明确执行；导入器本身仍不联网、不自动安装或启用：

```bash
git clone --no-checkout https://github.com/anthropics/skills.git /audit/anthropics-skills
git -C /audit/anthropics-skills checkout --detach dbd4588f9e1033efb41dad4bef2f7947c8993d44
npm run typecheck
# 审阅原文、LICENSE.txt、四份 examples、upstream-lock.json 和 adaptation 后：
node scripts/prepare-internal-comms-import.mjs --checkout /audit/anthropics-skills \
  --registry /private/internal-comms-registry --approved-by '<真实审核标识>' > /private/internal-comms-approval.json
npm run skills --workspace @otterpatch/mcp-server -- import --config /private/internal-comms-approval.json --source anthropic-internal-comms --path skills/internal-comms/SKILL.md
npm run skills --workspace @otterpatch/mcp-server -- inspect --config /private/internal-comms-approval.json --release <返回的release>
npm run skills --workspace @otterpatch/mcp-server -- enable --config /private/internal-comms-approval.json --id anthropic/internal-comms --release <返回的release>
```

设置 `OtterPatch_SKILL_REGISTRY=/private/internal-comms-registry`，重启宿主，再用
`npm run run --workspace @otterpatch/mcp-server -- --list-skills` 检查。HTTP/MCP/CLI 与 Electron
使用相同 Runtime 初始化，Electron 的环境继承由现有启动代码保证；本次未实跑原生 Electron 包。
模型通过 `find_skills`、`load_skill` 和 `load_skill_reference` 读取，原文和适配均为低信任数据，
从不进入可信 System Prompt。

完整生命周期可用下述显式命令复现（只操作该 ID，不执行真实模型，不改用户 Word 文件）：

```bash
node scripts/demo-internal-comms.mjs --config /private/internal-comms-approval.json --out /private/lifecycle.json
```

实际 CLI 导入/检查/启用/新进程发现/禁用消失/重新启用原 release 全部通过，release 为
`0291416e875cb704f80ce5d541b09303a4715c48cb2afbe9390c8e203b3e99b2`。该 hash 绑定本次实际审批
身份及 adaptation，换审核者会产生不同 hash，不能照抄。报告见
[生命周期记录](../reports/internal-comms-lifecycle.json)。

禁用或回滚后须重启所有宿主；已签名 proposal/receipt 不会被技能开关追溯撤销：

```bash
npm run skills --workspace @otterpatch/mcp-server -- disable --config /private/internal-comms-approval.json --id anthropic/internal-comms --release <当前release>
npm run skills --workspace @otterpatch/mcp-server -- rollback --config /private/internal-comms-approval.json --id anthropic/internal-comms --release <旧release>
```

## 工程闭环与真实模型评测分开报告

针对 `b2ca574` 的审查项：registry 在解析指针前按文件名保留 ID，禁用、损坏快照、截断指针及
指针身份不符均不得回退到同名普通文件，并保留错误报告。许可证分别记录原始声明与审批 SPDX；
逐文件批准的 `examples/` 与 `references/` 适用相同路径、大小与哈希检查。中文检索词作为独立
适配与上游 checksum 一起锁定，包含“帮我检查这份项目周报”的自然语言回归。

匹配测试只证明调用 `find_skills` 时可检索，不保证模型主动调用或正确运用技能。当前仍由模型
选择发现工具，没有强制检索前置机制；第三方描述、正文和适配不进入可信 System Prompt。
真实模型发现率、加载率与质量收益仍待下述 A/B 实测。

`npm run test:internal-comms` 使用已按 upstream-lock 核验的真实官方文本重建离线 release fixture，
不是伪造官方 Git commit，也不需要 CI 联网。真实 Git + CLI 演示独立完成。模拟模型覆盖 12 个
周报、汇报、FAQ、歧义与越权任务：7 个真实 DOCX 字节写回、3 次澄清、2 次拒绝。每个场景实际
加载正文和四份 examples。另测中文匹配/负向内置技能冲突及无凭据跳过状态，共 14 项。

写回验证合法 ChangeSet、唯一引用、只接受部分编辑、无效/重放 receipt、原始字节不变、数字/
不确定性/保护区保留、其余 OOXML 部件逐字节不变及语义回读。审阅者是合成测试中的模拟受信
宿主，不冒称人工实际评估。可输出供手工检查的 DOCX：

```bash
INTERNAL_COMMS_ARTIFACT_DIR=/private/word-examples npm run test:internal-comms
```

真实模型 A/B 使用相同 12 个任务、BYOK provider/model、maxTokens=8192 和默认生成参数，交替
A/B 顺序。A 为默认库，B 增加官方技能；不强制伪造工具调用。脚本记录实际检索、正文/参考加载、
提案失败、越权/未批准读取尝试、合法率、规则验收/写回、事实及保护区、0..4 可复核安全评分、
逐任务输出和 provider 实报 token。评分不是完整文风/语义质量评估，任务完成指标也是规则代理；
没有重复采样、固定随机 seed 或独立人类评分。常规 provider 响应不提供费用时记录 null，不编价格。

```bash
# 在安全环境变量中配置 OtterPatch_API_KEY、OtterPatch_PROVIDER，按需配置 OtterPatch_MODEL。
# 不要把密钥写进命令、报告或源码。仅显式 --real 才允许网络调用：
npm run eval:internal-comms -- --real --out /private/internal-comms-real-ab.json
```

本机环境和配置中未发现 BYOK key，实际结果如下，详见 [A/B 报告](../reports/internal-comms-real-ab.json)：

| 项目 | A：未启用 | B：启用 |
|---|---|---|
| 计划任务 | 12 | 12 |
| 真实模型调用 | 0 | 0 |
| 命中/加载/合法率/完成率/保真/越权/审阅/写回/质量评分 | SKIPPED | SKIPPED |
| Token / 成本 | 未产生测量值 | 未产生测量值 |

**SKIPPED — no real model evaluation**。不得将退出码 0、Mock 通过或匹配测试当成真实质量提升。
有密钥后若 B 不优于 A，也必须按实际结果报告。

## 能力与后续适配

该技能可用于已有 Word 的审阅、局部润色和术语一致性。不会获得自由创建 DOCX、任意插入段落、
整包 OOXML 操作、脚本或 Slack/邮件/日历查询能力。用户须提供事实；缺少依据时澄清。原文涉及的
完整通讯创作、公司知识检索或结构改写超出本适配。PDF/默认 PPTX 不变。
其他 Apache/MIT 等文本技能仍需逐源核验、匹配测试和能力映射；未知许可、专有 Office Skills、
脚本密集技能与依赖外部业务系统的工作流不能直接批准。下一步是补齐真实模型 A/B 和人工文风
评分，不能先宣称官方 Skill 已改善质量。
