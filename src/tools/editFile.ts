import * as vscode from 'vscode';
import { getShowDiffPreview } from '../config/settings';
import { isBinary, matchesAnyGlob, resolveSafePath } from './common';
import { isSessionApproved, requestToolApproval } from './confirmation';
import { openLiveDiffPreview, showDiffPreview } from './diffPreview';
import { applyEdits, type FindReplace, type ApplyEditsResult } from './editLogic';
import { applyLazyEdit, isLazyEdit } from './lazyEdit';
import { applyUnifiedDiff, isUnifiedDiff } from './unifiedDiff';
import type { Tool, ToolExecutionContext } from './types';

type Input = {
  path?: string;
  edits?: FindReplace[];
};

function fullDocumentRange(document: vscode.TextDocument): vscode.Range {
  const lastLine = Math.max(0, document.lineCount - 1);
  return new vscode.Range(0, 0, lastLine, document.lineAt(lastLine).text.length);
}

/**
 * Shared approval + write flow used by both regular edits and lazy edits.
 */
async function doApplyEdit(
  relPath: string,
  abs: string,
  original: string,
  applied: ApplyEditsResult,
  ctx: ToolExecutionContext,
): Promise<{ content: string; isError?: boolean }> {
  if (!applied.ok) {
    return { content: 'Error: ' + applied.error, isError: true };
  }

  if (applied.result === original) {
    return { content: 'No-op: edits produced no change.' };
  }

  const netDelta = applied.result.length - original.length;

  const wantDiff = !isSessionApproved('edit_file') && getShowDiffPreview();
  let closeDiff: (() => Promise<void>) | undefined;
  if (wantDiff) {
    closeDiff = await showDiffPreview({
      relPath,
      original,
      proposed: applied.result,
      isNewFile: false,
    });
  }

  let outcome: 'approve' | 'deny';
  try {
    outcome = await requestToolApproval(
      ctx,
      'edit_file',
      `Apply to ${relPath}?`,
      `${netDelta >= 0 ? '+' : ''}${netDelta} chars net change.` +
        (wantDiff
          ? ' Review the diff in the editor before approving.'
          : ' Review the diff in VS Code before approving if unsure.'),
    );
  } finally {
    if (closeDiff) await closeDiff();
  }
  if (outcome === 'deny') {
    return { content: 'Denied by user.', isError: true };
  }

  try {
    const uri = vscode.Uri.file(abs);
    const document = await vscode.workspace.openTextDocument(uri);
    const edit = new vscode.WorkspaceEdit();
    edit.replace(uri, fullDocumentRange(document), applied.result);
    const appliedToWorkspace = await vscode.workspace.applyEdit(edit);
    if (!appliedToWorkspace) {
      return {
        content: `Error applying edit to "${relPath}" in the VS Code workspace.`,
        isError: true,
      };
    }
    const saved = document.isDirty ? await document.save() : true;
    if (!saved) {
      return {
        content: `Error saving "${relPath}" after applying edits.`,
        isError: true,
      };
    }
    let suffix = '';
    if (applied.fuzzyMatch && applied.similarity !== undefined) {
      suffix = ` (fuzzy, similarity: ${applied.similarity.toFixed(2)})`;
    }
    return {
      content: `OK: applied ${applied.appliedCount} edits to ${relPath} (net ${netDelta >= 0 ? '+' : ''}${netDelta} chars)${suffix}.`,
    };
  } catch (err) {
    return {
      content: `Error writing file: ${err instanceof Error ? err.message : String(err)}`,
      isError: true,
    };
  }
}

export const editFileTool: Tool = {
  destructive: true,
  gateFlag: 'allowWriteTools',
  def: {
    name: 'edit_file',
    description:
      'Make precise find/replace edits to an existing file. By default each "find" must match ' +
      'exactly once (include enough surrounding context to be unambiguous). The matcher tolerates ' +
      'LF vs CRLF line endings and trailing spaces at end of lines, but still expects a specific ' +
      'snippet rather than short generic tokens like a lone closing tag. For symbol renames or ' +
      'version bumps where the same token appears repeatedly, set "replaceAll": true on that edit ' +
      'to update every occurrence in one shot — this is the preferred pattern over multiple edits ' +
      'with extra context. ' +
      'For large files, you may use "lazy" editing: include "// ... existing code ..." comments ' +
      'for unchanged sections — the system fills them in automatically. ' +
      'Each lazy placeholder needs context lines above and below. ' +
      'Unified diff format (@@ headers) is also accepted and will be applied automatically. ' +
      'Asks the user for approval before writing.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative path from workspace root.',
        },
        edits: {
          type: 'array',
          description: 'Ordered list of find/replace operations.',
          items: {
            type: 'object',
            properties: {
              find: {
                type: 'string',
                minLength: 1,
                description:
                  'Text to find. Matching is exact except for LF/CRLF differences and trailing spaces at line ends. Include enough surrounding context to make the snippet unique.',
              },
              replace: { type: 'string', description: 'Replacement text.' },
              replaceAll: {
                type: 'boolean',
                description:
                  'When true, replace every occurrence of "find" in the file. Default false (require unique match).',
              },
            },
            required: ['find', 'replace'],
          },
        },
      },
      required: ['path', 'edits'],
    },
  },
  async execute(input, ctx) {
    const { path: relPath, edits } = (input ?? {}) as Input;
    if (!relPath || typeof relPath !== 'string') {
      return { content: 'Error: "path" is required.', isError: true };
    }
    if (!Array.isArray(edits) || edits.length === 0) {
      return { content: 'Error: "edits" must be a non-empty array.', isError: true };
    }
    const abs = resolveSafePath(ctx.workspaceRoot, relPath);
    if (!abs) {
      return { content: `Error: "${relPath}" resolves outside the workspace.`, isError: true };
    }
    if (matchesAnyGlob(relPath, ctx.blacklist)) {
      return { content: `Error: "${relPath}" is blacklisted.`, isError: true };
    }

    let original: string;
    try {
      const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(abs));
      if (isBinary(bytes)) {
        return { content: `Error: "${relPath}" appears to be binary.`, isError: true };
      }
      original = new TextDecoder().decode(bytes);
    } catch (err) {
      return {
        content: `Error reading file: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }

    // Detect lazy edit: when there is exactly one edit and its "find" looks
    // like lazy code (contains "// ... existing code ..." placeholders),
    // expand it against the original file first.
    if (edits.length === 1 && isLazyEdit(edits[0].find)) {
      const lazyApplied = applyLazyEdit(original, edits[0].find);
      if (!lazyApplied.ok) {
        return { content: `Error: ${lazyApplied.error}`, isError: true };
      }
      // Convert expanded lazy edit to a full-file find/replace
      const fullEdit = applyEdits(original, [
        { find: original, replace: lazyApplied.result },
      ]);
      return await doApplyEdit(relPath, abs, original, fullEdit, ctx);
    }

    // Detect unified diff: if edits[0].find looks like @@-style diff,
    // apply via unified diff parser instead of find/replace.
    if (edits.length === 1 && isUnifiedDiff(edits[0].find)) {
      const diffApplied = applyUnifiedDiff(original, edits[0].find);
      if (!diffApplied.ok) {
        return { content: `Error: ${diffApplied.error}`, isError: true };
      }
      const fullEdit = applyEdits(original, [
        { find: original, replace: diffApplied.result },
      ]);
      return await doApplyEdit(relPath, abs, original, fullEdit, ctx);
    }

    // Standard find/replace edits — use streaming preview for multiple edits
    if (edits.length > 1) {
      return await executeWithStreamingDiff(relPath, abs, original, edits, ctx);
    }

    // Single edit: use existing fast path
    const applied = applyEdits(original, edits);
    return await doApplyEdit(relPath, abs, original, applied, ctx);
  },
};

/**
 * Execute multiple edits with a streaming diff preview.
 * Opens the diff tab immediately and updates it progressively as each edit
 * is applied, giving the user a real-time feel of changes accumulating.
 */
async function executeWithStreamingDiff(
  relPath: string,
  abs: string,
  original: string,
  edits: FindReplace[],
  ctx: ToolExecutionContext,
): Promise<{ content: string; isError?: boolean }> {
  const wantDiff = !isSessionApproved('edit_file') && getShowDiffPreview();
  let streamingPreview: Awaited<ReturnType<typeof openLiveDiffPreview>> | null = null;

  // Apply edits progressively, updating the preview after each one
  let currentContent = original;
  let appliedCount = 0;
  let lastSimilarity: number | undefined;
  let fuzzyMatched = false;

  for (let i = 0; i < edits.length; i++) {
    const piece = applyEdits(currentContent, [edits[i]]);
    if (!piece.ok) {
      return { content: `Edit #${i + 1} failed: ${piece.error}`, isError: true };
    }
    appliedCount++;
    currentContent = piece.result;

    if (piece.fuzzyMatch && piece.similarity !== undefined) {
      fuzzyMatched = true;
      lastSimilarity = piece.similarity;
    }

    // Update the streaming diff preview after each edit
    if (wantDiff) {
      if (!streamingPreview) {
        streamingPreview = await openLiveDiffPreview({
          relPath,
          original,
          proposed: currentContent,
          isNewFile: false,
        });
      } else {
        streamingPreview.updateProposed(currentContent);
      }
    }
  }

  if (currentContent === original) {
    if (streamingPreview) await streamingPreview.close();
    return { content: 'No-op: edits produced no change.' };
  }

  const netDelta = currentContent.length - original.length;

  // Ask for approval
  let outcome: 'approve' | 'deny';
  try {
    outcome = await requestToolApproval(
      ctx,
      'edit_file',
      `Apply ${appliedCount} edit${appliedCount > 1 ? 's' : ''} to ${relPath}?`,
      `${netDelta >= 0 ? '+' : ''}${netDelta} chars net change.` +
        (wantDiff ? ' Review the live diff in the editor.' : ''),
    );
  } finally {
    if (streamingPreview) await streamingPreview.close();
  }

  if (outcome === 'deny') {
    return { content: 'Denied by user.', isError: true };
  }

  // Write final result
  try {
    const uri = vscode.Uri.file(abs);
    const document = await vscode.workspace.openTextDocument(uri);
    const edit = new vscode.WorkspaceEdit();
    edit.replace(uri, fullDocumentRange(document), currentContent);
    const appliedToWorkspace = await vscode.workspace.applyEdit(edit);
    if (!appliedToWorkspace) {
      return {
        content: `Error applying edit to "${relPath}" in the VS Code workspace.`,
        isError: true,
      };
    }
    const saved = document.isDirty ? await document.save() : true;
    if (!saved) {
      return {
        content: `Error saving "${relPath}" after applying edits.`,
        isError: true,
      };
    }
    let suffix = '';
    if (fuzzyMatched && lastSimilarity !== undefined) {
      suffix = ` (at least one fuzzy, min similarity: ${lastSimilarity.toFixed(2)})`;
    }
    return {
      content: `OK: applied ${appliedCount} edits to ${relPath} (net ${netDelta >= 0 ? '+' : ''}${netDelta} chars)${suffix}.`,
    };
  } catch (err) {
    return {
      content: `Error writing file: ${err instanceof Error ? err.message : String(err)}`,
      isError: true,
    };
  }
}
