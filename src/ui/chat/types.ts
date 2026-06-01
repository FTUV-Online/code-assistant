import type {
  ChatContentBlock,
  ChatMessage,
  ImageMediaType,
} from '../../providers/base';

export type SessionKind = 'explain' | 'review' | 'rewrite' | 'chat';
export type CodeAnalysisKind = 'explain' | 'review' | 'rewrite';

export type HistoryEntry = {
  id: string;
  title: string;
  kind: SessionKind;
  fileLabel: string;
  filePath: string;
  source: string;
  systemPrompt: string;
  messages: ChatMessage[];
  attachments: string[];
  selectedProviderId: string;
  createdAt: number;
  updatedAt: number;
  compactSummary?: string;
  compactAt?: number;
};

export type HistorySummary = {
  id: string;
  title: string;
  kind: SessionKind;
  fileLabel: string;
  messageCount: number;
  updatedAt: number;
};

export type ChatContextInfo = {
  turns: number;
  inputChars: number;
  outputChars: number;
  inputTokens: number;
  outputTokens: number;
  realInputTokens?: number;
  realOutputTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  estimatedCostUsd?: number;
  lastTurnInputTokens?: number;
  lastTurnOutputTokens?: number;
  lastTurnInputChars?: number;
  lastTurnOutputChars?: number;
  lastTurnCostUsd?: number;
  imageCount: number;
  source: string;
  sourceTruncated: boolean;
  attachments: string[];
  selectedProviderId: string;
  providerContextLimitTokens?: number;
  providerContextUsedTokens: number;
  providerContextRemainingTokens?: number;
  providerContextUsagePercent?: number;
  providerContextNearLimit: boolean;
  providerContextIsEstimated: boolean;
  providerContextIsCompacting: boolean;
  providerContextLastCompactionAt?: number;
  providerContextCompactThresholdPercent?: number;
  providerContextShouldCompactSoon: boolean;
  providerContextSummaryPresent: boolean;
  availableProviders: Array<{
    id: string;
    displayName?: string;
    model: string;
    protocol: string;
  }>;
};

export type ImagePayload = {
  dataUrl: string;
  mediaType: string;
  label: string;
  sizeBytes: number;
};

export type ChatOutbound =
  | { type: 'init'; sessionId: string; title: string; kind: SessionKind; file: string }
  | {
      type: 'message';
      sessionId: string;
      role: 'user';
      text: string;
      images?: ImagePayload[];
    }
  | { type: 'startAssistant'; sessionId: string }
  | { type: 'streamChunk'; sessionId: string; text: string }
  | { type: 'doneAssistant'; sessionId: string }
  | { type: 'error'; sessionId: string; message: string }
  | { type: 'attached'; sessionId: string; label: string }
  | { type: 'context'; sessionId: string; info: ChatContextInfo }
  | { type: 'toolUse'; sessionId: string; callId: string; name: string; input: unknown }
  | { type: 'toolResult'; sessionId: string; callId: string; content: string; ok: boolean }
  | {
      type: 'approvalRequest';
      sessionId: string;
      approvalId: string;
      callId?: string;
      toolName: string;
      summary: string;
      detail?: string;
    }
  | { type: 'approvalCleared'; sessionId: string; approvalId: string }
  | { type: 'pendingImage'; sessionId: string; image: ImagePayload }
  | { type: 'titleUpdate'; sessionId: string; title: string }
  | { type: 'rewindMessage'; sessionId: string }
  | { type: 'resetMessages'; sessionId: string }
  | { type: 'editUserMessage'; sessionId: string; index: number; text: string };

export type { ChatContentBlock, ChatMessage, ImageMediaType };
