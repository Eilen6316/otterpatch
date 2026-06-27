import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSkillMd } from './parse.js';
import { SkillLibrary } from './library.js';
import { defaultLibrary, BUILTIN_SKILLS } from './catalog.js';

const SKILL_MD = `---
name: academic-paper-docx
description: >
  把一篇中文学术论文程序化生成为排版规范的 Word(.docx),再转 PDF。
  关键词:python-docx、三线表、docx、pdf
---

# 中文学术论文 → Word/PDF
正文说明……`;

test('parseSkillMd: 解析 frontmatter + 折叠 description + 正文', () => {
  const c = parseSkillMd(SKILL_MD, 'fixture');
  assert.equal(c.name, 'academic-paper-docx');
  assert.match(c.description, /中文学术论文/);
  assert.deepEqual(c.formats, ['word', 'docx']); // 从 name 推断
  assert.ok(c.keywords.includes('python-docx')); // 从“关键词:”抽取
  assert.match(c.instructions ?? '', /正文说明/);
  assert.equal(c.source, 'fixture');
});

test('SkillLibrary.match: 按格式 + 意图排序', () => {
  const lib = defaultLibrary();
  const word = lib.match('帮我把论文按三线表排版生成 docx', 'word');
  assert.ok(word.length > 0);
  assert.equal(word[0]!.name, 'academic-paper-docx'); // 格式 + 关键词双命中,排第一

  const excel = lib.match('把这张表的金额列补齐', 'excel');
  assert.equal(excel[0]!.name, 'xlsx');
});

test('SkillLibrary.render: 生成可注入系统提示的片段', () => {
  const snip = defaultLibrary().render('word', '写一篇课程论文');
  assert.match(snip, /可用技能/);
  assert.match(snip, /academic-paper-docx/);
});

test('add 去重 + toMcpTools', () => {
  const lib = new SkillLibrary();
  lib.add(BUILTIN_SKILLS[0]!).add(BUILTIN_SKILLS[0]!);
  assert.equal(lib.all().length, 1);
  const tools = defaultLibrary().toMcpTools();
  assert.equal(tools.length, BUILTIN_SKILLS.length);
  assert.ok(tools.every((t) => t.name.startsWith('skill__')));
});
