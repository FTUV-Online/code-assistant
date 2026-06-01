import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ChatMessage } from '../src/providers/base';
import {
  computeMessageChars,
  computeSafeCutPoints,
  estimateMessagesTokens,
  extractTextContent,
  looksLikeIntentWithoutAction,
  stripImagesFromMessages,
  withAbort,
} from '../src/ui/chat/helpers';

// ── looksLikeIntentWithoutAction ──

test('looksLikeIntentWithoutAction: empty text → true', () => {
  assert.equal(looksLikeIntentWithoutAction(''), true);
  assert.equal(looksLikeIntentWithoutAction('   '), true);
});

test('looksLikeIntentWithoutAction: trailing colon → true', () => {
  assert.equal(looksLikeIntentWithoutAction('Let me check:'), true);
});

test('looksLikeIntentWithoutAction: trailing fullwidth colon → true', () => {
  assert.equal(looksLikeIntentWithoutAction('讓我看看：'), true);
});

test('looksLikeIntentWithoutAction: trailing ellipsis char → true', () => {
  assert.equal(looksLikeIntentWithoutAction('Looking into this…'), true);
});

test('looksLikeIntentWithoutAction: trailing literal dots → true', () => {
  assert.equal(looksLikeIntentWithoutAction('Let me check...'), true);
});

test('looksLikeIntentWithoutAction: trailing arrow → true', () => {
  assert.equal(looksLikeIntentWithoutAction('I will now →'), true);
  assert.equal(looksLikeIntentWithoutAction('Let me→'), true);
});

test('looksLikeIntentWithoutAction: trailing arrow -> → true', () => {
  assert.equal(looksLikeIntentWithoutAction('I will now ->'), true);
  assert.equal(looksLikeIntentWithoutAction('do this->'), true);
});

test('looksLikeIntentWithoutAction: trailing fat arrow => → true', () => {
  assert.equal(looksLikeIntentWithoutAction('Then I will =>'), true);
});

test('looksLikeIntentWithoutAction: trailing period → false (genuine end)', () => {
  assert.equal(looksLikeIntentWithoutAction('This is done.'), false);
});

test('looksLikeIntentWithoutAction: trailing exclamation → false', () => {
  assert.equal(looksLikeIntentWithoutAction('All fixed!'), false);
});

test('looksLikeIntentWithoutAction: trailing question → false', () => {
  assert.equal(looksLikeIntentWithoutAction('What do you think?'), false);
});

test('looksLikeIntentWithoutAction: trailing closing quote → false', () => {
  assert.equal(looksLikeIntentWithoutAction('Here is the code."'), false);
});

test('looksLikeIntentWithoutAction: plain statement → false', () => {
  assert.equal(looksLikeIntentWithoutAction('The bug was in line 42. Fixed.'), false);
});

test('looksLikeIntentWithoutAction: arrow mid-sentence → false', () => {
  assert.equal(looksLikeIntentWithoutAction('Use a → b for mapping.'), false);
});

// ── computeSafeCutPoints ──

test('computeSafeCutPoints: empty messages → [0] (filtered out)', () => {
  const points = computeSafeCutPoints([]);
  assert.deepEqual(points, []);
});

test('computeSafeCutPoints: single message → still [0] (index 0 always a safe cut)', () => {
  const msgs: ChatMessage[] = [{ role: 'user', content: 'hi' }];
  // 0 is always added; with 1 message it's the only valid cut point
  assert.deepEqual(computeSafeCutPoints(msgs), [0]);
});

test('computeSafeCutPoints: user→assistant → cut point [0]', () => {
  const msgs: ChatMessage[] = [
    { role: 'user', content: 'q1' },
    { role: 'assistant', content: 'a1' },
  ];
  // user→assistant boundary at index 1 → cut at index 0
  assert.deepEqual(computeSafeCutPoints(msgs), [0]);
});

test('computeSafeCutPoints: assistant→user → cut points [0, 2]', () => {
  const msgs: ChatMessage[] = [
    { role: 'user', content: 'q1' },
    { role: 'assistant', content: 'a1' },
    { role: 'user', content: 'q2' },
  ];
  // 0 from user→assistant boundary, 2 from assistant→user boundary
  assert.deepEqual(computeSafeCutPoints(msgs), [0, 2]);
});

test('computeSafeCutPoints: multi-turn picks correct boundaries', () => {
  const msgs: ChatMessage[] = [
    { role: 'user', content: 'q1' },
    { role: 'assistant', content: 'a1' },
    { role: 'user', content: 'q2' },
    { role: 'assistant', content: 'a2' },
    { role: 'user', content: 'q3' },
    { role: 'assistant', content: 'a3' },
  ];
  assert.deepEqual(computeSafeCutPoints(msgs), [0, 2, 4]);
});

// ── extractTextContent ──

test('extractTextContent: string → same string', () => {
  assert.equal(extractTextContent('hello'), 'hello');
});

test('extractTextContent: blocks → joined text', () => {
  assert.equal(
    extractTextContent([
      { type: 'text', text: 'a' },
      { type: 'text', text: 'b' },
    ]),
    'a\nb',
  );
});

test('extractTextContent: skips tool blocks', () => {
  assert.equal(
    extractTextContent([
      { type: 'text', text: 'ok' },
      { type: 'tool_use', id: '1', name: 'x', input: {} },
    ]),
    'ok',
  );
});

// ── stripImagesFromMessages ──

test('stripImagesFromMessages: replaces image with placeholder', () => {
  const msgs: ChatMessage[] = [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'check this' },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc' } },
      ],
    },
  ];
  const result = stripImagesFromMessages(msgs);
  if (typeof result[0].content !== 'string') {
    const blocks = result[0].content;
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0].type, 'text');
    assert.equal(blocks[1].type, 'text');
    assert.ok(blocks[1].type === 'text' && 'text' in blocks[1] && blocks[1].text.includes('stripped'));
  }
});

// ── computeMessageChars ──

test('computeMessageChars: string content', () => {
  const msg: ChatMessage = { role: 'user', content: 'hello' };
  assert.equal(computeMessageChars(msg), 5);
});

test('computeMessageChars: mixed blocks', () => {
  const msg: ChatMessage = {
    role: 'assistant',
    content: [
      { type: 'text', text: 'abc' },
      { type: 'tool_use', id: '1', name: 'x', input: { a: 1 } },
    ],
  };
  // 'abc' = 3 + JSON of {a:1} = 7 = 10
  assert.equal(computeMessageChars(msg), 10);
});

// ── estimateMessagesTokens ──

test('estimateMessagesTokens: chars/4 rounded up', () => {
  const msgs: ChatMessage[] = [
    { role: 'user', content: '1234' }, // 4 chars /4 = 1
    { role: 'assistant', content: '12' }, // 2 chars /4 = ceil(0.5) = 1
  ];
  assert.equal(estimateMessagesTokens(msgs), 2);
});

test('estimateMessagesTokens: image counts 1500 tokens', () => {
  const msgs: ChatMessage[] = [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'x' },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'img' } },
      ],
    },
  ];
  // ceil(1/4) + 1500 = 1 + 1500 = 1501
  assert.equal(estimateMessagesTokens(msgs), 1501);
});

// ── withAbort ──

test('withAbort: resolves when promise resolves', async () => {
  const ctrl = new AbortController();
  const result = await withAbort(Promise.resolve(42), ctrl.signal);
  assert.equal(result, 42);
});

test('withAbort: rejects when signal fires first', async () => {
  const ctrl = new AbortController();
  const promise = withAbort(new Promise(() => {}), ctrl.signal);
  ctrl.abort();
  await assert.rejects(promise);
});

test('withAbort: rejects when already aborted', async () => {
  const ctrl = new AbortController();
  ctrl.abort();
  await assert.rejects(withAbort(Promise.resolve(1), ctrl.signal));
});
