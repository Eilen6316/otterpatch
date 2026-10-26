import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unzipSync } from 'fflate';
import { assertChangeSet } from '@otterpatch/core';
import { initializeSkillLibrary, defaultLibrary, setImportedSkillState, skillChecksum } from '@otterpatch/skills';
import { OtterPatchRuntime, sha256Bytes } from '@otterpatch/runtime';
import { officialRegistry, tasks, docx, request, acceptedText, quality, skillId } from './internal-comms-fixture.mjs';

for (const task of tasks) test(`official internal-comms engineering ${task.id}`, async () => {
  const root = mkdtempSync(join(tmpdir(), 'official-comms-'));
  try {
    const imported = officialRegistry(root);
    const { library, errors } = initializeSkillLibrary({ registry: root }); assert.deepEqual(errors, []);
    let bodyLoaded = false; let referencesLoaded = 0;
    const model = {
      identity: { provider: 'mock', model: 'deterministic-engineering-only' },
      proposeChangeSet: async () => { throw new Error('unused'); },
      respond: async (req, dialect, opts) => {
        assert.ok(!dialect.systemPrompt.includes(imported.card.description));
        assert.ok(!dialect.systemPrompt.includes('## When to use this skill'));
        const tools = opts.extraTools;
        const catalog = JSON.parse(tools.exec('find_skills', { query: task.intent }));
        assert.equal(catalog.untrusted_data, true);
        // Even adversarial intents can explicitly inspect the approved card; ordinary
        // positive discovery and negative matching are tested independently below.
        if (!task.expected || task.expected === 'clarify') assert.ok(catalog.skills.some((s) => s.id === skillId));
        const body = JSON.parse(tools.exec('load_skill', { name: skillId }));
        assert.equal(body.untrusted_data, true); assert.equal(body.trust, 'external');
        assert.equal(body.content, imported.card.instructions);
        assert.equal(body.provenance.sourceChecksum, skillChecksum(readFileSync('third-party/anthropic-internal-comms/SKILL.md', 'utf8')));
        assert.ok(body.adaptation.instructions.includes('已有 Word')); bodyLoaded = true;
        for (const file of imported.card.references) {
          const reference = JSON.parse(tools.exec('load_skill_reference', { name: skillId, path: file.path }));
          assert.equal(reference.untrusted_data, true); assert.equal(reference.content, file.content);
          assert.equal(reference.checksum, file.checksum); referencesLoaded++;
        }
        for (const path of ['examples/not-approved.md', '../LICENSE.txt', '/etc/passwd', 'scripts/run.py']) {
          assert.match(tools.exec('load_skill_reference', { name: skillId, path }), /not approved/);
        }
        assert.equal(tools.exec('shell', { command: 'echo unsafe' }), null);
        const unsupported = dialect.buildChangeSet(req, { plan: 'unsupported structure', edits: [{ quote: task.paragraphs[0], replacement: 'new' }] });
        unsupported.edits[0].op = { family: 'structure', kind: 'insertParagraph', text: 'new' };
        assert.throws(() => assertChangeSet(unsupported));
        await assert.rejects(runtime.commit({ format: 'word', bytes: docx(task), changeSet: unsupported }));
        if (task.expected === 'clarify') return { kind: 'clarify', questions: [{ header: '核实事实', question: '请确认冲突事实或缺失依据。', options: [] }] };
        if (task.expected === 'refuse') return { kind: 'answer', text: '当前仅支持已有 Word 的受约束局部修订，不能执行脚本、任意新建结构或跳过人工审阅。' };
        const edits = [...task.edits];
        if (task.id === 'weekly-clear') edits.push({ quote: task.paragraphs[1], replacement: '保护区域被改为999万元。' });
        return { kind: 'changeset', changeSet: dialect.buildChangeSet(req, { plan: '基于已读事实的局部润色，保留原始数值和不确定性。', edits }) };
      },
    };
    const runtime = new OtterPatchRuntime({ skills: library }); const bytes = docx(task); const originalHash = sha256Bytes(bytes);
    const response = await runtime.respond(request(task, bytes), model);
    assert.equal(bodyLoaded, true); assert.equal(referencesLoaded, 4);
    assert.equal(sha256Bytes(bytes), originalHash);
    if (task.expected) { assert.notEqual(response.kind, 'changeset'); return; }
    assert.equal(response.kind, 'changeset'); const cs = response.changeSet; assertChangeSet(cs);
    assert.ok(cs.origin.provenance.skillVersions.some((s) => s.id === skillId && s.checksum === imported.card.checksum));
    await assert.rejects(runtime.commit({ format: 'word', bytes, changeSet: cs }), /signed proposal/);
    const accepted = cs.edits.slice(0, task.edits.length).map((edit) => edit.id);
    const proposal = runtime.createProposal(cs, 'word');
    const reviewed = runtime.reviewProposal(proposal, cs, accepted, bytes, 'synthetic-reviewer-not-a-human');
    await assert.rejects(runtime.commit({ format: 'word', bytes, changeSet: cs, ...reviewed, reviewReceipt: { ...reviewed.reviewReceipt, signature: '0'.repeat(64) } }), /signature/);
    const committed = await runtime.commit({ format: 'word', bytes, changeSet: cs, ...reviewed });
    assert.equal(committed.ok, true); assert.equal(committed.fidelity.verification.packageValid, true);
    assert.deepEqual(committed.fidelity.verification.semantic.failedEdits, []);
    assert.deepEqual(committed.fidelity.verification.semantic.verifiedEdits, accepted);
    const before = unzipSync(bytes); const after = unzipSync(committed.bytes);
    for (const path of Object.keys(before)) if (path !== 'word/document.xml') assert.deepEqual(after[path], before[path], path);
    const text = acceptedText(committed.bytes); assert.equal(quality(task, text, response.kind).ruleScore, 4);
    for (const edit of task.edits) assert.ok(text.includes(edit.replacement));
    assert.ok(!text.includes('999万元')); assert.equal(sha256Bytes(bytes), originalHash);
    if (process.env.INTERNAL_COMMS_ARTIFACT_DIR) {
      const directory = process.env.INTERNAL_COMMS_ARTIFACT_DIR; mkdirSync(directory, { recursive: true });
      writeFileSync(join(directory, `${task.id}.before.docx`), bytes);
      writeFileSync(join(directory, `${task.id}.after.docx`), committed.bytes);
      writeFileSync(join(directory, `${task.id}.verification.json`), JSON.stringify({ syntheticReviewer: true, originalHash, acceptedEditIds: accepted, verification: committed.fidelity.verification, checks: quality(task, text, response.kind) }, null, 2));
    }

    await assert.rejects(runtime.commit({ format: 'word', bytes, changeSet: cs, ...reviewed }), /already been/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('official matching is local, narrow, versioned; disable/re-enable is persistent across library instances', () => {
  const root = mkdtempSync(join(tmpdir(), 'official-match-'));
  try {
    const imported = officialRegistry(root); let library = initializeSkillLibrary({ registry: root }).library;
    const positive = ['帮我检查这份项目周报','帮我规范这份项目周报','检查这份工作汇报的表达','整理领导汇报中的进展、计划和问题','审阅团队内部通知','检查这份 FAQ 的语言和结构'];
    for (const intent of positive) assert.equal(library.match(intent, 'word')[0]?.namespace, 'anthropic', intent);
    for (const intent of ['调整字体和段落间距','公文排版','帮我起草一份项目报告','检查财务公式']) {
      const format = intent.includes('公式') ? 'excel' : 'word';
      assert.equal(library.match(intent, format)[0]?.name, defaultLibrary().match(intent, format)[0]?.name, intent);
    }
    assert.deepEqual(library.match('项目周报', 'ppt'), []);
    setImportedSkillState(root, imported.id, imported.release, false);
    library = initializeSkillLibrary({ registry: root }).library; assert.equal(library.resolve(skillId), undefined);
    setImportedSkillState(root, imported.id, imported.release, true);
    assert.equal(initializeSkillLibrary({ registry: root }).library.resolve(skillId)?.checksum, imported.card.checksum);
  } finally { rmSync(root, { recursive: true, force: true }); }
});


test('real A/B without credentials is explicitly SKIPPED, never a zero-sample quality PASS', () => {
  const root = mkdtempSync(join(tmpdir(), 'internal-ab-skip-'));
  try {
    const env = { ...process.env };
    for (const name of ['OtterPatch_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY']) delete env[name];
    const output = execFileSync(process.execPath, ['test/eval-internal-comms.mjs', '--real', '--out', join(root, 'report.json')], { env, encoding: 'utf8', timeout: 10000 });
    const report = JSON.parse(readFileSync(join(root, 'report.json'), 'utf8'));
    assert.match(output, /SKIPPED — no real model evaluation/);
    assert.equal(report.groups.A.executed, 0); assert.equal(report.groups.B.executed, 0);
    assert.equal(report.groups.B.metrics, null); assert.equal(report.tokens, null); assert.equal(report.costUSD, null);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
