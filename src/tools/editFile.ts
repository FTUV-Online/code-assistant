import * as vscode from 'vscode';
import { isBinary, matchesAnyGlob, resolveSafePath } from './common';
import { confirmDestructive } from './confirmation';
import { applyEdits, type FindReplace } from './editLogic';
import type { Tool } from './types';

type Input = {
  path?: string;
  edits?: FindReplace[];
};

export const editFileTool: Tool = {
  destructive: true,
  gateFlag: 'allowWriteTools',
  def: {
    name: 'edit_file',
    description:
      'Make precise find/replace edits to an existing file. Each "find" must match exactly once ' +
      '(include enough surrounding context to be unambiguous). Asks the user for approval before writing.',
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
              find: { type: 'string', description: 'Exact text to find (verbatim, including whitespace).' },
              replace: { type: 'string', description: 'Replacement text.' },
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
    const outcome = await confirmDestructive(
      'edit_file',
      summary,
      `${applied.result.length - original.length >= 0 ? '+' : ''}${applied.result.length - original.length} chars net change. ` +
        `Review the diff in VS Code before approving if unsure.`,
    );
    if (outcome === 'deny') {
      return { content: 'Denied by user.', isError: true };
    }

    try {
      await vscode.workspace.fs.writeFile(
        vscode.Uri.file(abs),
        new TextEncoder().encode(applied.result),
      );
      return {
        content: `OK: applied ${applied.appliedCount} edits to ${relPath} (net ${
          applied.result.length - original.length >= 0 ? '+' : ''
        }${applied.result.length - original.length} chars).`,
      };
    } catch (err) {
      return {
        content: `Error writing file: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }
  },
};
