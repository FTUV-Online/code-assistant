import type {
  ChatContentBlock,
  ChatMessage,
  ImageBlock,
  ImageMediaType,
} from '../../providers/base';
import * as log from '../../util/logger';

const IMAGE_MEDIA_TYPES: Record<string, ImageMediaType> = {
  'image/png': 'image/png',
  'image/jpeg': 'image/jpeg',
  'image/jpg': 'image/jpeg',
  'image/gif': 'image/gif',
  'image/webp': 'image/webp',
};

export function dataUrlToImageBlock(dataUrl: string, mediaType: string): ImageBlock | null {
  const normalized = IMAGE_MEDIA_TYPES[mediaType.toLowerCase()] ?? null;
  if (!normalized) {
    log.warn('attach image: unsupported media type', { mediaType });
    return null;
  }
  const commaIdx = dataUrl.indexOf(',');
  const data = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
  return {
    type: 'image',
    source: { type: 'base64', media_type: normalized, data },
  };
}

export function deriveTitleFromMessage(text: string): string {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  return cleaned.length > 50 ? cleaned.slice(0, 50) + '…' : cleaned;
}

export function extractTextContent(content: string | ChatContentBlock[]): string {
  if (typeof content === 'string') return content;
  return content
    .map((b) => (b.type === 'text' ? b.text : ''))
    .filter(Boolean)
    .join('\n');
}

export function stripImagesFromMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((m) => {
    if (typeof m.content === 'string') return { ...m };
    const blocks: ChatContentBlock[] = [];
    for (const b of m.content) {
      if (b.type === 'image') {
        blocks.push({ type: 'text', text: '[image stripped from history]' });
      } else {
        blocks.push(b);
      }
    }
    return { ...m, content: blocks };
  });
}

/**
 * Heuristic for Claude's "narrate-then-stop" failure mode. Uses only
 * language-agnostic signals (punctuation + structure) so it works for any
 * locale the user writes in.
 */
export function looksLikeIntentWithoutAction(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return true;
  if (/[:：…]$/.test(trimmed)) return true;
  if (trimmed.endsWith('...')) return true;
  if (/(?:→|->|=>)\s*$/.test(trimmed)) return true;
  return false;
}

/** Race a promise against an AbortSignal — rejects if the signal fires first. */
export function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new DOMException('Aborted', 'AbortError'));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (v) => { signal.removeEventListener('abort', onAbort); resolve(v); },
      (e) => { signal.removeEventListener('abort', onAbort); reject(e); },
    );
  });
}

export function computeMessageChars(m: ChatMessage): number {
  if (typeof m.content === 'string') return m.content.length;
  let total = 0;
  for (const b of m.content) {
    if (b.type === 'text') total += b.text.length;
    else if (b.type === 'tool_result') total += b.content.length;
    else if (b.type === 'tool_use') total += JSON.stringify(b.input ?? {}).length;
  }
  return total;
}

export function estimateMessageTokens(msg: ChatMessage): number {
  if (typeof msg.content === 'string') {
    return Math.max(1, Math.ceil(msg.content.length / 4));
  }
  let total = 0;
  for (const b of msg.content) {
    if (b.type === 'text') {
      total += Math.ceil(b.text.length / 4);
    } else if (b.type === 'tool_result') {
      total += Math.ceil(b.content.length / 4);
    } else if (b.type === 'tool_use') {
      total += Math.ceil(JSON.stringify(b.input ?? {}).length / 4);
    } else if (b.type === 'image') {
      total += 1500;
    }
  }
  return Math.max(1, total);
}

export function estimateMessagesTokens(messages: ChatMessage[]): number {
  return messages.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0);
}

export function computeSafeCutPoints(messages: ChatMessage[]): number[] {
  const points = new Set<number>();
  for (let i = 1; i < messages.length; i++) {
    const prev = messages[i - 1];
    const curr = messages[i];
    if (prev.role === 'user' && curr.role === 'assistant') points.add(i - 1);
    if (prev.role === 'assistant' && curr.role === 'user') points.add(i);
  }
  points.add(0);
  points.delete(messages.length);
  return [...points]
    .filter((n) => n >= 0 && n < messages.length)
    .sort((a, b) => a - b);
}

export function buildCompactionSummary(droppedMessages: ChatMessage[]): string {
  const parts: string[] = [];
  for (const msg of droppedMessages) {
    const text = extractTextContent(msg.content).trim();
    if (!text) continue;
    const label = msg.role === 'assistant' ? 'Assistant' : 'User';
    parts.push(`${label}: ${text.slice(0, 400)}`);
  }
  return parts.join('\n\n');
}
