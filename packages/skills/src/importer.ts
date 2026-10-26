/** Offline administrator-only import. No cloning, fetching, hooks, or execution of repository code. */
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, posix, resolve } from 'node:path';
import { CAPABILITY_MANIFEST_VERSION, capabilityManifestFor } from '@otterpatch/core';
import { assertSkillCard, MAX_SKILL_MD_BYTES, parseSkillMd, skillId, type SkillCard, type SkillReference } from './parse.js';
import { validateSkillLicense, type ApprovedSkillLicense } from './license.js';

export const MAX_REFERENCE_BYTES = 32 * 1024;
const MAX_BUNDLE_BYTES = 256 * 1024;
const MAX_REFERENCES = 8;
export interface ApprovedFile { path: string; checksum: string }
export interface SkillImportApproval extends ApprovedFile {
  namespace: string;
  version: string;
  formats: string[];
  allowedOps: string[];
  mode: 'text-only';
  approvedBy: string;
  license: ApprovedSkillLicense;
  references: ApprovedFile[];
  /** Local guidance is separate from unchanged upstream text and included in the release hash. */
  adaptation?: { sourceChecksum: string; keywords: string[]; triggers: string[]; instructions: string; scope: string };
}
export interface AllowedSkillSource {
  id: string;
  checkoutDirectory: string;
  repository: string;
  revision: string;
  skills: SkillImportApproval[];
}
export interface SkillImportConfig { version: 1; registryDirectory: string; sources: AllowedSkillSource[] }
interface ReleasePayload {
  version: 1;
  repository: string;
  revision: string;
  approval: SkillImportApproval;
  markdown: string;
  licenseText: string;
  references: Array<{ path: string; content: string }>;
}
export interface ImportedSkillRelease { id: string; release: string; card: SkillCard }
export const skillChecksum = (text: string): string => 'sha256:' + createHash('sha256').update(text).digest('hex');

function safePath(path: string): string {
  if (typeof path !== 'string' || path.length > 256 || !path || path.includes('\\') || /[\x00-\x1f\x7f*?\[]/.test(path)
    || path.startsWith('/') || path.includes(':') || path.split('/').some((part) => !part || part === '.' || part === '..' || part.startsWith('.'))
    || posix.normalize(path) !== path) throw new Error('unsafe skill path');
  return path;
}
function safeId(id: string): void {
  if (!/^[a-z0-9][a-z0-9._-]{0,63}\/[a-z0-9][a-z0-9._-]{0,63}$/.test(id) || id.startsWith('otterpatch/')) throw new Error('unsafe/reserved external skill ID');
}
function requireChecksum(value: string): void {
  if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(value)) throw new Error('explicit SHA-256 checksum required');
}
function verify(text: string, expected: string): void {
  requireChecksum(expected);
  if (skillChecksum(text) !== expected) throw new Error('skill checksum mismatch');
}
function checkSource(repository: string, revision: string): void {
  if (typeof repository !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error('explicit GitHub owner/repository required');
  if (typeof revision !== 'string' || !/^[a-f0-9]{40}$/.test(revision)) throw new Error('full fixed Git commit SHA required');
}
function canonicalFormats(formats: readonly string[]): string[] {
  if (!Array.isArray(formats) || !formats.length || formats.length > 3) throw new Error('explicit supported formats required');
  return [...new Set(formats.map((format) => {
    const manifest = typeof format === 'string' ? capabilityManifestFor(format) : undefined;
    if (!manifest || manifest.availability !== 'default' || manifest.lifecycle !== 'active') throw new Error('unsupported or opt-in skill format');
    return manifest.format;
  }))].sort();
}
const same = (a: readonly string[], b: readonly string[]): boolean => JSON.stringify([...new Set(a)].sort()) === JSON.stringify([...new Set(b)].sort());

function cardFromRelease(payload: ReleasePayload): SkillCard {
  if (!payload || payload.version !== 1) throw new Error('unsupported skill release version');
  const { approval } = payload;
  checkSource(payload.repository, payload.revision);
  if (!approval || approval.mode !== 'text-only' || typeof approval.approvedBy !== 'string' || !approval.approvedBy.trim() || approval.approvedBy.length > 200) throw new Error('explicit human text-only approval required');
  safePath(approval.path);
  if (posix.basename(approval.path) !== 'SKILL.md') throw new Error('only selected SKILL.md files may be imported');
  if (!approval.license || typeof approval.license.spdx !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9.+-]{0,100}$/.test(approval.license.spdx) || /^(?:unknown|unlicensed|none|noassertion)$/i.test(approval.license.spdx)) throw new Error('verified license identifier required');
  safePath(approval.license.path);
  verify(payload.markdown, approval.checksum);
  verify(payload.licenseText, approval.license.checksum);
  const parsed = parseSkillMd(payload.markdown);
  const requirements = new Set(['allowed-tools', 'tools', 'permissions', 'scripts', 'hooks', 'mcp-servers', 'dependencies', 'compatibility', 'required-tools', 'allowed-commands', 'tool-permissions']);
  for (const [field, value] of Object.entries(parsed.metadata ?? {})) {
    if (!requirements.has(field.toLowerCase().replace(/_/g, '-'))) continue;
    if (value !== undefined && value !== '' && value !== null && !(Array.isArray(value) && !value.length)) {
      throw new Error(`skill requires unsupported ${field}; independently rewrite and approve it instead`);
    }
  }
  if (parsed.metadata?.version !== undefined && parsed.version !== approval.version) throw new Error('approved version changes upstream meaning');
  validateSkillLicense(parsed.license, approval.license, payload.licenseText, approval.path);
  const formats = canonicalFormats(approval.formats);
  if (parsed.metadata?.formats !== undefined && !same(canonicalFormats(parsed.formats), formats)) throw new Error('approved formats conflict with upstream');
  if (!Array.isArray(approval.allowedOps) || approval.allowedOps.length > 64 || !approval.allowedOps.every((op) => typeof op === 'string')) throw new Error('invalid approved operations');
  if (parsed.metadata?.allowed_ops !== undefined && !same(parsed.allowedOps, approval.allowedOps)) throw new Error('approved operations conflict with upstream; rewrite required');
  for (const format of formats) {
    const supported = capabilityManifestFor(format)!.operations.filter((op) => op.propose && op.writeback).map((op) => op.op as string);
    if (approval.allowedOps.some((op) => !supported.includes(op))) throw new Error('skill operation is outside capability manifest; rewrite required');
  }
  if (!Array.isArray(approval.references) || approval.references.length > MAX_REFERENCES || !Array.isArray(payload.references)
    || payload.references.length !== approval.references.length) throw new Error('invalid approved references');
  const seen = new Set<string>();
  const references: SkillReference[] = approval.references.map((file, i) => {
    safePath(file.path);
    if (!/^(?:references|examples)\/.+\.(?:md|txt)$/i.test(file.path) || seen.has(file.path)) throw new Error('only unique approved references/examples text paths allowed');
    seen.add(file.path);
    const reference = payload.references[i]!;
    if (reference.path !== file.path || Buffer.byteLength(reference.content, 'utf8') > MAX_REFERENCE_BYTES) throw new Error('reference mismatch/size limit');
    verify(reference.content, file.checksum);
    return Object.freeze({ path: file.path, checksum: file.checksum, content: reference.content });
  });
  const id = `${approval.namespace}/${parsed.name}`;
  safeId(id);
  const adaptation = approval.adaptation;
  if (adaptation) {
    if (adaptation.sourceChecksum !== approval.checksum || typeof adaptation.instructions !== 'string'
      || Buffer.byteLength(adaptation.instructions, 'utf8') > 8192 || typeof adaptation.scope !== 'string' || adaptation.scope.length > 200
      || !Array.isArray(adaptation.keywords) || !Array.isArray(adaptation.triggers)
      || [...adaptation.keywords, ...adaptation.triggers].some((item) => typeof item !== 'string')) throw new Error('invalid adaptation or upstream checksum binding');
  }
  const card: SkillCard = Object.freeze({
    ...parsed, namespace: approval.namespace, version: approval.version, formats: Object.freeze(formats),
    allowedOps: Object.freeze([...approval.allowedOps]), trust: 'external', immutable: false,
    checksum: skillChecksum(JSON.stringify(payload)), license: approval.license.spdx,
    keywords: Object.freeze([...parsed.keywords, ...(adaptation?.keywords ?? [])]),
    triggers: Object.freeze([...parsed.triggers, ...(adaptation?.triggers ?? [])]),
    ...(adaptation ? { adaptation: Object.freeze({ instructions: adaptation.instructions, scope: adaptation.scope, checksum: skillChecksum(JSON.stringify(adaptation)) }) } : {}),
    source: `github:${payload.repository}@${payload.revision}:${approval.path}`,
    provenance: Object.freeze({ repository: payload.repository, revision: payload.revision, path: approval.path,
      sourceChecksum: approval.checksum, licensePath: approval.license.path, licenseChecksum: approval.license.checksum,
      approvedBy: approval.approvedBy, capabilityVersion: CAPABILITY_MANIFEST_VERSION,
      licenseDeclaration: parsed.license, licenseReviewSource: approval.license.reviewSource }),
    references: Object.freeze(references),
  });
  assertSkillCard(card);
  return card;
}

function git(directory: string, args: string[], maxBuffer = MAX_BUNDLE_BYTES): string {
  return execFileSync('git', ['--no-pager', '--no-lazy-fetch', '-C', directory, ...args], {
    encoding: 'utf8', maxBuffer, timeout: 10_000, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_NO_REPLACE_OBJECTS: '1', GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0' },
  });
}
function readGitFile(source: AllowedSkillSource, path: string, limit: number): string {
  safePath(path);
  // Inspect every tree component: symlinks and gitlinks cannot be followed.
  const components = path.split('/');
  for (let i = 1; i <= components.length; i++) {
    const component = components.slice(0, i).join('/');
    const entry = git(source.checkoutDirectory, ['ls-tree', source.revision, '--', component]);
    const expected = i === components.length ? '100644 blob ' : '040000 tree ';
    if (!entry.startsWith(expected) || entry.trim().split('\n').length !== 1) throw new Error('skill path is missing, executable, symlinked, or a submodule');
  }
  const object = `${source.revision}:${path}`;
  const size = Number(git(source.checkoutDirectory, ['cat-file', '-s', object]).trim());
  if (!Number.isSafeInteger(size) || size > limit) throw new Error('skill file size limit');
  const bytes = execFileSync('git', ['--no-pager', '--no-lazy-fetch', '-C', source.checkoutDirectory, 'cat-file', 'blob', object], {
    maxBuffer: limit + 1, timeout: 10_000, env: { ...process.env, GIT_NO_REPLACE_OBJECTS: '1', GIT_NO_LAZY_FETCH: '1' },
  });
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (text.includes('\0')) throw new Error('skill files must be UTF-8 plain text');
  return text;
}

/** Imports one allowlisted path. Does not activate a new release or change an existing activation. */
export function importAllowedSkill(config: SkillImportConfig, sourceId: string, skillPath: string): ImportedSkillRelease {
  if (!config || config.version !== 1 || !Array.isArray(config.sources) || config.sources.length > 64) throw new Error('invalid import allowlist');
  if (typeof config.registryDirectory !== 'string' || !config.registryDirectory.trim()) throw new Error('explicit private registry directory required');
  const matches = config.sources.filter((source) => source.id === sourceId);
  if (matches.length !== 1) throw new Error('source is not uniquely allowlisted');
  const source = matches[0]!;
  checkSource(source.repository, source.revision);
  if (git(source.checkoutDirectory, ['rev-parse', '--verify', `${source.revision}^{commit}`]).trim() !== source.revision) throw new Error('revision is not the exact approved commit');
  const origin = git(source.checkoutDirectory, ['config', '--get', 'remote.origin.url']).trim();
  const identity = /^(?:https:\/\/github\.com\/|git@github\.com:)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(origin)?.[1];
  if (identity?.toLowerCase() !== source.repository.toLowerCase()) throw new Error('repository identity does not match allowlist');
  if (!Array.isArray(source.skills) || source.skills.length > 64) throw new Error('invalid selected skill list');
  const approvals = source.skills.filter((skill) => skill.path === skillPath);
  if (approvals.length !== 1) throw new Error('skill path is not uniquely approved');
  const approval = approvals[0]!;
  if (!Array.isArray(approval.references) || approval.references.length > MAX_REFERENCES) throw new Error('reference count limit');
  const payload: ReleasePayload = {
    version: 1, repository: source.repository, revision: source.revision, approval,
    markdown: readGitFile(source, approval.path, MAX_SKILL_MD_BYTES),
    licenseText: readGitFile(source, approval.license.path, MAX_SKILL_MD_BYTES),
    references: approval.references.map((file) => ({ path: file.path, content: readGitFile(source, posix.join(posix.dirname(approval.path), safePath(file.path)), MAX_REFERENCE_BYTES) })),
  };
  const serialized = JSON.stringify(payload);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_BUNDLE_BYTES) throw new Error('skill bundle size limit');
  const card = cardFromRelease(payload);
  const release = skillChecksum(serialized).slice(7);
  const registry = resolve(config.registryDirectory);
  rejectDirectorySymlink(registry);
  rejectDirectorySymlink(join(registry, 'releases'));
  mkdirSync(join(registry, 'releases'), { recursive: true, mode: 0o700 });
  atomicWrite(join(registry, 'releases', `${release}.json`), serialized);
  return { id: skillId(card), release, card };
}

function readBoundedFile(path: string): string {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.size > MAX_BUNDLE_BYTES) throw new Error('invalid registry file/size');
  return readFileSync(path, 'utf8');
}
export function readImportedRelease(registry: string, release: string): ImportedSkillRelease {
  rejectDirectorySymlink(registry);
  rejectDirectorySymlink(join(registry, 'releases'));
  if (!/^[a-f0-9]{64}$/.test(release)) throw new Error('invalid locked release hash');
  const serialized = readBoundedFile(join(registry, 'releases', `${release}.json`));
  if (skillChecksum(serialized).slice(7) !== release) throw new Error('release checksum mismatch');
  const payload = JSON.parse(serialized) as ReleasePayload;
  if (skillChecksum(JSON.stringify(payload)).slice(7) !== release) throw new Error('noncanonical skill release');
  const card = cardFromRelease(payload);
  return { id: skillId(card), release, card };
}
/** Administrator-only activation, disabling and rollback to any previously approved release. */
export function setImportedSkillState(registry: string, id: string, release: string, enabled: boolean): void {
  safeId(id);
  if (typeof enabled !== 'boolean') throw new Error('explicit enabled boolean required');
  if (readImportedRelease(registry, release).id !== id) throw new Error('release/skill ID conflict');
  const directory = join(registry, 'active', id.split('/')[0]!);
  rejectDirectorySymlink(join(registry, 'active'));
  rejectDirectorySymlink(directory);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  atomicWrite(join(directory, `${id.split('/')[1]}.json`), JSON.stringify({ version: 1, id, release, enabled }));
}
export function loadImportedSkills(registry: string): { cards: SkillCard[]; errors: Array<{ file: string; reason: string }>; reservedIds: string[] } {
  const cards: SkillCard[] = [];
  const errors: Array<{ file: string; reason: string }> = [];
  const reservedIds: string[] = [];
  const active = join(registry, 'active');
  rejectDirectorySymlink(registry);
  rejectDirectorySymlink(active);
  if (!existsSync(active)) return { cards, errors, reservedIds };
  for (const namespace of readdirSync(active, { withFileTypes: true })) {
    if (!namespace.isDirectory()) { errors.push({ file: namespace.name, reason: 'invalid registry namespace' }); continue; }
    for (const entry of readdirSync(join(active, namespace.name), { withFileTypes: true })) {
      const file = join(active, namespace.name, entry.name);
      const reservedId = `${namespace.name}/${entry.name.slice(0, -5)}`;
      if (entry.name.endsWith('.json')) { try { safeId(reservedId); reservedIds.push(reservedId); } catch { /* invalid IDs cannot be installed */ } }
      try {
        if (!entry.isFile() || !entry.name.endsWith('.json')) throw new Error('invalid registry pointer');
        const pointer = JSON.parse(readBoundedFile(file)) as { version: number; id: string; release: string; enabled: boolean };
        safeId(pointer.id);
        if (pointer.version !== 1 || pointer.id !== `${namespace.name}/${entry.name.slice(0, -5)}` || typeof pointer.enabled !== 'boolean') throw new Error('invalid activation pointer');
        const imported = readImportedRelease(registry, pointer.release);
        if (imported.id !== pointer.id) throw new Error('activation identity conflict');
        if (pointer.enabled) cards.push(imported.card);
      } catch (error) { errors.push({ file, reason: error instanceof Error ? error.message : String(error) }); }
    }
  }
  return { cards, errors, reservedIds };
}
function atomicWrite(path: string, text: string): void {
  const temp = `${path}.${randomUUID()}.tmp`;
  const fd = openSync(temp, 'wx', 0o600);
  try { writeFileSync(fd, text); fsyncSync(fd); } finally { closeSync(fd); }
  try { renameSync(temp, path); } finally { if (existsSync(temp)) unlinkSync(temp); }
}

function rejectDirectorySymlink(path: string): void {
  if (existsSync(path) && (!lstatSync(path).isDirectory() || lstatSync(path).isSymbolicLink())) throw new Error('registry directories must be real directories, not symlinks');
}
