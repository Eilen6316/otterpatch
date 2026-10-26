/** Deterministic pilot comparison through real import -> Agent tools -> human review -> writeback. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync, unzipSync } from 'fflate';
import { assertChangeSet, docRevFromSha256, type ChangeSet } from '@otterpatch/core';
import type { ModelClient, ProposeRequest } from '@otterpatch/agent';
import { defaultLibrary, importAllowedSkill, initializeSkillLibrary, setImportedSkillState, type SkillImportConfig, type SkillLibrary } from '@otterpatch/skills';
import { OtterPatchRuntime } from './runtime.js';
import { sha256Bytes } from './review.js';

function pilotFixture() {
  const root = mkdtempSync(join(tmpdir(), 'otterpatch-pilots-'));
  const source = join(root, 'source'); mkdirSync(source);
  cpSync(fileURLToPath(new URL('../../../examples/agent-skills', import.meta.url)), join(source, 'examples', 'agent-skills'), { recursive: true });
  cpSync(fileURLToPath(new URL('../../../LICENSE', import.meta.url)), join(source, 'LICENSE'));
  const git = (...args: string[]): string => execFileSync('git', ['-C', source, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init'); git('config', 'user.name', 'Pilot test'); git('config', 'user.email', 'pilot@example.invalid');
  git('remote', 'add', 'origin', 'https://github.com/Eilen6316/otterpatch.git'); git('add', '.'); git('commit', '-qm', 'independent pilots');
  const config = JSON.parse(execFileSync(process.execPath, [
    fileURLToPath(new URL('../../../scripts/prepare-pilot-import.mjs', import.meta.url)),
    '--checkout', source, '--revision', git('rev-parse', 'HEAD'), '--registry', join(root, 'registry'), '--approved-by', 'deterministic-test-admin',
  ], { encoding: 'utf8' })) as SkillImportConfig;
  for (const approval of config.sources[0]!.skills) {
    const imported = importAllowedSkill(config, 'otterpatch-pilots', approval.path);
    setImportedSkillState(config.registryDirectory, imported.id, imported.release, true);
  }
  return { root, config };
}
function document(format: string): Uint8Array {
  const enc = (s: string) => new TextEncoder().encode(s);
  const base = { '[Content_Types].xml': enc('<?xml version="1.0"?><Types/>'), '_rels/.rels': enc('<?xml version="1.0"?><Relationships/>') };
  return format === 'excel' ? zipSync({ ...base,
    'xl/workbook.xml': enc('<workbook xmlns:r="r"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>'),
    'xl/_rels/workbook.xml.rels': enc('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
    'xl/styles.xml': enc('<styleSheet/>'),
    'xl/worksheets/sheet1.xml': enc('<worksheet><sheetData><row r="1"><c r="B1"><v>20</v></c></row></sheetData></worksheet>'),
  }) : zipSync({ ...base,
    'word/document.xml': enc('<w:document xmlns:w="w"><w:body><w:p><w:r><w:t>旧术语</w:t></w:r></w:p></w:body></w:document>'),
    'word/styles.xml': enc('<w:styles xmlns:w="w"/>'),
  });
}

for (const format of ['excel', 'word']) test(`pilot ${format}: discovery, actual untrusted loading, legal ChangeSet, review and verified writeback`, async () => {
  const fixture = pilotFixture();
  try {
    const name = format === 'excel' ? 'excel-data-quality' : 'word-technical-review';
    const id = `pilot/${name}`;
    const after = initializeSkillLibrary({ registry: fixture.config.registryDirectory });
    assert.deepEqual(after.errors, []);
    const queries = format === 'excel' ? ['数据质量', '检查缺失值与重复值', '核查資料品質'] : ['技术文档规范检查', '核查术语和标题层级', '检查技術文件'];
    const before = defaultLibrary();
    assert.equal(queries.filter((q) => before.match(q, format)[0]?.name === name).length, 0);
    assert.equal(queries.filter((q) => after.library.match(q, format)[0]?.name === name).length, 3);
    const bytes = document(format);
    const request: ProposeRequest = {
      hostId: 'pilot-document', documentId: 'pilot-document', userId: 'test-user', format,
      intent: format === 'excel' ? '数据质量检查，把 Sheet1!B1 显示为两位小数' : '技术文档规范检查，把唯一的旧术语改为接口',
      baseRev: docRevFromSha256(sha256Bytes(bytes)), sourceFileSha256: sha256Bytes(bytes), anchors: [], context: '',
      ...(format === 'excel' ? { sheet: { a1: 'Sheet1!B1', name: 'Sheet1', values: [[20]], formulas: [[null]] } }
        : { doc: { blocks: [{ style: 'Normal', text: '旧术语' }] } }),
    };
    const run = async (library: SkillLibrary, enabled: boolean): Promise<{ runtime: OtterPatchRuntime; cs: ChangeSet }> => {
      let loads = 0;
      const model: ModelClient = {
        proposeChangeSet: async () => { throw new Error('unused'); },
        respond: async (req, dialect, opts) => {
          assert.doesNotMatch(dialect.systemPrompt, /pilot\//);
          assert.doesNotMatch(dialect.systemPrompt, /independently-authored/);
          const tools = opts?.extraTools;
          const catalog = JSON.parse(tools!.exec('find_skills', { query: req.intent })!) as { untrusted_data: boolean; skills: Array<{ id: string }> };
          assert.equal(catalog.untrusted_data, true);
          const found = catalog.skills.some((skill) => skill.id === id);
          assert.equal(found, enabled);
          let reference = '';
          if (found) {
            const body = JSON.parse(tools!.exec('load_skill', { name: id })!) as { untrusted_data: boolean; trust: string; content: string };
            assert.equal(body.untrusted_data, true); assert.equal(body.trust, 'external'); assert.match(body.content, /人工/); loads++;
            const text = JSON.parse(tools!.exec('load_skill_reference', { name: id, path: 'references/checklist.md' })!) as { untrusted_data: boolean; content: string };
            assert.equal(text.untrusted_data, true); reference = text.content; loads++;
            assert.match(tools!.exec('load_skill_reference', { name: id, path: '../../LICENSE' })!, /not approved/);
            assert.match(tools!.exec('load_skill_reference', { name: id, path: 'scripts/run.sh' })!, /not approved/);
          } else assert.ok(!tools!.defs.some((tool) => tool.name === 'load_skill_reference'));
          const proposal = format === 'excel'
            ? { plan: found ? '按已加载清单核查并提出显示修正' : '仅基础格式建议', edits: [{ cell: 'Sheet1!B1', op: 'setNumberFormat', pattern: reference.includes('0.00') ? '0.00' : '0' }] }
            : { plan: found ? '已核查术语、层级和引用清单' : '仅基础术语替换', edits: [{ quote: '旧术语', replacement: '接口' }] };
          return { kind: 'changeset', changeSet: dialect.buildChangeSet(req, proposal) };
        },
      };
      const runtime = new OtterPatchRuntime({ skills: library });
      const response = await runtime.respond({ ...request }, model);
      assert.equal(response.kind, 'changeset');
      if (response.kind !== 'changeset') throw new Error('expected ChangeSet');
      const cs = response.changeSet; assertChangeSet(cs);
      assert.equal(loads, enabled ? 2 : 0);
      assert.equal(cs.origin.by, 'agent');
      if (cs.origin.by === 'agent') assert.equal(cs.origin.provenance.skillVersions.some((s) => s.id === id), enabled);
      return { runtime, cs };
    };
    const baseline = await run(before, false);
    const enabled = await run(after.library, true);
    if (format === 'excel') {
      assert.equal(baseline.cs.edits[0]!.op.kind, 'setNumberFormat');
      assert.notDeepEqual(baseline.cs.edits[0]!.op, enabled.cs.edits[0]!.op);
    }
    await assert.rejects(enabled.runtime.commit({ format, bytes, changeSet: enabled.cs }), /signed proposal/);
    const proposal = enabled.runtime.createProposal(enabled.cs, format);
    const reviewed = enabled.runtime.reviewProposal(proposal, enabled.cs, enabled.cs.edits.map((edit) => edit.id), bytes, 'human-test-reviewer');
    await assert.rejects(enabled.runtime.commit({ format, bytes, changeSet: enabled.cs, ...reviewed, reviewReceipt: { ...reviewed.reviewReceipt, signature: '0'.repeat(64) } }), /signature/);
    const committed = await enabled.runtime.commit({ format, bytes, changeSet: enabled.cs, ...reviewed });
    assert.equal(committed.ok, true); assert.equal(committed.fidelity.verification.packageValid, true);
    assert.deepEqual(committed.fidelity.verification.semantic.failedEdits, []);
    assert.deepEqual(committed.fidelity.verification.semantic.verifiedEdits, enabled.cs.edits.map((edit) => edit.id));
    const parts = unzipSync(committed.bytes);
    assert.match(new TextDecoder().decode(parts[format === 'excel' ? 'xl/styles.xml' : 'word/document.xml']), format === 'excel' ? /0\.00/ : /接口/);
    await assert.rejects(enabled.runtime.commit({ format, bytes, changeSet: enabled.cs, ...reviewed }), /already been/);
  } finally { rmSync(fixture.root, { recursive: true, force: true }); }
});
