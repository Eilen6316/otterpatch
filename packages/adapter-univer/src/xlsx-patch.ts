/**
 * Excel ChangeSet → xlsx OOXML 部件补丁编译器(OoxmlPatchCompiler 实现)。
 * 把 setValue 编译成对 xl/worksheets/sheetN.xml 的最小改动;字符串用 inlineStr(不碰 sharedStrings),
 * 保留原单元格样式 s。配合 @otterpatch/writeback-surgical 做外科写回。
 * MVP:仅 setValue 改"已存在单元格";新增单元格/其它算子留待扩展。
 */
import { unzipSync } from 'fflate';
import type { CellValue, ChangeSet, LogicalAnchor } from '@otterpatch/core';

export type OoxmlParts = Record<string, Uint8Array>;

const dec = new TextDecoder();
const encoder = new TextEncoder();

/** 把 sheet 名解析到 xl/worksheets/sheetN.xml;单 sheet 或解析失败 → 默认 sheet1。 */
export function resolveSheetPart(parts: OoxmlParts, sheetName?: string): string {
  const fallback = 'xl/worksheets/sheet1.xml';
  const wbBytes = parts['xl/workbook.xml'];
  const relBytes = parts['xl/_rels/workbook.xml.rels'];
  if (!wbBytes || !relBytes) return fallback;
  const wb = dec.decode(wbBytes);
  const rels = dec.decode(relBytes);

  let rid: string | undefined;
  for (const m of wb.matchAll(/<sheet\b[^>]*?\/?>/g)) {
    const tag = m[0] ?? '';
    const name = /\bname="([^"]*)"/.exec(tag)?.[1];
    const id = /\br:id="([^"]*)"/.exec(tag)?.[1];
    if (!id) continue;
    if (!sheetName || name === sheetName) {
      rid = id;
      break;
    }
  }
  if (!rid) return fallback;

  const relTag = new RegExp(`<Relationship\\b[^>]*?\\bId="${rid}"[^>]*?>`).exec(rels)?.[0];
  const target = relTag ? /\bTarget="([^"]*)"/.exec(relTag)?.[1] : undefined;
  if (!target) return fallback;
  return target.startsWith('/') ? target.slice(1) : 'xl/' + target;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 在 sheet XML 里把某个【已存在】单元格设为新值(保留样式 s)。 */
export function setCellValueXml(sheetXml: string, ref: string, value: CellValue): string {
  const m = new RegExp(`<c r="${ref}"([^>]*?)(?:/>|>([\\s\\S]*?)</c>)`).exec(sheetXml);
  if (!m) {
    throw new Error(`setCellValueXml: cell ${ref} not present (inserting new cells is TODO)`);
  }
  const attrs = m[1] ?? '';
  const sMatch = /\bs="(\d+)"/.exec(attrs);
  const sAttr = sMatch ? ` s="${sMatch[1]}"` : '';

  let replacement: string;
  if (value === null) {
    replacement = `<c r="${ref}"${sAttr}/>`;
  } else if (typeof value === 'number') {
    replacement = `<c r="${ref}"${sAttr}><v>${value}</v></c>`;
  } else if (typeof value === 'boolean') {
    replacement = `<c r="${ref}"${sAttr} t="b"><v>${value ? 1 : 0}</v></c>`;
  } else {
    const space = /^\s|\s$/.test(value) ? ' xml:space="preserve"' : '';
    replacement = `<c r="${ref}"${sAttr} t="inlineStr"><is><t${space}>${escapeXml(value)}</t></is></c>`;
  }
  return sheetXml.slice(0, m.index) + replacement + sheetXml.slice(m.index + (m[0]?.length ?? 0));
}

/** 从 grid 锚点取 {sheet?, cell}。a1 可能是 "Sheet1!B2" / "B2" / "B2:D2"(范围取左上)。 */
function anchorCell(a: LogicalAnchor): { sheet?: string; cell: string } | null {
  const p = a.portable;
  if (p.kind !== 'grid') return null;
  let a1 = p.a1;
  let sheet: string | undefined;
  const bang = a1.indexOf('!');
  if (bang >= 0) {
    sheet = a1.slice(0, bang).replace(/^'|'$/g, '');
    a1 = a1.slice(bang + 1);
  }
  return { sheet, cell: a1.split(':')[0] ?? a1 };
}

/** 构造 Excel 的 OoxmlPatchCompiler:ChangeSet 的 setValue → sheet XML 补丁。 */
export function buildXlsxCompiler() {
  return async function compile(cs: ChangeSet, original: Uint8Array): Promise<OoxmlParts> {
    const parts = unzipSync(original);
    const dirty = new Map<string, string>();
    const getSheet = (path: string): string => {
      const cached = dirty.get(path);
      if (cached !== undefined) return cached;
      const b = parts[path];
      if (!b) throw new Error(`compile: missing part ${path}`);
      return dec.decode(b);
    };

    for (const edit of cs.edits) {
      if (edit.op.kind !== 'setValue') continue; // MVP:只处理 setValue
      const anchor = cs.anchors[edit.target];
      if (!anchor) throw new Error(`compile: anchor ${edit.target} missing`);
      const ac = anchorCell(anchor);
      if (!ac) continue;
      const path = resolveSheetPart(parts, ac.sheet);
      dirty.set(path, setCellValueXml(getSheet(path), ac.cell, edit.op.value));
    }

    const out: OoxmlParts = {};
    for (const [path, xml] of dirty) out[path] = encoder.encode(xml);
    return out;
  };
}
