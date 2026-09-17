/**
 * 技能目录层:坏文件跳过不拖垮整库、两种文件形态、写入路径安全。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSkillDirectory, writeSkillFile } from './directory.js';

const GOOD = `---
name: sales-cleanup
namespace: user
version: 1.0.0
description: 统一日期格式、修复文本数字
formats: excel
allowed_ops: setValue, setFormula
---
# 打法
清洗销售表。`;

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'otterpatch-skills-'));
}

test('loadSkillDirectory: loads good files, skips bad ones with reasons', () => {
  const dir = tempDir();
  try {
    writeFileSync(join(dir, 'good.md'), GOOD);
    writeFileSync(join(dir, 'bad.md'), '---\nname: bad-name\n---\nno description');
    const result = loadSkillDirectory(dir);
    assert.equal(result.cards.length, 1);
    assert.equal(result.cards[0]!.name, 'sales-cleanup');
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0]!.reason, /description/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadSkillDirectory: also loads <subdir>/SKILL.md', () => {
  const dir = tempDir();
  try {
    mkdirSync(join(dir, 'sub'));
    writeFileSync(join(dir, 'sub', 'SKILL.md'), GOOD);
    const result = loadSkillDirectory(dir);
    assert.equal(result.cards.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadSkillDirectory: a missing directory is empty, not an error', () => {
  const result = loadSkillDirectory('/nonexistent-otterpatch-skills');
  assert.deepEqual(result.cards, []);
  assert.deepEqual(result.errors, []);
});

test('writeSkillFile: writes and returns a safe path', () => {
  const dir = tempDir();
  try {
    const file = writeSkillFile(dir, 'sales-cleanup', GOOD);
    assert.equal(file, join(dir, 'sales-cleanup.md'));
    assert.match(loadSkillDirectory(dir).cards[0]?.name ?? '', /sales-cleanup/);
    const unsafe = writeSkillFile(dir, '../../escape', GOOD);
    assert.ok(unsafe.startsWith(dir + '\\') || unsafe.startsWith(dir + '/'), 'the file stays inside the directory');
    assert.equal(unsafe.includes('..\\') || unsafe.includes('../'), false, 'separators are neutralized');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
