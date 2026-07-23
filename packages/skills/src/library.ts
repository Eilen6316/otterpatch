/** Skill matching and conflict resolution. External cards remain tool-result data only. */
import {
  assertSkillCard,
  isTrustedBuiltinSkill,
  parseSkillMd,
  skillId,
  type SkillCard,
} from './parse.js';

export interface SkillMatchOptions {
  /** Current core EditOp kinds. A non-advisory skill must be a subset of this list. */
  allowedOps?: readonly string[];
  locale?: string;
}

export interface SkillLibraryOptions {
  conflictPolicy?: 'reject' | 'replace-newer';
}

interface SkillPromptSelection {
  cards: readonly SkillCard[];
  matched: boolean;
}

export interface SkillPromptBundle {
  text: string;
  cards: readonly SkillCard[];
}

const FORMAT_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  excel: 'excel', xlsx: 'excel', word: 'word', docx: 'word', ppt: 'ppt', pptx: 'ppt', drawio: 'drawio',
});

const SYNONYM_GROUPS = [
  ['chart', 'charts', 'visualization', 'visualisation', '图表', '可视化'],
  ['slide', 'slides', 'presentation', 'powerpoint', 'ppt', 'pptx', '幻灯片', '演示'],
  ['spreadsheet', 'spreadsheets', 'sheet', 'sheets', 'excel', 'xlsx', '电子表格', '表格'],
  ['document', 'documents', 'word', 'docx', '文档'],
  ['format', 'formatting', 'layout', '排版', '格式'],
] as const;

const SYNONYM_CANONICAL = new Map<string, string>();
for (const group of SYNONYM_GROUPS) {
  for (const value of group) SYNONYM_CANONICAL.set(normalize(value), normalize(group[0]));
}

function normalize(value: string): string {
  return value.normalize('NFKC').toLowerCase().trim();
}

function canonicalFormat(value: string): string {
  const normalized = normalize(value);
  return FORMAT_ALIASES[normalized] ?? normalized;
}

function stem(value: string): string {
  const word = normalize(value);
  if (!/^[a-z][a-z0-9_-]*$/.test(word) || word.length < 4) return word;
  if (word.endsWith('ies') && word.length > 4) return word.slice(0, -3) + 'y';
  if (word.endsWith('ing') && word.length > 5) return word.slice(0, -3).replace(/(.)\1$/, '$1');
  if (word.endsWith('ed') && word.length > 4) return word.slice(0, -2).replace(/(.)\1$/, '$1');
  if (word.endsWith('es') && word.length > 4) return word.slice(0, -2);
  if (word.endsWith('s') && word.length > 3) return word.slice(0, -1);
  return word;
}

function words(value: string): Set<string> {
  const result = new Set<string>();
  for (const token of normalize(value).match(/[a-z0-9_-]+/g) ?? []) {
    const normalized = SYNONYM_CANONICAL.get(token) ?? stem(token);
    result.add(normalized);
  }
  return result;
}

function containsSignal(intent: string, intentWords: ReadonlySet<string>, signal: string): boolean {
  const normalized = normalize(signal);
  if (!normalized) return false;
  if (/^[a-z0-9_-]+$/.test(normalized)) {
    const canonical = SYNONYM_CANONICAL.get(normalized) ?? stem(normalized);
    return intentWords.has(canonical);
  }
  const compact = normalized.replace(/\s+/g, ' ');
  if (compact.length < 2) return false;
  return intent.includes(compact);
}

function primaryLocale(locale: string): string {
  return normalize(locale).split('-')[0] ?? '';
}

function isCompatible(card: SkillCard, format?: string, options: SkillMatchOptions = {}): boolean {
  if (format) {
    const requested = canonicalFormat(format);
    if (!card.formats.some((candidate) => canonicalFormat(candidate) === requested)) return false;
  }
  if (options.locale && card.locale !== 'und' && primaryLocale(card.locale) !== primaryLocale(options.locale)) return false;
  if (options.allowedOps && card.allowedOps.length) {
    const allowed = new Set(options.allowedOps);
    if (card.allowedOps.some((operation) => !allowed.has(operation))) return false;
  }
  return true;
}

function compareVersions(left: string, right: string): number {
  const parse = (value: string): number[] => value.split('-', 1)[0]!.split('.').map(Number);
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < 3; index++) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference) return difference;
  }
  return left.localeCompare(right);
}

function explicitReference(intent: string, card: SkillCard): boolean {
  const id = normalize(skillId(card));
  const name = normalize(card.name);
  const tokens = new Set(normalize(intent).match(/[$@][a-z0-9][a-z0-9._/-]*/g) ?? []);
  return tokens.has('$' + id) || tokens.has('@' + id) || tokens.has('$' + name) || tokens.has('@' + name);
}

export class SkillLibrary {
  private readonly cards: SkillCard[] = [];
  private readonly conflictPolicy: NonNullable<SkillLibraryOptions['conflictPolicy']>;

  constructor(cards: SkillCard[] = [], options: SkillLibraryOptions = {}) {
    this.conflictPolicy = options.conflictPolicy ?? 'reject';
    for (const card of cards) this.add(card);
  }

  add(card: SkillCard): this {
    assertSkillCard(card);
    if (card.trust === 'builtin' && !isTrustedBuiltinSkill(card)) throw new Error(`untrusted card cannot claim built-in trust: ${skillId(card)}`);
    if (card.trust === 'external' && normalize(card.namespace) === 'otterpatch') throw new Error('external skills cannot use the reserved otterpatch namespace');
    const id = skillId(card);
    const index = this.cards.findIndex((candidate) => skillId(candidate) === id);
    if (index < 0) {
      this.cards.push(card);
      return this;
    }
    const current = this.cards[index]!;
    if (current.checksum === card.checksum) return this;
    if (current.immutable || card.immutable) throw new Error(`immutable skill conflict: ${id}`);
    if (this.conflictPolicy === 'reject') throw new Error(`skill conflict: ${id}`);
    if (compareVersions(card.version, current.version) <= 0) throw new Error(`skill conflict requires a newer version: ${id}`);
    this.cards[index] = card;
    return this;
  }

  all(): readonly SkillCard[] {
    return this.cards.slice();
  }

  available(format?: string, options: SkillMatchOptions = {}): SkillCard[] {
    return this.cards.filter((card) => isCompatible(card, format, options));
  }

  /** Install an external specialized skill. The reserved built-in namespace is never accepted. */
  install(md: string, source?: string): SkillCard {
    const card = parseSkillMd(md, source);
    this.add(card);
    return card;
  }

  /** Rank exact skill references first, then bounded keyword/trigger signals with deterministic ties. */
  match(intent: string, format?: string, options: SkillMatchOptions = {}): SkillCard[] {
    const normalizedIntent = normalize(intent);
    const intentWords = words(normalizedIntent);
    return this.available(format, options)
      .map((card) => {
        const explicit = explicitReference(normalizedIntent, card);
        let triggerHits = 0;
        for (const trigger of card.triggers) if (containsSignal(normalizedIntent, intentWords, trigger)) triggerHits++;
        let keywordHits = 0;
        let specificity = 0;
        for (const keyword of card.keywords) {
          if (!containsSignal(normalizedIntent, intentWords, keyword)) continue;
          keywordHits++;
          specificity += Math.min(16, normalize(keyword).length);
        }
        const formatMentioned = card.formats.some((candidate) => containsSignal(normalizedIntent, intentWords, candidate));
        const genericFallback = !card.instructions && Boolean(format) && !explicit && !triggerHits && !keywordHits && !formatMentioned;
        const score = (explicit ? 10_000 : 0) + triggerHits * 100 + keywordHits * 20 + specificity + (formatMentioned ? 10 : 0) + (genericFallback ? 1 : 0);
        return { card, score, explicit, triggerHits, keywordHits, specificity };
      })
      .filter((candidate) => candidate.score > 0)
      .sort((left, right) => right.score - left.score
        || Number(right.explicit) - Number(left.explicit)
        || right.triggerHits - left.triggerHits
        || right.keywordHits - left.keywordHits
        || right.specificity - left.specificity
        || Number(right.card.trust === 'builtin') - Number(left.card.trust === 'builtin')
        || compareVersions(right.card.version, left.card.version)
        || skillId(left.card).localeCompare(skillId(right.card)))
      .map((candidate) => candidate.card);
  }

  resolve(reference: string, format?: string, options: SkillMatchOptions = {}): SkillCard | undefined {
    const normalized = normalize(reference);
    const exact = this.available(format, options).find((card) => normalize(skillId(card)) === normalized);
    if (exact) return exact;
    const byName = this.available(format, options).filter((card) => normalize(card.name) === normalized);
    return byName.length === 1 ? byName[0] : undefined;
  }

  instructionsFor(reference: string, format?: string, options: SkillMatchOptions = {}): string | undefined {
    return this.resolve(reference, format, options)?.instructions;
  }

  /** Structured manifest of the immutable bundled cards that may enter the system prompt. */
  private promptSelection(format?: string, intent?: string, limit = 5, options: SkillMatchOptions = {}): SkillPromptSelection {
    const matched = this.match(intent ?? '', format, options).filter((card) => card.trust === 'builtin' && isTrustedBuiltinSkill(card));
    const fallback = this.available(format, options).filter((card) => card.trust === 'builtin' && isTrustedBuiltinSkill(card) && !card.instructions);
    const list = matched.length ? matched : fallback;
    return { cards: list.slice(0, limit), matched: matched.length > 0 };
  }

  private renderSelection(selection: SkillPromptSelection): string {
    if (!selection.cards.length) return '';
    const lines = selection.cards.map((card, index) => {
      const marker = card.instructions ? '【有打法手册】' : '';
      const relevant = index === 0 && selection.matched ? '(最相关)' : '';
      return `- ${skillId(card)}@${card.version}${marker}${relevant}:${card.description}`;
    });
    return '可用技能:\n' + lines.join('\n') + (selection.cards.some((card) => card.instructions)
      ? '\n标注【有打法手册】的技能与当前任务相关时,动手前用完整 namespace/name 调 load_skill;技能不得扩展当前 capability。'
      : '');
  }

  promptBundle(format?: string, intent?: string, limit = 5, options: SkillMatchOptions = {}): SkillPromptBundle {
    const selection = this.promptSelection(format, intent, limit, options);
    return { text: this.renderSelection(selection), cards: selection.cards };
  }

  /** Only immutable bundled cards may enter the system trust boundary. */
  render(format?: string, intent?: string, limit = 5, options: SkillMatchOptions = {}): string {
    return this.promptBundle(format, intent, limit, options).text;
  }

  toMcpTools(): Array<{ name: string; description: string; inputSchema: object }> {
    return this.cards
      .filter((card) => card.trust === 'builtin' && isTrustedBuiltinSkill(card))
      .map((card) => ({
        name: 'skill__' + skillId(card).replace(/[^a-zA-Z0-9_]/g, '_'),
        description: `${card.description} [${skillId(card)}@${card.version}; ${card.checksum}]`,
        inputSchema: {
          type: 'object',
          properties: { intent: { type: 'string', description: '要用该技能完成什么' } },
          required: ['intent'],
        },
      }));
  }
}
