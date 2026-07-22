'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const {
  validateCommitInvocation,
  validateCommitResult,
  validateProposeInvocation,
  validateProposeResult,
  validateStreamEventEnvelope,
} = require('./ipc-contract.cjs');

test('Electron proposal IPC accepts only the bounded local-service schema', () => {
  const sourceFileSha256 = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';
  const baseRev = Number.parseInt(sourceFileSha256.slice(0, 13), 16);
  const result = validateProposeInvocation({
    requestId: 'request_1',
    payload: { format: 'excel', intent: 'set B1', context: '', baseRev, sourceFileSha256, documentId: `excel:sha256:${sourceFileSha256}`, sessionId: 'session-1', userId: 'user-1', parentProposalId: 'proposal-1', provider: 'openai', apiKey: 'secret' },
  });
  assert.equal(result.requestId, 'request_1');
  assert.deepEqual(JSON.parse(result.body), {
    format: 'excel', intent: 'set B1', context: '', baseRev, sourceFileSha256, documentId: `excel:sha256:${sourceFileSha256}`, sessionId: 'session-1', userId: 'user-1', parentProposalId: 'proposal-1', provider: 'openai', apiKey: 'secret',
  });
  assert.throws(
    () => validateProposeInvocation({ requestId: 'bad id', payload: { format: 'excel', intent: 'x' } }),
    /requestId/,
  );
  assert.throws(
    () => validateProposeInvocation({ requestId: 'r', payload: { format: 'excel', intent: 'x', url: 'https://evil.test' } }),
    /unsupported fields/,
  );
  assert.throws(
    () => validateProposeInvocation({ requestId: 'r', payload: { format: 'exe', intent: 'x' } }),
    /unsupported document format/,
  );
  assert.throws(
    () => validateProposeInvocation({ requestId: 'r', payload: { format: 'excel', intent: 'x', baseRev: 0, sourceFileSha256 } }),
    /baseRev must match/,
  );
  assert.throws(
    () => validateProposeInvocation({ requestId: 'r', payload: { format: 'excel', intent: 'x', baseRev, sourceFileSha256, documentId: 'other' } }),
    /documentId must match/,
  );
  assert.throws(
    () => validateProposeInvocation({ requestId: 'r', payload: { format: 'excel', intent: 'x', sessionId: 'mock' } }),
    /reserved/,
  );
  assert.throws(
    () => validateProposeInvocation({ requestId: 'r', payload: { format: 'excel', intent: 'x', userId: '   ' } }),
    /must not be blank/,
  );
});

test('Electron commit IPC validates the accepted subset and rejects ambient authority fields', () => {
  const result = validateCommitInvocation({
    format: 'word',
    fileBase64: 'aW4=',
    changeSet: { baseRev: 3 },
    proposal: { proposalId: 'p' },
    acceptedEditIds: ['e1'],
  });
  assert.deepEqual(result.acceptedEditIds, ['e1']);
  assert.throws(
    () => validateCommitInvocation({
      format: 'word', fileBase64: 'aW4=', changeSet: {}, proposal: {}, acceptedEditIds: ['e1', 'e1'],
    }),
    /unique/,
  );
  assert.throws(
    () => validateCommitInvocation({
      format: 'word', fileBase64: 'aW4=', changeSet: {}, proposal: {}, acceptedEditIds: [], token: 'renderer-supplied',
    }),
    /unsupported fields/,
  );
});

test('preload exposes narrow IPC methods and no service credentials', () => {
  const preload = readFileSync(path.join(__dirname, 'preload.cjs'), 'utf8');
  assert.doesNotMatch(preload, /serveToken|reviewToken|OtterPatch_TOKEN|OtterPatch_REVIEW_TOKEN/);
  assert.match(preload, /streamPropose/);
  assert.match(preload, /commitWriteback/);
});

test('preload stream envelope rejects unknown event types and extra fields', () => {
  assert.deepEqual(
    validateStreamEventEnvelope({ requestId: 'r1', kind: 'event', event: { type: 'done', kind: 'answer', text: 'ok' } }),
    { requestId: 'r1', kind: 'event', event: { type: 'done', kind: 'answer', text: 'ok' } },
  );
  assert.throws(
    () => validateStreamEventEnvelope({ requestId: 'r1', kind: 'event', event: { type: 'token' } }),
    /event type/,
  );
  assert.throws(
    () => validateStreamEventEnvelope({ requestId: 'r1', kind: 'open', event: undefined, token: 'x' }),
    /unsupported fields/,
  );
});

test('IPC completion results are exact and cannot smuggle credential fields', () => {
  assert.deepEqual(validateProposeResult({ ok: true, eventCount: 3 }), { ok: true, eventCount: 3 });
  assert.throws(() => validateProposeResult({ ok: true, eventCount: 0 }), /propose result/);
  assert.deepEqual(
    validateCommitResult({ ok: true, fileBase64: 'b3V0', touchedParts: [], fidelity: { score: 1 } }),
    { ok: true, fileBase64: 'b3V0', touchedParts: [], fidelity: { score: 1 } },
  );
  assert.throws(
    () => validateCommitResult({ ok: true, touchedParts: [], token: 'must-not-cross-ipc' }),
    /unsupported fields/,
  );
});
