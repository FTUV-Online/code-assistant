import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSSE, type SSEEvent } from '../src/util/sse';

function streamFromStrings(parts: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const p of parts) controller.enqueue(encoder.encode(p));
      controller.close();
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<SSEEvent[]> {
  const events: SSEEvent[] = [];
  for await (const e of parseSSE(stream)) events.push(e);
  return events;
}

test('parseSSE: single event with implicit type "message"', async () => {
  const events = await collect(streamFromStrings(['data: hello\n\n']));
  assert.deepEqual(events, [{ event: 'message', data: 'hello' }]);
});

test('parseSSE: event with explicit type', async () => {
  const events = await collect(
    streamFromStrings(['event: content_block_delta\ndata: {"x":1}\n\n']),
  );
  assert.deepEqual(events, [{ event: 'content_block_delta', data: '{"x":1}' }]);
});

test('parseSSE: multi-line data joins with newline', async () => {
  const events = await collect(streamFromStrings(['data: line1\ndata: line2\n\n']));
  assert.deepEqual(events, [{ event: 'message', data: 'line1\nline2' }]);
});

test('parseSSE: multiple events in sequence', async () => {
  const events = await collect(
    streamFromStrings(['event: a\ndata: 1\n\nevent: b\ndata: 2\n\n']),
  );
  assert.deepEqual(events, [
    { event: 'a', data: '1' },
    { event: 'b', data: '2' },
  ]);
});

test('parseSSE: event type resets after each dispatch', async () => {
  const events = await collect(streamFromStrings(['event: a\ndata: 1\n\ndata: 2\n\n']));
  assert.deepEqual(events, [
    { event: 'a', data: '1' },
    { event: 'message', data: '2' },
  ]);
});

test('parseSSE: handles chunk splits mid-line', async () => {
  const events = await collect(streamFromStrings(['event: del', 'ta\nda', 'ta: hi\n\n']));
  assert.deepEqual(events, [{ event: 'delta', data: 'hi' }]);
});

test('parseSSE: ignores comment lines starting with colon', async () => {
  const events = await collect(streamFromStrings([': keepalive\ndata: x\n\n']));
  assert.deepEqual(events, [{ event: 'message', data: 'x' }]);
});

test('parseSSE: trims a single leading space from value', async () => {
  const events = await collect(streamFromStrings(['data:  two-leading-spaces\n\n']));
  assert.deepEqual(events, [{ event: 'message', data: ' two-leading-spaces' }]);
});

test('parseSSE: trailing data without final blank line is still emitted', async () => {
  const events = await collect(streamFromStrings(['data: tail\n']));
  assert.deepEqual(events, [{ event: 'message', data: 'tail' }]);
});

test('parseSSE: empty stream produces no events', async () => {
  const events = await collect(streamFromStrings([]));
  assert.deepEqual(events, []);
});

test('parseSSE: handles CRLF line endings', async () => {
  const events = await collect(streamFromStrings(['event: a\r\ndata: b\r\n\r\n']));
  assert.deepEqual(events, [{ event: 'a', data: 'b' }]);
});

test('parseSSE: simulates Anthropic content_block_delta stream', async () => {
  const stream = streamFromStrings([
    'event: message_start\ndata: {"type":"message_start"}\n\n',
    'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}\n\n',
    'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":" world"}}\n\n',
    'event: message_stop\ndata: {"type":"message_stop"}\n\n',
  ]);
  const events = await collect(stream);
  assert.equal(events.length, 4);
  assert.equal(events[0].event, 'message_start');
  assert.equal(events[1].event, 'content_block_delta');
  assert.equal(events[3].event, 'message_stop');

  const deltaTexts = events
    .filter((e) => e.event === 'content_block_delta')
    .map((e) => JSON.parse(e.data).delta.text);
  assert.deepEqual(deltaTexts, ['Hello', ' world']);
});
