/**
 * OOXML 外科补丁核心工具(已用真实 .docx 实测验证)。
 * 把 .docx/.xlsx 当 zip:只重写被命中的部件,其余部件【字节级原样透传】,重新打包。
 * 实测:30/31 部件字节级不变(见 experiments/exp1_surgical_test.py)。
 */
import { unzipSync, zipSync, type Zippable } from 'fflate';

export type OoxmlParts = Record<string, Uint8Array>;

/** 读出 .docx/.xlsx(zip)的全部部件(path → bytes)。 */
export function readOoxmlParts(bytes: Uint8Array): OoxmlParts {
  return unzipSync(bytes);
}

/**
 * 外科补丁:只重写 patches 中的部件,其余部件字节级原样透传,重新打包。
 * 这是"高保真写回"的首选机制——绝不整文件重序列化。
 */
export function repackOoxml(originalBytes: Uint8Array, patches: OoxmlParts): Uint8Array {
  const parts = unzipSync(originalBytes);
  const out: Zippable = {};
  for (const [path, data] of Object.entries(parts)) {
    const patched = patches[path];
    out[path] = patched ?? data; // 命中→新内容;未命中→原字节
  }
  for (const [path, data] of Object.entries(patches)) {
    if (!(path in parts)) out[path] = data; // 新增部件
  }
  return zipSync(out);
}

export interface PartsIntegrity {
  total: number;
  identical: number;
  /** "~path"=改动 / "+path"=新增 / "-path"=丢失 */
  changed: string[];
}

/** 对比两份 OOXML 的部件字节完整性(写回后防毁容自检)。 */
export function comparePartsIntegrity(before: Uint8Array, after: Uint8Array): PartsIntegrity {
  const a = unzipSync(before);
  const b = unzipSync(after);
  const names = new Set<string>([...Object.keys(a), ...Object.keys(b)]);
  let identical = 0;
  const changed: string[] = [];
  for (const n of [...names].sort()) {
    const x = a[n];
    const y = b[n];
    if (!x) changed.push('+' + n);
    else if (!y) changed.push('-' + n);
    else if (bytesEqual(x, y)) identical++;
    else changed.push('~' + n);
  }
  return { total: names.size, identical, changed };
}

function bytesEqual(x: Uint8Array, y: Uint8Array): boolean {
  if (x.length !== y.length) return false;
  for (let i = 0; i < x.length; i++) {
    if (x[i] !== y[i]) return false;
  }
  return true;
}
