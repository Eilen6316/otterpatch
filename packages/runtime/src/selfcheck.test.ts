import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ChangeSet } from '@otterpatch/core';
import { withFinalModelReview } from './runtime.js';

const okVerifier = () => ({ ok: true, report: '结构通过' });
const csWith = (n: number): ChangeSet => ({ id: 'cs', hostId: 'h', baseRev: 0, meta: {}, anchors: {}, edits: Array.from({ length: n }, (_, i) => ({ id: 'e' + i, target: 'a' + i, op: { family: 'text', kind: 'replaceText', text: 'x' } })) } as unknown as ChangeSet);

test('model review: large proposals request one explicitly non-deterministic review', async () => {
  const v = withFinalModelReview(okVerifier);
  const first = await v(csWith(5));
  assert.equal(first.ok, false);
  assert.equal(first.level, 'model_review');
  assert.equal(first.code, 'FINAL_MODEL_REVIEW_REQUIRED');
  assert.deepEqual(first.details, { kind: 'model_review', deterministic: false });
  assert.match(first.report, /不是 semantic verification/);
  const second = await v(csWith(5)); // model resubmits unchanged after self-review
  assert.equal(second.ok, true);
});

test('model review: small proposals do not consume a repair round', async () => {
  const v = withFinalModelReview(okVerifier);
  assert.equal((await v(csWith(2))).ok, true);
});

test('model review: deterministic structural failures take precedence', async () => {
  let pass = false;
  const structural = () => (pass ? { ok: true, report: 'ok' } : { ok: false, report: '锚点不存在' });
  const v = withFinalModelReview(structural);
  const r1 = await v(csWith(6));
  assert.equal(r1.ok, false);
  assert.match(r1.report, /锚点不存在/); // structural report comes first
  pass = true;
  const r2 = await v(csWith(6));
  assert.equal(r2.ok, false);
  assert.equal(r2.level, 'model_review');
  assert.equal((await v(csWith(6))).ok, true);
});
