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

type OpenAITextPart = { type: 'text'; text: string };
type OpenAIImagePart = { type: 'image_url'; image_url: { url: string } };
type OpenAIContent = string | Array<OpenAITextPart | OpenAIImagePart>;

type OpenAIToolCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};

type OpenAIMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: OpenAIContent }
  | {
      role: 'assistant';
      content: string | null;
      tool_calls?: OpenAIToolCall[];
    }
  | { role: 'tool'; tool_call_id: string; content: string };

type OpenAIBody = {
  model: string;
  messages: OpenAIMessage[];
  max_tokens?: number;
  temperature?: number;
  stream: true;
  stream_options?: { include_usage?: boolean };
  tools?: Array<{
    type: 'function';
    function: { name: string; description: string; parameters: unknown };
  }>;
  stop?: string[];
};

export class OpenAIProvider implements LLMProvider {
  readonly protocol = 'openai' as const;

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

    const body: OpenAIBody = {
      model: this.config.model,
      messages: [
        { role: 'system', content: COMPLETION_SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
      max_tokens: this.config.maxTokens ?? 256,
      temperature: this.config.temperature ?? 0.2,
      stream: true,
      ...(stopSequences && stopSequences.length > 0 ? { stop: stopSequences } : {}),
    };

    for await (const evt of this.streamEvents(
      body,
      { purpose: 'complete', promptChars: userContent.length },
      signal,
    )) {
      if (evt.type === 'text') yield evt.text;
    }
  }

  async *chat(
    messages: ChatMessage[],
    opts: ChatOptions,
    signal: AbortSignal,
  ): AsyncIterable<string> {
    const body = this.buildBody(messages, opts);
    for await (const evt of this.streamEvents(
      body,
      { purpose: 'chat', promptChars: charCount(messages) },
      signal,
    )) {
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
    body.tools = tools.map(convertToolDef);
    yield* this.streamEvents(
      body,
      {
        purpose: 'chat+tools',
        promptChars: charCount(messages),
        toolCount: tools.length,
      },
      signal,
    );
  }

  private buildBody(messages: ChatMessage[], opts: ChatOptions): OpenAIBody {
    return {
      model: this.config.model,
      messages: convertMessages(messages),
      max_tokens: opts.maxTokens ?? this.config.maxTokens ?? 1024,
      temperature: opts.temperature ?? this.config.temperature ?? 0.4,
      stream: true,
      stream_options: { include_usage: true },
    };
  }

  private async *streamEvents(
    body: OpenAIBody,
    meta: { purpose: string; promptChars: number; toolCount?: number },
    signal?: AbortSignal,
  ): AsyncIterable<ChatStreamEvent> {
    const baseURL = this.config.baseURL.replace(/\/$/, '');
    const url = baseURL.endsWith('/v1')
      ? `${baseURL}/chat/completions`
      : `${baseURL}/v1/chat/completions`;

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      ...this.config.headers,
    };
    applyAuthHeaders(headers, this.apiKey, this.config, 'bearer');

    const t0 = Date.now();
    log.info(`POST ${url}`, {
      purpose: meta.purpose,
      model: this.config.model,
      promptChars: meta.promptChars,
      hasApiKey: !!this.apiKey,
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
      log.error(`OpenAI ${res.status}`, text.slice(0, 500));
      throw new Error(`OpenAI API ${res.status}: ${text.slice(0, 300)}`);
    }
    if (!res.body) {
      log.error('OpenAI empty body', new Error('no body'));
      throw new Error('OpenAI API returned no response body');
    }

    type ToolCallState = { id: string; name: string; argsJson: string };
    const toolCalls = new Map<number, ToolCallState>();
    let toolCallsEmitted = false;
    let firstChunkMs = -1;
    let textChars = 0;

    function* emitPendingToolCalls(): IterableIterator<ChatStreamEvent> {
      if (toolCallsEmitted) return;
      toolCallsEmitted = true;
      const sorted = [...toolCalls.entries()].sort((a, b) => a[0] - b[0]);
      for (const [, tc] of sorted) {
        let input: unknown = {};
        if (tc.argsJson) {
          try {
            input = JSON.parse(tc.argsJson);
          } catch {
            log.warn('OpenAI tool_call: failed to parse args JSON', { argsJson: tc.argsJson });
          }
        }
        yield { type: 'tool_use', id: tc.id, name: tc.name, input };
      }
    }

    for await (const evt of parseSSE(res.body)) {
      if (evt.event !== 'message') continue;
      const data = evt.data;
      if (data === '[DONE]') {
        for (const out of emitPendingToolCalls()) yield out;
        log.info('done', {
          purpose: meta.purpose,
          ms: Date.now() - t0,
          firstChunkMs,
          textChars,
          toolUses: toolCalls.size,
        });
        return;
      }
      let payload: any;
      try {
        payload = JSON.parse(data);
      } catch {
        continue;
      }
      // Some providers send error payloads inline
      if (payload.error) {
        throw new Error(`OpenAI error: ${JSON.stringify(payload.error)}`);
      }

      // Usage (only emitted on the last chunk when stream_options.include_usage is true,
      // or as a separate object on some providers).
      if (payload.usage && typeof payload.usage === 'object') {
        yield {
          type: 'usage',
          usage: {
            inputTokens: payload.usage.prompt_tokens ?? 0,
            outputTokens: payload.usage.completion_tokens ?? 0,
            cacheReadInputTokens:
              payload.usage.prompt_tokens_details?.cached_tokens || undefined,
          },
        };
      }

      const choice = payload?.choices?.[0];
      if (!choice) continue;

      const delta = choice.delta;
      if (delta?.content && typeof delta.content === 'string') {
        if (firstChunkMs < 0) firstChunkMs = Date.now() - t0;
        textChars += delta.content.length;
        yield { type: 'text', text: delta.content };
      }
      if (Array.isArray(delta?.tool_calls)) {
        for (const tcd of delta.tool_calls) {
          const idx = typeof tcd.index === 'number' ? tcd.index : 0;
          let tc = toolCalls.get(idx);
          if (!tc) {
            tc = { id: tcd.id ?? `call_${idx}`, name: '', argsJson: '' };
            toolCalls.set(idx, tc);
          }
          if (tcd.id) tc.id = tcd.id;
          if (tcd.function?.name) tc.name = tcd.function.name;
          if (typeof tcd.function?.arguments === 'string') {
            tc.argsJson += tcd.function.arguments;
          }
        }
      }
      if (choice.finish_reason === 'tool_calls') {
        for (const out of emitPendingToolCalls()) yield out;
      }
    }

    // Stream ended without explicit [DONE]
    for (const out of emitPendingToolCalls()) yield out;
    log.info('stream closed (no [DONE])', {
      purpose: meta.purpose,
      ms: Date.now() - t0,
      textChars,
    });
  }
}

// ---- Pure helpers (exported for unit tests) ----

export function convertMessages(messages: ChatMessage[]): OpenAIMessage[] {
  const out: OpenAIMessage[] = [];
  for (const m of messages) {
    if (m.role === 'system') {
      const text = typeof m.content === 'string' ? m.content : extractTextBlocks(m.content);
      if (text) out.push({ role: 'system', content: text });
      continue;
    }
    if (typeof m.content === 'string') {
      if (m.role === 'user') out.push({ role: 'user', content: m.content });
      else out.push({ role: 'assistant', content: m.content });
      continue;
    }
    const textParts: string[] = [];
    const imageParts: OpenAIImagePart[] = [];
    const toolUses: { id: string; name: string; input: unknown }[] = [];
    const toolResults: { tool_use_id: string; content: string }[] = [];
    for (const b of m.content) {
      if (b.type === 'text') textParts.push(b.text);
      else if (b.type === 'image') {
        imageParts.push({
          type: 'image_url',
          image_url: {
            url: `data:${b.source.media_type};base64,${b.source.data}`,
          },
        });
      } else if (b.type === 'tool_use') {
        toolUses.push({ id: b.id, name: b.name, input: b.input });
      } else if (b.type === 'tool_result') {
        toolResults.push({ tool_use_id: b.tool_use_id, content: b.content });
      }
    }

    if (m.role === 'user' && toolResults.length > 0) {
      for (const tr of toolResults) {
        out.push({ role: 'tool', tool_call_id: tr.tool_use_id, content: tr.content });
      }
      if (textParts.length > 0 || imageParts.length > 0) {
        out.push({ role: 'user', content: buildUserContent(textParts, imageParts) });
      }
    } else if (m.role === 'assistant' && toolUses.length > 0) {
      out.push({
        role: 'assistant',
        content: textParts.length > 0 ? textParts.join('\n') : null,
        tool_calls: toolUses.map((t) => ({
          id: t.id,
          type: 'function' as const,
          function: { name: t.name, arguments: JSON.stringify(t.input ?? {}) },
        })),
      });
    } else if (m.role === 'user') {
      out.push({ role: 'user', content: buildUserContent(textParts, imageParts) });
    } else {
      out.push({ role: 'assistant', content: textParts.join('\n') });
    }
  }
  return out;
}

function buildUserContent(textParts: string[], imageParts: OpenAIImagePart[]): OpenAIContent {
  if (imageParts.length === 0) return textParts.join('\n');
  const parts: Array<OpenAITextPart | OpenAIImagePart> = [];
  for (const t of textParts) parts.push({ type: 'text', text: t });
  for (const img of imageParts) parts.push(img);
  return parts;
}

function extractTextBlocks(blocks: ChatContentBlock[]): string {
  return blocks
    .map((b) => (b.type === 'text' ? b.text : ''))
    .filter(Boolean)
    .join('\n');
}

export function convertToolDef(td: ToolDef): {
  type: 'function';
  function: { name: string; description: string; parameters: unknown };
} {
  return {
    type: 'function',
    function: {
      name: td.name,
      description: td.description,
      parameters: td.input_schema,
    },
  };
}

function charCount(messages: ChatMessage[]): number {
  let total = 0;
  for (const m of messages) {
    if (typeof m.content === 'string') total += m.content.length;
    else
      for (const b of m.content) {
        if (b.type === 'text') total += b.text.length;
        else if (b.type === 'tool_result') total += b.content.length;
        else if (b.type === 'tool_use') total += JSON.stringify(b.input ?? {}).length;
        else if (b.type === 'image') total += 6000;
      }
  }
  return total;
}
