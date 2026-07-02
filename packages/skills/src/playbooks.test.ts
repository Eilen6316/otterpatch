import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultLibrary } from './catalog.js';
import { PLAYBOOK_SKILLS } from './playbooks.js';

test('playbook:全部打法手册都带 L1 正文', () => {
  assert.equal(PLAYBOOK_SKILLS.length, 7);
  for (const c of PLAYBOOK_SKILLS) assert.ok((c.instructions ?? '').length > 200, c.name + ' 手册太薄');
});

test('意图匹配:写作/建模/PPT 类请求命中对应新手册', () => {
  const lib = defaultLibrary();
  assert.equal(lib.match('帮我起草一份项目报告', 'word')[0]?.name, 'docx-coauthoring');
  assert.equal(lib.match('这个模型的公式帮我规范化,别硬编码', 'excel')[0]?.name, 'xlsx-authoring');
  assert.equal(lib.match('这页幻灯片配色帮我美化一下', 'ppt')[0]?.name, 'pptx-design');
});

test('意图匹配:公文类请求命中 docx-gongwen 且排最前', () => {
  const lib = defaultLibrary();
  const hit = lib.match('把这份通知排成公文格式', 'word');
  assert.equal(hit[0]?.name, 'docx-gongwen');
});

test('意图匹配:财务/图表请求各命中对应手册', () => {
  const lib = defaultLibrary();
  assert.equal(lib.match('检查这张财务报表的勾稽关系', 'excel')[0]?.name, 'xlsx-financial');
  assert.equal(lib.match('各产品销量画个图表', 'excel')[0]?.name, 'chart-selection');
});

test('render:带手册的技能有【有打法手册】标注与 load_skill 指引', () => {
  const lib = defaultLibrary();
  const r = lib.render('word', '公文排版');
  assert.match(r, /docx-gongwen【有打法手册】/);
  assert.match(r, /load_skill/);
});

test('instructionsFor:能按名拉到手册正文(GB/T 9704 内容在)', () => {
  const lib = defaultLibrary();
  const md = lib.instructionsFor('docx-gongwen') ?? '';
  assert.match(md, /GB\/T 9704/);
  assert.match(md, /仿宋/);
  assert.equal(lib.instructionsFor('不存在'), undefined);
});
