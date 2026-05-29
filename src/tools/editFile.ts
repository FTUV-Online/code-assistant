import * as vscode from 'vscode';
import { getShowDiffPreview } from '../config/settings';
import { isBinary, matchesAnyGlob, resolveSafePath } from './common';
import { isSessionApproved, requestToolApproval } from './confirmation';
import { showDiffPreview } from './diffPreview';
import { applyEdits, type FindReplace } from './editLogic';
import type { Tool } from './types';

type Input = {
  path?: string;
  edits?: FindReplace[];
};

function fullDocumentRange(document: vscode.TextDocument): vscode.Range {
  const lastLine = Math.max(0, document.lineCount - 1);
  return new vscode.Range(0, 0, lastLine, document.lineAt(lastLine).text.length);
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
      'with extra context. Asks the user for approval before writing.',
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

    const applied = applyEdits(original, edits);
    if (!applied.ok) {
      return { content: 'Error: ' + applied.error, isError: true };
    }

    if (applied.result === original) {
      return { content: 'No-op: edits produced no change.' };
    }

    const summary = `Apply ${edits.length} edit${edits.length === 1 ? '' : 's'} to ${relPath}?`;
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
        summary,
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
      return {
        content: `OK: applied ${applied.appliedCount} edits to ${relPath} (net ${netDelta >= 0 ? '+' : ''}${netDelta} chars).`,
      };
    } catch (err) {
      return {
        content: `Error writing file: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }
  },
};

