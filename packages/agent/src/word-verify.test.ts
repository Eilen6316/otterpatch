import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { DocRev } from '@otterpatch/core';
import { buildDocVerifier, wordDialect, type ProposeRequest } from './index.js';

const DOC = '本报告分析吉林省财政收入的影响因素。全省财政收入逐年增长,增速略有放缓。';
const reqFor = (): ProposeRequest => ({ hostId: 'h1', format: 'word', intent: 'x', baseRev: 0 as DocRev, anchors: [], context: DOC });
const cs = (edits: unknown[]) => wordDialect.buildChangeSet(reqFor(), { plan: 'p', edits } as never);

test('Word 自检:quote 真实存在 → 通过', () => {
  const v = buildDocVerifier(DOC)(cs([{ quote: '增速略有放缓', replacement: '增速有所回落' }]));
  assert.equal(v.ok, true);
});

test('Word 自检:quote 不在原文 → 失败并回喂', () => {
  const v = buildDocVerifier(DOC)(cs([{ quote: '这句话文档里根本没有', replacement: '改后' }]));
  assert.equal(v.ok, false);
  assert.match(v.report, /不在文档原文中/);
});

test('Word 自检:改后与原文相同 = 空改动 → 失败', () => {
  const v = buildDocVerifier(DOC)(cs([{ quote: '增速略有放缓', replacement: '增速略有放缓' }]));
  assert.equal(v.ok, false);
  assert.match(v.report, /空改动/);
});

test('Word 自检:全文格式改动(all=true,无 quote)→ 跳过定位、通过', () => {
  const v = buildDocVerifier(DOC)(cs([{ all: true, font: '宋体', size: 10.5 }]));
  assert.equal(v.ok, true);
});

test('Word 自检:quote 多次出现 → 通过但给唯一性告警', () => {
  const v = buildDocVerifier(DOC)(cs([{ quote: '财政收入', replacement: '一般公共预算收入' }]));
  assert.equal(v.ok, true); // 告警不阻断
  assert.match(v.report, /出现多次/);
});
