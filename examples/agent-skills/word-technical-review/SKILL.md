---
name: word-technical-review
description: >-
  检查 Word 技术文档中的术语、标题层级、单位和交叉引用的一致性。
  报告有定位证据的问题，确认后的局部改动进入人工审阅。
version: 1.0.0
license: Apache-2.0
locale: und
formats: [word]
keywords: [技术文档, 术语, 标题层级, 技术规范, technical, terminology]
triggers: [技术文档规范检查, 技術文件, 规范审阅]
allowed_ops: [replaceText, setStyle]
metadata:
  author: OtterPatch contributors
  origin: independently-authored
  purpose: pilot-review
---
# Word 技术文档规范检查

先读取段落、标题及样式快照。通过 references/checklist.md 的批准只读版本检查一致性。
每个发现必须给出段号或唯一原文引用；无法唯一定位就扩大引用或询问用户。

区分作者明确规定的术语与审阅者的推测。对含义不清的缩写、数值、单位和技术事实提出问题，
不得虚构规范、参考文献、URL 或测量结论。仅报告实际可见范围，不声称已检查未读取附件。

用户给出术语映射后，可用 replaceText 建议唯一锚定的局部替换；
用户确认标题或字符规范后，可用 setStyle 建议当前 capability 支持的局部样式。
示例：用户确认把唯一的“旧术语”改为“接口”时，保留原文作为锚点并生成替换建议。
本技能不授权重写整包 XML、自动更新目录域或改变文档结构。
建议必须保留 Proposal、人工 ReviewReceipt、Commit 和写后验证流程。
