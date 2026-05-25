export type ProviderProtocol = 'anthropic' | 'openai' | 'gemini' | 'ollama';

export type CompletionRequest = {
  prefix: string;
  suffix: string;
  language: string;
  filePath?: string;
  maxTokens?: number;
  stopSequences?: string[];
  temperature?: number;
};

export type TextBlock = { type: 'text'; text: string };
export type ToolUseBlock = { type: 'tool_use'; id: string; name: string; input: unknown };
export type ToolResultBlock = {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
};
export type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
export type ImageBlock = {
  type: 'image';
  source: {
    type: 'base64';
    media_type: ImageMediaType;
    data: string; // raw base64, no "data:..." prefix
  };
};
export type ChatContentBlock = TextBlock | ToolUseBlock | ToolResultBlock | ImageBlock;

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string | ChatContentBlock[];
};

export type ChatOptions = {
  maxTokens?: number;
  temperature?: number;
};

export type ToolDef = {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
};

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
};

export type ChatStreamEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'usage'; usage: TokenUsage };

export interface LLMProvider {
  readonly id: string;
  readonly protocol: ProviderProtocol;
  complete(req: CompletionRequest, signal: AbortSignal): AsyncIterable<string>;
  chat(messages: ChatMessage[], opts: ChatOptions, signal: AbortSignal): AsyncIterable<string>;
  chatWithTools?(
    messages: ChatMessage[],
    tools: ToolDef[],
    opts: ChatOptions,
    signal: AbortSignal,
  ): AsyncIterable<ChatStreamEvent>;
}

export type AuthScheme = 'x-api-key' | 'bearer' | 'custom-header';

export type ProviderConfig = {
  id: string;
  displayName?: string;
  protocol: ProviderProtocol;
  baseURL: string;
  model: string;
  headers?: Record<string, string>;
  authScheme?: AuthScheme;
  authHeaderName?: string;
  authValuePrefix?: string;
  maxTokens?: number;
  temperature?: number;
  supportsFIM?: boolean;
  promptCaching?: boolean;
};

/**
 * Inject the API key into request headers using the provider's configured
 * auth scheme. Skips if a matching header is already set explicitly (e.g.
 * via custom headers), so the user can always override.
 */
export function applyAuthHeaders(
  headers: Record<string, string>,
  apiKey: string | undefined,
  config: ProviderConfig,
  defaultScheme: AuthScheme,
): void {
  if (!apiKey) return;
  const scheme = config.authScheme ?? defaultScheme;
  const lowerKeys = new Set(Object.keys(headers).map((k) => k.toLowerCase()));

  if (scheme === 'x-api-key') {
    if (!lowerKeys.has('x-api-key') && !lowerKeys.has('authorization')) {
      headers['x-api-key'] = apiKey;
    }
    return;
  }
  if (scheme === 'bearer') {
    if (!lowerKeys.has('authorization') && !lowerKeys.has('api-key')) {
      headers['authorization'] = `Bearer ${apiKey}`;
    }
    return;
  }
  if (scheme === 'custom-header') {
    const name = (config.authHeaderName || '').trim();
    if (!name) return;
    if (!lowerKeys.has(name.toLowerCase())) {
      const prefix = config.authValuePrefix ?? '';
      headers[name] = prefix ? `${prefix}${apiKey}` : apiKey;
    }
  }
}
