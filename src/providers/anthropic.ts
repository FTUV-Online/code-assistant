import type {
  ChatContentBlock,
  ChatMessage,
  ChatOptions,
  ChatStreamEvent,
  CompletionRequest,
  LLMProvider,
  ProviderConfig,
  ToolDef,
} from './base';
import { applyAuthHeaders } from './base';
import * as log from '../util/logger';
import { parseSSE } from '../util/sse';

const COMPLETION_SYSTEM_PROMPT =
  'You are an inline code completion engine. The user will send a code snippet ' +
  'containing a <CURSOR/> marker. Reply with ONLY the raw code that should be ' +
  'inserted at <CURSOR/> to continue the program naturally. ' +
  'Do not include explanations, surrounding context, or markdown code fences. ' +
  'Match the file language and existing indentation.';

type AnthropicSystem =
  | string
  | Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }>;

type AnthropicMessageContent = string | ChatContentBlock[];

type AnthropicMessageBody = {
  model: string;
  max_tokens: number;
  temperature: number;
  stream: true;
  system?: AnthropicSystem;
  messages: Array<{ role: 'user' | 'assistant'; content: AnthropicMessageContent }>;
  stop_sequences?: string[];
  tools?: ToolDef[];
};

export class AnthropicProvider implements LLMProvider {
  readonly protocol = 'anthropic' as const;

  constructor(
    public readonly id: string,
    private readonly config: ProviderConfig,
    private readonly apiKey: string | undefined,
  ) {}

  async *complete(req: CompletionRequest, signal: AbortSignal): AsyncIterable<string> {
    const userContent = [
      req.filePath ? `// File: ${req.filePath}` : null,
      '```' + req.language,
      `${req.prefix}<CURSOR/>${req.suffix}`,
      '```',
    ]
      .filter((x): x is string => x !== null)
      .join('\n');

    const stopSequences = req.stopSequences?.filter((s) => s.trim().length > 0);

    const body: AnthropicMessageBody = {
      model: this.config.model,
      max_tokens: this.config.maxTokens ?? 256,
      temperature: this.config.temperature ?? 0.2,
      stream: true,
      system: this.config.promptCaching
        ? [
            {
              type: 'text',
              text: COMPLETION_SYSTEM_PROMPT,
              cache_control: { type: 'ephemeral' },
            },
          ]
        : COMPLETION_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userContent }],
      ...(stopSequences && stopSequences.length > 0 ? { stop_sequences: stopSequences } : {}),
    };

    yield* this.stream(body, { purpose: 'complete', promptChars: userContent.length }, signal);
  }

  async *chat(
    messages: ChatMessage[],
    opts: ChatOptions,
    signal: AbortSignal,
  ): AsyncIterable<string> {
    const body = this.buildBody(messages, opts);
    const promptChars = messagesChars(messages);
    for await (const evt of this.streamEvents(body, { purpose: 'chat', promptChars }, signal)) {
      if (evt.type === 'text') yield evt.text;
    }
  }

  async *chatWithTools(
    messages: ChatMessage[],
    tools: ToolDef[],
    opts: ChatOptions,
    signal: AbortSignal,
  ): AsyncIterable<ChatStreamEvent> {
    const body = this.buildBody(messages, opts);
    body.tools = tools;
    const promptChars = messagesChars(messages);
    yield* this.streamEvents(
      body,
      { purpose: 'chat+tools', promptChars, toolCount: tools.length },
      signal,
    );
  }

  private buildBody(messages: ChatMessage[], opts: ChatOptions): AnthropicMessageBody {
    const systemParts: string[] = [];
    const conversation: ChatMessage[] = [];
    for (const m of messages) {
      if (m.role === 'system') {
        systemParts.push(typeof m.content === 'string' ? m.content : stringifyBlocks(m.content));
      } else {
        conversation.push(m);
      }
    }
    const body: AnthropicMessageBody = {
      model: this.config.model,
      max_tokens: opts.maxTokens ?? this.config.maxTokens ?? 1024,
      temperature: opts.temperature ?? this.config.temperature ?? 0.4,
      stream: true,
      messages: conversation.map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      })),
    };
    if (systemParts.length > 0) body.system = systemParts.join('\n\n');
    return body;
  }

  private async *stream(
    body: AnthropicMessageBody,
    meta: { purpose: string; promptChars: number },
    signal?: AbortSignal,
  ): AsyncIterable<string> {
    for await (const evt of this.streamEvents(body, meta, signal)) {
      if (evt.type === 'text') yield evt.text;
    }
  }

  private async *streamEvents(
    body: AnthropicMessageBody,
    meta: { purpose: string; promptChars: number; toolCount?: number },
    signal?: AbortSignal,
  ): AsyncIterable<ChatStreamEvent> {
    const url = `${this.config.baseURL.replace(/\/$/, '')}/v1/messages`;

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
      ...this.config.headers,
    };
    applyAuthHeaders(headers, this.apiKey, this.config, 'x-api-key');

    const t0 = Date.now();
    log.info(`POST ${url}`, {
      purpose: meta.purpose,
      model: this.config.model,
      promptChars: meta.promptChars,
      hasApiKey: !!this.apiKey,
      promptCaching: !!this.config.promptCaching,
      toolCount: meta.toolCount,
    });

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      log.error(`Anthropic ${res.status}`, text.slice(0, 500));
      throw new Error(`Anthropic API ${res.status}: ${text.slice(0, 300)}`);
    }
    if (!res.body) {
      log.error('Anthropic empty body', new Error('no body'));
      throw new Error('Anthropic API returned no response body');
    }

    let firstChunkMs = -1;
    let chunkCount = 0;
    let totalChars = 0;
    let toolUses = 0;

    let startInputTokens = 0;
    let startCacheCreation = 0;
    let startCacheRead = 0;
    let startOutputTokens = 0;

    // Track current content block (text or tool_use) by index.
    type BlockState =
      | { kind: 'text' }
      | { kind: 'tool_use'; id: string; name: string; partialJson: string };
    const blocks = new Map<number, BlockState>();

    for await (const evt of parseSSE(res.body)) {
      if (evt.event === 'message_start') {
        const payload = safeJson(evt.data);
        const u = payload?.message?.usage;
        if (u) {
          startInputTokens = u.input_tokens ?? 0;
          startCacheCreation = u.cache_creation_input_tokens ?? 0;
          startCacheRead = u.cache_read_input_tokens ?? 0;
          startOutputTokens = u.output_tokens ?? 0;
        }
      } else if (evt.event === 'message_delta') {
        const payload = safeJson(evt.data);
        const u = payload?.usage;
        if (u) {
          yield {
            type: 'usage',
            usage: {
              inputTokens: startInputTokens,
              outputTokens: u.output_tokens ?? startOutputTokens,
              cacheCreationInputTokens: startCacheCreation || undefined,
              cacheReadInputTokens: startCacheRead || undefined,
            },
          };
        }
      } else if (evt.event === 'content_block_start') {
        const payload = safeJson(evt.data);
        const idx = payload?.index ?? 0;
        const cb = payload?.content_block;
        if (cb?.type === 'tool_use') {
          blocks.set(idx, { kind: 'tool_use', id: cb.id, name: cb.name, partialJson: '' });
        } else {
          blocks.set(idx, { kind: 'text' });
        }
      } else if (evt.event === 'content_block_delta') {
        const payload = safeJson(evt.data);
        const idx = payload?.index ?? 0;
        const block = blocks.get(idx);
        const delta = payload?.delta;
        if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
          if (firstChunkMs < 0) firstChunkMs = Date.now() - t0;
          chunkCount++;
          totalChars += delta.text.length;
          yield { type: 'text', text: delta.text };
        } else if (delta?.type === 'input_json_delta' && block?.kind === 'tool_use') {
          block.partialJson += String(delta.partial_json ?? '');
        }
      } else if (evt.event === 'content_block_stop') {
        const payload = safeJson(evt.data);
        const idx = payload?.index ?? 0;
        const block = blocks.get(idx);
        if (block?.kind === 'tool_use') {
          let input: unknown = {};
          if (block.partialJson) {
            try {
              input = JSON.parse(block.partialJson);
            } catch (err) {
              log.warn('failed to parse tool_use input', { json: block.partialJson });
            }
          }
          toolUses++;
          yield { type: 'tool_use', id: block.id, name: block.name, input };
        }
        blocks.delete(idx);
      } else if (evt.event === 'message_stop') {
        log.info('done', {
          purpose: meta.purpose,
          ms: Date.now() - t0,
          firstChunkMs,
          textChunks: chunkCount,
          chars: totalChars,
          toolUses,
        });
        return;
      } else if (evt.event === 'error') {
        log.error('stream event=error', evt.data);
        throw new Error(`Anthropic stream error: ${evt.data}`);
      }
    }

    log.info('stream closed (no message_stop)', {
      purpose: meta.purpose,
      ms: Date.now() - t0,
      chunks: chunkCount,
      chars: totalChars,
      toolUses,
    });
  }
}

function safeJson(s: string): any {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function stringifyBlocks(blocks: ChatContentBlock[]): string {
  return blocks
    .map((b) => {
      if (b.type === 'text') return b.text;
      if (b.type === 'tool_use') return `[tool_use ${b.name}]`;
      if (b.type === 'tool_result') return `[tool_result] ${b.content}`;
      if (b.type === 'image') return `[image ${b.source.media_type}]`;
      return '';
    })
    .join('\n');
}

function messagesChars(messages: ChatMessage[]): number {
  let total = 0;
  for (const m of messages) {
    if (typeof m.content === 'string') total += m.content.length;
    else
      for (const b of m.content) {
        if (b.type === 'text') total += b.text.length;
        else if (b.type === 'tool_result') total += b.content.length;
        else if (b.type === 'tool_use') total += JSON.stringify(b.input ?? {}).length;
        // Images counted separately via image tokens; estimate ~1500 tok = 6000 chars
        else if (b.type === 'image') total += 6000;
      }
  }
  return total;
}
