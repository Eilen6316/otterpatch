import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AnchorId, ChangeSet, DocRev, HostId, StyleScope } from './index.js';
import {
  CAPABILITY_MANIFEST_VERSION,
  assertFormatCapabilities,
  capabilityManifestFor,
  capabilityManifests,
  proposalOperationNamesFor,
} from './capabilities.js';

const flowChangeSet = (style: Record<string, unknown>, quote = '', path: number[] = [], scope: StyleScope = 'selection'): ChangeSet => {
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
    edits: [{ id: 'e0', target: anchorId, op: { family: 'style', kind: 'setStyle', scope, style } }],
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

test('capability manifest advertises only previews backed by adapter shadows', () => {
  assert.ok(capabilityManifestFor('excel')?.operations.every((operation) => operation.preview && operation.verify));
  assert.ok(capabilityManifestFor('word')?.operations.every((operation) => !operation.preview && !operation.verify));
  assert.ok(capabilityManifestFor('drawio')?.operations.every((operation) => operation.preview && operation.verify));
  assert.ok(capabilityManifestFor('pdf')?.operations.every((operation) => !operation.preview && !operation.verify));
  assert.ok(capabilityManifestFor('pptx')?.operations.every((operation) => !operation.preview && !operation.verify));
  assert.equal(capabilityManifestFor('drawio')?.features?.compressed, 'unsupported');
});

test('PDF capabilities disclose experimental form fill and verification limits', () => {
  const pdf = capabilityManifestFor('pdf');
  assert.equal(pdf?.operations[0]?.maturity, 'experimental');
  assert.deepEqual(pdf?.features, {
    acroFormTextFill: 'experimental',
    semanticVerification: 'incomplete',
    byteLocality: 'not-guaranteed',
  });
});

test('PPTX capabilities disclose the narrow single-run preview boundary', () => {
  const ppt = capabilityManifestFor('pptx');
  assert.equal(ppt?.operations[0]?.maturity, 'preview');
  assert.equal(ppt?.operations[0]?.maxScope, 'range');
  assert.deepEqual(ppt?.features, {
    singleRunTextReplacement: 'supported',
    crossRunTextReplacement: 'unsupported',
    structuredProposalVerification: 'supported',
    semanticVerification: 'incomplete',
  });
});

test('capability gate rejects unsupported Excel structure operations', () => {
  const cs = flowChangeSet({ bold: true });
  const edit = { ...cs.edits[0]!, op: { family: 'structure' as const, kind: 'insertRows' as const, count: 1, before: true } };
  assert.throws(() => assertFormatCapabilities('excel', { ...cs, edits: [edit] }, 'propose'), /does not allow propose/);
});

test('Word capability separates page styling from anchored local styling', () => {
  assert.doesNotThrow(() => assertFormatCapabilities('word', flowChangeSet({ columns: 2 }, '', [], 'document'), 'writeback'));
  assert.doesNotThrow(() => assertFormatCapabilities('docx', flowChangeSet({ bold: true }, 'target text'), 'writeback'));
  assert.doesNotThrow(() => assertFormatCapabilities('docx', flowChangeSet({ align: 'center' }, 'target text', [], 'paragraph'), 'writeback'));
  assert.throws(
    () => assertFormatCapabilities('word', flowChangeSet({ font: 'Arial' }, '', [], 'document'), 'writeback'),
    /local styling requires selection or paragraph scope/,
  );
  assert.throws(
    () => assertFormatCapabilities('word', flowChangeSet({ columns: 2, font: 'Arial' }, '', [], 'document'), 'writeback'),
    /must be separate edits/,
  );
  assert.throws(
    () => assertFormatCapabilities('word', flowChangeSet({ columns: 2 }, 'target text'), 'writeback'),
    /section or document scope/,
  );
  assert.throws(
    () => assertFormatCapabilities('word', flowChangeSet({ columns: 2 }, 'target text', [], 'document'), 'writeback'),
    /empty document-level anchor/,
  );
  assert.throws(
    () => assertFormatCapabilities('word', flowChangeSet({ align: 'center' }, 'target text'), 'writeback'),
    /paragraph styling requires paragraph scope/,
  );
  assert.throws(
    () => assertFormatCapabilities('word', flowChangeSet({ bold: true }, '', [0], 'paragraph'), 'writeback'),
    /character styling requires a non-empty quote/,
  );
});
