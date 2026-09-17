# OOXML 修订语义笔记（adapter-word 贡献者向）

写回层要产出**真 Word 修订**，这些语义细节决定"接受修订后文档是否干净"。当前 adapter-word
已覆盖一部分；未覆盖项标注为 backlog。来源：OOXML 规范与对主流实现的观察，文本为本项目原创。

## 已覆盖（有测试）
- 插入 = `<w:ins>` 包 run；删除 = `<w:del>` 包 run，且其中文本节点必须改名 `<w:delText>`
- 修订最小化：只把变化的词切成 del/ins 对，前后未变文本保持原 run 字节不动
- 字符格式修订 `<w:rPr>+<w:rPrChange>`、段落格式修订 `<w:pPr>+<w:pPrChange>`
- 修订 run 必须复制原 `<w:rPr>`，否则接受修订后丢加粗/字号
- 生成的 `<w:t>` / `<w:delText>` 会携带 `xml:space="preserve"`；前后空格与 XML 转义均有回归覆盖
- 页面级 sectPr 补丁（cols/pgMar/pgSz），按 OOXML 元素顺序插入
- **整段删除**（deleteRange → 整段删除修订）：所有 run 包 `<w:del>`、`w:t` 改名 `w:delText`，
  并在该段 `<w:pPr><w:rPr>` 放空 `<w:del/>` 标记**段落符本身**被删——接受修订后不残留空段/空列表项
- **图片操作**（setObjectProps/imgAction）：删图 = drawing run 包 `<w:del>`；调宽 =
  `wp:extent`/`a:ext` 按 EMU 重写，保持纵横比
- **段号锚定（para anchoring）**：块序与导入器镜像——顶层 `w:tbl` 算一个块、表内 `w:p` 不计数，
  工作区"第N段"与 document.xml 落点一致；段落格式修订（pPrChange）也支持段号锚（空段落可套格式）
- **结构化插表**：有界规则二维数据会在最终 `sectPr` 前生成原生 `w:tbl`；表头行与单元格文本
  保留修订和转义语义

## Backlog（未覆盖，欢迎 PR）
- **嵌套否决语义**：否决他人插入 = 在对方 `<w:ins>` 内嵌自己的 `<w:del>`；恢复他人删除 =
  保留对方 `<w:del>`、其后追加自己的 `<w:ins>` 重写同文本。多作者协作场景需要。
- **`<w:pPr>` 子元素顺序 schema**：pStyle → numPr → spacing → ind → jc → rPr（垫底）；
  pPrChange 注入时若原段无 pPr，新建的必须守序。
- **批注（comments）**：锚点 `commentRangeStart/End` 是 run 的兄弟节点（w:p 直接子节点），
  不能塞进 run；引用标记是独立 run。未来"Agent 留批注不改文"模式的基础。
- **单位体系**：DXA（1440=1 英寸）用于页面/缩进/表格；EMU（914400=1 英寸）用于图片。
  sectPr 补丁已用 DXA，图片调宽已用 EMU；未来**插入**新图仍需四步注册
  （media/ + rels + Content_Types + w:drawing）。

## 当前验证边界

Runtime 会重新打开结果，验证 OOXML 包，检查只有预期 package part 变化，并要求每个 edit 都被
分类。Word 现在用 TypeScript 实现了那个更强判据的确定性变体：`packages/adapter-word/src/accept.ts`
解开 `<w:ins>`、丢弃 `<w:del>`（含 `<w:delText>`）以及段落标记带删除修订的段落、丢弃原始属性的
`<w:rPrChange>`/`<w:pPrChange>` 快照；`readback.ts` 把接受修订后的文档与 ChangeSet 的顺序文本级
模拟对比。组合效果不符的 edit 逐条归因；若每条 edit 单独可见但组合文档仍不符，则整个接受的子集
失败（交互失败）。页面级 edit 对照 body 级 `sectPr` 检查；图片 edit 对照接受后的 drawing 状态检查。

LibreOffice-headless 变体仍是最强的外部判据（真实渲染器接受修订）；进程内回读是确定性的、无依赖的，
但它验证的是文档语义，不是视觉渲染。
