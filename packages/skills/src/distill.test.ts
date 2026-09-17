/**
 * 示范即技能:提交 → 技能卡的蒸馏(纯函数)+ SKILL.md 渲染与解析回环。
 * 外部技能是不可信数据:非法产物必须被 parseSkillMd 拒绝,而不是悄悄进库。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { distillSkillDraft, extractTriggers, renderSkillMd, slugifySkillName } from './distill.js';
import { parseSkillMd } from './parse.js';
import { SkillLibrary } from './library.js';
import type { DistillChangeSet } from './distill.js';

function gridCs(edits: DistillChangeSet['edits']): DistillChangeSet {
  return {
    edits,
    anchors: {
      a1: { portable: { kind: 'grid', sheet: 'Sheet1', a1: 'A1:B2' } },
      a2: { portable: { kind: 'grid', sheet: 'Sheet1', a1: 'C1' } },
    },
  };
}

const valueEdits: DistillChangeSet['edits'] = [
  { id: 'e1', target: 'a1', op: { kind: 'setValue', value: 42 } },
  { id: 'e2', target: 'a2', op: { kind: 'setFormula', formula: '=A1*2' } },
];

test('distillSkillDraft: extracts ops, formats, triggers and a playbook from the demonstration', () => {
  const draft = distillSkillDraft({
    intent: '统一日期格式、修复被存成文本的数字、标红异常值',
    format: 'excel',
    changeSet: gridCs(valueEdits),
  });
  assert.deepEqual(draft.formats, ['excel', 'xlsx']);
  assert.deepEqual(draft.allowedOps, ['setValue', 'setFormula']);
  assert.ok(draft.triggers.length >= 2, 'intent phrases become retrieval triggers');
  assert.match(draft.instructions, /Sheet1!A1:B2/);
  assert.match(draft.instructions, /setValue 42/);
  assert.match(draft.instructions, /setFormula =A1\*2/);
  assert.match(draft.instructions, /锚点必须唯一落地/);
});

test('distillSkillDraft: a word demonstration records quote/para anchor shapes', () => {
  const cs: DistillChangeSet = {
    edits: [
      { id: 'e1', target: 'a1', op: { kind: 'replaceText', text: '新的正文' } },
      { id: 'e2', target: 'a2', op: { kind: 'setStyle', scope: 'paragraph', style: { align: 'center' } } },
    ],
    anchors: {
      a1: { portable: { kind: 'flow', path: [0], quote: { text: '旧的正文' } } },
      a2: { portable: { kind: 'flow', path: [], quote: { text: '' } } },
    },
  };
  const draft = distillSkillDraft({ intent: '圈选正文改成正式公文语气', format: 'word', changeSet: cs });
  assert.deepEqual(draft.formats, ['word', 'docx']);
  assert.deepEqual(draft.allowedOps, ['replaceText', 'setStyle']);
  assert.match(draft.instructions, /第1段/);
  assert.match(draft.instructions, /replaceText/);
  assert.match(draft.instructions, /scope=paragraph/);
});

test('distillSkillDraft: rejects empty intents and edit-less demonstrations', () => {
  assert.throws(() => distillSkillDraft({ intent: '   ', format: 'excel', changeSet: gridCs(valueEdits) }), /intent is required/);
  assert.throws(() => distillSkillDraft({ intent: 'x', format: 'excel', changeSet: gridCs([]) }), /no edits/);
  assert.throws(() => distillSkillDraft({ intent: 'x', format: '', changeSet: gridCs(valueEdits) }), /format is required/);
});

test('slugifySkillName: ASCII intents slugify; CJK intents get a stable demo id', () => {
  assert.equal(slugifySkillName('Clean the Sales Table!'), 'clean-the-sales-table');
  const first = slugifySkillName('清洗销售表');
  const second = slugifySkillName('清洗销售表');
  assert.equal(first, second, 'same intent → same id (stable)');
  assert.match(first, /^demo-[0-9a-f]{8}$/);
  assert.notEqual(slugifySkillName('清洗另一张表'), first);
  assert.equal(slugifySkillName('用户指定-sales-report'), 'sales-report');
});

test('extractTriggers: splits on punctuation, bounds length, dedupes', () => {
  const triggers = extractTriggers('统一日期格式;修复文本数字,标红异常值。');
  assert.deepEqual(triggers, ['统一日期格式', '修复文本数字', '标红异常值']);
  assert.deepEqual(extractTriggers('a'), [], 'single-char segments are dropped');
  assert.deepEqual(extractTriggers('same;same'), ['same'], 'duplicates collapse');
});

test('renderSkillMd + parseSkillMd: round-trips into a valid external card', () => {
  const draft = distillSkillDraft({
    intent: '把 B1 改成 99 并补公式',
    format: 'excel',
    changeSet: gridCs(valueEdits),
    name: 'sales-fix',
  });
  const md = renderSkillMd(draft);
  assert.match(md, /^---\n/);
  const card = parseSkillMd(md, 'distilled');
  assert.equal(card.name, 'sales-fix');
  assert.equal(card.namespace, 'user', 'external skills never take the reserved namespace');
  assert.equal(card.trust, 'external');
  assert.equal(card.immutable, false);
  assert.deepEqual(card.formats, ['excel', 'xlsx']);
  assert.deepEqual(card.allowedOps, ['setValue', 'setFormula']);
  assert.ok(card.instructions?.includes('演示编辑明细'));
});

test('distilled skills match similar future intents through the library', () => {
  const draft = distillSkillDraft({
    intent: '统一日期格式、修复被存成文本的数字、标红异常值',
    format: 'excel',
    changeSet: gridCs(valueEdits),
    name: 'sales-cleanup',
  });
  const library = new SkillLibrary();
  library.install(renderSkillMd(draft), 'distilled');

  const hits = library.match('帮我把这张表统一日期格式、修复文本数字', 'excel');
  assert.ok(hits.some((card) => card.name === 'sales-cleanup'), 'the distilled skill ranks for a similar intent');

  // allowed_ops 与格式清单同时起门禁作用:drawio 上不命中。
  assert.ok(!library.match('统一日期格式', 'drawio').some((card) => card.name === 'sales-cleanup'));
});
