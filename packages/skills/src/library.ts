/**
 * SkillLibrary —— 技能中枢:按格式 + 意图匹配技能,渲染成可注入系统提示的片段(渐进披露 L0),
 * 也可导出为 MCP 工具清单("技能即基础设施")。
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

  /** 安装一个外部专用技能(SKILL.md 文本)。宿主从目录/URL 读到内容后调用。 */
  install(md: string, source?: string): SkillCard {
    const card = parseSkillMd(md, source);
    this.add(card);
    return card;
  }

  /** 按格式(强信号)+ 意图关键词(弱信号)排序,返回命中技能。 */
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
        if (kw > 0 && c.instructions) score += 0.5; // 意图真命中关键词时,带打法手册的更可执行 → 决胜优先;仅格式命中不加(通用卡片保持在前)
        return { c, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.c);
  }

  /** 按名字取技能的 L1 正文(打法手册),供 load_skill 工具执行。 */
  instructionsFor(name: string): string | undefined {
    return this.cards.find((c) => c.name === name)?.instructions;
  }

  /** 注入 Agent 系统提示的 L0 片段:列出最相关技能的 name+description;带手册的标注可 load_skill。 */
  render(format?: string, intent?: string, limit = 5): string {
    const hit = this.match(intent ?? '', format);
    const list = hit.length ? hit : this.cards.filter((c) => !format || c.formats.includes(format));
    if (!list.length) return '';
    const lines = list.slice(0, limit).map((c, i) => `- ${c.name}${c.instructions ? '【有打法手册】' : ''}${i === 0 && hit.length ? '(最相关)' : ''}:${c.description}`);
    return '可用技能:\n' + lines.join('\n') + (list.slice(0, limit).some((c) => c.instructions) ? '\n标注【有打法手册】的技能与当前任务相关时,【动手前先调 load_skill 加载其检查清单与惯用法】,按手册执行。' : '');
  }

  /** 技能即 MCP 工具:供 Agent/外部以工具形式调用。 */
  toMcpTools(): Array<{ name: string; description: string; inputSchema: object }> {
    return this.cards.map((c) => ({
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
