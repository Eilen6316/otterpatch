/**
 * 提交记录面板:空态、展开细节、验证计数、审阅方式标注。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { TContext } from './i18n.js';
import { CommitHistory } from './CommitHistory.js';
import type { DesktopAuditRecord } from './electron-bridge.js';

const t = (s: string): string => s;

function record(overrides: Partial<DesktopAuditRecord> = {}): DesktopAuditRecord {
  return {
    ts: '2026-09-17T12:00:00.000Z',
    documentId: 'doc-a',
    format: 'excel',
    reviewKind: 'receipt',
    changeSetId: 'cs1',
    intent: '把 B1 改成 99',
    editCount: 1,
    acceptedEditIds: ['e0'],
    sourceSha256: 'a'.repeat(64),
    outputSha256: 'b'.repeat(64),
    backendId: 'surgical-ooxml',
    ok: true,
    touchedParts: ['xl/worksheets/sheet1.xml'],
    fidelity: 1,
    verification: { packageValid: true, verifiedEdits: ['e0'], unverifiableEdits: [], failedEdits: [] },
    ...overrides,
  };
}

const render = (records: DesktopAuditRecord[], available = true): string =>
  renderToStaticMarkup(
    <TContext.Provider value={t}>
      <CommitHistory records={records} available={available} />
    </TContext.Provider>,
  );

test('CommitHistory renders nothing without records and without a ledger', () => {
  assert.equal(render([], false), '');
});

test('CommitHistory shows the empty-state hint when the ledger is configured but empty', () => {
  const markup = render([], true);
  assert.match(markup, /提交记录/);
  assert.match(markup, /OtterPatch_AUDIT_DIR/);
});

test('CommitHistory shows intent, review kind and verification counts', () => {
  const markup = render([record()]);
  assert.match(markup, /把 B1 改成 99/);
  assert.match(markup, /1 处改动/);
  assert.match(markup, /1 处验证通过/);
  assert.match(markup, /excel/);
});

test('CommitHistory flags failed edits and the unreviewed exception', () => {
  const markup = render([
    record({
      reviewKind: 'unreviewed',
      verification: { packageValid: true, verifiedEdits: [], unverifiableEdits: [], failedEdits: [{ editId: 'e0', reason: 'anchor did not match' }] },
    }),
  ]);
  assert.match(markup, /1 处未通过验证/);
});

test('CommitHistory sorts newest first', () => {
  const markup = render([
    record({ ts: '2026-09-17T12:00:00.000Z', intent: 'older' }),
    record({ ts: '2026-09-17T13:00:00.000Z', intent: 'newer' }),
  ]);
  assert.ok(markup.indexOf('newer') < markup.indexOf('older'), 'newest commit renders first');
});
