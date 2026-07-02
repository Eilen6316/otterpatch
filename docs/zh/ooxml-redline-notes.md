# OOXML 修订语义笔记（adapter-word 贡献者向）

写回层要产出**真 Word 修订**，这些语义细节决定"接受修订后文档是否干净"。当前 adapter-word
已覆盖一部分；未覆盖项标注为 backlog。来源：OOXML 规范与对主流实现的观察，文本为本项目原创。

## 已覆盖（有测试）
- 插入 = `<w:ins>` 包 run；删除 = `<w:del>` 包 run，且其中文本节点必须改名 `<w:delText>`
- 修订最小化：只把变化的词切成 del/ins 对，前后未变文本保持原 run 字节不动
- 字符格式修订 `<w:rPr>+<w:rPrChange>`、段落格式修订 `<w:pPr>+<w:pPrChange>`
- 修订 run 必须复制原 `<w:rPr>`，否则接受修订后丢加粗/字号
- 页面级 sectPr 补丁（cols/pgMar/pgSz），按 OOXML 元素顺序插入

## Backlog（未覆盖，欢迎 PR）
- **整段删除的段落符标记**：除删内容 run 外，还需在该段 `<w:pPr><w:rPr>` 里放空 `<w:del/>`
  标记段落符本身被删——缺它则接受修订后残留空段/空列表项。当前 replaceText 为整段删空时未处理。
- **嵌套否决语义**：否决他人插入 = 在对方 `<w:ins>` 内嵌自己的 `<w:del>`；恢复他人删除 =
  保留对方 `<w:del>`、其后追加自己的 `<w:ins>` 重写同文本。多作者协作场景需要。
- **`xml:space="preserve"`**：生成带前导/尾随空格的 `<w:t>` 时必须挂，否则空格静默丢失。
  当前生成路径未系统校验。
- **`<w:pPr>` 子元素顺序 schema**：pStyle → numPr → spacing → ind → jc → rPr（垫底）；
  pPrChange 注入时若原段无 pPr，新建的必须守序。
- **批注（comments）**：锚点 `commentRangeStart/End` 是 run 的兄弟节点（w:p 直接子节点），
  不能塞进 run；引用标记是独立 run。未来"Agent 留批注不改文"模式的基础。
- **单位体系**：DXA（1440=1 英寸）用于页面/缩进/表格；EMU（914400=1 英寸）用于图片。
  sectPr 补丁已用 DXA；未来插图需要 EMU + 四步注册（media/ + rels + Content_Types + w:drawing）。

## 验证思路
- 写回后的 docx 应通过：解包 → 接受全部修订（LibreOffice headless 可自动化）→ 与"直接改后
  文本"对比一致 + 无残留空段；这是比"打得开"更强的正确性判据，值得做进 CI。
