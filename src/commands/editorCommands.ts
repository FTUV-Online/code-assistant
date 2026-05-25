import * as vscode from 'vscode';
import { isFeatureEnabled } from '../config/settings';
import { runInlineEdit } from '../editor/inlineEdit';
import type { CodeAnalysisKind } from '../ui/chatSession';
import type { MainViewProvider } from '../ui/mainView';
import * as log from '../util/logger';

export function registerEditorCommands(
  context: vscode.ExtensionContext,
  mainView: MainViewProvider,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('devCode.explainCode', () =>
      runOnSelection(mainView, 'explain'),
    ),
    vscode.commands.registerCommand('devCode.reviewCode', () =>
      runOnSelection(mainView, 'review'),
    ),
    vscode.commands.registerCommand('devCode.rewriteCode', () =>
      runOnSelection(mainView, 'rewrite'),
    ),
    vscode.commands.registerCommand(
      'devCode.lens.explain',
      (uri: vscode.Uri, range: vscode.Range) => runOnRange(mainView, 'explain', uri, range),
    ),
    vscode.commands.registerCommand(
      'devCode.lens.review',
      (uri: vscode.Uri, range: vscode.Range) => runOnRange(mainView, 'review', uri, range),
    ),
    vscode.commands.registerCommand('devCode.inlineEdit', () => runInlineEdit(context)),
  );
}

async function runOnRange(
  mainView: MainViewProvider,
  kind: CodeAnalysisKind,
  uri: vscode.Uri,
  range: vscode.Range,
): Promise<void> {
  if (!isFeatureEnabled(kind)) {
    vscode.window.showInformationMessage(
      `dev-code: the "${kind}" feature is disabled. Enable it in the Config tab.`,
    );
    return;
  }
  const doc = await vscode.workspace.openTextDocument(uri);
  const code = doc.getText(range);
  if (!code.trim()) {
    vscode.window.showInformationMessage('dev-code: empty range.');
    return;
  }
  const languageId = doc.languageId;
  const fileLabel = vscode.workspace.asRelativePath(uri);
  const filePath = uri.fsPath;
  const startLine = range.start.line + 1;
  const endLine = range.end.line + 1;
  const rangeLabel = startLine === endLine ? `line ${startLine}` : `lines ${startLine}-${endLine}`;
  log.info('lens command', { kind, file: fileLabel, range: rangeLabel, chars: code.length });
  await vscode.commands.executeCommand('devCode.mainView.focus').then(undefined, () => {});
  await mainView.openCodeAnalysis(kind, code, languageId, fileLabel, filePath, rangeLabel);
}

async function runOnSelection(mainView: MainViewProvider, kind: CodeAnalysisKind): Promise<void> {
  if (!isFeatureEnabled(kind)) {
    vscode.window.showInformationMessage(
      `dev-code: the "${kind}" feature is disabled. Enable it in the Config tab.`,
    );
    return;
  }
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showInformationMessage('dev-code: open a file and select some code first.');
    return;
  }
  if (editor.selection.isEmpty) {
    vscode.window.showInformationMessage('dev-code: select some code first.');
    return;
  }

  const sel = editor.selection;
  const code = editor.document.getText(sel);
  if (!code.trim()) {
    vscode.window.showInformationMessage('dev-code: the selection is empty.');
    return;
  }

  const languageId = editor.document.languageId;
  const fileLabel = vscode.workspace.asRelativePath(editor.document.uri);
  const filePath = editor.document.uri.fsPath;
  const startLine = sel.start.line + 1;
  const endLine = sel.end.line + 1;
  const rangeLabel = startLine === endLine ? `line ${startLine}` : `lines ${startLine}-${endLine}`;

  log.info('editor command', { kind, file: fileLabel, range: rangeLabel, chars: code.length });

  // Focus the dev-code view so the new chat tab is visible.
  await vscode.commands.executeCommand('devCode.mainView.focus').then(undefined, () => {
    /* command may not be available pre-activation; ignore */
  });

  await mainView.openCodeAnalysis(kind, code, languageId, fileLabel, filePath, rangeLabel);
}
