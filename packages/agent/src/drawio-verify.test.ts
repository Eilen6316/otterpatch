import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { DocRev } from '@otterpatch/core';
import { buildDrawioVerifier, drawioDialect, type ProposeRequest } from './index.js';

// 画板上下文里已有两个节点 n1/n2 与一条边 e1(校验器按"id 出现在上下文文本中"判存在)
const BOARD = '节点 id=n1 label=开始; 节点 id=n2 label=处理; 边 id=e1 n1→n2';
const reqFor = (): ProposeRequest => ({ hostId: 'h1', format: 'drawio', intent: 'x', baseRev: 0 as DocRev, anchors: [], context: BOARD });
const cs = (ops: unknown[]) => drawioDialect.buildChangeSet(reqFor(), { plan: 'p', ops } as never);
const verify = buildDrawioVerifier(BOARD);

test('drawio 自检:改真实存在的节点 → 通过', () => {
  const v = verify(cs([{ op: 'update', cellId: 'n1', value: '开始(改)' }]));
  assert.equal(v.ok, true);
});

test('drawio 自检:update 不存在的 id → 失败并回喂', () => {
  const v = verify(cs([{ op: 'update', cellId: 'ghost9', value: 'x' }]));
  assert.equal(v.ok, false);
  assert.match(v.report, /不在画板中/);
});

test('drawio 自检:新建边指向不存在的端点 → 悬空边失败', () => {
  const v = verify(cs([{ op: 'add', cellId: 'eNew', edge: true, source: 'n1', target: 'nowhere' }]));
  assert.equal(v.ok, false);
  assert.match(v.report, /悬空边/);
});

test('drawio 自检:边指向同提案新建的节点 → 通过', () => {
  const v = verify(cs([
    { op: 'add', cellId: 'n3', vertex: true, value: '结束', x: 100, y: 300, width: 120, height: 40 },
    { op: 'add', cellId: 'e2', edge: true, source: 'n2', target: 'n3' },
  ]));
  assert.equal(v.ok, true);
});

test('drawio 自检:新建 id 提案内重复 → 失败', () => {
  const v = verify(cs([
    { op: 'add', cellId: 'dup', vertex: true, value: 'A' },
    { op: 'add', cellId: 'dup', vertex: true, value: 'B' },
  ]));
  assert.equal(v.ok, false);
  assert.match(v.report, /重复/);
});

test('drawio 自检:先改后删同一 id → 通过但告警', () => {
  const v = verify(cs([
    { op: 'update', cellId: 'n2', value: 'x' },
    { op: 'delete', cellId: 'n2' },
  ]));
  assert.equal(v.ok, true);
  assert.match(v.report, /先被修改又被删除/);
});
