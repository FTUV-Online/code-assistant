import * as vscode from 'vscode';
import { getContextLines } from '../config/settings';
import type { CompletionRequest } from '../providers/base';

export function buildContext(
  document: vscode.TextDocument,
  position: vscode.Position,
): CompletionRequest {
  const { before, after } = getContextLines();

  const startLine = Math.max(0, position.line - before);
  const endLine = Math.min(document.lineCount - 1, position.line + after);
  const lastLineLen = document.lineAt(endLine).text.length;

  const prefixRange = new vscode.Range(startLine, 0, position.line, position.character);
  const suffixRange = new vscode.Range(position.line, position.character, endLine, lastLineLen);

  return {
    prefix: document.getText(prefixRange),
    suffix: document.getText(suffixRange),
    language: document.languageId,
    filePath: vscode.workspace.asRelativePath(document.uri),
  };
}
