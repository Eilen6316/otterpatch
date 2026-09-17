/**
 * Hover-card model: card state derivation (text extraction, clipping, viewport flip,
 * anchor position) and the shared ring-cursor arithmetic.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  HOVER_CARD_CLOSE_DELAY_MS,
  HOVER_CARD_OPEN_DELAY_MS,
  buildHoverCardState,
  wrapCursor,
} from './richdoc-hover-card.js';

interface FakeChange {
  attributes: Record<string, string>;
  delText: string | null;
  insText: string | null;
  text: string;
  rect: { left: number; top: number; bottom: number; width: number };
}

const change = (input: Partial<FakeChange> & { attributes: Record<string, string>; rect: FakeChange['rect'] }): FakeChange => ({
  delText: null,
  insText: null,
  text: '',
  ...input,
});

const elementFor = (fake: FakeChange) => ({
  getAttribute: (name: string) => fake.attributes[name] ?? null,
  querySelector: (selector: string) => {
    if (selector === 'del' && fake.delText !== null) return { textContent: fake.delText };
    if (selector === 'ins' && fake.insText !== null) return { textContent: fake.insText };
    return null;
  },
  textContent: fake.text,
  getBoundingClientRect: () => fake.rect,
});

test('buildHoverCardState: replace changes show old→new from del/ins', () => {
  const state = buildHoverCardState(elementFor(change({
    attributes: { 'data-cid': 'e1', 'data-kind': 'replace', 'data-glyph': '✓' },
    delText: '旧文',
    insText: '新文',
    rect: { left: 100, top: 300, bottom: 320, width: 40 },
  })));
  assert.deepEqual(state, {
    cid: 'e1', kind: 'replace', oldText: '旧文', newText: '新文', glyph: '✓',
    x: 120, y: 300, below: false,
  });
});

test('buildHoverCardState: missing change id yields no card', () => {
  assert.equal(buildHoverCardState(elementFor(change({
    attributes: {}, rect: { left: 0, top: 0, bottom: 0, width: 0 },
  }))), null);
});

test('buildHoverCardState: default kind is replace', () => {
  const state = buildHoverCardState(elementFor(change({
    attributes: { 'data-cid': 'e2' },
    insText: 'x',
    rect: { left: 0, top: 0, bottom: 0, width: 0 },
  })));
  assert.equal(state?.kind, 'replace');
});

test('buildHoverCardState: format changes show the current full text', () => {
  const state = buildHoverCardState(elementFor(change({
    attributes: { 'data-cid': 'e3', 'data-kind': 'format' },
    text: '整段新格式',
    rect: { left: 0, top: 0, bottom: 0, width: 0 },
  })));
  assert.equal(state?.newText, '整段新格式');
});

test('buildHoverCardState: insert changes use the projected block text when provided', () => {
  const state = buildHoverCardState(
    elementFor(change({
      attributes: { 'data-cid': 'e4', 'data-kind': 'insert' },
      text: 'raw text',
      rect: { left: 0, top: 0, bottom: 0, width: 0 },
    })),
    { insertText: () => '投影文本' },
  );
  assert.equal(state?.newText, '投影文本');
});

test('buildHoverCardState: long texts are clipped with an ellipsis', () => {
  const long = 'x'.repeat(80);
  const state = buildHoverCardState(elementFor(change({
    attributes: { 'data-cid': 'e5' },
    insText: long,
    rect: { left: 0, top: 0, bottom: 0, width: 0 },
  })));
  assert.equal(state?.newText.length, 49); // 48 chars + ellipsis
  assert.equal(state?.newText.endsWith('…'), true);
});

test('buildHoverCardState: changes near the viewport top flip below', () => {
  const nearTop = buildHoverCardState(elementFor(change({
    attributes: { 'data-cid': 'e6' },
    rect: { left: 10, top: 100, bottom: 120, width: 20 },
  })));
  assert.equal(nearTop?.below, true);
  assert.equal(nearTop?.y, 120, 'anchored at the bottom edge when flipped');

  const lower = buildHoverCardState(elementFor(change({
    attributes: { 'data-cid': 'e7' },
    rect: { left: 10, top: 300, bottom: 320, width: 20 },
  })));
  assert.equal(lower?.below, false);
  assert.equal(lower?.y, 300);
});

test('buildHoverCardState: x is the horizontal center, rounded', () => {
  const state = buildHoverCardState(elementFor(change({
    attributes: { 'data-cid': 'e8' },
    rect: { left: 10, top: 300, bottom: 320, width: 21 },
  })));
  assert.equal(state?.x, 21); // round(10 + 21/2) = round(20.5) = 21
});

test('hover card delays keep the open delay longer than the close delay', () => {
  assert.equal(HOVER_CARD_OPEN_DELAY_MS, 120);
  assert.equal(HOVER_CARD_CLOSE_DELAY_MS, 90);
  assert.ok(HOVER_CARD_OPEN_DELAY_MS > HOVER_CARD_CLOSE_DELAY_MS);
});

test('wrapCursor: forward and backward stepping wraps around', () => {
  assert.equal(wrapCursor(0, 1, 3), 1);
  assert.equal(wrapCursor(2, 1, 3), 0, 'next from the last wraps to the first');
  assert.equal(wrapCursor(0, -1, 3), 2, 'previous from the first wraps to the last');
  assert.equal(wrapCursor(1, -1, 3), 0);
});

test('wrapCursor: empty lists are a no-op', () => {
  assert.equal(wrapCursor(0, 1, 0), 0);
  assert.equal(wrapCursor(5, -1, 0), 0);
});
