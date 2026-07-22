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
import { replaceUniquePptxText } from './pptx-text.js';

const dec = new TextDecoder();
const enc = new TextEncoder();

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
      if (!anchor || anchor.portable.kind !== 'flow' || anchor.portable.path.length !== 1) {
        dropped.push({ editId: e.id, reason: 'missing slide text anchor' });
        continue;
      }
      const slideIdx = anchor.portable.path[0]!;
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
      const replacement = replaceUniquePptxText(dec.decode(src), oldText, e.op.text);
      if (replacement.kind === 'missing') {
        dropped.push({ editId: e.id, reason: 'quote text not found in slide' });
        continue;
      }
      if (replacement.kind === 'ambiguous') {
        dropped.push({ editId: e.id, reason: `quote text is ambiguous in slide (${replacement.matches} matches)` });
        continue;
      }
      if (replacement.kind === 'cross-run') {
        dropped.push({ editId: e.id, reason: 'quote text spans multiple <a:t> runs and is unsupported' });
        continue;
      }
      patches[path] = enc.encode(replacement.xml);
      applied.push(e.id);
    }
    return { parts: patches, report: { applied, dropped } };
  };
}
