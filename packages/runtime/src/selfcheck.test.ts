import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ChangeSet } from '@otterpatch/core';
import { withFinalSelfCheck } from './runtime.js';

const okVerifier = () => ({ ok: true, report: '结构通过' });
const csWith = (n: number): ChangeSet => ({ id: 'cs', hostId: 'h', baseRev: 0, meta: {}, anchors: {}, edits: Array.from({ length: n }, (_, i) => ({ id: 'e' + i, target: 'a' + i, op: { family: 'text', kind: 'replaceText', text: 'x' } })) } as unknown as ChangeSet);

test('收尾自检:大提案(≥5)结构通过后先打回复盘一次,重交即通过', async () => {
  const v = withFinalSelfCheck(okVerifier);
  const first = await v(csWith(5));
  assert.equal(first.ok, false);
  assert.match(first.report, /收尾自检/);
  const second = await v(csWith(5)); // 模型复盘后原样重交
  assert.equal(second.ok, true);
});

test('收尾自检:小提案(<5)不额外打回', async () => {
  const v = withFinalSelfCheck(okVerifier);
  assert.equal((await v(csWith(2))).ok, true);
});

test('收尾自检:结构失败优先回喂结构报告,不消耗自检机会', async () => {
  let pass = false;
  const structural = () => (pass ? { ok: true, report: 'ok' } : { ok: false, report: '锚点不存在' });
  const v = withFinalSelfCheck(structural);
  const r1 = await v(csWith(6));
  assert.equal(r1.ok, false);
  assert.match(r1.report, /锚点不存在/); // 先结构
  pass = true;
  const r2 = await v(csWith(6));
  assert.equal(r2.ok, false);
  assert.match(r2.report, /收尾自检/); // 结构过了才轮到语义复盘
  assert.equal((await v(csWith(6))).ok, true);
});
