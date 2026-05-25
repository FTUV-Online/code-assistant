import * as vscode from 'vscode';
import { isEnabled, isFeatureEnabled } from '../config/settings';

export class DevCodeActionProvider implements vscode.CodeActionProvider {
  static readonly providedCodeActionKinds = [
    vscode.CodeActionKind.RefactorRewrite,
    vscode.CodeActionKind.QuickFix,
  ];

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
  ): vscode.CodeAction[] {
    if (!isEnabled()) return [];
    if (document.uri.scheme !== 'file') return [];
    if (range.isEmpty) return [];

    const actions: vscode.CodeAction[] = [];

    if (isFeatureEnabled('explain')) {
      actions.push(
        this.makeAction('✨ Explain with dev-code', 'devCode.explainCode', vscode.CodeActionKind.RefactorRewrite),
      );
    }
    if (isFeatureEnabled('review')) {
      actions.push(
        this.makeAction('✨ Review with dev-code', 'devCode.reviewCode', vscode.CodeActionKind.RefactorRewrite),
      );
    }
    if (isFeatureEnabled('rewrite')) {
      actions.push(
        this.makeAction('✨ Rewrite with dev-code', 'devCode.rewriteCode', vscode.CodeActionKind.RefactorRewrite),
      );
    }

    // If the selection covers a diagnostic, surface review as a Quick Fix too.
    if (context.diagnostics.length > 0 && isFeatureEnabled('review')) {
      const fix = this.makeAction(
        '✨ Ask dev-code to fix this',
        'devCode.reviewCode',
        vscode.CodeActionKind.QuickFix,
      );
      fix.diagnostics = [...context.diagnostics];
      actions.push(fix);
    }

    return actions;
  }

  private makeAction(
    title: string,
    command: string,
    kind: vscode.CodeActionKind,
  ): vscode.CodeAction {
    const a = new vscode.CodeAction(title, kind);
    a.command = { title, command };
    return a;
  }
}
