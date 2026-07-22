import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffWords, buildRedlineXml } from './redline.js';

test('diffWords: 词级 equal/del/ins,且可重建原文与改后', () => {
  const segs = diffWords('the quick brown fox', 'the slow brown fox');
  assert.ok(segs.some((s) => s.op === 'del' && s.text.includes('quick')));
  assert.ok(segs.some((s) => s.op === 'ins' && s.text.includes('slow')));
  // equal+del = original text; equal+ins = revised text
  assert.equal(segs.filter((s) => s.op !== 'ins').map((s) => s.text).join(''), 'the quick brown fox');
  assert.equal(segs.filter((s) => s.op !== 'del').map((s) => s.text).join(''), 'the slow brown fox');
});

test('buildRedlineXml: 产 Word 原生 w:del / w:ins,未改部分为普通 run', () => {
  const xml = buildRedlineXml('利润 100', '利润 200', { author: 'A', date: '2026-01-01T00:00:00Z' });
  assert.match(xml, /<w:del w:id="1" w:author="A" w:date="2026-01-01T00:00:00Z"><w:r><w:delText[^>]*>100<\/w:delText><\/w:r><\/w:del>/);
  assert.match(xml, /<w:ins w:id="2"[^>]*><w:r><w:t[^>]*>200<\/w:t><\/w:r><\/w:ins>/);
  assert.match(xml, /<w:r><w:t xml:space="preserve">利润 <\/w:t><\/w:r>/); // unchanged part preserved
});

test('buildRedlineXml defaults revision metadata to the current time', () => {
  const before = Date.now();
  const xml = buildRedlineXml('old', 'new');
  const dates = [...xml.matchAll(/w:date="([^"]+)"/g)].map((match) => match[1]!);

  assert.ok(dates.length >= 2);
  assert.equal(new Set(dates).size, 1, 'all revisions in one operation share one timestamp');
  const timestamp = Date.parse(dates[0]!);
  assert.ok(timestamp >= before && timestamp <= Date.now(), `revision timestamp is current: ${dates[0]}`);
  assert.notEqual(dates[0], '1970-01-01T00:00:00Z');
});

test('buildRedlineXml validates dates and escapes revision authors', () => {
  assert.throws(() => buildRedlineXml('old', 'new', { date: 'not-a-date' }), /valid ISO timestamp/);
  const xml = buildRedlineXml('old', 'new', { author: 'A" & B', date: '2026-01-01T00:00:00Z' });
  assert.match(xml, /w:author="A&quot; &amp; B"/);
});

test('纯新增 / 纯删除', () => {
  assert.match(buildRedlineXml('', 'hi'), /<w:ins[^>]*><w:r><w:t[^>]*>hi</);
  assert.match(buildRedlineXml('hi', ''), /<w:del[^>]*><w:r><w:delText[^>]*>hi</);
});

test('XML 转义(新增的特殊字符被转义)', () => {
  assert.match(buildRedlineXml('a', 'a & <b>'), /&amp; &lt;b&gt;/);
});
