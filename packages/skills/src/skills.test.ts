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

test('内置=通用技能 + 跨行业打法手册,不含行业专用模板技能', () => {
  const builtin = ['xlsx', 'docx', 'pptx', 'pdf', 'drawio', 'docx-gongwen', 'xlsx-financial', 'chart-selection'];
  assert.ok(defaultLibrary().all().every((c) => builtin.includes(c.name)));
  assert.equal(
    defaultLibrary().match('写课程论文 三线表', 'word').some((c) => c.name === 'academic-paper-docx'),
    false,
  );
});

test('专用技能从外部 SKILL.md 安装后即可命中', () => {
  const lib = defaultLibrary();
  const card = lib.install(SKILL_MD, 'user:SKILL_HUB');
  assert.equal(card.name, 'academic-paper-docx');
  // 安装后,论文+三线表意图命中专用技能(格式 + 关键词双命中,胜过通用 docx)
  assert.equal(lib.match('写课程论文 三线表', 'word')[0]!.name, 'academic-paper-docx');
});

test('SkillLibrary.match: 按格式 + 意图排序(内置通用)', () => {
  const lib = defaultLibrary();
  assert.equal(lib.match('把这张表的金额列补齐', 'excel')[0]!.name, 'xlsx');
  assert.equal(lib.match('把这个 word 文档排版一下', 'word')[0]!.name, 'docx');
});

test('SkillLibrary.render: 生成可注入系统提示的片段', () => {
  const snip = defaultLibrary().render('word', '排版这个文档');
  assert.match(snip, /可用技能/);
  assert.match(snip, /docx/);
});

test('add 去重 + toMcpTools', () => {
  const lib = new SkillLibrary();
  lib.add(BUILTIN_SKILLS[0]!).add(BUILTIN_SKILLS[0]!);
  assert.equal(lib.all().length, 1);
  const tools = defaultLibrary().toMcpTools();
  assert.equal(tools.length, BUILTIN_SKILLS.length + 3); // 通用卡片 + 3 篇打法手册
  assert.ok(tools.every((t) => t.name.startsWith('skill__')));
});
