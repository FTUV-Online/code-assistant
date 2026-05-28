import * as path from 'path';
import * as vscode from 'vscode';
import { getShowDiffPreview } from '../config/settings';
import { isBinary, matchesAnyGlob, resolveSafePath } from './common';
import { isSessionApproved, requestToolApproval } from './confirmation';
import { showDiffPreview } from './diffPreview';
import type { Tool } from './types';

const MAX_WRITE_CHARS = 200_000;

type Input = {
  path?: string;
  content?: string;
};

export const writeFileTool: Tool = {
  destructive: true,
  gateFlag: 'allowWriteTools',
  def: {
    name: 'write_file',
    description:
      'Create or overwrite a workspace file. Asks the user for approval before writing. ' +
      'Use sparingly — prefer edit_file for changes to existing files.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative path from workspace root.',
        },
        content: {
          type: 'string',
          description: 'Full file content to write.',
        },
      },
      required: ['path', 'content'],
    },
  },
  async execute(input, ctx) {
    const { path: relPath, content } = (input ?? {}) as Input;
    if (!relPath || typeof relPath !== 'string') {
      return { content: 'Error: "path" is required.', isError: true };
    }
    if (typeof content !== 'string') {
      return { content: 'Error: "content" must be a string.', isError: true };
    }
    if (content.length > MAX_WRITE_CHARS) {
      return {
        content: `Error: content too large (${content.length} chars, limit ${MAX_WRITE_CHARS}).`,
        isError: true,
      };
    }
    const abs = resolveSafePath(ctx.workspaceRoot, relPath);
    if (!abs) {
      return { content: `Error: "${relPath}" resolves outside the workspace.`, isError: true };
    }
    if (matchesAnyGlob(relPath, ctx.blacklist)) {
      return { content: `Error: "${relPath}" is blacklisted.`, isError: true };
    }

    let exists = false;
    let originalContent = '';
    let originalIsBinary = false;
    try {
      const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(abs));
      exists = true;
      if (isBinary(bytes)) {
        originalIsBinary = true;
      } else {
        originalContent = new TextDecoder().decode(bytes);
      }
    } catch {
      /* doesn't exist */
    }
    const verb = exists ? 'overwrite' : 'create';
    const lines = content.split('\n').length;
    const sizeKb = (content.length / 1024).toFixed(1);

    const wantDiff =
      !isSessionApproved('write_file') && getShowDiffPreview() && !originalIsBinary;
    let closeDiff: (() => Promise<void>) | undefined;
    if (wantDiff) {
      closeDiff = await showDiffPreview({
        relPath,
        original: originalContent,
        proposed: content,
        isNewFile: !exists,
      });
    }

    let outcome: 'approve' | 'deny';
    try {
      outcome = await requestToolApproval(
        ctx,
        'write_file',
        `${verb} ${relPath} (${sizeKb} KB, ${lines} lines)?`,
        exists
          ? `Existing file will be replaced. ${
              wantDiff ? 'Review the diff in the editor.' : 'Approve only if the new content is what you want.'
            }`
          : `A new file will be created at this path.${
              wantDiff ? ' Review the diff in the editor.' : ''
            }`,
      );
    } finally {
      if (closeDiff) await closeDiff();
    }
    if (outcome === 'deny') {
      return { content: 'Denied by user.', isError: true };
    }

    try {
      // Ensure parent dir exists
      const dir = path.dirname(abs);
      try {
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(dir));
      } catch {
        /* may already exist */
      }
      await vscode.workspace.fs.writeFile(
        vscode.Uri.file(abs),
        new TextEncoder().encode(content),
      );
      return { content: `OK: ${verb}d ${relPath} (${content.length} chars)` };
    } catch (err) {
      return {
        content: `Error writing file: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }
  },
};
