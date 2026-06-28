/**
 * 真模型端到端冒烟(BYOK)。仅在设置了 OtterPatch_API_KEY 时跑;否则跳过(CI 默认无 secret → 跳过)。
 * 验证"真实模型 → 受约束 ChangeSet → 外科写回"整条 BYOK 链路能跑通(非确定性,只断言不报错 + 产出非空)。
 *   OtterPatch_API_KEY=...  OtterPatch_PROVIDER=claude  node scripts/real-smoke.mjs
 */
import { zipSync, unzipSync } from 'fflate';

if (!process.env.OtterPatch_API_KEY) {
  console.log('[smoke] OtterPatch_API_KEY not set — skipping real-model smoke (this is OK).');
  process.exit(0);
}

const { OtterPatchRuntime } = await import('@otterpatch/runtime');
const { createModelClient } = await import('@otterpatch/agent');

const enc = (s) => new TextEncoder().encode(s);
const dec = new TextDecoder();
const xlsx = zipSync({
  '[Content_Types].xml': enc('<?xml version="1.0"?><Types/>'),
  '_rels/.rels': enc('<?xml version="1.0"?><Relationships/>'),
  'xl/workbook.xml': enc('<?xml version="1.0"?><workbook xmlns:r="r"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>'),
  'xl/_rels/workbook.xml.rels': enc('<?xml version="1.0"?><Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
  'xl/styles.xml': enc('<?xml version="1.0"?><styleSheet/>'),
  'xl/worksheets/sheet1.xml': enc('<?xml version="1.0"?><worksheet><sheetData><row r="1"><c r="B1" s="2"><v>20</v></c></row></sheetData></worksheet>'),
});

const rt = new OtterPatchRuntime();
const provider = process.env.OtterPatch_PROVIDER || 'claude';
const model = createModelClient(provider, { apiKey: process.env.OtterPatch_API_KEY });

const cs = await rt.propose(
  { hostId: 'smoke', format: 'excel', intent: '把单元格 Sheet1!B1 的值改成 99', baseRev: 0, anchors: [], context: 'Sheet1!B1 = 20' },
  model,
);
const diff = rt.diff(cs);
console.log(`[smoke] provider=${provider} edits=${cs.edits.length} diffItems=${diff.items.length}`);
if (cs.edits.length < 1) {
  console.error('[smoke] FAIL: expected >= 1 edit from the model');
  process.exit(1);
}

const res = await rt.commit({ format: 'excel', bytes: xlsx, changeSet: cs });
const sheet = dec.decode(unzipSync(res.bytes)['xl/worksheets/sheet1.xml']);
console.log(`[smoke] commit ok=${res.ok} touched=${JSON.stringify(res.touchedParts)} sheet1Snippet=${sheet.slice(0, 120)}`);
console.log('[smoke] REAL-MODEL SMOKE OK');
