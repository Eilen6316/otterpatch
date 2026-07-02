# 技能（Skills）

`packages/skills` 是知识中枢：存放 Agent「擅长做什么」的知识，并且与核心提示词分离，
使其可以不断增长而不会让每次请求都变得臃肿。

## 两类内置技能

| 类型 | 示例 | 内容 | 注入方式 |
|---|---|---|---|
| **能力卡片** | `xlsx`、`docx`、`pptx`、`pdf`、`drawio` | 一句话说明「该格式支持什么」 | L0：名称 + 描述注入系统提示词 |
| **打法手册**（Playbooks） | `docx-gongwen`、`xlsx-financial`、`chart-selection` | 检查清单 + changeset 惯用手法 + 反模式 | L0 卡片，标注【有打法手册】；完整正文通过 `load_skill` 按需加载 |

内置打法手册以**真实的 SKILL.md 文件**形式存放于 `packages/skills/skills/<name>/SKILL.md`
（遵循 Anthropic Agent Skills 目录约定——每个技能一个文件夹，YAML frontmatter 作为 L0，
markdown 正文作为 L1）。`playbooks.ts` 只是一个加载器；直接编辑 markdown 即可，无需改代码：

- **`docx-gongwen`** —— GB/T 9704 公文（中国政府正式文件）版式：标题/正文字号体系（二号小标宋
  标题、三号仿宋正文）、一、/(一)/1./(1) 的标题编号层级、全角标点，
  以及落实这些规范的 changeset 惯用手法（在任何 `all=true` 全量扫格式之前，先用 `block` 处理真实标题）。
- **`xlsx-financial`** —— 对账核验（合计 = 公式，绝不硬编码）、金额/百分比
  数字格式、异常检测，以及硬性红线：在写出任何数值结论之前，必须先用 `read_range`/`aggregate`
  核实；绝不覆盖原始数据。
- **`chart-selection`** —— 从问题到图表类型的决策树，外加专业底线规则
  （柱状图零基线、颜色 ≤6 种、有意义的排序、结论式标题）。

## 渐进式披露（Progressive disclosure）

1. `SkillLibrary.match(intent, format)` 为卡片打分：格式命中 +3，每个关键词命中 +1，
   并且**仅当确有关键词命中时**，打法手册获得 +0.5 的加分用于打破平局（对于泛化意图，
   普通能力卡片仍排在前面）。
2. `render()` 将排名靠前的卡片（L0）注入系统提示词；打法手册卡片附带一条明确
   指令：*如相关，先用 `load_skill` 加载后再行动*。
3. `load_skill` 工具（由 `Agent.withSkillTools` 通过 `RespondOptions.extraTools` 接线）
   以工具结果形式返回打法手册的完整 markdown——知识只在需要时才到达。

## 外部技能

任何行业或团队专属的内容都不放进内置技能。宿主（Host）可以在运行时安装标准的
`SKILL.md`（与 Anthropic Agent Skills 兼容——YAML frontmatter + markdown 正文）：

```ts
library.install(skillMdText, 'file:./skills/my-company-report.md');
```

解析出的卡片会立即参与匹配/渲染/`load_skill`。L2（可执行脚本）
被有意禁用——纯文本打法手册以零沙箱风险交付了绝大部分价值。

## 如何写好一份打法手册

- 以**模型行动前要跑一遍的检查清单**开头——诊断胜过处方。
- 包含 **changeset 惯用手法**：用哪些操作、按什么顺序（例如「先用 `block`
  设置真实标题，再用 `all=true` 打正文基线——否则全量扫格式会把你的标题压平」）。
- 包含**反模式**（「不要用手动加粗+调字号来伪造标题」）。
- 全文控制在约 50 行以内。它会被加载进活跃上下文；密度就是价值。
