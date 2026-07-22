import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { observeClientAbort } from './client-abort.js';

function pair(): { req: EventEmitter & { aborted: boolean }; res: EventEmitter & { writableEnded: boolean; destroyed: boolean } } {
  return {
    req: Object.assign(new EventEmitter(), { aborted: false }),
    res: Object.assign(new EventEmitter(), { writableEnded: false, destroyed: false }),
  };
}

test('client abort signal fires when the response connection closes early', () => {
  const { req, res } = pair();
  const handle = observeClientAbort(req as IncomingMessage, res as ServerResponse);
  res.emit('close');
  assert.equal(handle.signal.aborted, true);
  handle.dispose();
});

test('normal response close does not cancel completed work and dispose removes listeners', () => {
  const { req, res } = pair();
  const handle = observeClientAbort(req as IncomingMessage, res as ServerResponse);
  res.writableEnded = true;
  res.emit('close');
  assert.equal(handle.signal.aborted, false);
  handle.dispose();
  assert.equal(req.listenerCount('aborted'), 0);
  assert.equal(res.listenerCount('close'), 0);
});
