import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { deleteApiKey, deleteMcpToken, getApiKey, getMcpToken, setApiKey, setMcpToken } from '../config/secrets';
import {
  FEATURE_LIST,
  SUPPORTED_OUTPUT_LANGUAGES,
  getActiveProviderId,
  getAllowShell,
  getAllowWriteTools,
  getFeatures,
  getIncludeFullFile,
  getMcpDisabledTools,
  getOutputLanguage,
  getProviderConfigs,
  getShellAutoApprove,
  getShowDiffPreview,
  isEnabled,
  setActiveProviderId,
  setAllowShell,
  setAllowWriteTools,
  setEnabled,
  setFeature,
  setIncludeFullFile,
  setMcpDisabledTools,
  setOutputLanguage,
  setProviderConfigs,
  setShellAutoApprove,
  setShowDiffPreview,
  type FeatureName,
  type FeaturesMap,
} from '../config/settings';
import { generateCommitMessage } from '../git/commitMessageGenerator';
import { generatePrDescription } from '../git/prDescriptionGenerator';
import { generateBranchNames } from '../git/branchNameGenerator';
import { RepoManager } from '../git/repoManager';
import { shortStatusLabel } from '../git/types';
import type { RepoSummary } from '../git/types';
import { AnthropicProvider } from '../providers/anthropic';
import type { ProviderConfig } from '../providers/base';
import * as log from '../util/logger';
import {
  ChatSession,
  type ChatOutbound,
  type HistoryEntry,
  type HistorySummary,
  type SessionKind,
} from './chatSession';
import type { McpManager } from '../mcp/manager';
import { McpOAuthProvider } from '../mcp/oauth';
import type { McpServerSummary } from '../mcp/types';
import type { McpServerConfigSetting } from '../config/settings';
import type { SkillManager } from '../skills/manager';
import type { SkillSummary } from '../skills/types';

const HISTORY_KEY = 'devCode.chatHistory';
const HISTORY_LIMIT = 50;

const WORKSPACE_FILE_EXCLUDE =
  '{**/node_modules/**,**/.git/**,**/dist/**,**/out/**,**/build/**,**/target/**,**/.next/**,**/.cache/**,**/.venv/**,**/venv/**}';

/**
 * Build a case-insensitive glob fragment from a query so VS Code's `findFiles`
 * matches across the whole tree (it is case-sensitive on POSIX). Strips
 * characters with special glob meaning to avoid breaking the pattern.
 */
function caseInsensitiveGlobFragment(query: string): string {
  const cleaned = query.replace(/[*?{}[\]()!,]/g, '');
  let out = '';
  for (const ch of cleaned) {
    const lo = ch.toLowerCase();
    const up = ch.toUpperCase();
    out += lo === up ? ch : `[${lo}${up}]`;
  }
  return out;
}

/**
 * Search workspace files using the query as part of the include glob so
 * `findFiles` does the filtering server-side and the maxResults cap can stay
 * tight without missing matches in deep sub-folders.
 */
export async function searchWorkspaceFiles(
  query: string,
  maxResults: number,
): Promise<vscode.Uri[]> {
  const q = query.trim();
  const include = q.length > 0 ? `**/*${caseInsensitiveGlobFragment(q)}*` : '**/*';
  try {
    return await vscode.workspace.findFiles(include, WORKSPACE_FILE_EXCLUDE, maxResults);
  } catch (err) {
    log.error('findFiles', err);
    return [];
  }
}

type Inbound =
  | { scope: 'meta'; type: 'ready' }
  | { scope: 'meta'; type: 'showLogs' }
  | { scope: 'tabs'; type: 'switch'; tab: string }
  | { scope: 'tabs'; type: 'close'; tab: string }
  | { scope: 'tabs'; type: 'newChat' }
  | { scope: 'tabs'; type: 'togglePin'; tab: string }
  | { scope: 'history'; type: 'list' }
  | { scope: 'history'; type: 'resume'; entryId: string }
  | { scope: 'history'; type: 'delete'; entryId: string }
  | { scope: 'mcp'; type: 'list' }
  | { scope: 'mcp'; type: 'reconnect' }
  | { scope: 'mcp'; type: 'addServer'; name: string; config: McpServerConfigSetting; target: 'global' | 'workspace'; token?: string }
  | { scope: 'mcp'; type: 'updateServer'; name: string; config: McpServerConfigSetting; target: 'global' | 'workspace'; token?: string }
  | { scope: 'mcp'; type: 'deleteServer'; name: string; target: 'global' | 'workspace' }
  | { scope: 'mcp'; type: 'toggleTool'; server: string; tool: string }
  | { scope: 'mcp'; type: 'getConfig' }
  | { scope: 'mcp'; type: 'startOAuth'; name: string }
  | { scope: 'mcp'; type: 'signOut'; name: string }
  | { scope: 'skills'; type: 'list' }
  | { scope: 'skills'; type: 'reload' }
  | { scope: 'skills'; type: 'open'; filePath: string }
  | {
      scope: 'chat';
      sessionId: string;
      type: 'send';
      text: string;
      attachments?: Array<{ dataUrl: string; mediaType: string; label: string; sizeBytes: number }>;
    }
  | { scope: 'chat'; sessionId: string; type: 'stop' }
  | { scope: 'chat'; sessionId: string; type: 'attachFile' }
  | { scope: 'chat'; sessionId: string; type: 'attachFilePicker' }
  | { scope: 'chat'; sessionId: string; type: 'attachImagePicker' }
  | { scope: 'chat'; sessionId: string; type: 'setProvider'; providerId: string }
  | { scope: 'chat'; sessionId: string; type: 'regenerate' }
  | { scope: 'chat'; sessionId: string; type: 'export'; format: 'md' | 'json' }
  | { scope: 'chat'; sessionId: string; type: 'clear' }
  | { scope: 'chat'; sessionId: string; type: 'editMessage'; index: number; text: string }
  | { scope: 'chat'; sessionId: string; type: 'attachFileByPath'; path: string; label: string }
  | {
      scope: 'chat';
      sessionId: string;
      type: 'approvalResponse';
      approvalId: string;
      decision: 'approve' | 'approveAll' | 'deny';
    }
  | { scope: 'meta'; type: 'requestFileList'; query: string; requestId: string }
  | { scope: 'config'; type: 'addProvider'; config: ProviderConfig; apiKey?: string }
  | { scope: 'config'; type: 'updateProvider'; config: ProviderConfig; apiKey?: string }
  | { scope: 'config'; type: 'deleteProvider'; id: string }
  | { scope: 'config'; type: 'activateProvider'; id: string }
  | { scope: 'config'; type: 'toggleEnabled' }
  | { scope: 'config'; type: 'testConnection'; config: ProviderConfig; apiKey?: string }
  | { scope: 'config'; type: 'setOutputLanguage'; language: string }
  | { scope: 'config'; type: 'setIncludeFullFile'; value: boolean }
  | { scope: 'config'; type: 'setAllowWriteTools'; value: boolean }
  | { scope: 'config'; type: 'setShowDiffPreview'; value: boolean }
  | { scope: 'config'; type: 'setAllowShell'; value: boolean }
  | { scope: 'config'; type: 'setShellAutoApprove'; value: string[] }
  | { scope: 'config'; type: 'setFeatureEnabled'; feature: FeatureName; value: boolean }
  | { scope: 'config'; type: 'setFeatureProvider'; feature: FeatureName; providerId: string }
  | { scope: 'git'; type: 'selectRepo'; repoId: string }
  | { scope: 'git'; type: 'stage'; repoId: string; paths: string[] }
  | { scope: 'git'; type: 'unstage'; repoId: string; paths: string[] }
  | { scope: 'git'; type: 'stageAll'; repoId: string }
  | { scope: 'git'; type: 'unstageAll'; repoId: string }
  | { scope: 'git'; type: 'commit'; repoId: string; message: string }
  | { scope: 'git'; type: 'generateMessage'; repoId: string }
  | { scope: 'git'; type: 'generatePrDescription'; repoId: string; baseBranch: string; instructions?: string; template?: string }
  | { scope: 'git'; type: 'createPr'; repoId: string; serverName: string; toolName: string; prefixedName: string; title: string; body: string; head: string; base: string }
  | { scope: 'git'; type: 'listBranches'; repoId: string }
  | { scope: 'git'; type: 'checkoutBranch'; repoId: string; branch: string }
  | { scope: 'git'; type: 'generateBranchName'; repoId: string; intent: string }
  | { scope: 'git'; type: 'openFile'; path: string }
  | { scope: 'git'; type: 'openDiff'; repoId: string; path: string; staged: boolean }
  | { scope: 'git'; type: 'discard'; repoId: string; path: string; relPath?: string }
  | { scope: 'git'; type: 'explainChange'; repoId: string; path: string; relPath: string; staged: boolean }
  | { scope: 'git'; type: 'reviewChange'; repoId: string; path: string; relPath: string; staged: boolean }
  | { scope: 'git'; type: 'rescan' };

type Outbound =
  | { scope: 'meta'; type: 'init'; version: string }
  | { scope: 'meta'; type: 'toast'; message: string; kind: 'info' | 'error' | 'success' }
  | {
      scope: 'meta';
      type: 'fileList';
      requestId: string;
      files: { path: string; name: string }[];
    }
  | {
      scope: 'config';
      type: 'state';
      providers: ProviderConfig[];
      activeId: string;
      enabled: boolean;
      apiKeyStatus: Record<string, boolean>;
      outputLanguage: string;
      supportedLanguages: readonly string[];
      includeFullFile: boolean;
      allowWriteTools: boolean;
      showDiffPreview: boolean;
      allowShell: boolean;
      shellAutoApprove: string[];
      features: FeaturesMap;
      featureList: typeof FEATURE_LIST;
    }
  | { scope: 'config'; type: 'testResult'; success: boolean; message: string }
  | {
      scope: 'git';
      type: 'state';
      hasGit: boolean;
      loading: boolean;
      repos: SerializedRepo[];
      activeRepoId: string;
    }
  | { scope: 'git'; type: 'commitMessage'; text: string }
  | { scope: 'git'; type: 'prDescription'; title: string; body: string; branch: string; baseBranch: string; createPrTool?: { serverName: string; toolName: string; prefixedName: string } }
  | { scope: 'git'; type: 'branchSuggestions'; names: string[] }
  | { scope: 'git'; type: 'branches'; branches: string[] }
  | { scope: 'git'; type: 'busy'; busy: boolean; label?: string }
  | {
      scope: 'tabs';
      type: 'state';
      tabs: { id: string; label: string; kind: string; closable: boolean; pinned: boolean }[];
      activeTab: string;
    }
  | { scope: 'history'; type: 'list'; entries: HistorySummary[] }
  | { scope: 'mcp'; type: 'state'; servers: McpServerSummary[]; disabledTools: Record<string, string[]> }
  | { scope: 'mcp'; type: 'config'; servers: Record<string, McpServerConfigSetting>; configScope: 'global' | 'workspace'; tokenStatus: Record<string, boolean> }
  | { scope: 'skills'; type: 'state'; skills: SkillSummary[] }
  | ({ scope: 'chat' } & ChatOutbound);

type SerializedRepo = {
  id: string;
  rootPath: string;
  rootName: string;
  branch: string | null;
  ahead: number;
  behind: number;
  staged: SerializedChange[];
  unstaged: SerializedChange[];
  merge: SerializedChange[];
};

type SerializedChange = {
  path: string;
  relPath: string;
  status: string;
  statusLabel: string;
  staged: boolean;
};

export class MainViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'devCode.mainView';
  private view?: vscode.WebviewView;
  private activeRepoId = '';
  private generateAbort: AbortController | null = null;
  private chatSessions: Map<string, ChatSession> = new Map();
  private sessionOrder: string[] = [];
  private activeTab = 'git';
  private sessionCounter = 0;
  private hasEnsuredDefaultChat = false;
  private pinnedSessions: Set<string> = new Set();

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly repoManager: RepoManager,
    private readonly mcpManager?: McpManager,
    private readonly skillManager?: SkillManager,
  ) {
    this.context.subscriptions.push(this.repoManager.onDidChange(() => this.postGitState()));
    if (this.mcpManager) {
      this.context.subscriptions.push(this.mcpManager.onChange(() => this.postMcpState()));
    }
    if (this.skillManager) {
      this.context.subscriptions.push(this.skillManager.onChange(() => this.postSkillsState()));
    }
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    const version = this.context.extension.packageJSON.version ?? '';
    if (version) view.description = `v${version}`;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')],
    };
    view.webview.html = this.renderHtml(view.webview);
    view.webview.onDidReceiveMessage((msg: Inbound) => {
      this.handleMessage(msg).catch((err) => {
        const m = err instanceof Error ? err.message : String(err);
        log.error('mainView handler', err);
        this.post({ scope: 'meta', type: 'toast', message: m, kind: 'error' });
      });
    });
    this.ensureDefaultChat();
  }

  refresh(): void {
    void this.postConfigState();
    void this.postGitState();
  }

  private renderHtml(webview: vscode.Webview): string {
    const htmlPath = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'mainView.html');
    const raw = fs.readFileSync(htmlPath.fsPath, 'utf8');
    const nonce = makeNonce();
    return raw.replace(/{{nonce}}/g, nonce).replace(/{{cspSource}}/g, webview.cspSource);
  }

  private async handleMessage(msg: Inbound): Promise<void> {
    if (msg.scope === 'meta') return this.handleMeta(msg);
    if (msg.scope === 'config') return this.handleConfig(msg);
    if (msg.scope === 'git') return this.handleGit(msg);
    if (msg.scope === 'tabs') return this.handleTabs(msg);
    if (msg.scope === 'chat') return this.handleChat(msg);
    if (msg.scope === 'history') return this.handleHistory(msg);
    if (msg.scope === 'mcp') return this.handleMcp(msg);
    if (msg.scope === 'skills') return this.handleSkills(msg);
  }

  private async handleSkills(msg: Inbound & { scope: 'skills' }): Promise<void> {
    if (!this.skillManager) return;
    if (msg.type === 'list') {
      this.postSkillsState();
      return;
    }
    if (msg.type === 'reload') {
      await this.skillManager.reload();
      return;
    }
    if (msg.type === 'open') {
      try {
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(msg.filePath));
        await vscode.window.showTextDocument(doc);
      } catch (err) {
        log.error('open skill file failed', err);
      }
      return;
    }
  }

  private postSkillsState(): void {
    if (!this.skillManager) {
      this.post({ scope: 'skills', type: 'state', skills: [] });
      return;
    }
    this.post({ scope: 'skills', type: 'state', skills: this.skillManager.getSummaries() });
  }

  private async handleMcp(msg: Inbound & { scope: 'mcp' }): Promise<void> {
    if (!this.mcpManager) return;
    if (msg.type === 'list') {
      this.postMcpState();
      return;
    }
    if (msg.type === 'reconnect') {
      await this.mcpManager.reconnect();
      return;
    }
    if (msg.type === 'getConfig') {
      const config = vscode.workspace.getConfiguration('devCode');
      const raw = config.get<Record<string, McpServerConfigSetting>>('mcp.servers') ?? {};
      const inspected = config.inspect<Record<string, McpServerConfigSetting>>('mcp.servers');
      const configScope = inspected?.workspaceValue ? 'workspace' : 'global';
      const tokenStatus: Record<string, boolean> = {};
      for (const name of Object.keys(raw)) {
        tokenStatus[name] = !!(await getMcpToken(this.context, name));
      }
      this.post({ scope: 'mcp', type: 'config', servers: raw, configScope, tokenStatus });
      return;
    }
    if (msg.type === 'addServer' || msg.type === 'updateServer') {
      try {
        const target = msg.target === 'workspace'
          ? vscode.ConfigurationTarget.Workspace
          : vscode.ConfigurationTarget.Global;
        const config = vscode.workspace.getConfiguration('devCode');
        const servers = cloneServers(config.get<Record<string, McpServerConfigSetting>>('mcp.servers'));
        servers[msg.name] = msg.config;
        await config.update('mcp.servers', servers, target);
        if (msg.token !== undefined) {
          if (msg.token.length > 0) {
            await setMcpToken(this.context, msg.name, msg.token);
          } else {
            await deleteMcpToken(this.context, msg.name);
          }
        }
        this.post({ scope: 'meta', type: 'toast', message: `MCP server "${msg.name}" saved.`, kind: 'success' });
      } catch (err) {
        const m = err instanceof Error ? err.message : String(err);
        this.post({ scope: 'meta', type: 'toast', message: m, kind: 'error' });
      }
      return;
    }
    if (msg.type === 'toggleTool') {
      try {
        const current = getMcpDisabledTools();
        const disabled = new Set(current[msg.server] ?? []);
        if (disabled.has(msg.tool)) {
          disabled.delete(msg.tool);
        } else {
          disabled.add(msg.tool);
        }
        current[msg.server] = [...disabled];
        if (current[msg.server].length === 0) delete current[msg.server];
        await setMcpDisabledTools(current);
        if (this.mcpManager) {
          this.mcpManager.setDisabledTools(current);
        }
        this.postMcpState();
      } catch (err) {
        const m = err instanceof Error ? err.message : String(err);
        this.post({ scope: 'meta', type: 'toast', message: m, kind: 'error' });
      }
      return;
    }
    if (msg.type === 'deleteServer') {
      const pick = await vscode.window.showWarningMessage(
        `Delete MCP server "${msg.name}"?`,
        { modal: true, detail: 'Stored OAuth tokens and API keys for this server will also be cleared.' },
        'Delete',
      );
      if (pick !== 'Delete') return;
      try {
        const target = msg.target === 'workspace'
          ? vscode.ConfigurationTarget.Workspace
          : vscode.ConfigurationTarget.Global;
        const config = vscode.workspace.getConfiguration('devCode');
        // config.get() returns a frozen/proxied object — clone before mutating.
        const servers = cloneServers(config.get<Record<string, McpServerConfigSetting>>('mcp.servers'));
        delete servers[msg.name];
        await config.update('mcp.servers', servers, target);
        await deleteMcpToken(this.context, msg.name);
        await new McpOAuthProvider(this.context, msg.name).clearAll();
        this.post({ scope: 'meta', type: 'toast', message: `MCP server "${msg.name}" removed.`, kind: 'success' });
      } catch (err) {
        const m = err instanceof Error ? err.message : String(err);
        this.post({ scope: 'meta', type: 'toast', message: m, kind: 'error' });
      }
      return;
    }
    if (msg.type === 'startOAuth') {
      this.post({ scope: 'meta', type: 'toast', message: `Opening browser to sign in to "${msg.name}"…`, kind: 'info' });
      try {
        await this.mcpManager.startOAuth(msg.name);
        this.post({ scope: 'meta', type: 'toast', message: `Signed in to "${msg.name}".`, kind: 'success' });
      } catch (err) {
        const m = err instanceof Error ? err.message : String(err);
        this.post({ scope: 'meta', type: 'toast', message: `Sign-in failed: ${m}`, kind: 'error' });
      }
      return;
    }
    if (msg.type === 'signOut') {
      const pick = await vscode.window.showWarningMessage(
        `Sign out of "${msg.name}"?`,
        { modal: true, detail: 'OAuth tokens and the registered client will be cleared. You will need to sign in again to use this server.' },
        'Sign out',
      );
      if (pick !== 'Sign out') return;
      try {
        await new McpOAuthProvider(this.context, msg.name).clearAll();
        await this.mcpManager.reconnect();
        this.post({ scope: 'meta', type: 'toast', message: `Signed out of "${msg.name}".`, kind: 'success' });
      } catch (err) {
        const m = err instanceof Error ? err.message : String(err);
        this.post({ scope: 'meta', type: 'toast', message: m, kind: 'error' });
      }
      return;
    }
  }

  private postMcpState(): void {
    if (!this.mcpManager) {
      this.post({ scope: 'mcp', type: 'state', servers: [], disabledTools: {} });
      return;
    }
    const summaries = this.mcpManager.getServerSummaries();
    const config = vscode.workspace.getConfiguration('devCode');
    const inspected = config.inspect<Record<string, McpServerConfigSetting>>('mcp.servers');
    const globalVal = inspected?.globalValue ?? {};
    const workspaceVal = inspected?.workspaceValue ?? {};
    for (const s of summaries) {
      if (workspaceVal && s.name in workspaceVal) {
        s.configScope = 'workspace';
      } else if (globalVal && s.name in globalVal) {
        s.configScope = 'global';
      }
    }
    this.post({
      scope: 'mcp',
      type: 'state',
      servers: summaries,
      disabledTools: getMcpDisabledTools(),
    });
  }

  private handleTabs(msg: Inbound & { scope: 'tabs' }): void {
    if (msg.type === 'switch') {
      this.activeTab = msg.tab;
      this.postTabsState();
    } else if (msg.type === 'close') {
      if (msg.tab.startsWith('chat:')) {
        const id = msg.tab.slice('chat:'.length);
        if (this.pinnedSessions.has(id)) {
          // Cannot close pinned tabs
          return;
        }
        const sess = this.chatSessions.get(id);
        if (sess) {
          // Save snapshot to history if it has content.
          if (sess.hasContent()) void this.saveHistorySnapshot(sess.toHistoryEntry());
          sess.dispose();
          this.chatSessions.delete(id);
          this.sessionOrder = this.sessionOrder.filter((s) => s !== id);
        }
        if (this.activeTab === msg.tab) {
          // Fall back to last session or git tab
          const lastSession = this.sessionOrder[this.sessionOrder.length - 1];
          this.activeTab = lastSession ? `chat:${lastSession}` : 'git';
        }
        this.postTabsState();
      }
    } else if (msg.type === 'newChat') {
      this.openNewChat();
    } else if (msg.type === 'togglePin') {
      if (msg.tab.startsWith('chat:')) {
        const id = msg.tab.slice('chat:'.length);
        if (this.pinnedSessions.has(id)) this.pinnedSessions.delete(id);
        else this.pinnedSessions.add(id);
        this.postTabsState();
      }
    }
  }

  private async handleHistory(msg: Inbound & { scope: 'history' }): Promise<void> {
    if (msg.type === 'list') {
      this.postHistoryList();
      return;
    }
    if (msg.type === 'resume') {
      const entries = this.loadHistory();
      const entry = entries.find((e) => e.id === msg.entryId);
      if (!entry) return;

      const activeSess = this.getActiveChatSession();
      if (activeSess && activeSess.sessionKind === 'chat' && !activeSess.hasContent()) {
        // Empty chat tab → load into it
        activeSess.loadFromHistory(entry);
      } else {
        // Create new tab
        const id = this.createChatTab();
        const sess = this.chatSessions.get(id);
        if (sess) sess.loadFromHistory(entry);
      }
      this.postTabsState();
      return;
    }
    if (msg.type === 'delete') {
      const entries = this.loadHistory().filter((e) => e.id !== msg.entryId);
      await this.context.workspaceState.update(HISTORY_KEY, entries);
      this.postHistoryList();
      return;
    }
  }

  private getActiveChatSession(): ChatSession | null {
    if (!this.activeTab.startsWith('chat:')) return null;
    return this.chatSessions.get(this.activeTab.slice('chat:'.length)) ?? null;
  }

  // ---- Tab / session creation ----

  openNewChat(): string {
    return this.createChatTab();
  }

  private createChatTab(): string {
    this.sessionCounter++;
    const id = `s${Date.now().toString(36)}${this.sessionCounter}`;
    const sess = new ChatSession(
      id,
      'chat',
      '',
      '',
      this.context,
      (payload) => {
        if (payload.type === 'doneAssistant') {
          const s = this.chatSessions.get(id);
          if (s && s.hasContent()) void this.saveHistorySnapshot(s.toHistoryEntry());
        }
        this.post({ scope: 'chat', ...payload } as Outbound);
      },
      () => this.postTabsState(),
    );
    this.chatSessions.set(id, sess);
    this.sessionOrder.push(id);
    this.activeTab = `chat:${id}`;
    sess.startChat();
    this.postTabsState();
    return id;
  }

  private ensureDefaultChat(): void {
    if (this.hasEnsuredDefaultChat) return;
    this.hasEnsuredDefaultChat = true;
    if (this.sessionOrder.length === 0) {
      this.createChatTab();
    }
  }

  // ---- History persistence ----

  private loadHistory(): HistoryEntry[] {
    return this.context.workspaceState.get<HistoryEntry[]>(HISTORY_KEY, []);
  }

  private async saveHistorySnapshot(entry: HistoryEntry): Promise<void> {
    let history = this.loadHistory().filter((e) => e.id !== entry.id);
    history.unshift(entry);
    history = history.slice(0, HISTORY_LIMIT);
    await this.context.workspaceState.update(HISTORY_KEY, history);
    this.postHistoryList();
  }

  private postHistoryList(): void {
    const entries = this.loadHistory();
    const summaries: HistorySummary[] = entries.map((e) => ({
      id: e.id,
      title: e.title,
      kind: e.kind,
      fileLabel: e.fileLabel,
      messageCount: e.messages.length,
      updatedAt: e.updatedAt,
    }));
    this.post({ scope: 'history', type: 'list', entries: summaries });
  }

  private async handleChat(msg: Inbound & { scope: 'chat' }): Promise<void> {
    const sess = this.chatSessions.get(msg.sessionId);
    if (!sess) {
      log.warn('chat message for unknown session', { id: msg.sessionId });
      return;
    }
    if (msg.type === 'send') await sess.handleUserMessage(msg.text, msg.attachments ?? []);
    else if (msg.type === 'stop') sess.cancelStream();
    else if (msg.type === 'attachFile') await sess.attachFile();
    else if (msg.type === 'attachFilePicker') await this.showAttachFilePicker(sess);
    else if (msg.type === 'attachImagePicker') await this.showAttachImagePicker(sess);
    else if (msg.type === 'setProvider') sess.setProvider(msg.providerId);
    else if (msg.type === 'regenerate') await sess.regenerateLast();
    else if (msg.type === 'export') await this.exportSession(sess, msg.format);
    else if (msg.type === 'clear') sess.clearMessages();
    else if (msg.type === 'editMessage') await sess.editAndResend(msg.index, msg.text);
    else if (msg.type === 'attachFileByPath') {
      let abs = msg.path;
      const ws = vscode.workspace.workspaceFolders?.[0];
      if (ws && !path.isAbsolute(msg.path)) {
        abs = vscode.Uri.joinPath(ws.uri, msg.path).fsPath;
      }
      await sess.attachFile({ filePath: abs, fileLabel: msg.label });
    } else if (msg.type === 'approvalResponse') {
      sess.resolveApproval(msg.approvalId, msg.decision);
    }
  }

  private async handleFileListRequest(query: string, requestId: string): Promise<void> {
    const files = await searchWorkspaceFiles(query, 500);
    const q = query.toLowerCase();
    const items = files
      .map((uri) => {
        const rel = vscode.workspace.asRelativePath(uri).replace(/\\/g, '/');
        const name = rel.split('/').pop() || rel;
        return { path: rel, name };
      })
      .sort((a, b) => {
        const an = a.name.toLowerCase();
        const bn = b.name.toLowerCase();
        if (q) {
          const ai = an.startsWith(q) ? 0 : an.includes(q) ? 1 : 2;
          const bi = bn.startsWith(q) ? 0 : bn.includes(q) ? 1 : 2;
          if (ai !== bi) return ai - bi;
          // Prefer shorter paths so root-level matches outrank deep matches.
          if (a.path.length !== b.path.length) return a.path.length - b.path.length;
        }
        return an.localeCompare(bn);
      })
      .slice(0, 30);
    this.post({ scope: 'meta', type: 'fileList', requestId, files: items });
  }

  private async exportSession(sess: ChatSession, format: 'md' | 'json'): Promise<void> {
    const data = format === 'md' ? sess.toMarkdown() : sess.toJson();
    const title = sess.getTitle().replace(/[^a-zA-Z0-9-_]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'chat';
    const ext = format === 'md' ? '.md' : '.json';
    const defaultFileName = `${title}-${Date.now()}${ext}`;
    const ws = vscode.workspace.workspaceFolders?.[0];
    const defaultUri = ws ? vscode.Uri.joinPath(ws.uri, defaultFileName) : vscode.Uri.file(defaultFileName);
    const filters: Record<string, string[]> =
      format === 'md' ? { Markdown: ['md'] } : { JSON: ['json'] };
    const uri = await vscode.window.showSaveDialog({ defaultUri, filters, saveLabel: 'Export' });
    if (!uri) return;
    try {
      await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(data));
      this.post({
        scope: 'meta',
        type: 'toast',
        message: `Exported to ${vscode.workspace.asRelativePath(uri)}`,
        kind: 'success',
      });
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      this.post({ scope: 'meta', type: 'toast', message: 'Export failed: ' + m, kind: 'error' });
    }
  }

  private async showAttachImagePicker(sess: ChatSession): Promise<void> {
    const uris = await vscode.window.showOpenDialog({
      canSelectMany: true,
      filters: { Images: ['png', 'jpg', 'jpeg', 'gif', 'webp'] },
      title: 'Attach image(s) to chat',
      openLabel: 'Attach',
    });
    if (!uris || uris.length === 0) return;
    for (const uri of uris) {
      await sess.attachImageFromPath(uri.fsPath);
    }
  }

  private async showAttachFilePicker(sess: ChatSession): Promise<void> {
    type Item = vscode.QuickPickItem & { uri: vscode.Uri };
    const qp = vscode.window.createQuickPick<Item>();
    qp.title = 'Attach a file to this chat';
    qp.placeholder = 'Type to filter workspace files…';
    qp.matchOnDescription = true;
    qp.matchOnDetail = true;

    let queryToken = 0;
    const refresh = async (query: string): Promise<void> => {
      const token = ++queryToken;
      qp.busy = true;
      const files = await searchWorkspaceFiles(query, 500);
      if (token !== queryToken) return; // a newer keystroke superseded this
      qp.items = files.map((uri) => {
        const relative = vscode.workspace.asRelativePath(uri).replace(/\\/g, '/');
        const segments = relative.split('/');
        const name = segments[segments.length - 1];
        const dir = segments.slice(0, -1).join('/');
        return { label: name, description: dir, detail: relative, uri };
      });
      qp.busy = false;
    };

    qp.onDidChangeValue((value) => {
      void refresh(value);
    });

    const picked = await new Promise<Item | undefined>((resolve) => {
      qp.onDidAccept(() => resolve(qp.selectedItems[0]));
      qp.onDidHide(() => resolve(undefined));
      qp.show();
      void refresh('');
    });
    qp.dispose();

    if (picked) {
      await sess.attachFile({ filePath: picked.uri.fsPath, fileLabel: picked.detail ?? '' });
    }
  }

  // Public API for editor commands / git tab to open a chat tab
  async openDiffAnalysis(
    kind: SessionKind,
    diff: string,
    fileLabel: string,
    filePath: string,
  ): Promise<void> {
    const id = this.createSession(kind, fileLabel, filePath);
    const sess = this.chatSessions.get(id);
    if (!sess) return;
    this.activeTab = `chat:${id}`;
    this.postTabsState();
    await sess.startDiffAnalysis(diff);
  }

  async openCodeAnalysis(
    kind: SessionKind,
    code: string,
    languageId: string,
    fileLabel: string,
    filePath: string,
    rangeLabel: string,
  ): Promise<void> {
    const id = this.createSession(kind, fileLabel, filePath);
    const sess = this.chatSessions.get(id);
    if (!sess) return;
    this.activeTab = `chat:${id}`;
    this.postTabsState();
    await sess.startCodeAnalysis(code, languageId, rangeLabel);
  }

  private createSession(kind: SessionKind, fileLabel: string, filePath: string): string {
    this.sessionCounter++;
    const id = `s${Date.now().toString(36)}${this.sessionCounter}`;
    const sess = new ChatSession(
      id,
      kind,
      fileLabel,
      filePath,
      this.context,
      (payload) => {
        // Auto-save snapshot every time assistant finishes a turn.
        if (payload.type === 'doneAssistant') {
          const s = this.chatSessions.get(id);
          if (s && s.hasContent()) void this.saveHistorySnapshot(s.toHistoryEntry());
        }
        this.post({ scope: 'chat', ...payload } as Outbound);
      },
      () => this.postTabsState(),
    );
    this.chatSessions.set(id, sess);
    this.sessionOrder.push(id);
    return id;
  }

  private postTabsState(): void {
    const tabs = [
      { id: 'git', label: 'Git', kind: 'git', closable: false, pinned: false },
      { id: 'config', label: 'Config', kind: 'config', closable: false, pinned: false },
    ];
    for (const id of this.sessionOrder) {
      const s = this.chatSessions.get(id);
      if (s) {
        const pinned = this.pinnedSessions.has(id);
        tabs.push({
          id: `chat:${id}`,
          label: s.getTitle(),
          kind: s.kind,
          closable: !pinned,
          pinned,
        });
      }
    }
    this.post({ scope: 'tabs', type: 'state', tabs, activeTab: this.activeTab });
  }

  private async handleMeta(msg: Inbound & { scope: 'meta' }): Promise<void> {
    if (msg.type === 'ready') {
      this.post({
        scope: 'meta',
        type: 'init',
        version: this.context.extension.packageJSON.version ?? '',
      });
      await this.postConfigState();
      await this.postGitState();
      this.postTabsState();
      this.postHistoryList();
      this.postMcpState();
      this.postSkillsState();
      return;
    }
    if (msg.type === 'showLogs') {
      log.show();
      return;
    }
    if (msg.type === 'requestFileList') {
      await this.handleFileListRequest(msg.query, msg.requestId);
      return;
    }
  }

  private async handleConfig(msg: Inbound & { scope: 'config' }): Promise<void> {
    switch (msg.type) {
      case 'addProvider':
      case 'updateProvider': {
        validateConfig(msg.config);
        const others = getProviderConfigs().filter((c) => c.id !== msg.config.id);
        await setProviderConfigs([...others, msg.config]);
        if (typeof msg.apiKey === 'string' && msg.apiKey.length > 0) {
          await setApiKey(this.context, msg.config.id, msg.apiKey);
        }
        if (!getActiveProviderId()) {
          await setActiveProviderId(msg.config.id);
        }
        await this.postConfigState();
        this.post({
          scope: 'meta',
          type: 'toast',
          message: `Provider "${msg.config.id}" saved.`,
          kind: 'success',
        });
        return;
      }
      case 'deleteProvider': {
        const pick = await vscode.window.showWarningMessage(
          `Delete provider "${msg.id}"?`,
          { modal: true, detail: 'The stored API key for this provider will also be removed.' },
          'Delete',
        );
        if (pick !== 'Delete') return;
        const remaining = getProviderConfigs().filter((c) => c.id !== msg.id);
        await setProviderConfigs(remaining);
        await deleteApiKey(this.context, msg.id);
        if (getActiveProviderId() === msg.id) {
          await setActiveProviderId(remaining[0]?.id ?? '');
        }
        await this.postConfigState();
        this.post({
          scope: 'meta',
          type: 'toast',
          message: `Provider "${msg.id}" removed.`,
          kind: 'info',
        });
        return;
      }
      case 'activateProvider':
        await setActiveProviderId(msg.id);
        await this.postConfigState();
        return;
      case 'toggleEnabled':
        await setEnabled(!isEnabled());
        await this.postConfigState();
        return;
      case 'testConnection':
        await this.testConnection(msg.config, msg.apiKey);
        return;
      case 'setOutputLanguage':
        await setOutputLanguage(msg.language);
        await this.postConfigState();
        return;
      case 'setIncludeFullFile':
        await setIncludeFullFile(msg.value);
        await this.postConfigState();
        return;
      case 'setAllowWriteTools':
        await setAllowWriteTools(msg.value);
        await this.postConfigState();
        return;
      case 'setShowDiffPreview':
        await setShowDiffPreview(msg.value);
        await this.postConfigState();
        return;
      case 'setAllowShell':
        await setAllowShell(msg.value);
        await this.postConfigState();
        return;
      case 'setShellAutoApprove': {
        const clean = Array.isArray(msg.value)
          ? msg.value
              .map((s) => (typeof s === 'string' ? s.trim() : ''))
              .filter((s) => s.length > 0)
          : [];
        await setShellAutoApprove(clean);
        await this.postConfigState();
        return;
      }
      case 'setFeatureEnabled':
        await setFeature(msg.feature, { enabled: msg.value });
        await this.postConfigState();
        return;
      case 'setFeatureProvider':
        await setFeature(msg.feature, { providerId: msg.providerId });
        await this.postConfigState();
        return;
    }
  }

  private async handleGit(msg: Inbound & { scope: 'git' }): Promise<void> {
    switch (msg.type) {
      case 'selectRepo':
        this.activeRepoId = msg.repoId;
        await this.postGitState();
        return;
      case 'stage':
        await this.repoManager.stage(msg.repoId, msg.paths);
        return;
      case 'unstage':
        await this.repoManager.unstage(msg.repoId, msg.paths);
        return;
      case 'stageAll':
        await this.repoManager.stageAll(msg.repoId);
        return;
      case 'unstageAll':
        await this.repoManager.unstageAll(msg.repoId);
        return;
      case 'commit':
        await this.repoManager.commit(msg.repoId, msg.message);
        this.post({ scope: 'meta', type: 'toast', message: 'Committed.', kind: 'success' });
        this.post({ scope: 'git', type: 'commitMessage', text: '' });
        return;
      case 'generateMessage':
        await this.handleGenerate(msg.repoId);
        return;
      case 'generatePrDescription':
        await this.handleGeneratePrDescription(
          msg.repoId,
          msg.baseBranch,
          msg.instructions,
          msg.template,
        );
        return;
      case 'createPr':
        await this.handleCreatePr(
          msg.repoId, msg.serverName, msg.toolName, msg.prefixedName,
          msg.title, msg.body, msg.head, msg.base,
        );
        return;
      case 'listBranches':
        await this.handleListBranches(msg.repoId);
        return;
      case 'checkoutBranch':
        await this.handleCheckoutBranch(msg.repoId, msg.branch);
        return;
      case 'generateBranchName':
        await this.handleGenerateBranchName(msg.repoId, msg.intent);
        return;
      case 'openFile':
        await vscode.window.showTextDocument(vscode.Uri.file(msg.path));
        return;
      case 'openDiff':
        await vscode.commands.executeCommand('git.openChange', vscode.Uri.file(msg.path));
        return;
      case 'discard': {
        const label = msg.relPath ?? msg.path;
        const pick = await vscode.window.showWarningMessage(
          `Discard changes for "${label}"?`,
          { modal: true, detail: 'This cannot be undone.' },
          'Discard',
        );
        if (pick !== 'Discard') {
          // Tell the webview to clear any optimistic pending state for this path.
          this.post({ scope: 'meta', type: 'toast', message: 'Discard cancelled.', kind: 'info' });
          return;
        }
        await this.repoManager.discard(msg.repoId, msg.path);
        this.post({ scope: 'meta', type: 'toast', message: 'Changes discarded.', kind: 'info' });
        return;
      }
      case 'explainChange':
        await this.analyseChange('explain', msg.repoId, msg.path, msg.relPath, msg.staged);
        return;
      case 'reviewChange':
        await this.analyseChange('review', msg.repoId, msg.path, msg.relPath, msg.staged);
        return;
      case 'rescan':
        await this.repoManager.rescan();
        return;
    }
  }

  private async analyseChange(
    kind: 'explain' | 'review',
    repoId: string,
    filePath: string,
    relPath: string,
    staged: boolean,
  ): Promise<void> {
    const diff = await this.repoManager.getFileDiff(repoId, filePath, staged);
    if (!diff.trim()) {
      this.post({
        scope: 'meta',
        type: 'toast',
        message: 'No diff for this file (already up to date with HEAD).',
        kind: 'info',
      });
      return;
    }
    await this.openDiffAnalysis(kind, diff, relPath || filePath, filePath);
  }

  private async handleGeneratePrDescription(
    repoId: string,
    baseBranch: string,
    instructions?: string,
    template?: string,
  ): Promise<void> {
    this.generateAbort?.abort();
    const ctrl = new AbortController();
    this.generateAbort = ctrl;
    try {
      this.post({ scope: 'git', type: 'busy', busy: true, label: 'Computing diff vs base...' });
      const { diff, commitLog, branch, baseBranch: base } =
        await this.repoManager.getDiffAgainstBase(repoId, baseBranch);
      if (!diff.trim() && !commitLog.trim()) {
        this.post({
          scope: 'meta',
          type: 'toast',
          message: 'No commits or diff between HEAD and ' + base + '.',
          kind: 'error',
        });
        return;
      }
      this.post({ scope: 'git', type: 'busy', busy: true, label: 'Generating PR description...' });
      const { title, body } = await generatePrDescription(
        this.context,
        {
          diff,
          commitLog,
          branch,
          baseBranch: base,
          instructions,
          template,
        },
        ctrl.signal,
      );
      const createPrTool = this.findPrCreationTool();
      this.post({ scope: 'git', type: 'prDescription', title, body, branch, baseBranch: base, createPrTool: createPrTool || undefined });
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      this.post({ scope: 'meta', type: 'toast', message: m, kind: 'error' });
    } finally {
      this.post({ scope: 'git', type: 'busy', busy: false });
    }
  }

  private findPrCreationTool(): { serverName: string; toolName: string; prefixedName: string } | null {
    if (!this.mcpManager) return null;
    const prPatterns = ['create_pull_request', 'create_pr', 'create_merge_request'];
    for (const s of this.mcpManager.getServerSummaries()) {
      if (s.status !== 'connected') continue;
      for (const t of s.tools) {
        const lower = t.name.toLowerCase();
        if (prPatterns.some((p) => lower.includes(p))) {
          return {
            serverName: s.name,
            toolName: t.name,
            prefixedName: this.mcpManager.buildToolName(s.name, t.name),
          };
        }
      }
    }
    return null;
  }

  private async handleCreatePr(
    repoId: string,
    serverName: string,
    toolName: string,
    prefixedName: string,
    title: string,
    body: string,
    head: string,
    base: string,
  ): Promise<void> {
    this.post({ scope: 'git', type: 'busy', busy: true, label: 'Creating PR...' });
    try {
      if (!this.mcpManager) throw new Error('No MCP manager available.');
      const remoteUrl = await this.repoManager.getRemoteUrl(repoId);
      const ownerRepo = extractOwnerRepo(remoteUrl);
      const args: Record<string, unknown> = { title, body, head, base };
      if (ownerRepo.owner) args.owner = ownerRepo.owner;
      if (ownerRepo.repo) args.repo = ownerRepo.repo;

      const result = await this.mcpManager.executeTool(prefixedName, args);
      if (result.isError) {
        this.post({ scope: 'meta', type: 'toast', message: 'PR creation failed: ' + result.content, kind: 'error' });
      } else {
        const url = extractUrl(result.content);
        this.post({ scope: 'meta', type: 'toast', message: url ? `PR created: ${url}` : 'PR created successfully.', kind: 'success' });
      }
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      this.post({ scope: 'meta', type: 'toast', message: 'PR creation failed: ' + m, kind: 'error' });
    } finally {
      this.post({ scope: 'git', type: 'busy', busy: false });
    }
  }

  private async handleListBranches(repoId: string): Promise<void> {
    try {
      const branches = await this.repoManager.listBranches(repoId);
      this.post({ scope: 'git', type: 'branches', branches });
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      this.post({ scope: 'meta', type: 'toast', message: m, kind: 'error' });
    }
  }

  private async handleCheckoutBranch(repoId: string, branch: string): Promise<void> {
    try {
      await this.repoManager.checkoutBranch(repoId, branch);
      this.post({ scope: 'meta', type: 'toast', message: 'Switched to ' + branch, kind: 'success' });
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      this.post({ scope: 'meta', type: 'toast', message: m, kind: 'error' });
    }
  }

  private async handleGenerateBranchName(repoId: string, intent: string): Promise<void> {
    this.generateAbort?.abort();
    const ctrl = new AbortController();
    this.generateAbort = ctrl;
    try {
      this.post({ scope: 'git', type: 'busy', busy: true, label: 'Looking at changes...' });
      let diff = '';
      try {
        diff = await this.repoManager.getStagedDiff(repoId);
      } catch {}
      if (!diff.trim()) {
        try {
          diff = await this.repoManager.getUnstagedDiff(repoId);
        } catch {}
      }
      this.post({ scope: 'git', type: 'busy', busy: true, label: 'Suggesting branch names...' });
      const names = await generateBranchNames(this.context, { diff, intent }, ctrl.signal);
      if (names.length === 0) {
        this.post({
          scope: 'meta',
          type: 'toast',
          message: 'No usable branch names came back. Try giving an intent description.',
          kind: 'error',
        });
        return;
      }
      this.post({ scope: 'git', type: 'branchSuggestions', names });
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      this.post({ scope: 'meta', type: 'toast', message: m, kind: 'error' });
    } finally {
      this.post({ scope: 'git', type: 'busy', busy: false });
    }
  }

  private async handleGenerate(repoId: string): Promise<void> {
    this.generateAbort?.abort();
    const ctrl = new AbortController();
    this.generateAbort = ctrl;
    try {
      const diff = await this.repoManager.getStagedDiff(repoId);
      if (!diff.trim()) {
        this.post({
          scope: 'meta',
          type: 'toast',
          message: 'No staged changes. Stage some files first.',
          kind: 'error',
        });
        return;
      }
      this.post({ scope: 'git', type: 'busy', busy: true, label: 'Generating commit message...' });
      const text = await generateCommitMessage(this.context, diff, ctrl.signal);
      this.post({ scope: 'git', type: 'commitMessage', text });
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      this.post({ scope: 'meta', type: 'toast', message: m, kind: 'error' });
    } finally {
      this.post({ scope: 'git', type: 'busy', busy: false });
    }
  }

  private async testConnection(config: ProviderConfig, apiKeyOverride?: string): Promise<void> {
    log.info('test connection', {
      id: config.id,
      protocol: config.protocol,
      baseURL: config.baseURL,
      model: config.model,
    });
    if (config.protocol !== 'anthropic') {
      this.post({
        scope: 'config',
        type: 'testResult',
        success: false,
        message: `Protocol "${config.protocol}" is not implemented yet.`,
      });
      return;
    }
    const apiKey = apiKeyOverride || (await getApiKey(this.context, config.id));
    const testConfig: ProviderConfig = { ...config, maxTokens: 1 };
    const provider = new AnthropicProvider(config.id, testConfig, apiKey);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const iter = provider.complete(
        { prefix: 'hello', suffix: '', language: 'plaintext' },
        controller.signal,
      );
      for await (const _ of iter) {
        break;
      }
      log.info('test connection OK');
      this.post({ scope: 'config', type: 'testResult', success: true, message: 'Connection OK.' });
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      log.error('test connection failed', err);
      this.post({ scope: 'config', type: 'testResult', success: false, message: m });
    } finally {
      clearTimeout(timer);
    }
  }

  private async postConfigState(): Promise<void> {
    if (!this.view) return;
    const providers = getProviderConfigs();
    const apiKeyStatus: Record<string, boolean> = {};
    for (const c of providers) {
      const key = await getApiKey(this.context, c.id);
      apiKeyStatus[c.id] = !!key;
    }
    this.post({
      scope: 'config',
      type: 'state',
      providers,
      activeId: getActiveProviderId(),
      enabled: isEnabled(),
      apiKeyStatus,
      outputLanguage: getOutputLanguage(),
      supportedLanguages: SUPPORTED_OUTPUT_LANGUAGES,
      includeFullFile: getIncludeFullFile(),
      allowWriteTools: getAllowWriteTools(),
      showDiffPreview: getShowDiffPreview(),
      allowShell: getAllowShell(),
      shellAutoApprove: getShellAutoApprove(),
      features: getFeatures(),
      featureList: FEATURE_LIST,
    });
  }

  private async postGitState(): Promise<void> {
    if (!this.view) return;
    const repos = this.repoManager.listRepos();
    if (!this.activeRepoId && repos.length > 0) {
      this.activeRepoId = repos[0].id;
    } else if (this.activeRepoId && !repos.find((r) => r.id === this.activeRepoId)) {
      this.activeRepoId = repos[0]?.id ?? '';
    }
    this.post({
      scope: 'git',
      type: 'state',
      hasGit: this.repoManager.hasGit(),
      loading: this.repoManager.loading,
      repos: repos.map(serializeRepo),
      activeRepoId: this.activeRepoId,
    });
  }

  private post(payload: Outbound): void {
    this.view?.webview.postMessage(payload);
  }
}

/**
 * `vscode.workspace.getConfiguration().get()` returns a frozen/proxied object
 * tree — attempting to mutate it (set property, delete key) throws
 * `'isExtensible' on proxy: trap result does not reflect extensibility…`.
 * Deep-clone via JSON round-trip before any mutation.
 */
function cloneServers(raw: Record<string, McpServerConfigSetting> | undefined): Record<string, McpServerConfigSetting> {
  if (!raw) return {};
  return JSON.parse(JSON.stringify(raw)) as Record<string, McpServerConfigSetting>;
}

function validateConfig(c: ProviderConfig): void {
  if (!/^[a-zA-Z0-9_-]+$/.test(c.id)) {
    throw new Error('Provider ID must contain only letters, digits, "-" and "_".');
  }
  if (!c.baseURL.startsWith('http://') && !c.baseURL.startsWith('https://')) {
    throw new Error('Base URL must start with http:// or https://');
  }
  if (!c.model.trim()) {
    throw new Error('Model is required.');
  }
}

function serializeRepo(r: RepoSummary): SerializedRepo {
  return {
    id: r.id,
    rootPath: r.rootPath,
    rootName: r.rootName,
    branch: r.branch,
    ahead: r.ahead,
    behind: r.behind,
    staged: r.staged.map(serializeChange),
    unstaged: r.unstaged.map(serializeChange),
    merge: r.merge.map(serializeChange),
  };
}

function serializeChange(c: { path: string; relPath: string; status: string; staged: boolean }): SerializedChange {
  return {
    path: c.path,
    relPath: c.relPath,
    status: c.status,
    statusLabel: shortStatusLabel(c.status as any),
    staged: c.staged,
  };
}

function makeNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  for (let i = 0; i < 32; i++) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return nonce;
}

function extractOwnerRepo(url: string): { owner?: string; repo?: string } {
  if (!url) return {};
  const sshMatch = url.match(/git@[^:]+:([^/]+)\/([^.]+)(?:\.git)?$/);
  if (sshMatch) return { owner: sshMatch[1], repo: sshMatch[2] };
  const httpsMatch = url.match(/https?:\/\/[^/]+\/([^/]+)\/([^.]+)(?:\.git)?$/);
  if (httpsMatch) return { owner: httpsMatch[1], repo: httpsMatch[2] };
  return {};
}

function extractUrl(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s]+/);
  return match ? match[0] : null;
}
