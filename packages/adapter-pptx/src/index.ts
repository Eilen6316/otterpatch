/**
 * @otterpatch/adapter-pptx —— PowerPoint 适配器(起步:幻灯片正文外科写回)。
 * ChangeSet replaceText → ppt/slides/slideN.xml 的 <a:t> 文本,只改命中 slide,其余字节不变。
 * 后续:形状/版式/母版定位锚点、图表数据源。
 */
export * from './pptx-patch.js';
