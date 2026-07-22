import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AnchorId, ChangeSet, DocRev, HostId } from './index.js';
import {
  CAPABILITY_MANIFEST_VERSION,
  assertFormatCapabilities,
  capabilityManifestFor,
  capabilityManifests,
  proposalOperationNamesFor,
} from './capabilities.js';

const flowChangeSet = (style: Record<string, unknown>, quote = '', path: number[] = []): ChangeSet => {
  const anchorId = 'a0' as AnchorId;
  return {
    id: 'word-capability',
    hostId: 'word-host',
    baseRev: 0 as DocRev,
    anchors: {
      [anchorId]: {
        id: anchorId,
        hostId: 'word-host' as HostId,
        kind: 'flow',
        ref: null,
        baseRev: 0 as DocRev,
        portable: { kind: 'flow', path, quote: { prefix: '', text: quote, suffix: '' }, bias: 'left' },
      },
    },
    origin: { by: 'human' },
    meta: { intent: 'format' },
    edits: [{ id: 'e0', target: anchorId, op: { family: 'style', kind: 'setStyle', style } }],
  } as ChangeSet;
};

test('capability manifest exposes only verified Excel writeback operations', () => {
  assert.equal(capabilityManifestFor('xlsx')?.version, CAPABILITY_MANIFEST_VERSION);
  assert.deepEqual(proposalOperationNamesFor('excel'), ['setValue', 'setFormula', 'setStyle', 'setNumberFormat', 'clear']);
  for (const manifest of capabilityManifests()) {
    for (const operation of manifest.operations) {
      assert.equal(operation.propose, operation.writeback, `${manifest.format}/${operation.op} proposal-writeback mismatch`);
    }
  }
});

test('capability manifest does not advertise writeback-only formats as preview or verification', () => {
  assert.ok(capabilityManifestFor('excel')?.operations.every((operation) => operation.preview && operation.verify));
  assert.ok(capabilityManifestFor('word')?.operations.every((operation) => !operation.preview && !operation.verify));
  assert.ok(capabilityManifestFor('drawio')?.operations.every((operation) => !operation.preview && operation.verify));
  assert.ok(capabilityManifestFor('pdf')?.operations.every((operation) => !operation.preview && !operation.verify));
});

test('capability gate rejects unsupported Excel structure operations', () => {
  const cs = flowChangeSet({ bold: true });
  const edit = { ...cs.edits[0]!, op: { family: 'structure' as const, kind: 'insertRows' as const, count: 1, before: true } };
  assert.throws(() => assertFormatCapabilities('excel', { ...cs, edits: [edit] }, 'propose'), /does not allow propose/);
});

test('Word capability separates page styling from anchored local styling', () => {
  assert.doesNotThrow(() => assertFormatCapabilities('word', flowChangeSet({ columns: 2 }), 'writeback'));
  assert.doesNotThrow(() => assertFormatCapabilities('docx', flowChangeSet({ bold: true }, 'target text'), 'writeback'));
  assert.throws(
    () => assertFormatCapabilities('word', flowChangeSet({ font: 'Arial' }), 'writeback'),
    /document-wide character or paragraph styling is not supported/,
  );
  assert.throws(
    () => assertFormatCapabilities('word', flowChangeSet({ columns: 2, font: 'Arial' }), 'writeback'),
    /must be separate edits/,
  );
});
