/**
 * pptx surgical patch compiler: applies replaceText edits from a ChangeSet (flow anchor:
 * path[0] = slide index, quote.text = original text) to <a:t> text in ppt/slides/slideN.xml,
 * rewriting only the slide parts that were hit and passing all other bytes through unchanged
 * (SurgicalOoxmlWriteback handles repacking + integrity self-check).
 * v1 limitation: target text must fall within a single <a:t> run (common for short titles/bullets);
 * text split across runs is not merged yet.
 */
import { supportsFormatOperation, type ChangeSet, type EditId } from '@otterpatch/core';
import { readOoxmlParts, type OoxmlParts, type OoxmlPatchCompiler, type OoxmlPatchResult } from '@otterpatch/writeback-surgical';

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

/** pptx compiler for SurgicalOoxmlWriteback (same shape as buildXlsxCompiler). */
export function buildPptxCompiler(): OoxmlPatchCompiler {
  return async (cs: ChangeSet, original: Uint8Array): Promise<OoxmlPatchResult> => {
    const parts = readOoxmlParts(original);
    const patches: OoxmlParts = {};
    const applied: EditId[] = [];
    const dropped: Array<{ editId: EditId; reason: string }> = [];
    for (const e of cs.edits) {
      if (!supportsFormatOperation('ppt', e.op.kind, 'writeback') || e.op.kind !== 'replaceText') {
        dropped.push({ editId: e.id, reason: `unsupported op ${e.op.kind}` });
        continue;
      }
      const anchor = cs.anchors[e.target];
      if (!anchor || anchor.portable.kind !== 'flow') {
        dropped.push({ editId: e.id, reason: 'missing slide text anchor' });
        continue;
      }
      const slideIdx = anchor.portable.path[0] ?? 0;
      const oldText = anchor.portable.quote.text;
      if (!oldText) {
        dropped.push({ editId: e.id, reason: 'missing quote text' });
        continue;
      }
      const path = `ppt/slides/slide${slideIdx + 1}.xml`;
      const src = patches[path] ?? parts[path];
      if (!src) {
        dropped.push({ editId: e.id, reason: `slide part ${path} not found` });
        continue;
      }
      const { xml, hit } = replaceInSlide(dec.decode(src), oldText, e.op.text);
      if (!hit) {
        dropped.push({ editId: e.id, reason: 'quote text not found in slide' });
        continue;
      }
      patches[path] = enc.encode(xml);
      applied.push(e.id);
    }
    return { parts: patches, report: { applied, dropped } };
  };
}
