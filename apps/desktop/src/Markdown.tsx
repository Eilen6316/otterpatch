/**
 * 轻量 Markdown 渲染:无第三方依赖、不用 dangerouslySetInnerHTML(安全),直接产出 React 元素。
 * 覆盖 Agent 回答常见语法:标题、粗体/斜体/行内码、代码块、有序与无序列表、表格、分隔线、段落。
 */
import type { ReactNode } from 'react';

/** 行内:**粗体** *斜体* `行内码`。 */
function inline(text: string, kb: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('**')) out.push(<strong key={kb + i}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith('`')) out.push(<code key={kb + i}>{tok.slice(1, -1)}</code>);
    else out.push(<em key={kb + i}>{tok.slice(1, -1)}</em>);
    last = m.index + tok.length;
    i++;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const isList = (l: string): boolean => /^\s*[-*]\s+/.test(l) || /^\s*\d+\.\s+/.test(l);
const isTableSep = (l: string | undefined): boolean => !!l && l.includes('-') && /^\s*\|?[\s:|-]+\|?\s*$/.test(l);
const cells = (l: string): string[] => l.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());

export function Markdown({ text }: { text: string }): ReactNode {
  const lines = text.split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';

    // 代码块 ```
    if (line.trimStart().startsWith('```')) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !(lines[i] ?? '').trimStart().startsWith('```')) {
        buf.push(lines[i] ?? '');
        i++;
      }
      i++;
      blocks.push(<pre key={key++}><code>{buf.join('\n')}</code></pre>);
      continue;
    }

    // 标题 # ~ ######(视觉上压一档:# → h3)
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      const lvl = Math.min(h[1]!.length + 2, 6);
      const Tag = `h${lvl}` as 'h3' | 'h4' | 'h5' | 'h6';
      blocks.push(<Tag key={key++}>{inline(h[2]!, `h${key}`)}</Tag>);
      i++;
      continue;
    }

    // 分隔线 --- / ***
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      blocks.push(<hr key={key++} />);
      i++;
      continue;
    }

    // 表格:本行含 | 且下一行是分隔行
    if (line.includes('|') && isTableSep(lines[i + 1])) {
      const header = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && (lines[i] ?? '').includes('|')) {
        rows.push(cells(lines[i] ?? ''));
        i++;
      }
      blocks.push(
        <table key={key++}>
          <thead>
            <tr>{header.map((c, ci) => <th key={ci}>{inline(c, `th${key}-${ci}`)}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={ri}>{r.map((c, ci) => <td key={ci}>{inline(c, `td${key}-${ri}-${ci}`)}</td>)}</tr>
            ))}
          </tbody>
        </table>,
      );
      continue;
    }

    // 列表(连续项)
    if (isList(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line);
      const items: string[] = [];
      while (i < lines.length && isList(lines[i] ?? '')) {
        items.push((lines[i] ?? '').replace(/^\s*(?:[-*]|\d+\.)\s+/, ''));
        i++;
      }
      const ListTag = ordered ? 'ol' : 'ul';
      blocks.push(<ListTag key={key++}>{items.map((it, ii) => <li key={ii}>{inline(it, `li${key}-${ii}`)}</li>)}</ListTag>);
      continue;
    }

    // 空行
    if (!line.trim()) {
      i++;
      continue;
    }

    // 段落(吃到下一个块级元素为止)
    const para: string[] = [];
    while (
      i < lines.length &&
      (lines[i] ?? '').trim() &&
      !/^#{1,6}\s/.test(lines[i] ?? '') &&
      !(lines[i] ?? '').trimStart().startsWith('```') &&
      !isList(lines[i] ?? '') &&
      !/^\s*(-{3,}|\*{3,})\s*$/.test(lines[i] ?? '') &&
      !((lines[i] ?? '').includes('|') && isTableSep(lines[i + 1]))
    ) {
      para.push(lines[i] ?? '');
      i++;
    }
    blocks.push(
      <p key={key++}>
        {para.flatMap((p, pi) => (pi > 0 ? [<br key={`br${pi}`} />, ...inline(p, `p${key}-${pi}`)] : inline(p, `p${key}-${pi}`)))}
      </p>,
    );
  }
  return <>{blocks}</>;
}
