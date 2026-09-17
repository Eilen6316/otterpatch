/**
 * 向导步骤状态机:合法流转、非法流转保持原状、错误带回。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canRunConnectionTest, initialSetupState, reduceSetup, type SetupAction } from './first-run-setup-state.js';

const run = (actions: SetupAction[]) => actions.reduce(reduceSetup, initialSetupState);

test('setup state machine walks provider → key → testing → done', () => {
  const state = run([{ type: 'next' }, { type: 'test-start' }, { type: 'test-ok' }]);
  assert.equal(state.step, 'done');
  assert.equal(state.error, null);
});

test('setup state machine returns to key with the error on a failed test', () => {
  const state = run([{ type: 'next' }, { type: 'test-start' }, { type: 'test-fail', message: 'API Key 未通过 Provider 验证' }]);
  assert.equal(state.step, 'key');
  assert.equal(state.error, 'API Key 未通过 Provider 验证');
});

test('setup state machine allows going back to the provider picker', () => {
  const state = run([{ type: 'next' }, { type: 'back' }]);
  assert.equal(state.step, 'provider');
});

test('setup state machine ignores actions that do not apply to the current step', () => {
  // provider 步骤上:next 之外的 next/back 语义只在 key 上;test-* 只在 testing 上。
  assert.equal(reduceSetup(initialSetupState, { type: 'back' }).step, 'provider');
  assert.equal(reduceSetup(initialSetupState, { type: 'test-start' }).step, 'provider');
  const testing = { step: 'testing' as const, error: null };
  assert.equal(reduceSetup(testing, { type: 'test-start' }).step, 'testing');
  assert.equal(reduceSetup(testing, { type: 'next' }).step, 'testing');
  // done 之后不再接受流转。
  const done = { step: 'done' as const, error: null };
  assert.equal(reduceSetup(done, { type: 'next' }).step, 'done');
  assert.equal(reduceSetup(done, { type: 'test-fail', message: 'x' }).step, 'done');
});

test('canRunConnectionTest requires a non-blank key on the key step', () => {
  assert.equal(canRunConnectionTest({ step: 'key', error: null }, 'sk-1'), true);
  assert.equal(canRunConnectionTest({ step: 'key', error: null }, '   '), false);
  assert.equal(canRunConnectionTest({ step: 'key', error: null }, ''), false);
  assert.equal(canRunConnectionTest({ step: 'provider', error: null }, 'sk-1'), false);
  assert.equal(canRunConnectionTest({ step: 'testing', error: null }, 'sk-1'), false);
  assert.equal(canRunConnectionTest({ step: 'done', error: null }, 'sk-1'), false);
});
