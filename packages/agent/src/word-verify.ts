/** Word anchor linting. This resolves targets but does not claim document simulation. */
import type { ChangeSet, VerifyReport } from '@otterpatch/core';

export interface WordVerificationSnapshot {
  blocks: Array<{ text: string }>;
}

type Source = string | WordVerificationSnapshot;

const SUPPORTED_WORD_OPS = new Set(['replaceText', 'setStyle', 'deleteRange', 'setObjectProps', 'insertTable']);
const clip = (value: string): string => (value.length > 40 ? value.slice(0, 40) + '…' : value);

interface Issue {
  code: string;
  editId: string;
  message: string;
}

function occurrences(text: string, quote: string): number[] {
  const hits: number[] = [];
  let from = 0;
  while (from <= text.length - quote.length) {
    const index = text.indexOf(quote, from);
    if (index < 0) break;
    hits.push(index);
    from = index + Math.max(1, quote.length);
  }
  return hits;
}

function result(errors: Issue[], warnings: string[]): VerifyReport {
  if (errors.length) {
    const payload = {
      ok: false,
      level: 'lint',
      code: errors[0]!.code,
      issues: errors,
      warnings,
    };
    return { ok: false, level: 'lint', code: errors[0]!.code, details: { issues: errors, warnings }, report: JSON.stringify(payload) };
  }
  const warningText = warnings.length ? '\n另外这些地方请留意:\n' + warnings.map((warning) => '- ' + warning).join('\n') : '';
  return { ok: true, level: 'lint', report: '锚点检查通过:每条改动都有唯一、可解析的目标。' + warningText, details: { warnings } };
}

/** Build a target-resolution lint pass from a structured document snapshot or plain text. */
export function buildDocVerifier(source: Source): (cs: ChangeSet) => VerifyReport {
  const blocks = typeof source === 'string' ? undefined : source.blocks;
  const documentText = typeof source === 'string' ? source : source.blocks.map((block) => block.text).join('\n');

  return (cs: ChangeSet): VerifyReport => {
    const errors: Issue[] = [];
    const warnings: string[] = [];
    const targeted = new Set<string>();

    for (const edit of cs.edits) {
      if (!SUPPORTED_WORD_OPS.has(edit.op.kind)) {
        errors.push({
          code: 'VERIFIER_UNSUPPORTED_OPERATION',
          editId: edit.id,
          message: `Word anchor lint does not support ${edit.op.kind}`,
        });
        continue;
      }
      const anchor = cs.anchors[edit.target];
      if (!anchor || anchor.portable.kind !== 'flow') {
        errors.push({ code: 'VERIFIER_INVALID_TARGET', editId: edit.id, message: '改动没有 flow 锚点' });
        continue;
      }
      const { quote, path } = anchor.portable;
      const paragraph = path[0];
      const isPageStyle = edit.op.kind === 'setStyle'
        && (edit.op.scope === 'document' || edit.op.scope === 'section')
        && Object.keys(edit.op.style).length > 0
        && Object.keys(edit.op.style).every((key) => key === 'columns' || key === 'margin' || key === 'orient');
      const isEndTable = edit.op.kind === 'insertTable' && edit.op.at === 'end';

      if (isEndTable || (isPageStyle && paragraph === undefined && !quote.text)) continue;

      let targetKey: string;
      if (paragraph !== undefined) {
        if (!blocks) {
          errors.push({
            code: 'VERIFIER_INSUFFICIENT_SNAPSHOT',
            editId: edit.id,
            message: `段落锚点 para=${paragraph + 1} 需要结构化 doc.blocks 快照`,
          });
          continue;
        }
        if (!Number.isSafeInteger(paragraph) || paragraph < 0 || paragraph >= blocks.length) {
          errors.push({
            code: 'VERIFIER_ANCHOR_OUT_OF_BOUNDS',
            editId: edit.id,
            message: `para=${paragraph + 1} 超出文档 ${blocks.length} 个块的范围`,
          });
          continue;
        }
        if (quote.text) {
          const hits = occurrences(blocks[paragraph]!.text, quote.text);
          if (!hits.length) {
            errors.push({
              code: 'VERIFIER_ANCHOR_MISMATCH',
              editId: edit.id,
              message: `第 ${paragraph + 1} 块不包含原文“${clip(quote.text)}”`,
            });
            continue;
          }
          if (hits.length > 1) {
            errors.push({
              code: 'VERIFIER_AMBIGUOUS_ANCHOR',
              editId: edit.id,
              message: `“${clip(quote.text)}”在第 ${paragraph + 1} 块中出现 ${hits.length} 次;当前写回器无法在同一块内唯一定位`,
            });
            continue;
          }
        }
        targetKey = `paragraph:${paragraph}`;
      } else {
        if (!quote.text) {
          errors.push({
            code: 'VERIFIER_MISSING_ANCHOR',
            editId: edit.id,
            message: '改动没有 quote 或 para 段号,无法唯一定位',
          });
          continue;
        }
        const hits = occurrences(documentText, quote.text);
        if (!hits.length) {
          errors.push({
            code: 'VERIFIER_ANCHOR_NOT_FOUND',
            editId: edit.id,
            message: `“${clip(quote.text)}”不在文档原文中,这条改动不会生效`,
          });
          continue;
        }
        if (hits.length > 1) {
          errors.push({
            code: 'VERIFIER_AMBIGUOUS_ANCHOR',
            editId: edit.id,
            message: `“${clip(quote.text)}”在原文中出现 ${hits.length} 次;请提供 para 段号`,
          });
          continue;
        }
        targetKey = `offset:${hits[0]}`;
      }

      if (edit.op.kind === 'replaceText' && edit.op.text === quote.text) {
        errors.push({
          code: 'VERIFIER_NO_OP',
          editId: edit.id,
          message: `“${clip(quote.text)}”的改后文字与原文相同,这是空改动`,
        });
      }
      if (targeted.has(targetKey)) warnings.push(`${targetKey} 被多条改动重复命中,请确认执行顺序不会互相覆盖`);
      targeted.add(targetKey);
    }

    return result(errors, warnings);
  };
}
