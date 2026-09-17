/**
 * rebaseProposal: the actionable recovery when the source file changed after a proposal
 * was signed. The ChangeSet is format-level; only its revision binding is source-bound,
 * so the runtime can rebind + re-sign without another model call — while the review
 * boundary stays intact (the new receipt binds the new source hash).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zipSync } from 'fflate';
import { MockModelClient } from '@otterpatch/agent';
import type { ProposeRequest } from '@otterpatch/agent';
import type { DocRev } from '@otterpatch/core';
import { OtterPatchRuntime } from './runtime.js';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

/** Build an xlsx whose B1 cell holds `value`. */
function makeXlsx(value: number): Uint8Array {
  return zipSync({
    '[Content_Types].xml': enc('<?xml version="1.0"?><Types/>'),
    '_rels/.rels': enc('<?xml version="1.0"?><Relationships/>'),
    'xl/workbook.xml': enc(
      '<?xml version="1.0"?><workbook xmlns:r="r"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>',
    ),
    'xl/_rels/workbook.xml.rels': enc(
      '<?xml version="1.0"?><Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    ),
    'xl/styles.xml': enc('<?xml version="1.0"?><styleSheet/>'),
    'xl/worksheets/sheet1.xml': enc(
      `<?xml version="1.0"?><worksheet><sheetData><row r="1"><c r="B1" s="2"><v>${value}</v></c></row></sheetData></worksheet>`,
    ),
  });
}

async function proposeB1Set(runtime: OtterPatchRuntime): ReturnType<OtterPatchRuntime['propose']> {
  const model = new MockModelClient(() => ({ plan: '把 B1 改成 99', edits: [{ cell: 'Sheet1!B1', op: 'setValue', value: 99 }] }));
  const request: ProposeRequest = {
    hostId: 'h1', format: 'excel', intent: '把 B1 改成 99', baseRev: 0 as DocRev, anchors: [], context: 'B1=20',
    sheet: { a1: 'Sheet1!B1', name: 'Sheet1', values: [[20]], formulas: [[null]] },
  };
  return runtime.propose(request, model);
}

test('rebaseProposal: re-signs the same ChangeSet against the new source bytes', async () => {
  const rt = new OtterPatchRuntime();
  const cs = await proposeB1Set(rt);

  const oldSource = makeXlsx(20);
  const oldProposal = rt.createProposal(cs, 'excel');
  assert.equal(oldProposal.sourceFileSha256, undefined);

  const newSource = makeXlsx(25); // the file changed under the proposal
  const rebased = rt.rebaseProposal(cs, 'excel', newSource);

  assert.notEqual(rebased.proposal.proposalId, oldProposal.proposalId, 'a fresh proposal is minted');
  assert.ok(rebased.proposal.sourceFileSha256, 'the new proposal binds the new source hash');
  assert.notEqual(rebased.changeSet.baseRev, cs.baseRev, 'the revision binding moved');
  assert.deepEqual(
    rebased.changeSet.edits.map((edit) => edit.op),
    cs.edits.map((edit) => edit.op),
    'the edits themselves are untouched — only the revision binding moves',
  );
  for (const anchor of Object.values(rebased.changeSet.anchors)) {
    assert.equal(anchor.baseRev, rebased.changeSet.baseRev, 'anchor revisions track the ChangeSet revision');
  }
});

test('rebaseProposal: the rebased proposal commits against the new bytes end-to-end', async () => {
  const rt = new OtterPatchRuntime();
  const cs = await proposeB1Set(rt);
  const newSource = makeXlsx(25);

  const rebased = rt.rebaseProposal(cs, 'excel', newSource);
  const reviewed = rt.reviewProposal(
    rebased.proposal,
    rebased.changeSet,
    rebased.changeSet.edits.map((edit) => edit.id),
    newSource,
    'reviewer-2',
  );
  const res = await rt.commit({ format: 'excel', bytes: newSource, changeSet: rebased.changeSet, ...reviewed });
  assert.equal(res.ok, true);
});

test('rebaseProposal: the stale proposal cannot commit against the new bytes', async () => {
  const rt = new OtterPatchRuntime();
  const cs = await proposeB1Set(rt);
  const oldSource = makeXlsx(20);
  const newSource = makeXlsx(25);

  const stale = rt.reviewProposal(
    rt.createProposal(cs, 'excel'),
    cs,
    cs.edits.map((edit) => edit.id),
    oldSource,
    'reviewer-1',
  );
  // Committing the OLD ChangeSet against the NEW bytes fails closed on the revision check.
  await assert.rejects(
    rt.commit({ format: 'excel', bytes: newSource, changeSet: cs, ...stale, currentRev: undefined }),
    /review receipt source file hash mismatch/,
  );
});

test('rebaseProposal: an unchanged source re-signs without moving the revision', async () => {
  const rt = new OtterPatchRuntime();
  const cs = await proposeB1Set(rt);
  const source = makeXlsx(20);
  // Make the ChangeSet's baseRev match this exact source, as a real proposal would be.
  const bound = rt.rebaseProposal(cs, 'excel', source).changeSet;
  const again = rt.rebaseProposal(bound, 'excel', source);
  assert.equal(again.changeSet.baseRev, bound.baseRev);
  assert.deepEqual(again.changeSet.anchors, bound.anchors);
});

test('rebaseProposal: validates the rebased ChangeSet through the format adapter', async () => {
  const rt = new OtterPatchRuntime();
  const cs = await proposeB1Set(rt);
  const newSource = makeXlsx(25);
  const rebased = rt.rebaseProposal(cs, 'excel', newSource);
  // The rebased ChangeSet must satisfy assertChangeSet + the excel manifest.
  const diff = await rt.diff(rebased.changeSet, {
    format: 'excel',
    sheet: { a1: 'Sheet1!B1', name: 'Sheet1', values: [[25]], formulas: [[null]] },
  });
  assert.equal(diff.items.length, 1);
  assert.deepEqual(diff.items[0]?.before, { kind: 'cell', value: 25 });
});

test('rebaseProposal: an unknown format fails closed', async () => {
  const rt = new OtterPatchRuntime();
  const cs = await proposeB1Set(rt);
  assert.throws(
    () => rt.rebaseProposal(cs, 'pdf', makeXlsx(25)),
    /no adapter registered for format "pdf"/,
  );
});
