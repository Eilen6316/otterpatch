import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { DocRev } from '@otterpatch/core';
import { buildDrawioVerifier, drawioDialect, prepareAgentRequest, type ProposeRequest } from './index.js';

// Board context already contains two nodes n1/n2 and one edge e1; ids are parsed as exact tokens.
const BOARD = '节点 id=n1 label=开始; 节点 id=n2 label=处理; 边 id=e1 n1→n2';
const reqFor = (): ProposeRequest => prepareAgentRequest(
  { hostId: 'h1', format: 'drawio', intent: 'x', baseRev: 0 as DocRev, anchors: [], context: BOARD },
  { provider: 'test', model: 'dialect-test' },
);
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
  assert.equal(v.code, 'VERIFIER_DANGLING_EDGE');
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

test('drawio 自检:id 使用精确匹配,短 id 不会命中较长 id 或标签', () => {
  const exact = buildDrawioVerifier('节点 id=n10 label="n1 只是文字"');
  const v = exact(cs([{ op: 'update', cellId: 'n1', value: 'x' }]));
  assert.equal(v.ok, false);
  assert.equal(v.code, 'VERIFIER_TARGET_NOT_FOUND');
});

test('drawio 结构化快照:重放后阻止缺失 parent、悬空边和 parent 循环', () => {
  const structured = buildDrawioVerifier({
    nodes: [{ id: 'n1' }, { id: 'n2', parent: 'n1' }],
    edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
  });
  const missingParent = structured(cs([{ op: 'add', cellId: 'n3', vertex: true, parent: 'ghost' }]));
  assert.equal(missingParent.ok, false);
  assert.equal(missingParent.level, 'simulation');
  assert.equal(missingParent.code, 'VERIFIER_MISSING_PARENT');

  const dangling = structured(cs([{ op: 'delete', cellId: 'n1' }]));
  assert.equal(dangling.ok, true, 'deletion cascades through children and connected edges');

  const cycle = structured(cs([
    { op: 'add', cellId: 'n3', vertex: true, parent: 'n4' },
    { op: 'add', cellId: 'n4', vertex: true, parent: 'n3' },
  ]));
  assert.equal(cycle.ok, false);
  assert.equal(cycle.code, 'VERIFIER_PARENT_CYCLE');
});

test('drawio 结构化快照:addObject 与写回器使用相同的 parent fallback,并保留根 id', () => {
  const structured = buildDrawioVerifier({ nodes: [{ id: 'n1' }], edges: [] });
  const fallback = cs([{ op: 'add', cellId: 'n2', vertex: true }]);
  const op = fallback.edits[0]!.op;
  assert.equal(op.kind, 'addObject');
  if (op.kind === 'addObject') delete (op.payload as { parent?: string }).parent;
  const fallbackResult = structured(fallback);
  assert.equal(fallbackResult.ok, false);
  assert.equal(fallbackResult.code, 'VERIFIER_PARENT_CYCLE');

  const reserved = structured(cs([{ op: 'add', cellId: '1', vertex: true, parent: '0' }]));
  assert.equal(reserved.ok, false);
  assert.equal(reserved.code, 'VERIFIER_DUPLICATE_OBJECT_ID');
});

test('drawio 结构化快照:畸形 HTTP 输入返回稳定错误而不是抛异常', () => {
  const invalid = buildDrawioVerifier({ nodes: null, edges: [] } as never)(cs([{ op: 'update', cellId: 'n1', value: 'x' }]));
  assert.equal(invalid.ok, false);
  assert.equal(invalid.code, 'VERIFIER_INVALID_SNAPSHOT');
});
