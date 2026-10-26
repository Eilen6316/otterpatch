import { parseDocument } from 'yaml';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

export const MAX_SKILL_MD_BYTES = 128 * 1024;
const MAX_DESCRIPTION_CHARS = 2_000;
const MAX_LIST_ITEMS = 64;
const MAX_ITEM_CHARS = 128;
const RESERVED_BUILTIN_NAMESPACE = 'otterpatch';

export type SkillMetadata = string | number | boolean | null | readonly SkillMetadata[] | { readonly [key: string]: SkillMetadata };
export interface SkillReference { readonly path: string; readonly checksum: string; readonly content: string }
export interface SkillImportProvenance {
  readonly repository: string; readonly revision: string; readonly path: string;
  readonly sourceChecksum: string; readonly licensePath: string; readonly licenseChecksum: string;
  readonly approvedBy: string; readonly capabilityVersion: string;
}
export interface SkillCard {
  name: string;
  namespace: string;
  version: string;
  checksum: string;
  locale: string;
  description: string;
  formats: readonly string[];
  keywords: readonly string[];
  triggers: readonly string[];
  /** Core EditOp kind names. Empty means advisory-only and grants no edit capability. */
  allowedOps: readonly string[];
  instructions?: string;
  source?: string;
  license?: string;
  metadata?: Readonly<Record<string, SkillMetadata>>;
  references?: readonly SkillReference[];
  provenance?: SkillImportProvenance;
  trust: 'builtin' | 'external';
  immutable: boolean;
}

export interface BuiltinSkillDefinition {
  name: string;
  description: string;
  formats: readonly string[];
  keywords: readonly string[];
  allowedOps: readonly string[];
  triggers?: readonly string[];
  namespace?: string;
  version?: string;
  locale?: string;
  instructions?: string;
  source?: string;
}

const trustedBuiltinCards = new WeakSet<SkillCard>();
const encoder = new TextEncoder();

function utf8Bytes(value: string): number {
  return encoder.encode(value).byteLength;
}

function sha256Checksum(value: string): string {
  return 'sha256:' + bytesToHex(sha256(encoder.encode(value)));
}

function inferFormats(name: string, explicit: string[]): string[] {
  if (explicit.length) return explicit;
  const n = name.toLowerCase();
  if (n.includes('xlsx') || n.includes('excel') || n.includes('sheet')) return ['excel', 'xlsx'];
  if (n.includes('docx') || n.includes('word') || n.includes('paper') || n.includes('论文')) return ['word', 'docx'];
  if (n.includes('pptx') || n.includes('ppt') || n.includes('slide')) return ['ppt', 'pptx'];
  if (n.includes('drawio') || n.includes('diagram')) return ['drawio'];
  if (n.includes('frontend') || n.includes('design') || n.includes('ui')) return ['ui'];
  return [];
}

function splitList(value: string): string[] {
  return value
    .replace(/^\[|\]$/g, '')
    .split(/[,，、]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function deriveKeywords(description: string): string[] {
  const match = /(?:关键词|keywords)[:：]\s*(.+)/i.exec(description);
  return match ? splitList(match[1]!) : [];
}

function uniqueList(values: readonly string[], label: string): readonly string[] {
  if (values.length > MAX_LIST_ITEMS) throw new Error(`invalid skill: ${label} exceeds ${MAX_LIST_ITEMS} items`);
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const value = raw.trim();
    if (!value) continue;
    if (value.length > MAX_ITEM_CHARS) throw new Error(`invalid skill: ${label} item exceeds ${MAX_ITEM_CHARS} characters`);
    const normalized = value.normalize('NFKC').toLowerCase();
    if (!seen.has(normalized)) {
      seen.add(normalized);
      unique.push(value);
    }
  }
  return Object.freeze(unique);
}

function assertIdentifier(value: string, label: string): void {
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(value)) throw new Error(`invalid skill: ${label} must be a lowercase safe identifier`);
}

function assertVersion(value: string): void {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value)) throw new Error('invalid skill: version must be semver');
}

function assertLocale(value: string): void {
  if (!/^(?:und|[a-z]{2,3}(?:-[A-Z][a-z]{3})?(?:-(?:[A-Z]{2}|\d{3}))?)$/.test(value)) {
    throw new Error('invalid skill: locale must be a simple BCP 47 tag or und');
  }
}

function freezeCard(input: Omit<SkillCard, 'formats' | 'keywords' | 'triggers' | 'allowedOps'> & {
  formats: readonly string[];
  keywords: readonly string[];
  triggers: readonly string[];
  allowedOps: readonly string[];
}): SkillCard {
  const card: SkillCard = {
    ...input,
    formats: uniqueList(input.formats, 'formats'),
    keywords: uniqueList(input.keywords, 'keywords'),
    triggers: uniqueList(input.triggers, 'triggers'),
    allowedOps: uniqueList(input.allowedOps, 'allowed_ops'),
  };
  assertSkillCard(card);
  return Object.freeze(card);
}

export function assertSkillCard(card: SkillCard): void {
  assertIdentifier(card.name, 'name');
  assertIdentifier(card.namespace, 'namespace');
  assertVersion(card.version);
  assertLocale(card.locale);
  if (!card.description.trim() || card.description.length > MAX_DESCRIPTION_CHARS) throw new Error('invalid skill: description is required and bounded');
  if (!/^sha256:[0-9a-f]{64}$/.test(card.checksum)) throw new Error('invalid skill: checksum must be SHA-256');
  if (card.trust !== 'builtin' && card.trust !== 'external') throw new Error('invalid skill: trust must be builtin or external');
  if (typeof card.immutable !== 'boolean') throw new Error('invalid skill: immutable must be boolean');
  if (card.instructions !== undefined && typeof card.instructions !== 'string') throw new Error('invalid skill: instructions must be a string');
  if (card.source !== undefined && (typeof card.source !== 'string' || card.source.length > MAX_DESCRIPTION_CHARS)) {
    throw new Error('invalid skill: source must be a bounded string');
  }
  for (const [label, values] of [
    ['formats', card.formats],
    ['keywords', card.keywords],
    ['triggers', card.triggers],
    ['allowed_ops', card.allowedOps],
  ] as const) {
    if (!Array.isArray(values)) throw new Error(`invalid skill: ${label} must be an array`);
    uniqueList(values, label);
  }
  if (card.instructions !== undefined && utf8Bytes(card.instructions) > MAX_SKILL_MD_BYTES) {
    throw new Error(`invalid skill: instructions exceed ${MAX_SKILL_MD_BYTES} bytes`);
  }
  if (card.trust === 'builtin' && !card.immutable) throw new Error('invalid skill: built-ins must be immutable');
  if (card.trust === 'external' && card.immutable) throw new Error('invalid skill: external skills cannot be immutable');
}

export function skillId(card: Pick<SkillCard, 'namespace' | 'name'>): string {
  return `${card.namespace}/${card.name}`;
}

function parseSkillMdInternal(md: string, source: string | undefined, trust: SkillCard['trust']): SkillCard {
  if (utf8Bytes(md) > MAX_SKILL_MD_BYTES) throw new Error(`invalid skill: SKILL.md exceeds ${MAX_SKILL_MD_BYTES} bytes`);
  const text = md.replace(/\r\n/g, '\n');
  const match = /^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/.exec(text);
  const frontmatter = match ? match[1]! : '';
  const body = (match ? match[2]! : text).trim();
  const metadata = parseFrontmatter(frontmatter);
  const scalar = (key: string): string | undefined => {
    const value = metadata[key];
    if (value === undefined || value === null) return undefined;
    if (typeof value !== 'string') throw new Error(`invalid skill: ${key} must be a string`);
    return value;
  };
  const list = (key: string): string[] => {
    const value = metadata[key];
    if (value === undefined || value === null) return [];
    if (typeof value === 'string') return splitList(value);
    if (!Array.isArray(value) || !value.every((item) => typeof item === 'string'
      || ((key === 'keywords' || key === 'triggers') && (typeof item === 'number' || typeof item === 'boolean')))) throw new Error(`invalid skill: ${key} must be a string list`);
    return value.map(String);
  };
  const fields = { get: scalar };
  const name = fields.get('name') ?? '';
  const description = fields.get('description') ?? '';
  const namespace = fields.get('namespace') || (trust === 'builtin' ? RESERVED_BUILTIN_NAMESPACE : 'user');
  if (trust === 'external' && namespace.toLowerCase() === RESERVED_BUILTIN_NAMESPACE) {
    throw new Error(`invalid skill: namespace "${RESERVED_BUILTIN_NAMESPACE}" is reserved for bundled skills`);
  }
  const explicitFormats = list('formats');
  const explicitKeywords = list('keywords');
  return freezeCard({
    name,
    namespace,
    version: fields.get('version') || '1.0.0',
    checksum: sha256Checksum(text),
    locale: fields.get('locale') || 'und',
    description,
    formats: inferFormats(name, explicitFormats),
    keywords: explicitKeywords.length ? explicitKeywords : deriveKeywords(description),
    triggers: list('triggers'),
    allowedOps: list('allowed_ops'),
    ...(body ? { instructions: body } : {}),
    ...(scalar('license') ? { license: scalar('license') } : {}),
    metadata,
    ...(source ? { source } : {}),
    trust,
    immutable: trust === 'builtin',
  });
}

/** Safe YAML data only: duplicate keys, tags, aliases and prototype keys are rejected. */
export function parseFrontmatter(text: string): Readonly<Record<string, SkillMetadata>> {
  const doc = parseDocument(text, { uniqueKeys: true, schema: 'core' });
  if (doc.errors.length || doc.warnings.length) throw new Error(`invalid skill YAML: ${[...doc.errors, ...doc.warnings].map((error) => error.message).join('; ')}`);
  const raw: unknown = doc.toJS({ mapAsMap: true, maxAliasCount: 0 });
  let nodes = 0;
  const convert = (value: unknown, depth: number): SkillMetadata => {
    if (++nodes > 512 || depth > 8) throw new Error('invalid skill YAML: metadata complexity limit');
    if (value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return value;
    if (Array.isArray(value)) return Object.freeze(value.map((item) => convert(item, depth + 1)));
    if (!(value instanceof Map)) throw new Error('invalid skill YAML: expected plain metadata');
    const result: Record<string, SkillMetadata> = Object.create(null);
    for (const [key, item] of value) {
      if (typeof key !== 'string' || ['__proto__', 'prototype', 'constructor', '<<'].includes(key)) throw new Error('invalid skill YAML: unsafe mapping key');
      result[key] = convert(item, depth + 1);
    }
    return Object.freeze(result);
  };
  if (raw === null) return Object.freeze({});
  if (!(raw instanceof Map)) throw new Error('invalid skill YAML: frontmatter must be a mapping');
  return convert(raw, 0) as Readonly<Record<string, SkillMetadata>>;
}

/** Parse an untrusted, externally supplied SKILL.md. */
export function parseSkillMd(md: string, source?: string): SkillCard {
  return parseSkillMdInternal(md, source, 'external');
}

/** Internal package helper; intentionally not re-exported from the public index. */
export function parseBuiltinSkillMd(md: string, source?: string): SkillCard {
  const card = parseSkillMdInternal(md, source, 'builtin');
  trustedBuiltinCards.add(card);
  return card;
}

/** Internal package helper; intentionally not re-exported from the public index. */
export function defineBuiltinSkill(definition: BuiltinSkillDefinition): SkillCard {
  const canonical = JSON.stringify({
    ...definition,
    namespace: definition.namespace ?? RESERVED_BUILTIN_NAMESPACE,
    version: definition.version ?? '1.0.0',
    locale: definition.locale ?? 'und',
    triggers: definition.triggers ?? [],
  });
  const card = freezeCard({
    ...definition,
    namespace: definition.namespace ?? RESERVED_BUILTIN_NAMESPACE,
    version: definition.version ?? '1.0.0',
    checksum: sha256Checksum(canonical),
    locale: definition.locale ?? 'und',
    triggers: definition.triggers ?? [],
    trust: 'builtin',
    immutable: true,
  });
  trustedBuiltinCards.add(card);
  return card;
}

/** Internal trust check used by SkillLibrary before anything reaches a system prompt. */
export function isTrustedBuiltinSkill(card: SkillCard): boolean {
  return trustedBuiltinCards.has(card);
}
