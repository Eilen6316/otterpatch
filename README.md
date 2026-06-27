# 智能体工作台 — 开发上手说明(README)

> 给接手开发的 Claude Code / 工程师。本仓库目前是**设计阶段产物**,目标是开始构建 MVP。
> 通用 Office 办公套件的 Agent 自动化平台 · 开源 · Apache-2.0。

## 这是什么

左侧渲染 Office 文档(先 Excel/Word),用户用**鼠标圈选区域 + 自然语言**表达意图,Agent 据此修改;改动以**可审阅 diff**(逐块接受/拒绝/回滚)落地。让任何人(含新手)用自然语言"完美驱动"Office,让办公自动化"想法成真"。

**技术身份**:面向真实 Office 文件的**可审阅安全执行层**——Agent 不直接改文件,只提交结构化修改建议,经校验/影子/diff/人审/rebase/高保真写回才落盘(**像给 Office 文件提 PR**)。**首发杀手用例:Excel 财务/运营表清洗与校验。**

## 先读这三份(按顺序)

1. **`design.md`** — 总纲:定位、战略、底座选型、交互、路线图、风险、待拍板。
2. **`abstraction-layer.md`** — 核心 IP 的完整 TS 接口规格(语义锚点 / ChangeSet / Diff / 技能 / 适配器契约 / 并发事务 / 写回保真)。**MVP 范围 = 其 §9;临时待定项 = 其 §10。**
3. **`kill-experiments.md`** — 动工前的排雷实验(含已跑出的首个真实文件结果)。

## 已锁定决策(不要推翻,除非实验证伪)

- **全开源 · 不付费**;许可 **Apache-2.0**(不得引入 AGPL 组件:OnlyOffice/PPTist/Collabora 编辑器)。
- **推理 = BYOK + 本地模型**(项目零推理成本)。
- **首发 Excel + Word**:Excel=**Univer**(Apache);Word=**ProseMirror/TipTap**(MIT,做编辑+影子+抗漂移)。
- **高保真 = LibreOffice headless 子进程 + 外科 OOXML 补丁**(均许可中立/安全)。
- **部署 = 本地优先桌面应用(Electron,msi/exe/dmg)为主 + 可选自托管 Web**(同一套 Node 后端);**不做托管 SaaS**。
- **UI 克制不花哨、功能齐全**,参考 Next AI Draw.io;左编辑器 + 右 Agent 驾驶舱;**i18n 中英双语**。

## 已验证的实测数据点

杀手实验一(Word 写回保真,真实 531KB `.docx`,见 `experiments/exp1_surgical_test.py`):
- **外科补丁:30/31 部件字节级不变**(只改目标 `document.xml`);
- **模型往返(python-docx 零编辑)却重写 11/31 部件**。
- → **写回必须走外科补丁,不能走模型往返。** 与 `abstraction-layer.md` 主写回后端一致。

## 从哪开始(建议顺序)

1. 搭 monorepo:`packages/core`(抽象层接口,照 `abstraction-layer.md`)、`packages/adapter-univer`(Excel)、`packages/adapter-word`(ProseMirror)、`packages/writeback`(surgical-ooxml + libreoffice)、`apps/desktop`(Electron)。
2. 先实现 `abstraction-layer.md §9` 最小子集,**Excel/Univer 闭环优先**(圈选→意图→计划→diff→接受/回滚),Word 第二。
3. **EditOp DSL 暂用 §9 子集,但标记为临时**——等 `kill-experiments.md` 实验二的真实指令清单回来再定死(见 `abstraction-layer.md §10`)。
4. 早跑 `kill-experiments.md`(尤其保真 + 意图覆盖),用数据回填 §10。

## 红线(别犯)

- 别把 EditOp DSL 写死(它待实验定);
- 别用模型往返做写回(已被实测否定);
- 别引入 AGPL 组件(破坏 Apache-2.0);
- 并发不可降级为"最后写赢"(`abstraction-layer.md §6`);
- markup 圈选层自建覆盖层,不依赖底座内置。

## 待拍板(见 `design.md §15`)

新手模型接入(本地一键包 / 部署式 / 向导)· 中国 vs 海外(模型与合规)。

---

## 开发与运行(脚手架)

monorepo(npm workspaces + TypeScript 项目引用):

```text
packages/core/               # 格式无关抽象层(核心 IP):Anchor/ChangeSet/Diff/Skill/Adapter/Transaction/Writeback —— 真实 TS
packages/adapter-univer/     # Excel 适配器(桩,含落地映射注释)
packages/writeback-surgical/ # 外科 OOXML 写回(桩,算法已实测)
apps/desktop/                # 渐进披露驾驶舱 UI(Vite + React;后续套 Electron)
experiments/                 # 杀手实验脚本
```

首次:

```bash
npm install
npm run typecheck     # tsc -b 构建/类型检查 packages/*
npm run dev           # 启动驾驶舱 UI → http://localhost:5173
```

> 当前是**骨架**:核心接口已是真实 TS;适配器/写回是带 TODO 的桩;UI 是可交互的布局原型。
> **下一里程碑**:UniverAdapter 接 Univer 真实 API,跑通"圈选→ChangeSet→影子→diff→外科写回"第一条闭环(首发用例:Excel 财务表清洗校验)。
