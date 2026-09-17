/**
 * 技能目录的文件层:从目录加载外部 SKILL.md、把蒸馏产物写入目录。
 * 与 SkillLibrary(纯内存)解耦——加载失败永不抛错,坏文件只是跳过并给出原因。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseSkillMd, type SkillCard } from './parse.js';

export interface SkillDirectoryLoadResult {
  cards: SkillCard[];
  errors: Array<{ file: string; reason: string }>;
}

/**
 * 加载目录下的外部技能:*.md 文件与 <subdir>/SKILL.md 两种形态都认。
 * 解析失败的文件被跳过(外部技能是不可信数据,坏一个不能拖垮整库)。
 */
export function loadSkillDirectory(directory: string): SkillDirectoryLoadResult {
  const cards: SkillCard[] = [];
  const errors: Array<{ file: string; reason: string }> = [];
  if (!directory || !existsSync(directory)) return { cards, errors };

  const files: string[] = [];
  const collect = (dir: string, depth: number): void => {
    if (depth > 2) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch (error) {
      errors.push({ file: dir, reason: error instanceof Error ? error.message : String(error) });
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) collect(full, depth + 1);
      else if (entry.isFile() && (entry.name.endsWith('.md') || entry.name.endsWith('.markdown'))) files.push(full);
    }
  };
  collect(directory, 0);

  for (const file of files) {
    try {
      const card = parseSkillMd(readFileSync(file, 'utf8'), file);
      cards.push(card);
    } catch (error) {
      errors.push({ file, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return { cards, errors };
}

/** 把蒸馏出的 SKILL.md 写入目录(按技能 ID 命名),返回文件路径。 */
export function writeSkillFile(directory: string, name: string, md: string): string {
  mkdirSync(directory, { recursive: true });
  const safe = name.replace(/[^a-z0-9._-]/gi, '-').slice(0, 64) || 'skill';
  const file = join(directory, `${safe}.md`);
  writeFileSync(file, md, { encoding: 'utf8' });
  return file;
}
