---
name: excel-data-quality
description: >-
  审阅 Excel 数据质量，核查缺失值、重复记录、类型和显示格式的一致性。
  仅依据已读快照给出证据，格式修正必须提出 ChangeSet 并由人选择。
version: 1.0.0
license: Apache-2.0
locale: und
formats: [excel]
keywords: [数据质量, 缺失值, 重复值, 数据校验, quality, duplicates, missing]
triggers: [数据核查, 資料品質, 质量检查]
allowed_ops: [setNumberFormat]
metadata:
  author: OtterPatch contributors
  origin: independently-authored
  purpose: pilot-review
---
# Excel 数据质量审阅

先用现有只读工具读取用户选择的范围，区分已观察事实、待确认假设和不可见数据。
引用 references/checklist.md 获取只读检查清单；若参考未批准或不可用，说明限制。

检查缺失值、重复键、文本数字、日期与数字显示格式。每项发现都应列出工作表、A1 位置、
实际观察、可能影响及建议。重复键不是删除记录的充分依据；缺失值不能靠猜测补齐。
保留公式，不将错误码或字符串静默转换成数字。

用户要求统一已确认的数字显示格式时，可为明确单元格提出 setNumberFormat。
示例：用户要求把 Sheet1!B1 的已观察数值 20 显示为两位小数时，建议格式 0.00。
本技能不授权改值、删除行、建图表或执行外部程序。超出支持范围时给出解释或澄清问题。
所有建议均通过原有 Proposal、人工 ReviewReceipt、Commit 和写后验证流程；
不能因“数据清洗”而省略人工审阅。
