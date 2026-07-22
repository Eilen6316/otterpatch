import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SetStateAction } from 'react';
import { useReviewState } from './use-review-state.js';

test('review state keeps accepted and rejected decisions disjoint', () => {
  let accepted = new Set<string>();
  let rejected = new Set<string>();
  let thread: Array<{ role: string; kind?: string }> = [];
  const apply = <T>(current: T, action: SetStateAction<T>): T => typeof action === 'function'
    ? (action as (previous: T) => T)(current)
    : action;
  const state = useReviewState({
    setThread: (action) => { thread = apply(thread, action); },
    setAccepted: (action) => { accepted = apply(accepted, action); },
    setRejected: (action) => { rejected = apply(rejected, action); },
  });

  state.toggleAccept('cs::e1', false);
  assert.deepEqual([...accepted], []);
  assert.deepEqual([...rejected], ['cs::e1']);
  state.toggleAccept('cs::e1', true);
  assert.deepEqual([...accepted], ['cs::e1']);
  assert.deepEqual([...rejected], []);
  state.toggleAccept('cs::e2', false);
  state.acceptMany(['cs::e2', 'cs::e3']);
  assert.deepEqual([...accepted].sort(), ['cs::e1', 'cs::e2', 'cs::e3']);
  assert.deepEqual([...rejected], []);
  state.clearAccepted();
  assert.equal(accepted.size, 0);
  assert.equal(rejected.size, 0);
  assert.deepEqual(thread, []);
});
