# OtterPatch

[English](./README.md) · **中文**

> 🦦 **O**ffice **T**ransforms · **T**racked · **E**dited & **R**eviewed · surgical **Patch** —— 由 Agent 驱动、可审阅的文档**安全提交层**。
> 圈选区域 → 说出诉求 → 审阅差异 → 高保真写回。
> （可以理解为:给你的 `.xlsx` / `.docx` / `.drawio` 开一个 PR。）

> ⚠️ 早期脚手架,正在积极开发中。

## 为什么

Agent 不该直接改你的文件。在 OtterPatch 里,Agent 只**提议**一份结构化的
`ChangeSet`;系统对它做影子校验(锚点落不了地就让模型当轮修复)、展示**可审阅的差异**
——工作区里是行内修订态,侧栏里是 git 风格 diff,逐条接受/拒绝——审阅通过后
**外科手术式**写回:只有被改动的部分变化,其余字节保持完全一致。

已在真实的 531 KB `.docx` 上验证:外科式写回保持 **31 个部件中 30 个字节不变**,
而模型整文重写会改写 31 个中的 11 个。详见 `packages/writeback-surgical`。

## 文档

文档在 [`docs/`](./docs/README.md)(中文 · English):
[架构](./docs/zh/architecture.md) · [Agent 循环](./docs/zh/agent.md) ·
[技能与打法手册](./docs/zh/skills.md) · [审阅体验](./docs/zh/review-ux.md) ·
[测试](./docs/zh/testing.md) · [能力基准](./docs/zh/bench.md)

## 结构

```text
packages/core/                与格式无关的抽象层
                              (Anchor / ChangeSet / Diff / Skill / Adapter / Registry / Transaction / Writeback)
packages/agent/               意图 → 受约束的 ChangeSet;BYOK,8 家模型
                              (Claude 原生 + OpenAI 兼容:DeepSeek/GLM/Kimi/豆包/MiniMax/Gemini/ChatGPT)
packages/skills/              技能中枢:SKILL.md 解析/匹配/渐进披露 + 内置能力卡片与领域打法手册
packages/adapter-univer/      Excel 适配器(Univer)—— ChangeSet → 工作表 XML 编译器
packages/adapter-drawio/      drawio 适配器 —— mxCell 操作引擎 + 图级外科式写回
packages/adapter-word/        Word 适配器 —— 词级红线(w:ins/w:del)+ 格式修订(rPrChange/pPrChange)外科写回
packages/adapter-pdf/         PDF 适配器 —— AcroForm 表单填写写回(pdf-lib)
packages/adapter-pptx/        PowerPoint 适配器 —— 幻灯片文本外科写回(<a:t>)
packages/writeback-surgical/  外科式 OOXML 写回 —— 已验证 + 有测试
packages/runtime/             headless 编排器:propose → diff → commit + JSON 事件流(含校验注册表)
apps/desktop/                 驾驶舱 UI(Vite + React + Electron):Excel/Word/流程图工作区 + 审阅栏 + BYOK
apps/mcp-server/              OtterPatch 作为 MCP server(stdio)+ headless CLI + otterpatch-serve 本地桥
```

`otterpatch-serve` 启动时会各显示一次自动生成的本地调用令牌和审阅令牌；`GET /health`
可匿名访问，所有 `POST` 必须携带 `X-OtterPatch-Token`，`POST /review` 还必须携带
`X-OtterPatch-Review-Token`。可通过 `OtterPatch_TOKEN`、`OtterPatch_REVIEW_TOKEN` 固定令牌，
通过 `OtterPatch_ALLOWED_ORIGINS` 配置逗号分隔的精确本机 Origin 白名单。

## 开发

```bash
npm install
npm run typecheck                  # 跨 packages/* 执行 tsc -b
npm run dev                        # 驾驶舱 UI → http://localhost:5173
npm run app -w @otterpatch/desktop       # 构建并启动 Electron 桌面窗口
npm test -w @otterpatch/core             # 适配器注册表
npm test -w @otterpatch/agent            # Agent 循环 / 取数工具 / 校验器(word+drawio)
npm test -w @otterpatch/skills           # 技能匹配 / 打法手册 / 渐进披露
npm test -w @otterpatch/runtime          # 编排器 / 校验注册表 / 收尾自检
npm test -w @otterpatch/adapter-univer   # 意图 → ChangeSet → 外科式 .xlsx 写回
npm test -w @otterpatch/adapter-word     # 词级红线 + 格式修订写回
npm test -w @otterpatch/adapter-drawio   # mxCell 操作 + 跨图外科式写回
npm test -w @otterpatch/writeback-surgical
```

## 状态

- [x] Monorepo 脚手架;core 抽象层 + 适配器注册表
- [x] 外科式 OOXML 写回(已验证 + 有测试)
- [x] Agent 回合:自然语言意图 → 受约束的 `ChangeSet`(BYOK,8 家模型)
- [x] drawio 适配器:mxCell 增/删/改属性/移动 + 图级外科式写回
- [x] headless runtime:按文档单写者队列 + 旧源拒绝 + 风险审批强制执行 + 写后 backend verify;MCP server + CLI(JSON 事件流,BYOK)
- [x] 版本化能力清单统一驱动模型操作暴露、runtime 门禁、写回支持、签名提案与 `/health`
- [x] HTTP/文档、OOXML 解压/XML 深度、ChangeSet/范围、工具/模型输出、超时与并发均有硬资源预算
- [x] Word 红线 / PDF 表单 / PPT 文本适配器 —— excel/word/pdf/ppt/drawio 全链路 propose→commit
- [x] 驾驶舱写回闭环(otterpatch-serve):载入文件 → SHA-256/revision 绑定的签名提案 → 逐条审阅 → 签名回执绑定接受子集 → 服务端重算摘要与 revision → 外科写回 → 下载
- [x] Word:Office 式六选项卡功能区 + **行内修订审阅**——逐条悬浮卡、四态视图(原文/修订/清样/改后)、flatten-on-accept(接受即物理定稿,零标记残留)
- [x] Agent 取数工具 —— Excel `read_range`/`aggregate`;Word `read_blocks`/`find_text`/`get_outline`/`get_style_usage`(全文快照,双模型通道)
- [x] 领域打法手册 + 渐进披露(`load_skill`):GB/T 9704 公文版式、财务表规范、图表选型
- [x] 影子校验注册表(Excel 重算 · Word 锚点可落地 · drawio 拓扑完整)+ 当轮修复 + 收尾语义自检;Anthropic 通道 prompt caching
- [x] 页面级版式操作(分栏/页边距/纸张方向,IEEE 双栏可直接做)+ 全文级改动 chip(真前后对比)
- [x] 分批续接(「继续下一批」+ 可选自动续批,串行重新锚定)+ 逐条接受率遥测 + 能力级 bench(`test/expert-bench.mjs`)
- [x] 三工作区统一审阅 UX(共享 **DiffToggle**):Excel 原文/对照/改后 三态 + 改动格着色、Word 四态含整段删除修订、drawio 逐条 hunk 审阅联动画板高亮;ReviewBox 单一交互面 + 未提交历史回合可重审
- [x] Word Agent 结构化操作——quote + 段号双通道锚定、`deletePara`、按段图片感知 + 图片删除/等比调宽;Excel 值×格式硬门槛进提示词
- [x] Word 外科写回闭环:全部接受 → `/commit` → `WordRedlineWriteback` 只重写 `word/document.xml`(词级红线、段落符删除修订、图片操作),其余部件字节透传 → 下载 `<名>.otterpatch.docx`;live eval 体系(`npm run eval:excel|word|word:struct|word:commit`,`OA_EVAL_KEY` 门控)

## 许可证

[Apache-2.0](./LICENSE)。
