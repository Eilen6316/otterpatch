'use strict';

const { contextBridge, ipcRenderer } = require('electron');
const {
  validateCommitInvocation,
  validateCommitResult,
  validateProposeInvocation,
  validateProposeResult,
  validateRequestId,
  validateStreamEventEnvelope,
} = require('./ipc-contract.cjs');

const CHANNELS = Object.freeze({
  propose: 'otterpatch:propose-stream',
  proposeCancel: 'otterpatch:propose-cancel',
  proposeEvent: 'otterpatch:propose-event',
  commit: 'otterpatch:commit-writeback',
});
const proposeListeners = new WeakMap();

contextBridge.exposeInMainWorld('otterpatch', {
  version: '0.0.1',
  platform: process.platform,
  async streamPropose(input) {
    const validated = validateProposeInvocation(input);
    const result = await ipcRenderer.invoke(CHANNELS.propose, {
      requestId: validated.requestId,
      payload: JSON.parse(validated.body),
    });
    return validateProposeResult(result);
  },
  cancelPropose(requestId) {
    ipcRenderer.send(CHANNELS.proposeCancel, validateRequestId(requestId));
  },
  onProposeEvent(listener) {
    if (typeof listener !== 'function') throw new Error('propose event listener must be a function');
    if (proposeListeners.has(listener)) return;
    const wrapped = (_event, value) => {
      try {
        listener(validateStreamEventEnvelope(value));
      } catch {
        // Ignore malformed main-process events instead of exposing an ambient IPC channel.
      }
    };
    proposeListeners.set(listener, wrapped);
    ipcRenderer.on(CHANNELS.proposeEvent, wrapped);
  },
  offProposeEvent(listener) {
    const wrapped = proposeListeners.get(listener);
    if (!wrapped) return;
    proposeListeners.delete(listener);
    ipcRenderer.removeListener(CHANNELS.proposeEvent, wrapped);
  },
  async commitWriteback(input) {
    const validated = validateCommitInvocation(input);
    const result = await ipcRenderer.invoke(CHANNELS.commit, validated);
    return validateCommitResult(result);
  },
});
