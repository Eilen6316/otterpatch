/**
 * SkillLibrary — skill hub: matches skills by format + intent, renders a fragment injectable
 * into the system prompt (progressive disclosure L0), and can also export an MCP tool list
 * ("skills as infrastructure").
 */
import { parseSkillMd, type SkillCard } from './parse.js';

export class SkillLibrary {
  private readonly cards: SkillCard[] = [];

  constructor(cards: SkillCard[] = []) {
    for (const c of cards) this.add(c);
  }

  add(card: SkillCard): this {
    const i = this.cards.findIndex((c) => c.name === card.name);
    if (i >= 0) this.cards[i] = card;
    else this.cards.push(card);
    return this;
  }

  all(): readonly SkillCard[] {
    return this.cards;
  }

  /** Install an external specialized skill (SKILL.md text). Called by the host after reading content from a directory/URL. */
  install(md: string, source?: string): SkillCard {
    const card = parseSkillMd(md, source);
    this.add(card);
    return card;
  }

  /** Rank by format (strong signal) + intent keywords (weak signal); return matching skills. */
  match(intent: string, format?: string): SkillCard[] {
    const lc = (intent || '').toLowerCase();
    return this.cards
      .map((c) => {
        let score = 0;
        if (format && c.formats.includes(format)) score += 3;
        let kw = 0;
        for (const k of c.keywords) if (k && lc.includes(k.toLowerCase())) kw += 1;
        score += kw;
        for (const f of c.formats) if (f.length > 1 && lc.includes(f)) score += 1;
        if (kw > 0 && c.instructions) score += 0.5; // When intent actually hits keywords, skills with a playbook are more actionable → tie-break in their favor; no bonus for format-only hits (generic cards stay first)
        return { c, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.c);
  }

  /** Get a skill's L1 body (playbook) by name, for the load_skill tool to execute. */
  instructionsFor(name: string): string | undefined {
    return this.cards.find((c) => c.name === name)?.instructions;
  }

  /** L0 system fragment. Only bundled, version-controlled skills may enter the system trust boundary. */
  render(format?: string, intent?: string, limit = 5): string {
    const hit = this.match(intent ?? '', format).filter((c) => c.trust === 'builtin');
    const list = hit.length ? hit : this.cards.filter((c) => c.trust === 'builtin' && (!format || c.formats.includes(format)));
    if (!list.length) return '';
    const lines = list.slice(0, limit).map((c, i) => `- ${c.name}${c.instructions ? '【有打法手册】' : ''}${i === 0 && hit.length ? '(最相关)' : ''}:${c.description}`);
    return '可用技能:\n' + lines.join('\n') + (list.slice(0, limit).some((c) => c.instructions) ? '\n标注【有打法手册】的技能与当前任务相关时,【动手前先调 load_skill 加载其检查清单与惯用法】,按手册执行。' : '');
  }

  /** Skills as MCP tools: callable by the Agent/external clients in tool form. */
  toMcpTools(): Array<{ name: string; description: string; inputSchema: object }> {
    return this.cards.filter((c) => c.trust === 'builtin').map((c) => ({
      name: 'skill__' + c.name.replace(/[^a-zA-Z0-9_]/g, '_'),
      description: c.description,
      inputSchema: {
        type: 'object',
        properties: { intent: { type: 'string', description: '要用该技能完成什么' } },
        required: ['intent'],
      },
    }));
  }
}
