import * as vscode from 'vscode';
import { isSkipDir, resolveSafePath } from './common';
import type { Tool } from './types';

const MAX_ENTRIES = 200;

type Input = { path?: string };

export const listDirTool: Tool = {
  def: {
    name: 'list_dir',
    description:
      'List entries (files and directories) in a workspace directory. ' +
      'Skips common build / dependency dirs.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative path from workspace root. Default: "." (workspace root).',
        },
      },
      required: [],
    },
  },
  async execute(input, ctx) {
    const relPath = (input as Input | undefined)?.path ?? '.';
    const abs = resolveSafePath(ctx.workspaceRoot, relPath);
    if (!abs) {
      return { content: `Error: "${relPath}" resolves outside the workspace.`, isError: true };
    }
    let entries: [string, vscode.FileType][];
    try {
      entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(abs));
    } catch (err) {
      return {
        content: `Error reading directory: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }
    const filtered = entries
      .filter(([name]) => !isSkipDir(name))
      .map(([name, type]) => {
        const isDir = (type & vscode.FileType.Directory) !== 0;
        return { name, isDir };
      })
      .sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

    if (filtered.length === 0) return { content: '(empty)' };

    const lines = filtered.slice(0, MAX_ENTRIES).map((e) => `${e.isDir ? 'd' : 'f'} ${e.name}`);
    const more =
      filtered.length > MAX_ENTRIES ? `\n... ${filtered.length - MAX_ENTRIES} more entries` : '';
    return { content: `${relPath}:\n` + lines.join('\n') + more };
  },
};
