/** 容错解析:被截断的工具入参也能救出已闭合的 edits/ops,避免整批崩。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { salvageProposalArgs, salvageText, safeParse } from './json-salvage.js';

test('完整 JSON:正常解析,truncated=false', () => {
  const r = salvageProposalArgs('{"plan":"标红","edits":[{"cell":"A1","op":"setStyle"},{"cell":"A2","op":"setValue","value":1}]}');
  assert.equal(r.truncated, false);
  assert.equal(r.edits?.length, 2);
  assert.equal(r.plan, '标红');
});

test('被截断的 edits:救回已闭合的条目,丢弃残缺尾巴', () => {
  // mock 大量数据时常见:最后一个对象被输出长度切断
  const raw = '{"plan":"mock 50 行","edits":[{"cell":"A2","op":"setValue","value":"x"},{"cell":"B2","op":"setValue","value":"y"},{"cell":"C2","op":"setVal';
  const r = salvageProposalArgs(raw);
  assert.equal(r.truncated, true);
  assert.equal(r.edits?.length, 2, '前两条完整 → 保留;第三条残缺 → 丢弃');
  assert.equal(r.plan, 'mock 50 行');
});

test('被截断的 drawio ops:救回已闭合节点', () => {
  const raw = '{"plan":"画图","ops":[{"op":"add","cellId":"n1","value":"应用层"},{"op":"add","cellId":"n2","value":"表示';
  const r = salvageProposalArgs(raw);
  assert.equal(r.truncated, true);
  assert.equal(r.ops?.length, 1);
});

test('完全无法解析:truncated=true 且无条目(上层据此回退提示)', () => {
  const r = salvageProposalArgs('{"plan":"坏');
  assert.equal(r.truncated, true);
  assert.equal(r.edits, undefined);
  assert.equal(r.ops, undefined);
});

test('safeParse:坏 JSON 不抛,返回 {}', () => {
  assert.deepEqual(safeParse('{"a":1}'), { a: 1 });
  assert.deepEqual(safeParse('{"a":'), {});
  assert.deepEqual(safeParse(''), {});
});

test('salvageText:截断的 answer_user 也救出已生成的正文', () => {
  assert.equal(salvageText('{"text":"完整回答"}'), '完整回答');
  // 长答案在字符串中途被截断 → 仍取回已生成部分
  assert.equal(salvageText('{"text":"这是一段很长的回答,正写到一半就被截'), '这是一段很长的回答,正写到一半就被截');
  assert.match(salvageText('{"text":"第一行\\n第二行'), /第一行\n第二行/);
});
