import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importAllowedSkill, loadImportedSkills, readImportedRelease, setImportedSkillState, skillChecksum, MAX_REFERENCE_BYTES, type SkillImportConfig } from './importer.js';
import { initializeSkillLibrary } from './initialize.js';
import { parseSkillMd } from './parse.js';
import { defaultLibrary } from './catalog.js';

const markdown = `---
name: quality
version: 1.0.0
description: >-
  检查数据质量
  保留原始证据
formats:
  - excel
keywords: [数据质量, 缺失值]
triggers: [质量检查]
allowed_ops: [setNumberFormat]
license: Apache-2.0
metadata:
  author: test
  category: review
---
只读检查，格式修改须人工审阅。`;
function fixture(md = markdown) {
  const root = mkdtempSync(join(tmpdir(), 'otterpatch-import-'));
  const checkout = join(root, 'source'); mkdirSync(checkout);
  const git = (...args: string[]): string => execFileSync('git', ['-C', checkout, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init'); git('config', 'user.name', 'Skill fixture'); git('config', 'user.email', 'fixture@example.invalid');
  git('remote', 'add', 'origin', 'https://github.com/example/approved.git');
  mkdirSync(join(checkout, 'quality', 'references'), { recursive: true });
  writeFileSync(join(checkout, 'quality', 'SKILL.md'), md);
  writeFileSync(join(checkout, 'quality', 'references', 'check.md'), '核对缺失值与显示格式。');
  writeFileSync(join(checkout, 'LICENSE'), readFileSync(new URL('../../../third-party/anthropic-internal-comms/LICENSE.txt', import.meta.url)));
  git('add', '.'); git('commit', '-qm', 'approved skill');
  const config: SkillImportConfig = { version: 1, registryDirectory: join(root, 'registry'), sources: [{
    id: 'approved', checkoutDirectory: checkout, repository: 'example/approved', revision: git('rev-parse', 'HEAD'), skills: [{
      path: 'quality/SKILL.md', checksum: skillChecksum(md), namespace: 'pilot', version: '1.0.0', formats: ['excel'], allowedOps: ['setNumberFormat'],
      approvedBy: 'test-admin', mode: 'text-only', license: { spdx: 'Apache-2.0', path: 'LICENSE', checksum: skillChecksum(readFileSync(join(checkout, 'LICENSE'), 'utf8')) },
      references: [{ path: 'references/check.md', checksum: skillChecksum('核对缺失值与显示格式。') }],
    }],
  }] };
  return { root, checkout, git, config, approval: config.sources[0]!.skills[0]!, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('standard YAML: quoted scalars, block descriptions, sequences, nested metadata and raw checksums', () => {
  const card = parseSkillMd(markdown.replace('name: quality', 'name: "quality"'));
  assert.equal(card.name, 'quality'); assert.deepEqual(card.formats, ['excel']);
  assert.match(card.description, /检查数据质量 保留原始证据/);
  assert.deepEqual(card.metadata?.metadata, Object.assign(Object.create(null), { author: 'test', category: 'review' }));
  assert.equal(card.license, 'Apache-2.0'); assert.equal(card.trust, 'external');
  assert.equal(parseSkillMd(markdown.replace('version: 1.0.0', 'version:')).version, '1.0.0');
  for (const bad of ['name: a\nname: b', 'name: &n quality\ndescription: *n', 'name: !!js/function x', '__proto__: pollution']) {
    assert.throws(() => parseSkillMd(`---\n${bad}\n---\ntext`));
  }
});

test('import is disabled until human activation; snapshot references and license are verified', () => {
  const f = fixture();
  try {
    const imported = importAllowedSkill(f.config, 'approved', f.approval.path);
    assert.equal(imported.card.trust, 'external'); assert.equal(imported.card.immutable, false);
    assert.equal(imported.card.provenance?.revision, f.config.sources[0]!.revision);
    assert.equal(imported.card.references?.[0]?.content, '核对缺失值与显示格式。');
    assert.equal(imported.card.license, 'Apache-2.0'); assert.equal(loadImportedSkills(f.config.registryDirectory).cards.length, 0);
    setImportedSkillState(f.config.registryDirectory, imported.id, imported.release, true);
    const initialized = initializeSkillLibrary({ registry: f.config.registryDirectory });
    assert.deepEqual(initialized.errors, []);
    assert.equal(initialized.library.match('核查缺漏值和資料品質', 'xlsx')[0]?.name, 'quality');
    assert.doesNotMatch(initialized.library.render('excel', '数据质量'), /pilot\/quality/);
    assert.equal(initialized.library.toMcpTools().some((tool) => tool.name.includes('pilot')), false);
    const loose = join(f.root, 'loose'); mkdirSync(loose);
    writeFileSync(join(loose, 'shadow.md'), markdown.replace('name: quality', 'name: quality\nnamespace: pilot') + '\nLoose shadow.');
    const collision = initializeSkillLibrary({ registry: f.config.registryDirectory, directory: loose });
    assert.equal(collision.library.resolve(imported.id)?.checksum, imported.card.checksum);
    assert.equal(collision.errors.length, 1); assert.match(collision.errors[0]!.reason, /conflict/);
    const lib = defaultLibrary(); lib.add(imported.card);
    assert.throws(() => lib.add({ ...imported.card, checksum: 'sha256:' + 'a'.repeat(64) }), /conflict/);
    assert.throws(() => lib.add({ ...imported.card, namespace: 'otterpatch' }), /reserved/);
    setImportedSkillState(f.config.registryDirectory, imported.id, imported.release, false);
    assert.equal(loadImportedSkills(f.config.registryDirectory).cards.length, 0);
  } finally { f.cleanup(); }
});

test('version locks read committed objects, preserve revisions, and support explicit rollback', () => {
  const f = fixture();
  try {
    const first = importAllowedSkill(f.config, 'approved', f.approval.path);
    writeFileSync(join(f.checkout, 'quality', 'SKILL.md'), 'uncommitted hostile content');
    assert.equal(importAllowedSkill(f.config, 'approved', f.approval.path).release, first.release);
    const next = markdown.replace('version: 1.0.0', 'version: 2.0.0') + '\nUpdated checklist.';
    writeFileSync(join(f.checkout, 'quality', 'SKILL.md'), next); f.git('add', '.'); f.git('commit', '-qm', 'v2');
    f.config.sources[0]!.revision = f.git('rev-parse', 'HEAD'); f.approval.version = '2.0.0'; f.approval.checksum = skillChecksum(next);
    const second = importAllowedSkill(f.config, 'approved', f.approval.path);
    setImportedSkillState(f.config.registryDirectory, second.id, second.release, true);
    assert.equal(loadImportedSkills(f.config.registryDirectory).cards[0]!.version, '2.0.0');
    setImportedSkillState(f.config.registryDirectory, first.id, first.release, true);
    assert.equal(loadImportedSkills(f.config.registryDirectory).cards[0]!.version, '1.0.0');
    assert.throws(() => setImportedSkillState(f.config.registryDirectory, 'pilot/other', first.release, true), /conflict/);
    writeFileSync(join(f.config.registryDirectory, 'releases', `${first.release}.json`), '{}');
    assert.equal(loadImportedSkills(f.config.registryDirectory).cards.length, 0);
    assert.match(loadImportedSkills(f.config.registryDirectory).errors[0]!.reason, /checksum/);
  } finally { f.cleanup(); }
});

const denials: Array<[string, (f: ReturnType<typeof fixture>) => void]> = [
  ['moving revision', (f) => { f.config.sources[0]!.revision = 'main'; }],
  ['wrong origin', (f) => { f.config.sources[0]!.repository = 'other/repo'; }],
  ['checksum', (f) => { f.approval.checksum = 'sha256:' + '0'.repeat(64); }],
  ['unreviewed', (f) => { f.approval.approvedBy = ''; }],
  ['missing license', (f) => { f.approval.license.spdx = ''; }],
  ['unverified license', (f) => { f.approval.license.spdx = 'NOASSERTION'; }],
  ['license hash', (f) => { f.approval.license.checksum = 'sha256:' + '0'.repeat(64); }],
  ['operation escalation', (f) => { f.approval.allowedOps = ['insertChart']; }],
  ['silent narrowing', (f) => { f.approval.allowedOps = []; }],
  ['PDF', (f) => { f.approval.formats = ['pdf']; }],
  ['PPTX', (f) => { f.approval.formats = ['pptx']; }],
  ['builtin override', (f) => { f.approval.namespace = 'otterpatch'; }],
  ['references escape', (f) => { f.approval.references[0]!.path = 'references/../../LICENSE'; }],
  ['absolute reference', (f) => { f.approval.references[0]!.path = '/etc/passwd'; }],
  ['Windows reference', (f) => { f.approval.references[0]!.path = 'references\\check.md'; }],
  ['scripts', (f) => { f.approval.references[0]!.path = 'scripts/check.sh'; }],
  ['reference checksum', (f) => { f.approval.references[0]!.checksum = 'sha256:' + '0'.repeat(64); }],
];
for (const [name, change] of denials) test(`import rejects ${name}`, () => {
  const f = fixture(); try { change(f); assert.throws(() => importAllowedSkill(f.config, 'approved', f.approval.path)); }
  finally { f.cleanup(); }
});

test('only manually allowlisted sources and paths are selectable', () => {
  const f = fixture(); try {
    assert.throws(() => importAllowedSkill(f.config, 'unknown', f.approval.path), /allowlist/);
    assert.throws(() => importAllowedSkill(f.config, 'approved', 'other/SKILL.md'), /approved/);
    assert.throws(() => readImportedRelease(f.config.registryDirectory, '../escape'), /hash/);
  } finally { f.cleanup(); }
});

test('advisory skills grant no operations, and registry namespace symlinks are not followed', () => {
  const f = fixture(markdown.replace('allowed_ops: [setNumberFormat]', 'allowed_ops: []'));
  try {
    f.approval.allowedOps = [];
    const imported = importAllowedSkill(f.config, 'approved', f.approval.path);
    assert.deepEqual(imported.card.allowedOps, []);
    setImportedSkillState(f.config.registryDirectory, imported.id, imported.release, true);
    const outside = join(f.root, 'outside'); mkdirSync(outside);
    symlinkSync(outside, join(f.config.registryDirectory, 'active', 'escape'), 'dir');
    const loaded = loadImportedSkills(f.config.registryDirectory);
    assert.equal(loaded.cards.length, 1); assert.equal(loaded.errors.length, 1);
  } finally { f.cleanup(); }
});

test('tool permissions and runtime requirements demand manual rewriting, never silent removal', () => {
  for (const field of ['allowed-tools: [Bash, Read]', 'allowed_tools: Bash', 'scripts: [check.py]', 'compatibility: Requires Python']) {
    const f = fixture(markdown.replace('metadata:', `${field}\nmetadata:`));
    try { assert.throws(() => importAllowedSkill(f.config, 'approved', f.approval.path), /rewrite/); }
    finally { f.cleanup(); }
  }
});

test('Git symlinks, gitlinks, oversized files, and invalid UTF-8 cannot become references', () => {
  for (const mode of ['symlink', 'gitlink', 'oversized', 'binary']) {
    const f = fixture();
    try {
      const reference = join(f.checkout, 'quality', 'references', 'check.md');
      if (mode === 'symlink') { rmSync(reference); symlinkSync('../../LICENSE', reference); }
      else if (mode === 'gitlink') { rmSync(reference); f.git('update-index', '--add', '--cacheinfo', `160000,${f.config.sources[0]!.revision},quality/references/check.md`); }
      else writeFileSync(reference, mode === 'oversized' ? 'x'.repeat(MAX_REFERENCE_BYTES + 1) : Buffer.from([0xff, 0xfe]));
      if (mode !== 'gitlink') f.git('add', '.');
      f.git('commit', '-qm', mode); f.config.sources[0]!.revision = f.git('rev-parse', 'HEAD');
      assert.throws(() => importAllowedSkill(f.config, 'approved', f.approval.path));
    } finally { f.cleanup(); }
  }
});

test('file-reference licenses require exact path, standard terms, original declaration and review source', () => {
  const declaration = 'Complete terms in LICENSE.txt';
  const f = fixture(markdown.replace('license: Apache-2.0', `license: ${declaration}`));
  try {
    writeFileSync(join(f.checkout, 'quality', 'LICENSE.txt'), readFileSync(join(f.checkout, 'LICENSE')));
    f.git('add', '.'); f.git('commit', '-qm', 'license file'); f.config.sources[0]!.revision = f.git('rev-parse', 'HEAD');
    f.approval.license = { ...f.approval.license, path: 'quality/LICENSE.txt', declaration, reviewSource: 'test: reviewed standard Apache normative terms' };
    const imported = importAllowedSkill(f.config, 'approved', f.approval.path);
    assert.equal(imported.card.license, 'Apache-2.0');
    assert.equal(imported.card.provenance?.licenseDeclaration, declaration);
    assert.equal(imported.card.provenance?.licenseReviewSource, f.approval.license.reviewSource);
    delete f.approval.license.reviewSource;
    assert.throws(() => importAllowedSkill(f.config, 'approved', f.approval.path), /audit source/);
    f.approval.license.reviewSource = 'test: reviewed';
    f.approval.license.path = 'LICENSE';
    assert.throws(() => importAllowedSkill(f.config, 'approved', f.approval.path), /different file/);
    f.approval.license.path = 'quality/LICENSE.txt';
    const conflict = readFileSync(join(f.checkout, 'LICENSE'), 'utf8') + '\nProprietary: no license granted.';
    writeFileSync(join(f.checkout, 'quality', 'LICENSE.txt'), conflict);
    f.git('add', '.'); f.git('commit', '-qm', 'conflicting license footer'); f.config.sources[0]!.revision = f.git('rev-parse', 'HEAD');
    f.approval.license.checksum = skillChecksum(conflict);
    assert.throws(() => importAllowedSkill(f.config, 'approved', f.approval.path), /conflicts/);
  } finally { f.cleanup(); }
});

for (const declaration of ['Proprietary', 'All rights reserved', 'unknown', 'MIT', 'See the license somewhere']) {
  test(`license declaration is not automatically upgraded: ${declaration}`, () => {
    const f = fixture(markdown.replace('license: Apache-2.0', `license: ${declaration}`));
    try { assert.throws(() => importAllowedSkill(f.config, 'approved', f.approval.path), /license/); }
    finally { f.cleanup(); }
  });
}

test('forged Apache text with an approved checksum and unknown SPDX are both rejected', () => {
  const f = fixture();
  try {
    writeFileSync(join(f.checkout, 'LICENSE'), 'Apache-2.0 heading only. Proprietary, no license granted.');
    f.git('add', '.'); f.git('commit', '-qm', 'forged license'); f.config.sources[0]!.revision = f.git('rev-parse', 'HEAD');
    f.approval.license.checksum = skillChecksum(readFileSync(join(f.checkout, 'LICENSE'), 'utf8'));
    assert.throws(() => importAllowedSkill(f.config, 'approved', f.approval.path), /reviewed Apache/);
    f.approval.license.spdx = 'Fake-License-1.0';
    assert.throws(() => importAllowedSkill(f.config, 'approved', f.approval.path), /unknown.*SPDX/);
  } finally { f.cleanup(); }
});

test('approved examples are locked text; local adaptation is separate, bounded and hash-bound', () => {
  const f = fixture();
  try {
    mkdirSync(join(f.checkout, 'quality', 'examples'));
    writeFileSync(join(f.checkout, 'quality', 'examples', 'check.md'), 'Approved example.');
    f.git('add', '.'); f.git('commit', '-qm', 'example'); f.config.sources[0]!.revision = f.git('rev-parse', 'HEAD');
    f.approval.references = [{ path: 'examples/check.md', checksum: skillChecksum('Approved example.') }];
    const original = importAllowedSkill(f.config, 'approved', f.approval.path);
    f.approval.adaptation = { sourceChecksum: f.approval.checksum, keywords: ['项目周报'], triggers: ['核查周报'], scope: 'advisory', instructions: 'Local guidance, never tool authority.' };
    const adapted = importAllowedSkill(f.config, 'approved', f.approval.path);
    assert.equal(adapted.card.instructions, original.card.instructions);
    assert.equal(adapted.card.provenance?.sourceChecksum, f.approval.checksum);
    assert.notEqual(adapted.release, original.release);
    assert.equal(adapted.card.references?.[0]?.path, 'examples/check.md');
    f.approval.adaptation.sourceChecksum = 'sha256:' + '0'.repeat(64);
    assert.throws(() => importAllowedSkill(f.config, 'approved', f.approval.path), /checksum binding/);
  } finally { f.cleanup(); }
});

test('corrupt or disabled registry entries reserve IDs against loose-file impersonation', () => {
  const f = fixture();
  try {
    const imported = importAllowedSkill(f.config, 'approved', f.approval.path);
    const loose = join(f.root, 'loose'); mkdirSync(loose);
    writeFileSync(join(loose, 'shadow.md'), markdown.replace('name: quality', 'name: quality\nnamespace: pilot'));
    assert.ok(initializeSkillLibrary({ directory: loose }).library.resolve(imported.id), 'the loose shadow is otherwise loadable');
    const assertReserved = (expectsRegistryError: boolean): void => {
      const registry = loadImportedSkills(f.config.registryDirectory);
      assert.deepEqual(registry.reservedIds, [imported.id]);
      assert.deepEqual(registry.cards, []);
      assert.equal(registry.errors.length > 0, expectsRegistryError);
      const initialized = initializeSkillLibrary({ registry: f.config.registryDirectory, directory: loose });
      assert.equal(initialized.library.resolve(imported.id), undefined);
      assert.ok(initialized.errors.some(({ reason }) => reason.includes('registry-reserved ID')));
    };
    setImportedSkillState(f.config.registryDirectory, imported.id, imported.release, false);
    assertReserved(false);
    setImportedSkillState(f.config.registryDirectory, imported.id, imported.release, true);
    writeFileSync(join(f.config.registryDirectory, 'releases', `${imported.release}.json`), '{}');
    assertReserved(true);
    writeFileSync(join(f.config.registryDirectory, 'active', 'pilot', 'quality.json'), '{truncated');
    assertReserved(true);
    writeFileSync(join(f.config.registryDirectory, 'active', 'pilot', 'quality.json'), JSON.stringify({ version: 1, id: 'pilot/other', release: imported.release, enabled: true }));
    assertReserved(true); // A corrupt pointer's payload must not release its filename identity.
  } finally { f.cleanup(); }
});
