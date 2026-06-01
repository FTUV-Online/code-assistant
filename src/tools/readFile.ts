import * as vscode from 'vscode';
import { isBinary, matchesAnyGlob, resolveSafePath, truncate } from './common';
import type { Tool } from './types';

const MAX_CHARS = 12000;
const MAX_LINES = 500;

type Input = {
  path?: string;
  startLine?: number;
  endLine?: number;
};

export const readFileTool: Tool = {
  readonly: true,
  def: {
    name: 'read_file',
    description:
      'Read a workspace file. Returns its content with 1-based line numbers prefixed. ' +
      `Use startLine/endLine to read a slice of large files. At most ${MAX_LINES} lines are ` +
      'returned per call; if the range is larger, the result says where to resume.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative path from the workspace root (e.g. "src/foo.ts").',
        },
        startLine: { type: 'number', description: '1-based first line to include.' },
        endLine: { type: 'number', description: '1-based last line to include.' },
      },
      required: ['path'],
    },
  },
  async execute(input, ctx) {
    const { path: relPath, startLine, endLine } = (input ?? {}) as Input;
    if (!relPath || typeof relPath !== 'string') {
      return { content: 'Error: "path" is required.', isError: true };
    }
    const abs = resolveSafePath(ctx.workspaceRoot, relPath);
    if (!abs) {
      return { content: `Error: "${relPath}" resolves outside the workspace.`, isError: true };
    }
    if (matchesAnyGlob(relPath, ctx.blacklist)) {
      return {
        content: `Error: "${relPath}" is blocked by the tool-use blacklist (likely contains secrets).`,
        isError: true,
      };
    }
    let bytes: Uint8Array;
    try {
      bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(abs));
    } catch (err) {
      return {
        content: `Error reading "${relPath}": ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }
    if (isBinary(bytes)) {
      return { content: `Error: "${relPath}" appears to be a binary file.`, isError: true };
    }
    const text = new TextDecoder().decode(bytes);
    const lines = text.split('\n');
    const from = Math.max(1, startLine ?? 1);
    const requestedTo = Math.min(lines.length, endLine ?? lines.length);
    if (from > requestedTo) {
      return { content: `Error: empty range (${from}..${requestedTo}) for ${lines.length}-line file.`, isError: true };
    }
    // Cap the number of lines returned so a giant file can't blow the context.
    // The model can page through the rest via startLine/endLine.
    const to = Math.min(requestedTo, from + MAX_LINES - 1);
    const lineCapped = to < requestedTo;
    const slice = lines.slice(from - 1, to);
    const width = String(to).length;
    const numbered = slice
      .map((line, i) => `${String(from + i).padStart(width)}  ${line}`)
      .join('\n');
    const header = `${relPath} (lines ${from}-${to} of ${lines.length}):\n`;
    let footer = '';
    if (lineCapped) {
      footer = `\n... [${requestedTo - to} more lines; re-read with startLine=${to + 1} to continue]`;
    }
    return {
      content: header + truncate(numbered, MAX_CHARS) + footer,
    };
  },
};
