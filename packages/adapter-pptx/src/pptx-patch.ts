/**
 * pptx 外科补丁编译器:把 ChangeSet 的 replaceText 编辑(flow 锚点:path[0]=幻灯片序号、quote.text=原文)
 * 落到 ppt/slides/slideN.xml 的 <a:t> 文本上,只重写命中的 slide 部件,其余字节原样透传
 * (交 SurgicalOoxmlWriteback 重打包 + 完整性自检)。
 * v1 限制:目标文本需落在单个 <a:t> run 内(短标题/项目符号常见);跨 run 拆分暂不合并。
 */
import type { ChangeSet } from '@otterpatch/core';
import { readOoxmlParts, type OoxmlParts, type OoxmlPatchCompiler } from '@otterpatch/writeback-surgical';

const dec = new TextDecoder();
const enc = new TextEncoder();
const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function replaceInSlide(xml: string, oldText: string, neu: string): { xml: string; hit: boolean } {
  const eo = esc(oldText);
  const en = esc(neu);
  let hit = false;
  const out = xml.replace(/<a:t>([\s\S]*?)<\/a:t>/g, (m, txt: string) => {
    if (!hit && txt.includes(eo)) {
      hit = true;
      return `<a:t>${txt.replace(eo, en)}</a:t>`;
    }
    return m;
  });
  return { xml: out, hit };
}

/** SurgicalOoxmlWriteback 的 pptx 编译器(与 buildXlsxCompiler 同形)。 */
export function buildPptxCompiler(): OoxmlPatchCompiler {
  return async (cs: ChangeSet, original: Uint8Array): Promise<OoxmlParts> => {
    const parts = readOoxmlParts(original);
    const patches: OoxmlParts = {};
    for (const e of cs.edits) {
      if (e.op.kind !== 'replaceText') continue;
      const anchor = cs.anchors[e.target];
      if (!anchor || anchor.portable.kind !== 'flow') continue;
      const slideIdx = anchor.portable.path[0] ?? 0;
      const oldText = anchor.portable.quote.text;
      if (!oldText) continue;
      const path = `ppt/slides/slide${slideIdx + 1}.xml`;
      const src = patches[path] ?? parts[path];
      if (!src) continue;
      const { xml, hit } = replaceInSlide(dec.decode(src), oldText, e.op.text);
      if (hit) patches[path] = enc.encode(xml);
    }
    return patches;
  };
}
