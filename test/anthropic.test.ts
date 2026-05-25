import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AnthropicProvider } from '../src/providers/anthropic';
import type { ProviderConfig } from '../src/providers/base';

function makeStream(parts: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const p of parts) controller.enqueue(encoder.encode(p));
      controller.close();
    },
  });
}

function baseConfig(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: 'test',
    protocol: 'anthropic',
    baseURL: 'https://api.anthropic.com',
    model: 'claude-haiku-4-5',
    ...overrides,
  };
}

async function drain(iter: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const c of iter) out.push(c);
  return out;
}

type CapturedCall = { url: string; init: any };

function mockFetch(response: Response | ((req: CapturedCall) => Response)): () => CapturedCall[] {
  const calls: CapturedCall[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : input.url;
    const call = { url, init };
    calls.push(call);
    return typeof response === 'function' ? response(call) : response;
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
    return calls;
  };
}

test('AnthropicProvider: yields delta text from SSE stream', async () => {
  const body = makeStream([
    'event: content_block_delta\ndata: {"delta":{"type":"text_delta","text":"foo"}}\n\n',
    'event: content_block_delta\ndata: {"delta":{"type":"text_delta","text":"bar"}}\n\n',
    'event: message_stop\ndata: {}\n\n',
  ]);
  const restore = mockFetch(new Response(body, { status: 200 }));
  try {
    const provider = new AnthropicProvider('t', baseConfig(), 'sk-test');
    const chunks = await drain(
      provider.complete(
        { prefix: 'const x = ', suffix: ';', language: 'typescript', filePath: 'src/foo.ts' },
        new AbortController().signal,
      ),
    );
    assert.equal(chunks.join(''), 'foobar');
  } finally {
    restore();
  }
});

test('AnthropicProvider: sends correct URL, method, headers and body', async () => {
  const body = makeStream(['event: message_stop\ndata: {}\n\n']);
  const restore = mockFetch(new Response(body, { status: 200 }));
  try {
    const provider = new AnthropicProvider(
      't',
      baseConfig({ maxTokens: 128, temperature: 0.1 }),
      'sk-key',
    );
    await drain(
      provider.complete(
        { prefix: 'a', suffix: 'b', language: 'go', filePath: 'main.go' },
        new AbortController().signal,
      ),
    );
    const [call] = restore();
    assert.equal(call.url, 'https://api.anthropic.com/v1/messages');
    assert.equal(call.init.method, 'POST');
    assert.equal(call.init.headers['x-api-key'], 'sk-key');
    assert.equal(call.init.headers['anthropic-version'], '2023-06-01');
    assert.equal(call.init.headers['content-type'], 'application/json');

    const payload = JSON.parse(call.init.body);
    assert.equal(payload.model, 'claude-haiku-4-5');
    assert.equal(payload.max_tokens, 128);
    assert.equal(payload.temperature, 0.1);
    assert.equal(payload.stream, true);
    assert.equal(payload.messages[0].role, 'user');
    assert.match(payload.messages[0].content, /a<CURSOR\/>b/);
    assert.match(payload.messages[0].content, /\/\/ File: main\.go/);
    assert.match(payload.messages[0].content, /```go/);
  } finally {
    /* restore handled above */
  }
});

test('AnthropicProvider: applies prompt caching to system prompt', async () => {
  const body = makeStream(['event: message_stop\ndata: {}\n\n']);
  const restore = mockFetch(new Response(body, { status: 200 }));
  try {
    const provider = new AnthropicProvider(
      't',
      baseConfig({ promptCaching: true }),
      'sk-key',
    );
    await drain(
      provider.complete(
        { prefix: '', suffix: '', language: 'js' },
        new AbortController().signal,
      ),
    );
    const [call] = restore();
    const payload = JSON.parse(call.init.body);
    assert.ok(Array.isArray(payload.system));
    assert.equal(payload.system[0].type, 'text');
    assert.deepEqual(payload.system[0].cache_control, { type: 'ephemeral' });
  } finally {
    /* restore handled above */
  }
});

test('AnthropicProvider: uses plain string system prompt when caching disabled', async () => {
  const body = makeStream(['event: message_stop\ndata: {}\n\n']);
  const restore = mockFetch(new Response(body, { status: 200 }));
  try {
    const provider = new AnthropicProvider('t', baseConfig(), 'sk-key');
    await drain(
      provider.complete(
        { prefix: '', suffix: '', language: 'js' },
        new AbortController().signal,
      ),
    );
    const [call] = restore();
    const payload = JSON.parse(call.init.body);
    assert.equal(typeof payload.system, 'string');
  } finally {
    /* restore handled above */
  }
});

test('AnthropicProvider: merges custom headers; skips x-api-key if Authorization provided', async () => {
  const body = makeStream(['event: message_stop\ndata: {}\n\n']);
  const restore = mockFetch(new Response(body, { status: 200 }));
  try {
    const provider = new AnthropicProvider(
      't',
      baseConfig({
        baseURL: 'https://proxy.example.com',
        headers: { authorization: 'Bearer xyz', 'X-Team-ID': 'dev' },
      }),
      'sk-shouldnt-be-sent',
    );
    await drain(
      provider.complete(
        { prefix: '', suffix: '', language: 'js' },
        new AbortController().signal,
      ),
    );
    const [call] = restore();
    assert.equal(call.init.headers['authorization'], 'Bearer xyz');
    assert.equal(call.init.headers['X-Team-ID'], 'dev');
    assert.equal(call.init.headers['x-api-key'], undefined);
  } finally {
    /* restore handled above */
  }
});

test('AnthropicProvider: strips trailing slash from baseURL', async () => {
  const body = makeStream(['event: message_stop\ndata: {}\n\n']);
  const restore = mockFetch(new Response(body, { status: 200 }));
  try {
    const provider = new AnthropicProvider(
      't',
      baseConfig({ baseURL: 'https://api.anthropic.com/' }),
      'sk',
    );
    await drain(
      provider.complete(
        { prefix: '', suffix: '', language: 'js' },
        new AbortController().signal,
      ),
    );
    const [call] = restore();
    assert.equal(call.url, 'https://api.anthropic.com/v1/messages');
  } finally {
    /* restore handled above */
  }
});

test('AnthropicProvider: throws on non-2xx response with body excerpt', async () => {
  const restore = mockFetch(new Response('rate limited', { status: 429 }));
  try {
    const provider = new AnthropicProvider('t', baseConfig(), 'sk');
    await assert.rejects(
      () =>
        drain(
          provider.complete(
            { prefix: '', suffix: '', language: 'js' },
            new AbortController().signal,
          ),
        ),
      /Anthropic API 429.*rate limited/,
    );
  } finally {
    restore();
  }
});

test('AnthropicProvider: throws on stream error event', async () => {
  const body = makeStream([
    'event: error\ndata: {"type":"overloaded_error"}\n\n',
  ]);
  const restore = mockFetch(new Response(body, { status: 200 }));
  try {
    const provider = new AnthropicProvider('t', baseConfig(), 'sk');
    await assert.rejects(
      () =>
        drain(
          provider.complete(
            { prefix: '', suffix: '', language: 'js' },
            new AbortController().signal,
          ),
        ),
      /stream error/,
    );
  } finally {
    restore();
  }
});

test('AnthropicProvider: filters whitespace-only stop sequences', async () => {
  const body = makeStream(['event: message_stop\ndata: {}\n\n']);
  const restore = mockFetch(new Response(body, { status: 200 }));
  try {
    const provider = new AnthropicProvider('t', baseConfig(), 'sk');
    await drain(
      provider.complete(
        {
          prefix: 'a',
          suffix: 'b',
          language: 'js',
          stopSequences: ['\n\n\n', '   ', '', '</end>'],
        },
        new AbortController().signal,
      ),
    );
    const [call] = restore();
    const payload = JSON.parse(call.init.body);
    assert.deepEqual(payload.stop_sequences, ['</end>']);
  } finally {
    /* restore handled above */
  }
});

test('AnthropicProvider: omits stop_sequences entirely when all are whitespace', async () => {
  const body = makeStream(['event: message_stop\ndata: {}\n\n']);
  const restore = mockFetch(new Response(body, { status: 200 }));
  try {
    const provider = new AnthropicProvider('t', baseConfig(), 'sk');
    await drain(
      provider.complete(
        { prefix: 'a', suffix: 'b', language: 'js', stopSequences: ['\n\n', '  '] },
        new AbortController().signal,
      ),
    );
    const [call] = restore();
    const payload = JSON.parse(call.init.body);
    assert.equal(payload.stop_sequences, undefined);
  } finally {
    /* restore handled above */
  }
});

test('AnthropicProvider: omits filePath comment when not provided', async () => {
  const body = makeStream(['event: message_stop\ndata: {}\n\n']);
  const restore = mockFetch(new Response(body, { status: 200 }));
  try {
    const provider = new AnthropicProvider('t', baseConfig(), 'sk');
    await drain(
      provider.complete(
        { prefix: 'a', suffix: 'b', language: 'js' },
        new AbortController().signal,
      ),
    );
    const [call] = restore();
    const payload = JSON.parse(call.init.body);
    assert.doesNotMatch(payload.messages[0].content, /\/\/ File:/);
  } finally {
    /* restore handled above */
  }
});
