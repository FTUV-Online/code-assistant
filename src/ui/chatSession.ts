import * as vscode from 'vscode';
import {
  getActiveProviderId,
  getEditFileAutoRetry,
  getFeatureProviderId,
  getIncludeFullFile,
  getOutputLanguage,
  getProviderConfigs,
  getToolUseBlacklist,
  getToolUseEnabled,
  getToolUseMaxIterations,
  type FeatureName,
} from '../config/settings';
import type {
  ChatContentBlock,
  ChatMessage,
  ImageBlock,
  ImageMediaType,
  LLMProvider,
  ProviderConfig,
  ToolResultBlock,
  ToolUseBlock,
} from '../providers/base';
import { getProviderById } from '../providers/manager';
import { estimateCostUsd } from '../providers/pricing';
import { buildMemoryPromptSection } from '../memory/manager';
import { isBinary, matchesAnyGlob, resolveSafePath } from '../tools/common';
import { isRetryableEditMatchError } from '../tools/editLogic';
import {
  executeTool,
  getAllToolDefs,
  getSkillManager,
  getSubAgentToolDefs,
  getWorkspaceRoot,
} from '../tools/registry';
import type { ToolExecutionContext } from '../tools/types';
import * as log from '../util/logger';

export type SessionKind = 'explain' | 'review' | 'rewrite' | 'chat';
export type CodeAnalysisKind = 'explain' | 'review' | 'rewrite';

const MAX_RETRY_FILE_CHARS = 20_000;

async function isReadableFile(absPath: string): Promise<boolean> {
  try {
    const stat = await vscode.workspace.fs.stat(vscode.Uri.file(absPath));
    return (stat.type & vscode.FileType.File) !== 0;
  } catch {
    return false;
  }
}

async function readFreshRetryFile(relPath: string, workspaceRoot: string): Promise<string | null> {
  const abs = resolveSafePath(workspaceRoot, relPath);
  if (!abs) return null;

  try {
    const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(abs));
    if (isBinary(bytes)) return null;
    const text = new TextDecoder().decode(bytes);
    return text.length > MAX_RETRY_FILE_CHARS
      ? text.slice(0, MAX_RETRY_FILE_CHARS) + '\n... [truncated]'
      : text;
  } catch {
    return null;
  }
}

function buildEditRetryMessage(relPath: string, content: string): string {
  return (
    `The edit_file call failed because its find strings did not match the current file content. ` +
    `Retry exactly once using the latest contents of \`${relPath}\` below. ` +
    `Use new find strings that match this file exactly, and do not repeat the previous failing edit unchanged.\n\n` +
    `\`\`\`\n${content}\n\`\`\``
  );
}

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
};

export type HistorySummary = {
  id: string;
  title: string;
  kind: SessionKind;
  fileLabel: string;
  messageCount: number;
  updatedAt: number;
};

const DIFF_EXPLAIN_PROMPT =
  'You explain a git diff to a developer reviewing their own change. ' +
  'Be concise and structured:\n' +
  '1) "What changed" — 1-3 bullet points summarising the modifications.\n' +
  '2) "Why it likely matters" — short reasoning about intent, risk, or follow-ups.\n' +
  'Use markdown. Do not restate the entire diff; focus on the meaningful parts.\n' +
  'You will continue chatting with the developer afterwards; remember the diff for follow-up questions.';

const DIFF_REVIEW_PROMPT =
  'You are a senior engineer doing a careful code review on a git diff. ' +
  'Identify only real issues. Group findings under headings:\n' +
  '- **Blockers** — bugs, security holes, data corruption risks.\n' +
  '- **Suggestions** — design or correctness improvements.\n' +
  '- **Nits** — naming, style, small readability.\n' +
  'Quote the specific lines (using backticks) when calling something out. ' +
  'If there is nothing concerning, write exactly: "LGTM — no concerns." and stop.\n' +
  'You will continue chatting with the developer afterwards; remember the diff for follow-up questions.';

const CODE_EXPLAIN_PROMPT =
  'You explain a code snippet to a developer. Be concise and structured:\n' +
  '- "What it does" — 2-4 sentences summary.\n' +
  '- "How it works" — bullet points on the key logic, control flow, side effects, error handling.\n' +
  '- "Notes" — any unusual patterns, gotchas, or potential issues worth highlighting.\n' +
  'Use markdown. Reference identifiers with backticks. Avoid restating the code verbatim.\n' +
  'You will continue chatting; remember the snippet for follow-up questions.';

const CODE_REVIEW_PROMPT =
  'You are a senior engineer reviewing a code snippet. Identify only real issues. ' +
  'Group findings under:\n' +
  '- **Blockers** — bugs, security holes, data corruption risks.\n' +
  '- **Suggestions** — design or correctness improvements.\n' +
  '- **Nits** — naming, style, small readability.\n' +
  'Quote specific lines (using backticks) when calling something out. ' +
  'If there is nothing concerning, write exactly: "LGTM — no concerns." and stop.\n' +
  'You will continue chatting; remember the snippet for follow-up questions.';

const CHAT_SYSTEM_PROMPT =
  'You are a coding assistant inside a VS Code extension. The user can ask any coding ' +
  'or workspace-related question. They may attach files (via the + button) or images. ' +
  'You have workspace tools available (read_file, grep, list_dir, find_files, git_log, ' +
  'get_open_tabs, get_selection, find_symbol, goto_definition, find_references, delegate_research) ' +
  'and memory tools (read_memory, write_memory, list_memory) for persistent notes across sessions. ' +
  'Prefer find_symbol over grep when looking up a definition by name, and goto_definition / ' +
  'find_references for semantic navigation (they use VS Code language servers). ' +
  'Use these tools whenever the user references workspace state ("this file", "where is X used", etc.). ' +
  'When you learn something durable (user preferences, project conventions, corrections), save it ' +
  'via write_memory so it survives this session. Format responses with markdown. Be concise and direct.\n\n' +
  'CRITICAL: never end your turn after announcing an action without performing it. If your text ' +
  'ends with a colon, ellipsis, arrow ("→"), or any phrase that promises a next step, you MUST ' +
  'call the corresponding tool in the same turn. Either complete the work in this turn or finish ' +
  'with a self-contained final answer — never with an unfinished promise.';

const CODE_REWRITE_PROMPT =
  'You are an expert engineer rewriting a code snippet to optimize it while ' +
  'preserving correctness. Rules:\n' +
  '- Keep public behavior IDENTICAL (same inputs → same outputs and side effects).\n' +
  '- Improve clarity, performance, idiomaticity for the snippet language.\n' +
  '- Do NOT change function signatures unless required by the language idiom.\n' +
  '- Do NOT introduce dependencies that are not already in the snippet.\n' +
  'Output exactly in this structure:\n' +
  '## Changes\n' +
  '<short bullet list of what changed and why>\n\n' +
  '## Rewritten code\n' +
  '<one fenced code block containing the COMPLETE final code — not a diff>\n\n' +
  'You will continue chatting; the user may ask follow-up questions about your rewrite.';

const MAX_DIFF_CHARS = 30000;
const MAX_CODE_CHARS = 30000;
const MAX_ATTACHMENT_CHARS = 100_000;

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
  lastTurnCostUsd?: number;
  imageCount: number;
  source: string;
  sourceTruncated: boolean;
  attachments: string[];
  selectedProviderId: string;
  availableProviders: Array<{
    id: string;
    displayName?: string;
    model: string;
    protocol: string;
  }>;
};

export type ImagePayload = {
  dataUrl: string; // "data:image/png;base64,..."
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

export class ChatSession {
  readonly id: string;
  readonly kind: SessionKind;
  readonly fileLabel: string;
  readonly filePath: string;
  readonly createdAt: number = Date.now();
  private title: string;
  private systemPrompt = '';
  private messages: ChatMessage[] = [];
  private source = '';
  private sourceTruncated = false;
  private attachments: string[] = [];
  private selectedProviderId = '';
  private currentAbort: AbortController | null = null;
  private pendingApprovals = new Map<
    string,
    {
      resolve: (decision: 'approve' | 'approveAll' | 'deny') => void;
      abortCleanup?: () => void;
    }
  >();
  private approvalCounter = 0;
  private cumulativeUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    estimatedCostUsd: 0,
  };
  private lastTurnUsage: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens?: number;
    cacheReadInputTokens?: number;
    estimatedCostUsd: number;
  } | null = null;

  constructor(
    id: string,
    kind: SessionKind,
    fileLabel: string,
    filePath: string,
    private readonly context: vscode.ExtensionContext,
    private readonly postFn: (msg: ChatOutbound) => void,
    private readonly onTitleChange?: () => void,
  ) {
    this.id = id;
    this.kind = kind;
    this.fileLabel = fileLabel;
    this.filePath = filePath;
    if (kind === 'chat') {
      this.title = 'New Chat';
    } else {
      this.title =
        (kind === 'explain' ? 'Explain' : kind === 'review' ? 'Review' : 'Rewrite') +
        ': ' +
        fileLabel;
    }
    // 'chat' kind has no feature-specific provider; fall back to active.
    this.selectedProviderId =
      (kind !== 'chat' ? getFeatureProviderId(kind as FeatureName) : '') ||
      getActiveProviderId();
  }

  getTitle(): string {
    return this.title;
  }

  async startDiffAnalysis(diff: string): Promise<void> {
    this.cancelStream();

    this.sourceTruncated = diff.length > MAX_DIFF_CHARS;
    const diffText = this.sourceTruncated
      ? diff.slice(0, MAX_DIFF_CHARS) + '\n... [truncated]'
      : diff;

    this.systemPrompt =
      (this.kind === 'explain' ? DIFF_EXPLAIN_PROMPT : DIFF_REVIEW_PROMPT) +
      langInstruction() +
      skillsInstruction();

    this.attachments = [];
    this.source = 'diff';
    this.messages = [
      {
        role: 'user',
        content: `File: ${this.fileLabel}\n\nHere is the diff to ${this.kind}:\n\n\`\`\`diff\n${diffText}\n\`\`\``,
      },
    ];

    this.post({
      type: 'init',
      sessionId: this.id,
      title: this.title,
      kind: this.kind,
      file: this.fileLabel,
    });
    this.postContext();

    if (getIncludeFullFile()) {
      await this.attachFile({ auto: true });
    }
    await this.streamReply();
  }

  async startCodeAnalysis(
    code: string,
    languageId: string,
    rangeLabel: string,
  ): Promise<void> {
    this.cancelStream();

    this.sourceTruncated = code.length > MAX_CODE_CHARS;
    const codeText = this.sourceTruncated
      ? code.slice(0, MAX_CODE_CHARS) + '\n... [truncated]'
      : code;

    const promptByKind: Record<CodeAnalysisKind, string> = {
      explain: CODE_EXPLAIN_PROMPT,
      review: CODE_REVIEW_PROMPT,
      rewrite: CODE_REWRITE_PROMPT,
    };
    const codeKind = this.kind as CodeAnalysisKind;
    this.systemPrompt =
      (promptByKind[codeKind] ?? CHAT_SYSTEM_PROMPT) + langInstruction() + skillsInstruction();

    this.attachments = [];
    this.source = `selection (${rangeLabel})`;

    const verb =
      this.kind === 'explain' ? 'explain' : this.kind === 'review' ? 'review' : 'rewrite';
    this.messages = [
      {
        role: 'user',
        content: `File: ${this.fileLabel} — ${rangeLabel}\n\nPlease ${verb} the following ${languageId} code:\n\n\`\`\`${languageId}\n${codeText}\n\`\`\``,
      },
    ];

    this.title =
      (this.kind === 'explain' ? 'Explain' : this.kind === 'review' ? 'Review' : 'Rewrite') +
      ': ' +
      this.fileLabel;

    this.post({
      type: 'init',
      sessionId: this.id,
      title: this.title,
      kind: this.kind,
      file: `${this.fileLabel} — ${rangeLabel}`,
    });
    this.postContext();

    if (getIncludeFullFile()) {
      await this.attachFile({ auto: true });
    }
    await this.streamReply();
  }

  startChat(): void {
    this.cancelStream();
    this.systemPrompt = CHAT_SYSTEM_PROMPT + langInstruction() + skillsInstruction();
    this.source = '';
    this.sourceTruncated = false;
    this.attachments = [];
    this.messages = [];
    this.title = 'New Chat';
    this.post({
      type: 'init',
      sessionId: this.id,
      title: this.title,
      kind: this.kind,
      file: '',
    });
    this.postContext();
  }

  loadFromHistory(entry: HistoryEntry): void {
    this.cancelStream();
    this.title = entry.title;
    this.systemPrompt = entry.systemPrompt;
    this.source = entry.source;
    this.sourceTruncated = false;
    this.attachments = [...entry.attachments];
    this.messages = entry.messages.map((m) => ({ ...m }));
    if (entry.selectedProviderId) this.selectedProviderId = entry.selectedProviderId;

    this.post({
      type: 'init',
      sessionId: this.id,
      title: this.title,
      kind: this.kind,
      file: entry.fileLabel || '',
    });
    // Replay messages into the webview
    for (const m of this.messages) {
      if (m.role === 'user') {
        const text = extractTextContent(m.content);
        this.post({ type: 'message', sessionId: this.id, role: 'user', text });
      } else if (m.role === 'assistant') {
        const text = extractTextContent(m.content);
        if (text) {
          this.post({ type: 'startAssistant', sessionId: this.id });
          this.post({ type: 'streamChunk', sessionId: this.id, text });
          this.post({ type: 'doneAssistant', sessionId: this.id });
        }
      }
    }
    this.postContext();
    this.onTitleChange?.();
  }

  toHistoryEntry(): HistoryEntry {
    return {
      id: this.id,
      title: this.title,
      kind: this.kind,
      fileLabel: this.fileLabel,
      filePath: this.filePath,
      source: this.source,
      systemPrompt: this.systemPrompt,
      messages: stripImagesFromMessages(this.messages),
      attachments: [...this.attachments],
      selectedProviderId: this.selectedProviderId,
      createdAt: this.createdAt,
      updatedAt: Date.now(),
    };
  }

  hasContent(): boolean {
    return this.messages.length > 0;
  }

  get sessionKind(): SessionKind {
    return this.kind;
  }

  async handleUserMessage(text: string, attachments: ImagePayload[] = []): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed && attachments.length === 0) return;
    const wasEmpty = this.messages.length === 0;

    if (trimmed) await this.resolveAndAttachMentions(trimmed);

    if (attachments.length === 0) {
      this.messages.push({ role: 'user', content: trimmed });
    } else {
      const blocks: ChatContentBlock[] = [];
      for (const att of attachments) {
        const block = dataUrlToImageBlock(att.dataUrl, att.mediaType);
        if (block) blocks.push(block);
      }
      if (trimmed) blocks.push({ type: 'text', text: trimmed });
      if (blocks.length > 0) {
        this.messages.push({ role: 'user', content: blocks });
      }
    }

    if (wasEmpty && this.kind === 'chat' && trimmed) {
      this.title = deriveTitleFromMessage(trimmed);
      this.post({ type: 'titleUpdate', sessionId: this.id, title: this.title });
      this.onTitleChange?.();
    }

    this.post({
      type: 'message',
      sessionId: this.id,
      role: 'user',
      text: trimmed,
      images: attachments.length > 0 ? attachments : undefined,
    });
    this.postContext();
    await this.streamReply();
  }

  /**
   * Scan a user message for `@path/to/file.ext` mentions and silently attach
   * each one that resolves to an existing workspace file. Lets users write
   * "review @src/foo.ts" without going through the popup or the 📎 picker.
   */
  private async resolveAndAttachMentions(text: string): Promise<void> {
    const root = getWorkspaceRoot();
    if (!root) return;
    const blacklist = getToolUseBlacklist();

    // Match @<path> where path starts after whitespace/start, contains
    // path-safe chars, has a dot (extension required to reduce false positives).
    const re = /(?:^|\s)@([A-Za-z0-9_./\\-]+\.[A-Za-z0-9_-]+)/g;
    const seen = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const raw = m[1];
      if (seen.has(raw)) continue;
      seen.add(raw);

      // Try direct relative resolution first.
      let absPath = resolveSafePath(root, raw);
      let displayPath = raw.replace(/\\/g, '/');

      if (absPath && !(await isReadableFile(absPath))) {
        absPath = null;
      }

      // Fallback: basename lookup if the mention has no slash and direct
      // resolution failed. Only auto-attach when exactly one match exists.
      if (!absPath && !raw.includes('/') && !raw.includes('\\')) {
        const hits = await vscode.workspace.findFiles(
          `**/${raw}`,
          '{**/node_modules/**,**/.git/**,**/dist/**,**/out/**,**/build/**}',
          2,
        );
        if (hits.length === 1) {
          absPath = hits[0].fsPath;
          displayPath = vscode.workspace.asRelativePath(hits[0]).replace(/\\/g, '/');
        }
      }

      if (!absPath) continue;
      if (matchesAnyGlob(displayPath, blacklist)) continue;

      await this.attachFile({ filePath: absPath, fileLabel: displayPath, auto: true });
    }
  }

  async attachFile(
    opts: { filePath?: string; fileLabel?: string; auto?: boolean } = {},
  ): Promise<void> {
    const targetPath = opts.filePath || this.filePath;
    const targetLabel = opts.fileLabel || this.fileLabel;
    if (!targetPath) {
      if (!opts.auto) {
        this.post({ type: 'error', sessionId: this.id, message: 'No file to attach.' });
      }
      return;
    }
    if (this.attachments.some((a) => a.startsWith(`File: ${targetLabel}`))) {
      if (!opts.auto) {
        this.post({
          type: 'error',
          sessionId: this.id,
          message: `"${targetLabel}" is already attached.`,
        });
      }
      return;
    }
    try {
      const uri = vscode.Uri.file(targetPath);
      const bytes = await vscode.workspace.fs.readFile(uri);
      const raw = new TextDecoder().decode(bytes);
      const truncated = raw.length > MAX_ATTACHMENT_CHARS;
      const content = truncated
        ? raw.slice(0, MAX_ATTACHMENT_CHARS) + '\n... [truncated]'
        : raw;
      const note = `Additional context — full content of \`${targetLabel}\`:\n\n\`\`\`\n${content}\n\`\`\``;
      this.messages.push({ role: 'user', content: note });
      const label = `File: ${targetLabel}${truncated ? ' (truncated)' : ''}`;
      this.attachments.push(label);
      this.post({
        type: 'attached',
        sessionId: this.id,
        label: `📎 ${label} · ${raw.length.toLocaleString()} chars${opts.auto ? ' · auto' : ''}`,
      });
      this.postContext();
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      log.error('attachFile', err);
      if (!opts.auto) {
        this.post({ type: 'error', sessionId: this.id, message: 'Failed to read file: ' + m });
      }
    }
  }

  async attachImageFromPath(filePath: string, label?: string): Promise<void> {
    try {
      const uri = vscode.Uri.file(filePath);
      const bytes = await vscode.workspace.fs.readFile(uri);
      const ext = (filePath.split('.').pop() ?? '').toLowerCase();
      const mediaMap: Record<string, ImageMediaType> = {
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        gif: 'image/gif',
        webp: 'image/webp',
      };
      const mediaType = mediaMap[ext];
      if (!mediaType) {
        this.post({
          type: 'error',
          sessionId: this.id,
          message: `Unsupported image type: .${ext}`,
        });
        return;
      }
      const MAX = 5 * 1024 * 1024;
      if (bytes.byteLength > MAX) {
        this.post({
          type: 'error',
          sessionId: this.id,
          message: `Image too large: ${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB (limit 5 MB).`,
        });
        return;
      }
      const base64 = Buffer.from(bytes).toString('base64');
      const dataUrl = `data:${mediaType};base64,${base64}`;
      const finalLabel = label || filePath.split(/[\\/]/).pop() || 'image';
      this.post({
        type: 'pendingImage',
        sessionId: this.id,
        image: {
          dataUrl,
          mediaType,
          label: finalLabel,
          sizeBytes: bytes.byteLength,
        },
      });
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      log.error('attachImageFromPath', err);
      this.post({ type: 'error', sessionId: this.id, message: 'Failed to read image: ' + m });
    }
  }

  clearMessages(): void {
    this.cancelStream();
    this.messages = [];
    this.attachments = [];
    this.cumulativeUsage = {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      estimatedCostUsd: 0,
    };
    this.lastTurnUsage = null;
    this.post({ type: 'resetMessages', sessionId: this.id });
    this.postContext();
  }

  async editAndResend(userOrdinal: number, newText: string): Promise<void> {
    let backendIdx = -1;
    let seen = -1;
    for (let i = 0; i < this.messages.length; i++) {
      if (this.messages[i].role === 'user') {
        seen++;
        if (seen === userOrdinal) {
          backendIdx = i;
          break;
        }
      }
    }
    if (backendIdx === -1) {
      this.post({ type: 'error', sessionId: this.id, message: 'Cannot edit: message not found.' });
      return;
    }
    const trimmed = newText.trim();
    if (!trimmed) return;
    const target = this.messages[backendIdx];
    if (typeof target.content === 'string') {
      target.content = trimmed;
    } else {
      const kept = target.content.filter((b) => b.type === 'image');
      target.content = kept.length > 0 ? [...kept, { type: 'text', text: trimmed }] : trimmed;
    }
    this.messages = this.messages.slice(0, backendIdx + 1);
    this.post({ type: 'editUserMessage', sessionId: this.id, index: userOrdinal, text: trimmed });
    this.postContext();
    await this.streamReply();
  }

  async regenerateLast(): Promise<void> {
    let lastIdx = -1;
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i].role === 'assistant') {
        lastIdx = i;
        break;
      }
    }
    if (lastIdx === -1) {
      this.post({
        type: 'error',
        sessionId: this.id,
        message: 'Nothing to regenerate.',
      });
      return;
    }
    this.messages = this.messages.slice(0, lastIdx);
    this.post({ type: 'rewindMessage', sessionId: this.id });
    this.postContext();
    await this.streamReply();
  }

  toMarkdown(): string {
    const lines: string[] = [
      `# ${this.title}`,
      '',
      `_Exported ${new Date().toISOString()}_`,
      this.fileLabel ? `_File: ${this.fileLabel}_` : '',
      this.source ? `_Source: ${this.source}_` : '',
      '',
      '---',
      '',
    ].filter(Boolean);
    for (const m of this.messages) {
      if (m.role === 'system') continue;
      const role = m.role === 'user' ? 'You' : 'Assistant';
      lines.push(`## ${role}`, '');
      if (typeof m.content === 'string') {
        lines.push(m.content);
      } else {
        for (const b of m.content) {
          if (b.type === 'text') lines.push(b.text);
          else if (b.type === 'tool_use')
            lines.push(
              '',
              `**Tool call: \`${b.name}\`**`,
              '```json',
              JSON.stringify(b.input ?? {}, null, 2),
              '```',
            );
          else if (b.type === 'tool_result')
            lines.push('', '**Tool result:**', '```', b.content, '```');
          else if (b.type === 'image') lines.push('', '_[image attached]_');
        }
      }
      lines.push('');
    }
    return lines.join('\n');
  }

  toJson(): string {
    return JSON.stringify(
      {
        title: this.title,
        kind: this.kind,
        fileLabel: this.fileLabel,
        source: this.source,
        createdAt: this.createdAt,
        exportedAt: Date.now(),
        messages: this.messages,
      },
      null,
      2,
    );
  }

  setProvider(id: string): void {
    this.selectedProviderId = id;
    this.postContext();
  }

  cancelStream(): void {
    if (this.currentAbort) {
      this.currentAbort.abort();
      this.currentAbort = null;
    }
  }

  dispose(): void {
    this.cancelStream();
  }

  private async streamReply(): Promise<void> {
    this.cancelStream();
    const ctrl = new AbortController();
    this.currentAbort = ctrl;

    try {
      const providerId = this.selectedProviderId || getActiveProviderId();
      const provider = providerId ? await getProviderById(this.context, providerId) : null;
      if (!provider) {
        throw new Error(
          'No provider selected. Pick one from the dropdown or configure one in the Config tab.',
        );
      }

      const toolsAllowed = this.kind === 'chat' || this.kind === 'explain' || this.kind === 'review';
      const useTools = toolsAllowed && getToolUseEnabled() && !!provider.chatWithTools;

      log.info('chat session: turn', {
        sessionId: this.id,
        provider: provider.id,
        kind: this.kind,
        useTools,
      });

      if (useTools) {
        await this.streamWithTools(provider, ctrl);
      } else {
        await this.streamPlain(provider, ctrl);
      }
    } catch (err) {
      if (!ctrl.signal.aborted) {
        const m = err instanceof Error ? err.message : String(err);
        log.error('chat streamReply', err);
        this.post({ type: 'error', sessionId: this.id, message: m });
      } else {
        this.post({ type: 'doneAssistant', sessionId: this.id });
      }
    } finally {
      if (this.currentAbort === ctrl) this.currentAbort = null;
      this.postContext();
    }
  }

  private recordUsage(
    provider: LLMProvider,
    usage: {
      inputTokens: number;
      outputTokens: number;
      cacheCreationInputTokens?: number;
      cacheReadInputTokens?: number;
    },
  ): void {
    const configs = getProviderConfigs();
    const cfg = configs.find((c) => c.id === provider.id);
    const model = cfg?.model ?? '';
    const cost = estimateCostUsd(model, usage);
    this.cumulativeUsage.inputTokens += usage.inputTokens;
    this.cumulativeUsage.outputTokens += usage.outputTokens;
    if (usage.cacheCreationInputTokens) {
      this.cumulativeUsage.cacheCreationInputTokens += usage.cacheCreationInputTokens;
    }
    if (usage.cacheReadInputTokens) {
      this.cumulativeUsage.cacheReadInputTokens += usage.cacheReadInputTokens;
    }
    this.cumulativeUsage.estimatedCostUsd += cost;
    this.lastTurnUsage = {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheCreationInputTokens: usage.cacheCreationInputTokens,
      cacheReadInputTokens: usage.cacheReadInputTokens,
      estimatedCostUsd: cost,
    };
  }

  private buildToolContext(signal: AbortSignal, provider: LLMProvider): ToolExecutionContext {
    const workspaceRoot = getWorkspaceRoot() ?? process.cwd();
    return {
      workspaceRoot,
      signal,
      blacklist: getToolUseBlacklist(),
      runSubAgent: (task, subSignal) => this.runSubAgent(provider, task, subSignal),
      requestApproval: (req) => this.requestApproval(req, signal),
    };
  }

  /**
   * Pop an approval card into the chat UI and return a Promise that resolves
   * once the user clicks Approve / Approve all / Discard. Honors the abort
   * signal so stopping generation also rejects in-flight approvals.
   */
  private requestApproval(
    req: { toolName: string; summary: string; detail?: string; callId?: string },
    signal: AbortSignal,
  ): Promise<'approve' | 'approveAll' | 'deny'> {
    return new Promise((resolve) => {
      if (signal.aborted) {
        resolve('deny');
        return;
      }
      const approvalId = `apv-${++this.approvalCounter}-${Date.now()}`;
      const onAbort = (): void => {
        if (this.pendingApprovals.has(approvalId)) {
          this.pendingApprovals.delete(approvalId);
          this.post({ type: 'approvalCleared', sessionId: this.id, approvalId });
          resolve('deny');
        }
      };
      signal.addEventListener('abort', onAbort, { once: true });
      this.pendingApprovals.set(approvalId, {
        resolve: (decision) => {
          signal.removeEventListener('abort', onAbort);
          resolve(decision);
        },
        abortCleanup: () => signal.removeEventListener('abort', onAbort),
      });
      this.post({
        type: 'approvalRequest',
        sessionId: this.id,
        approvalId,
        callId: req.callId,
        toolName: req.toolName,
        summary: req.summary,
        detail: req.detail,
      });
    });
  }

  /** Called when the user clicks a button on the approval card. */
  resolveApproval(approvalId: string, decision: 'approve' | 'approveAll' | 'deny'): void {
    const entry = this.pendingApprovals.get(approvalId);
    if (!entry) return;
    this.pendingApprovals.delete(approvalId);
    this.post({ type: 'approvalCleared', sessionId: this.id, approvalId });
    entry.resolve(decision);
  }

  private async runSubAgent(
    provider: LLMProvider,
    task: string,
    signal: AbortSignal,
  ): Promise<string> {
    if (!provider.chatWithTools) {
      throw new Error('Active provider does not support tools.');
    }
    const tools = getSubAgentToolDefs();
    const subSystem =
      'You are a research sub-agent. The main assistant has delegated a specific research task to you. ' +
      'Available tools: read_file, grep, list_dir, find_files, git_log, get_open_tabs, get_selection, ' +
      'find_symbol, goto_definition, find_references. Use them as needed. ' +
      'Prefer find_symbol / goto_definition / find_references for semantic navigation (language-server backed).\n' +
      'Goal: return a concise, accurate answer to the task. Cite file paths and line numbers when relevant. ' +
      'Be efficient: stop when you have a clear answer. Your last message must contain ONLY the answer text (no further tool calls).';

    const messages: ChatMessage[] = [
      { role: 'system', content: subSystem },
      { role: 'user', content: task },
    ];
    const SUB_MAX_ITERS = Math.max(3, Math.floor(getToolUseMaxIterations() / 2));
    let lastText = '';

    const subCtx: ToolExecutionContext = {
      workspaceRoot: getWorkspaceRoot() ?? process.cwd(),
      signal,
      blacklist: getToolUseBlacklist(),
      // Intentionally no runSubAgent here → block recursion.
    };

    log.info('subagent: start', { taskChars: task.length, maxIters: SUB_MAX_ITERS });

    for (let iter = 0; iter < SUB_MAX_ITERS; iter++) {
      if (signal.aborted) break;
      const turnText: string[] = [];
      const turnTools: ToolUseBlock[] = [];

      for await (const event of provider.chatWithTools(
        messages,
        tools,
        { maxTokens: 1500, temperature: 0.3 },
        signal,
      )) {
        if (signal.aborted) break;
        if (event.type === 'text') turnText.push(event.text);
        else if (event.type === 'tool_use') {
          turnTools.push({
            type: 'tool_use',
            id: event.id,
            name: event.name,
            input: event.input,
          });
        }
      }

      if (turnText.length > 0) lastText = turnText.join('');

      const blocks: ChatContentBlock[] = [];
      if (turnText.length > 0) blocks.push({ type: 'text', text: turnText.join('') });
      blocks.push(...turnTools);
      if (blocks.length > 0) messages.push({ role: 'assistant', content: blocks });

      if (turnTools.length === 0 || signal.aborted) break;

      const toolResults: ToolResultBlock[] = [];
      for (const tu of turnTools) {
        if (signal.aborted) break;
        const result = await withAbort(executeTool(tu.name, tu.input, subCtx), signal);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: result.content,
          is_error: result.isError,
        });
      }
      if (toolResults.length > 0) messages.push({ role: 'user', content: toolResults });
    }

    log.info('subagent: done', { answerChars: lastText.length });
    return lastText;
  }

  private async streamPlain(provider: LLMProvider, ctrl: AbortController): Promise<void> {
    this.post({ type: 'startAssistant', sessionId: this.id });
    await ensureMemoryPromptLoaded();
    let buf = '';
    const messages: ChatMessage[] = [
      { role: 'system', content: this.systemPrompt + memorySectionAffix() },
      ...this.messages,
    ];
    if (provider.chatWithTools) {
      // Use the events interface even without tools so we can capture usage.
      for await (const event of provider.chatWithTools(
        messages,
        [],
        { maxTokens: 4096, temperature: 0.4 },
        ctrl.signal,
      )) {
        if (ctrl.signal.aborted) break;
        if (event.type === 'text') {
          buf += event.text;
          this.post({ type: 'streamChunk', sessionId: this.id, text: event.text });
        } else if (event.type === 'usage') {
          this.recordUsage(provider, event.usage);
        }
      }
    } else {
      for await (const chunk of provider.chat(
        messages,
        { maxTokens: 4096, temperature: 0.4 },
        ctrl.signal,
      )) {
        if (ctrl.signal.aborted) break;
        buf += chunk;
        this.post({ type: 'streamChunk', sessionId: this.id, text: chunk });
      }
    }
    if (buf.trim()) {
      this.messages.push({ role: 'assistant', content: buf });
    }
    this.post({ type: 'doneAssistant', sessionId: this.id });
  }

  private async streamWithTools(
    provider: LLMProvider,
    ctrl: AbortController,
  ): Promise<void> {
    if (!provider.chatWithTools) {
      return this.streamPlain(provider, ctrl);
    }
    const tools = getAllToolDefs();
    const maxIters = getToolUseMaxIterations();
    const MAX_AUTO_CONTINUE = 2;
    let autoContinueCount = 0;
    let editFileRetried = false;
    await ensureMemoryPromptLoaded();

    for (let iter = 0; iter < maxIters; iter++) {
      if (ctrl.signal.aborted) break;

      this.post({ type: 'startAssistant', sessionId: this.id });

      const messages: ChatMessage[] = [
        { role: 'system', content: this.systemPrompt + memorySectionAffix() },
        ...this.messages,
      ];

      const turnText: string[] = [];
      const turnToolUses: ToolUseBlock[] = [];

      for await (const event of provider.chatWithTools(
        messages,
        tools,
        { maxTokens: 4096, temperature: 0.4 },
        ctrl.signal,
      )) {
        if (ctrl.signal.aborted) break;
        if (event.type === 'text') {
          turnText.push(event.text);
          this.post({ type: 'streamChunk', sessionId: this.id, text: event.text });
        } else if (event.type === 'tool_use') {
          turnToolUses.push({
            type: 'tool_use',
            id: event.id,
            name: event.name,
            input: event.input,
          });
          this.post({
            type: 'toolUse',
            sessionId: this.id,
            callId: event.id,
            name: event.name,
            input: event.input,
          });
        } else if (event.type === 'usage') {
          this.recordUsage(provider, event.usage);
        }
      }

      // Push assistant turn (text + tool_uses) into history
      const assistantBlocks: ChatContentBlock[] = [];
      if (turnText.length > 0) {
        assistantBlocks.push({ type: 'text', text: turnText.join('') });
      }
      assistantBlocks.push(...turnToolUses);
      if (assistantBlocks.length > 0) {
        this.messages.push({ role: 'assistant', content: assistantBlocks });
      }

      if (ctrl.signal.aborted) break;

      if (turnToolUses.length === 0) {
        // Model ended its turn with text only. Check for the "announce intent
        // then stop" failure mode — a final sentence that promises an action
        // without actually calling a tool. If detected, nudge it to continue.
        const finalText = turnText.join('').trimEnd();
        if (
          autoContinueCount < MAX_AUTO_CONTINUE &&
          finalText.length > 0 &&
          looksLikeIntentWithoutAction(finalText)
        ) {
          autoContinueCount++;
          this.messages.push({
            role: 'user',
            content:
              'Continue with the action you just announced. Call the tool now — do not narrate intent again, just execute.',
          });
          log.info('auto-continue triggered', { count: autoContinueCount, tail: finalText.slice(-80) });
          continue;
        }
        break; // genuine final answer
      }

      // Execute each tool, post result, append to history
      const toolCtx = this.buildToolContext(ctrl.signal, provider);
      const toolResults: ToolResultBlock[] = [];
      let retryFilePath: string | null = null;
      for (const tu of turnToolUses) {
        if (ctrl.signal.aborted) break;
        const result = await withAbort(
          executeTool(tu.name, tu.input, { ...toolCtx, callId: tu.id }),
          ctrl.signal,
        );
        if (tu.name === 'write_memory' && !result.isError) {
          // Refresh the in-prompt index so the next turn sees the new entry.
          await refreshMemoryPrompt();
        }
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: result.content,
          is_error: result.isError,
        });
        this.post({
          type: 'toolResult',
          sessionId: this.id,
          callId: tu.id,
          content: result.content,
          ok: !result.isError,
        });

        if (
          !editFileRetried &&
          getEditFileAutoRetry() &&
          tu.name === 'edit_file' &&
          result.isError &&
          isRetryableEditMatchError(result.content)
        ) {
          const input = (tu.input ?? {}) as { path?: unknown };
          if (typeof input.path === 'string' && input.path.length > 0) {
            retryFilePath = input.path;
            break;
          }
        }
      }
      if (toolResults.length > 0) {
        this.messages.push({ role: 'user', content: toolResults });
      }
      if (retryFilePath) {
        const freshContent = await readFreshRetryFile(retryFilePath, toolCtx.workspaceRoot);
        if (freshContent !== null) {
          editFileRetried = true;
          this.messages.push({
            role: 'user',
            content: buildEditRetryMessage(retryFilePath, freshContent),
          });
          this.postContext();
          continue;
        }
      }
      this.postContext();
    }

    this.post({ type: 'doneAssistant', sessionId: this.id });
  }

  private postContext(): void {
    this.post({ type: 'context', sessionId: this.id, info: this.getContextInfo() });
  }

  private getContextInfo(): ChatContextInfo {
    const turns = Math.max(0, Math.floor((this.messages.length - 1) / 2));
    let inputChars = this.systemPrompt.length;
    let outputChars = 0;
    let imageCount = 0;
    for (const m of this.messages) {
      if (typeof m.content === 'string') {
        if (m.role === 'assistant') outputChars += m.content.length;
        else inputChars += m.content.length;
      } else {
        for (const b of m.content) {
          if (b.type === 'text') {
            if (m.role === 'assistant') outputChars += b.text.length;
            else inputChars += b.text.length;
          } else if (b.type === 'tool_result') {
            inputChars += b.content.length;
          } else if (b.type === 'tool_use') {
            outputChars += JSON.stringify(b.input ?? {}).length;
          } else if (b.type === 'image') {
            imageCount++;
          }
        }
      }
    }
    const imageTokens = imageCount * 1500;
    const configs = getProviderConfigs();
    const hasReal = this.cumulativeUsage.inputTokens > 0 || this.cumulativeUsage.outputTokens > 0;
    return {
      turns,
      inputChars,
      outputChars,
      inputTokens: Math.ceil(inputChars / 4) + imageTokens,
      outputTokens: Math.ceil(outputChars / 4),
      realInputTokens: hasReal ? this.cumulativeUsage.inputTokens : undefined,
      realOutputTokens: hasReal ? this.cumulativeUsage.outputTokens : undefined,
      cacheCreationInputTokens:
        this.cumulativeUsage.cacheCreationInputTokens || undefined,
      cacheReadInputTokens: this.cumulativeUsage.cacheReadInputTokens || undefined,
      estimatedCostUsd: hasReal ? this.cumulativeUsage.estimatedCostUsd : undefined,
      lastTurnInputTokens: this.lastTurnUsage?.inputTokens,
      lastTurnOutputTokens: this.lastTurnUsage?.outputTokens,
      lastTurnCostUsd: this.lastTurnUsage?.estimatedCostUsd,
      imageCount,
      source: this.source,
      sourceTruncated: this.sourceTruncated,
      attachments: [...this.attachments],
      selectedProviderId: this.selectedProviderId,
      availableProviders: configs.map((c: ProviderConfig) => ({
        id: c.id,
        displayName: c.displayName,
        model: c.model,
        protocol: c.protocol,
      })),
    };
  }

  private post(msg: ChatOutbound): void {
    this.postFn(msg);
  }
}

const IMAGE_MEDIA_TYPES: Record<string, ImageMediaType> = {
  'image/png': 'image/png',
  'image/jpeg': 'image/jpeg',
  'image/jpg': 'image/jpeg',
  'image/gif': 'image/gif',
  'image/webp': 'image/webp',
};

function dataUrlToImageBlock(dataUrl: string, mediaType: string): ImageBlock | null {
  const normalized = IMAGE_MEDIA_TYPES[mediaType.toLowerCase()] ?? null;
  if (!normalized) {
    log.warn('attach image: unsupported media type', { mediaType });
    return null;
  }
  // dataUrl: "data:image/png;base64,iVBORw..." → strip prefix
  const commaIdx = dataUrl.indexOf(',');
  const data = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
  return {
    type: 'image',
    source: { type: 'base64', media_type: normalized, data },
  };
}

function deriveTitleFromMessage(text: string): string {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  return cleaned.length > 50 ? cleaned.slice(0, 50) + '…' : cleaned;
}

function extractTextContent(content: string | ChatContentBlock[]): string {
  if (typeof content === 'string') return content;
  return content
    .map((b) => (b.type === 'text' ? b.text : ''))
    .filter(Boolean)
    .join('\n');
}

function stripImagesFromMessages(messages: ChatMessage[]): ChatMessage[] {
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

function langInstruction(): string {
  const language = getOutputLanguage();
  if (!language || language === 'English') return '';
  return `\n\nIMPORTANT: write your responses in ${language}. Keep code snippets, identifiers, and file paths verbatim.`;
}

function skillsInstruction(): string {
  const mgr = getSkillManager();
  return mgr?.buildSystemPromptAddition() ?? '';
}

// Memory index is built once and refreshed when a write_memory tool fires.
// Stored at module scope so concurrent sessions share the same cache.
let memoryPromptCache = '';
let memoryPromptLoaded = false;

async function ensureMemoryPromptLoaded(): Promise<void> {
  if (memoryPromptLoaded) return;
  memoryPromptLoaded = true;
  try {
    memoryPromptCache = await buildMemoryPromptSection();
  } catch (err) {
    log.warn('memory prompt load failed', err);
    memoryPromptCache = '';
  }
}

export async function refreshMemoryPrompt(): Promise<void> {
  memoryPromptLoaded = true;
  try {
    memoryPromptCache = await buildMemoryPromptSection();
  } catch (err) {
    log.warn('memory prompt refresh failed', err);
  }
}

function memorySectionAffix(): string {
  return memoryPromptCache ? '\n\n' + memoryPromptCache : '';
}

/**
 * Heuristic for Claude's "narrate-then-stop" failure mode. Uses only
 * language-agnostic signals (punctuation + structure) so it works for any
 * locale the user writes in.
 *
 * Triggers when the assistant ended its turn with:
 *  - empty/whitespace-only text (and no tool_use elsewhere — checked by caller)
 *  - a trailing introductory punctuation: ":", "：", "…", "..."
 *  - a trailing arrow like "→" / "->" / "=>" used to introduce the next step
 *
 * Anything ending with "." "!" "?" or a closing quote is treated as a genuine
 * final answer and is NOT auto-continued.
 */
function looksLikeIntentWithoutAction(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return true;
  if (/[:：…]$/.test(trimmed)) return true;
  if (trimmed.endsWith('...')) return true;
  if (/(?:→|->|=>)\s*$/.test(trimmed)) return true;
  return false;
}

/** Race a promise against an AbortSignal — rejects if the signal fires first. */
function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
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
