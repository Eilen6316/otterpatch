/**
 * Pure text utilities extracted from RichDoc: HTML escaping and the Change Case family.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { esc, transformCase } from './richdoc-text-case.js';

test('esc escapes every HTML-significant character', () => {
  assert.equal(esc('<b>"x" & \'y\'</b>'), '&lt;b&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/b&gt;');
  assert.equal(esc('plain text'), 'plain text');
});

test('transformCase upper/lower/title/sentence/toggle', () => {
  assert.equal(transformCase('hello World', 'upper'), 'HELLO WORLD');
  assert.equal(transformCase('Hello World', 'lower'), 'hello world');
  assert.equal(transformCase('hello world', 'title'), 'Hello World');
  assert.equal(transformCase('hello WORLD', 'sentence'), 'Hello world');
  assert.equal(transformCase('aBc', 'toggle'), 'AbC');
});

test('transformCase keeps CJK text unchanged and handles empty input', () => {
  assert.equal(transformCase('项目周报', 'upper'), '项目周报');
  assert.equal(transformCase('项目周报', 'title'), '项目周报');
  assert.equal(transformCase('', 'upper'), '');
  assert.equal(transformCase('abc', 'unknown' as never), 'abc', 'unknown mode returns the input unchanged');
});

test('transformCase title capitalizes after punctuation-free word boundaries only', () => {
  assert.equal(transformCase('it is a test', 'title'), 'It Is A Test');
});
