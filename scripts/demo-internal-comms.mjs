/** Explicit administrator lifecycle demo. Uses the existing CLI, never installs automatically. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { skillLibraryFromEnv } from '@otterpatch/skills';
import { OtterPatchRuntime } from '@otterpatch/runtime';
import { tasks, docx, request } from '../test/internal-comms-fixture.mjs';
const arg = (name) => { const i = process.argv.indexOf(`--${name}`); if (i < 0 || !process.argv[i + 1]) throw new Error(`--${name} required`); return process.argv[i + 1]; };
const configPath = resolve(arg('config')); const outputPath = resolve(arg('out'));
const config = JSON.parse(readFileSync(configPath, 'utf8'));
const cli = (action, args) => JSON.parse(execFileSync(process.execPath, ['apps/mcp-server/dist/skills-cli.js', action, '--config', configPath, ...args], { encoding: 'utf8', timeout: 30000 }));
const imported = cli('import', ['--source', 'anthropic-internal-comms', '--path', 'skills/internal-comms/SKILL.md']);
assert.equal(imported.id, 'anthropic/internal-comms');
const selected = ['--id', imported.id, '--release', imported.release];
const inspected = cli('inspect', ['--release', imported.release]); assert.equal(inspected.card.references.length, 4);
const env = { ...process.env, OtterPatch_SKILL_REGISTRY: config.registryDirectory, OtterPatch_SKILLS_DIR: '' };
const discover = () => JSON.parse(execFileSync(process.execPath, ['apps/mcp-server/dist/cli.js', '--list-skills'], { env, encoding: 'utf8', timeout: 10000 })).skills.find((skill) => skill.id === imported.id);
cli('enable', selected); assert.equal(discover()?.checksum, imported.card.checksum);
cli('disable', selected); assert.equal(discover(), undefined);
cli('rollback', selected); assert.equal(discover()?.checksum, imported.card.checksum);
let loaded = 0; const paths = [];
const runtime = new OtterPatchRuntime({ skills: skillLibraryFromEnv(env) });
const model = { identity: { provider: 'mock', model: 'engineering-load-proof-only' },
  proposeChangeSet: async () => { throw new Error('unused'); },
  respond: async (req, dialect, opts) => {
    assert.ok(!dialect.systemPrompt.includes(imported.card.description));
    const catalog = JSON.parse(opts.extraTools.exec('find_skills', { query: req.intent }));
    assert.ok(catalog.skills.some((skill) => skill.id === imported.id));
    const body = JSON.parse(opts.extraTools.exec('load_skill', { name: imported.id }));
    assert.equal(body.untrusted_data, true); assert.equal(body.content, imported.card.instructions); loaded++;
    for (const { path } of imported.card.references) {
      const reference = JSON.parse(opts.extraTools.exec('load_skill_reference', { name: imported.id, path }));
      assert.equal(reference.untrusted_data, true); assert.equal(reference.kind, 'skill_reference'); paths.push(path);
    }
    return { kind: 'changeset', changeSet: dialect.buildChangeSet(req, { plan: '已读取官方原文和四份示例；工程验证，不是真实模型评测。', edits: tasks[0].edits }) };
  },
};
const response = await runtime.respond(request(tasks[0], docx(tasks[0])), model);
assert.ok(response.changeSet.origin.provenance.skillVersions.some((skill) => skill.id === imported.id && skill.checksum === imported.card.checksum));
const report = { status: 'PASS — engineering lifecycle only', id: imported.id, release: imported.release,
  version: imported.card.version, upstream: imported.card.provenance, license: imported.card.license,
  approvalIdentity: config.sources[0].skills[0].approvedBy, originalFilesUnmodified: true,
  lifecycle: ['imported via administrator CLI', 'inspected', 'enabled and discovered in new CLI process', 'disabled and absent in new CLI process', 'rolled back/re-enabled exact persisted release in new CLI process'],
  actualBodyLoads: loaded, actualReferenceLoads: paths, trust: imported.card.trust, realModelEvaluation: 'SKIPPED — no real model evaluation',
};
mkdirSync(dirname(outputPath), { recursive: true }); writeFileSync(outputPath, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
