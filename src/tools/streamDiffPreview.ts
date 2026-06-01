/**
 * Inline diff decorations for VS Code — shows green/red annotations directly
 * in the editor instead of opening a full diff tab.
 *
 * This is useful for quick edits where a full side-by-side diff tab would be
 * too heavyweight. The decorations show insertions (green) and deletions (red)
 * with +/- gutter markers.
 *
 * Reuses the `dev-code-preview` content provider registered by diffPreview.ts
 * for live preview updates when a diff tab is already open.
 */

import * as vscode from 'vscode';
import type { DiffLine, DiffStats } from './streamDiff';
import { computeDiff, computeDiffStats } from './streamDiff';
import * as log from '../util/logger';

const SCHEME = 'dev-code-preview';

/**
 * Create a set of VS Code decorations (green insertions, red deletions)
 * in the given editor. Used for inline previews within the current file.
 *
 * @returns A Disposable that removes all decorations when disposed.
 */
export function createInlineDiffDecorations(
  editor: vscode.TextEditor,
  diffLines: DiffLine[],
): vscode.Disposable {
  const removedDecoration = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: 'rgba(255, 0, 0, 0.1)',
    before: {
      contentText: '- ',
      color: 'rgba(255, 0, 0, 0.6)',
    },
  });
  const addedDecoration = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: 'rgba(0, 255, 0, 0.08)',
    before: {
      contentText: '+ ',
      color: 'rgba(0, 255, 0, 0.6)',
    },
  });

  const removedRanges: vscode.Range[] = [];
  const addedRanges: vscode.Range[] = [];

  for (let i = 0; i < diffLines.length; i++) {
    const dl = diffLines[i];
    if (dl.type === 'old') {
      removedRanges.push(new vscode.Range(i, 0, i, 0));
    } else if (dl.type === 'new') {
      addedRanges.push(new vscode.Range(i, 0, i, 0));
    }
  }

  editor.setDecorations(removedDecoration, removedRanges);
  editor.setDecorations(addedDecoration, addedRanges);

  return {
    dispose: () => {
      removedDecoration.dispose();
      addedDecoration.dispose();
    },
  };
}

/**
 * Show a quick inline diff in the currently active editor, opening
 * the file and creating temporary decorations.
 *
 * Decorations are automatically removed after `durationMs` (default 15s)
 * or when the user starts typing.
 */
export async function showInlineDiff(
  relPath: string,
  original: string,
  proposed: string,
  durationMs = 15000,
): Promise<void> {
  const oldLines = original.split('\n');
  const newLines = proposed.split('\n');
  const diffLines = computeDiff(oldLines, newLines);

  try {
    const uri = vscode.Uri.file(relPath);
    const document = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(document, { preserveFocus: true });
    const decoration = createInlineDiffDecorations(editor, diffLines);

    // Auto-remove after timeout
    const timeout = setTimeout(() => decoration.dispose(), durationMs);

    // Remove on next edit (user typing)
    const editListener = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === uri.toString()) {
        decoration.dispose();
        clearTimeout(timeout);
        editListener.dispose();
      }
    });

    // Composite disposable that cleans up both listeners
    const disposable = vscode.Disposable.from(
      { dispose: () => { decoration.dispose(); clearTimeout(timeout); editListener.dispose(); } },
    );
    // If the caller wants early cleanup, they can call disposable.dispose()
    // Stash it so it's not lost
    if (!(globalThis as any).__devCodeInlineDiffDisposables) {
      (globalThis as any).__devCodeInlineDiffDisposables = new Set<vscode.Disposable>();
    }
    (globalThis as any).__devCodeInlineDiffDisposables.add(disposable);
  } catch (err) {
    log.warn('showInlineDiff failed', err);
  }
}

/**
 * Update the proposed content of a `dev-code-preview` diff tab.
 * This searches open diff tabs for one matching the given relPath and
 * updates its proposed side content.
 *
 * This is a convenience wrapper that can be used from anywhere without
 * needing to keep a reference to the openLiveDiffPreview object.
 */
export function updateProposedContent(relPath: string, proposed: string): void {
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      const input = tab.input;
      if (
        input instanceof vscode.TabInputTextDiff &&
        input.modified.scheme === SCHEME &&
        input.modified.path.includes(relPath.replace(/\\/g, '/')) &&
        input.modified.path.includes('/proposed/')
      ) {
        // The content provider will handle the update via onDidChange
        // We trigger a document edit to the modified side
        vscode.workspace.openTextDocument(input.modified).then((doc) => {
          const edit = new vscode.WorkspaceEdit();
          const fullRange = new vscode.Range(0, 0, doc.lineCount, 0);
          edit.replace(input.modified, fullRange, proposed);
          vscode.workspace.applyEdit(edit);
        });
        return;
      }
    }
  }
}

export type { DiffLine, DiffStats } from './streamDiff';
export { computeDiff, computeDiffStats } from './streamDiff';
