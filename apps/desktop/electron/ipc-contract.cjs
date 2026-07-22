'use strict';

const MAX_IPC_BODY_BYTES = 16 * 1024 * 1024;
const MAX_CONTEXT_CHARS = 300_000;
const MAX_INTENT_CHARS = 100_000;
const MAX_API_KEY_CHARS = 8_192;
const MAX_EDIT_IDS = 500;
const FORMATS = new Set(['excel', 'xlsx', 'word', 'docx', 'drawio', 'pdf', 'ppt', 'pptx']);
const PROPOSE_KEYS = new Set([
  'format', 'intent', 'context', 'baseRev', 'provider', 'model', 'apiKey', 'documentId',
  'sheet', 'board', 'doc', 'ppt', 'history',
]);
const COMMIT_KEYS = new Set(['format', 'fileBase64', 'changeSet', 'proposal', 'acceptedEditIds']);
const STREAM_EVENT_TYPES = new Set(['status', 'answer', 'draft', 'done', 'error']);
const COMMIT_RESULT_KEYS = new Set([
  'ok', 'fileBase64', 'partialFileBase64', 'touchedParts', 'fidelity', 'appliedEditIds', 'droppedEdits', 'error',
]);

function validateProposeInvocation(value) {
  const input = record(value, 'propose invocation');
  exactKeys(input, new Set(['requestId', 'payload']), 'propose invocation');
  const requestId = requestIdOf(input.requestId);
  const payload = record(input.payload, 'propose payload');
  exactKeys(payload, PROPOSE_KEYS, 'propose payload');
  formatOf(payload.format);
  boundedString(payload.intent, 'intent', MAX_INTENT_CHARS);
  optionalString(payload.context, 'context', MAX_CONTEXT_CHARS);
  optionalString(payload.provider, 'provider', 64);
  optionalString(payload.model, 'model', 256);
  optionalString(payload.apiKey, 'apiKey', MAX_API_KEY_CHARS);
  optionalString(payload.documentId, 'documentId', 2_048);
  if (payload.baseRev !== undefined && (!Number.isSafeInteger(payload.baseRev) || payload.baseRev < 0)) {
    throw new Error('baseRev must be a non-negative safe integer');
  }
  return { requestId, body: boundedJson(payload, 'propose payload') };
}

function validateCommitInvocation(value) {
  const input = record(value, 'commit invocation');
  exactKeys(input, COMMIT_KEYS, 'commit invocation');
  const format = formatOf(input.format);
  const fileBase64 = boundedString(input.fileBase64, 'fileBase64', MAX_IPC_BODY_BYTES);
  const changeSet = record(input.changeSet, 'changeSet');
  const proposal = record(input.proposal, 'proposal');
  if (!Array.isArray(input.acceptedEditIds) || input.acceptedEditIds.length > MAX_EDIT_IDS) {
    throw new Error(`acceptedEditIds must be an array with at most ${MAX_EDIT_IDS} entries`);
  }
  const acceptedEditIds = input.acceptedEditIds.map((id) => boundedString(id, 'acceptedEditId', 256));
  if (new Set(acceptedEditIds).size !== acceptedEditIds.length) throw new Error('acceptedEditIds must be unique');
  boundedJson(input, 'commit invocation');
  return { format, fileBase64, changeSet, proposal, acceptedEditIds };
}

function validateStreamEventEnvelope(value) {
  const envelope = record(value, 'stream event envelope');
  exactKeys(envelope, new Set(['requestId', 'kind', 'event']), 'stream event envelope');
  const requestId = requestIdOf(envelope.requestId);
  if (envelope.kind === 'open') {
    if (envelope.event !== undefined) throw new Error('open stream event must not include a payload');
    return { requestId, kind: 'open' };
  }
  if (envelope.kind !== 'event') throw new Error('invalid stream event kind');
  const event = record(envelope.event, 'stream event');
  if (!STREAM_EVENT_TYPES.has(event.type)) throw new Error('invalid stream event type');
  validateStreamEvent(event);
  boundedJson(event, 'stream event');
  return { requestId, kind: 'event', event };
}

function validateCommitResult(value) {
  const result = record(value, 'commit result');
  exactKeys(result, COMMIT_RESULT_KEYS, 'commit result');
  if (typeof result.ok !== 'boolean') throw new Error('commit result ok must be boolean');
  optionalString(result.fileBase64, 'fileBase64', MAX_IPC_BODY_BYTES);
  optionalString(result.partialFileBase64, 'partialFileBase64', MAX_IPC_BODY_BYTES);
  optionalString(result.error, 'commit error', 1_000);
  optionalStringArray(result.touchedParts, 'touchedParts', 2_000, 1_024);
  optionalStringArray(result.appliedEditIds, 'appliedEditIds', MAX_EDIT_IDS, 256);
  if (result.fidelity !== undefined) record(result.fidelity, 'fidelity');
  if (result.droppedEdits !== undefined && !Array.isArray(result.droppedEdits)) throw new Error('droppedEdits must be an array');
  boundedJson(result, 'commit result');
  return result;
}

function validateProposeResult(value) {
  const result = record(value, 'propose result');
  exactKeys(result, new Set(['ok', 'eventCount']), 'propose result');
  if (result.ok !== true || !Number.isSafeInteger(result.eventCount) || result.eventCount < 1 || result.eventCount > 100_000) {
    throw new Error('invalid propose result');
  }
  return { ok: true, eventCount: result.eventCount };
}

function validateStreamEvent(event) {
  if (event.type === 'status') {
    exactKeys(event, new Set(['type', 'status']), 'status event');
    record(event.status, 'status event status');
    return;
  }
  if (event.type === 'answer' || event.type === 'draft') {
    exactKeys(event, new Set(['type', 'delta']), `${event.type} event`);
    boundedString(event.delta, `${event.type} delta`, MAX_CONTEXT_CHARS);
    return;
  }
  if (event.type === 'error') {
    exactKeys(event, new Set(['type', 'message', 'error']), 'error event');
    boundedString(event.message, 'error message', 2_000);
    if (event.error !== undefined) record(event.error, 'provider error');
    return;
  }
  exactKeys(event, new Set(['type', 'kind', 'changeSet', 'diff', 'proposal', 'questions', 'text']), 'done event');
  if (!['changeset', 'clarify', 'answer'].includes(event.kind)) throw new Error('invalid done event kind');
  if (event.kind === 'changeset') {
    record(event.changeSet, 'done changeSet');
    record(event.diff, 'done diff');
    record(event.proposal, 'done proposal');
  } else if (event.kind === 'clarify') {
    if (!Array.isArray(event.questions)) throw new Error('clarify done event requires questions');
  } else {
    boundedString(event.text, 'answer text', MAX_CONTEXT_CHARS);
  }
}

function requestIdOf(value) {
  const id = boundedString(value, 'requestId', 128);
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error('requestId contains invalid characters');
  return id;
}

function formatOf(value) {
  const format = boundedString(value, 'format', 16).toLowerCase();
  if (!FORMATS.has(format)) throw new Error('unsupported document format');
  return format;
}

function boundedJson(value, label) {
  let json;
  try {
    json = JSON.stringify(value);
  } catch {
    throw new Error(`${label} must be JSON serializable`);
  }
  if (typeof json !== 'string') throw new Error(`${label} must be JSON serializable`);
  const bytes = Buffer.byteLength(json, 'utf8');
  if (bytes > MAX_IPC_BODY_BYTES) throw new Error(`${label} exceeds the ${MAX_IPC_BODY_BYTES} byte IPC limit`);
  return json;
}

function boundedString(value, label, maxChars) {
  if (typeof value !== 'string' || value.length > maxChars) throw new Error(`${label} must be a string of at most ${maxChars} characters`);
  return value;
}

function optionalString(value, label, maxChars) {
  if (value !== undefined) boundedString(value, label, maxChars);
}

function optionalStringArray(value, label, maxItems, maxChars) {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length > maxItems) throw new Error(`${label} must be a bounded array`);
  for (const item of value) boundedString(item, label, maxChars);
}

function record(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
}

function exactKeys(value, allowed, label) {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) throw new Error(`${label} contains unsupported fields`);
}

module.exports = {
  MAX_IPC_BODY_BYTES,
  validateCommitInvocation,
  validateCommitResult,
  validateProposeInvocation,
  validateProposeResult,
  validateRequestId: requestIdOf,
  validateStreamEventEnvelope,
};
