import * as vscode from 'vscode';
import { registerEditorCommands } from './commands/editorCommands';
import { DevCodeInlineProvider } from './completion/inlineProvider';
import { getMcpToken } from './config/secrets';
import { getMcpDisabledTools, getMcpServers } from './config/settings';
import { DevCodeActionProvider } from './editor/codeActionProvider';
import { DevCodeLensProvider } from './editor/codeLensProvider';
import { RepoManager } from './git/repoManager';
import { McpManager } from './mcp/manager';
import { SkillManager } from './skills/manager';
import { setMcpManager, setSkillManager } from './tools/registry';
import { MainViewProvider } from './ui/mainView';
import { registerSetupWizard } from './ui/setupWizard';
import { createStatusBar } from './ui/statusBar';
import * as log from './util/logger';

async function readMcpTokens(
  context: vscode.ExtensionContext,
  serverNames: string[],
): Promise<Record<string, string>> {
  const tokens: Record<string, string> = {};
  for (const name of serverNames) {
    const token = await getMcpToken(context, name);
    if (token) tokens[name] = token;
  }
  return tokens;
}

async function reconfigureMcp(
  context: vscode.ExtensionContext,
  mcpManager: McpManager,
): Promise<void> {
  const servers = getMcpServers();
  const tokens = await readMcpTokens(context, Object.keys(servers));
  mcpManager.setDisabledTools(getMcpDisabledTools());
  await mcpManager.configure(servers, tokens);
  await mcpManager.connectAll();
}

export function activate(context: vscode.ExtensionContext): void {
  log.initLogger(context);
  log.info('extension activated');

  const inlineProvider = new DevCodeInlineProvider(context);

  context.subscriptions.push(
    vscode.languages.registerInlineCompletionItemProvider({ pattern: '**' }, inlineProvider),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('devCode.showLogs', () => log.show()),
  );

  registerSetupWizard(context);

  const statusBar = createStatusBar(context);
  context.subscriptions.push(statusBar);

  const repoManager = new RepoManager();
  context.subscriptions.push({ dispose: () => repoManager.dispose() });
  void repoManager.init().catch((err) => log.error('git init failed', err));

  const skillManager = new SkillManager();
  setSkillManager(skillManager);
  context.subscriptions.push({ dispose: () => skillManager.dispose() });
  void skillManager.init().catch((err) => log.error('skill init failed', err));

  const mcpManager = new McpManager();
  setMcpManager(mcpManager);
  context.subscriptions.push({ dispose: () => void mcpManager.dispose() });
  // Configure + connect in background.
  void reconfigureMcp(context, mcpManager).catch((err) => log.error('mcp init failed', err));

  const mainView = new MainViewProvider(context, repoManager, mcpManager, skillManager);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(MainViewProvider.viewType, mainView),
  );

  registerEditorCommands(context, mainView);

  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider({ scheme: 'file' }, new DevCodeLensProvider()),
    vscode.languages.registerCodeActionsProvider(
      { scheme: 'file' },
      new DevCodeActionProvider(),
      { providedCodeActionKinds: DevCodeActionProvider.providedCodeActionKinds },
    ),
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('devCode')) {
        inlineProvider.refresh();
        statusBar.refresh();
        mainView.refresh();
      }
      if (e.affectsConfiguration('devCode.mcp.servers')) {
        void reconfigureMcp(context, mcpManager).catch((err) =>
          log.error('mcp reconfigure failed', err),
        );
      }
    }),
  );
}

export function deactivate(): void {
  // Nothing to clean up beyond context.subscriptions
}
