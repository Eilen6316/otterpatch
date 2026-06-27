/**
 * SKILL.md 解析:YAML frontmatter(name/description[/formats/keywords])+ Markdown 正文。
 * 兼容 Anthropic Agent Skills 与 Claude Code 写的 SKILL.md(渐进披露:L0=name/description,L1=正文)。
 */
export interface SkillCard {
  name: string; // L0
  description: string; // L0(Agent 据此匹配意图)
  formats: string[]; // 适用格式标签:excel/xlsx/word/docx/ppt/pptx/pdf/drawio/ui…
  keywords: string[]; // 命中意图用
  instructions?: string; // L1:SKILL.md 正文(命中后才需要)
  source?: string; // built-in / 文件路径 / URL
}

function inferFormats(name: string, explicit: string[]): string[] {
  if (explicit.length) return explicit;
  const n = name.toLowerCase();
  if (n.includes('xlsx') || n.includes('excel') || n.includes('sheet')) return ['excel', 'xlsx'];
  if (n.includes('docx') || n.includes('word') || n.includes('paper') || n.includes('论文')) return ['word', 'docx'];
  if (n.includes('pptx') || n.includes('ppt') || n.includes('slide')) return ['ppt', 'pptx'];
  if (n.includes('pdf')) return ['pdf'];
  if (n.includes('drawio') || n.includes('diagram')) return ['drawio'];
  if (n.includes('frontend') || n.includes('design') || n.includes('ui')) return ['ui'];
  return [];
}

function splitList(v: string): string[] {
  return v
    .replace(/^\[|\]$/g, '')
    .split(/[,，、]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function deriveKeywords(desc: string): string[] {
  const m = /(?:关键词|keywords)[:：]\s*(.+)/i.exec(desc);
  return m ? splitList(m[1]!) : [];
}

export function parseSkillMd(md: string, source?: string): SkillCard {
  const text = md.replace(/\r\n/g, '\n');
  const m = /^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/.exec(text);
  const fm = m ? m[1]! : '';
  const body = (m ? m[2]! : text).trim();
  const lines = fm.split('\n');

  let name = '';
  let description = '';
  let formats: string[] = [];
  let keywords: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const km = /^([a-zA-Z_]+):\s?(.*)$/.exec(lines[i]!);
    if (!km) continue;
    const key = km[1]!;
    let val = km[2]!.trim();
    // YAML 折叠块(> 或 |):收集后续缩进行
    if (val === '' || val === '>' || val === '|' || val === '>-' || val === '|-') {
      const buf: string[] = [];
      while (i + 1 < lines.length && (lines[i + 1]!.startsWith(' ') || lines[i + 1]!.trim() === '')) {
        i++;
        if (lines[i]!.trim()) buf.push(lines[i]!.trim());
      }
      if (buf.length) val = buf.join(' ');
    }
    if (key === 'name') name = val;
    else if (key === 'description') description = val;
    else if (key === 'formats') formats = splitList(val);
    else if (key === 'keywords') keywords = splitList(val);
  }

  if (!keywords.length) keywords = deriveKeywords(description);
  return {
    name,
    description,
    formats: inferFormats(name, formats),
    keywords,
    instructions: body || undefined,
    source,
  };
}
