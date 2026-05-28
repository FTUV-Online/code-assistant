import * as vscode from 'vscode';
import { matchesAnyGlob, resolveSafePath, truncate } from './common';
import type { Tool } from './types';

const SNIPPET_LINES = 3;

type Input = {
  path?: string;
  line?: number;
  column?: number;
};

type LocationLike = vscode.Location | vscode.LocationLink;

function normalizeLocation(loc: LocationLike): { uri: vscode.Uri; range: vscode.Range } {
  if ('targetUri' in loc) {
    return { uri: loc.targetUri, range: loc.targetSelectionRange ?? loc.targetRange };
  }
  return { uri: loc.uri, range: loc.range };
}

async function readSnippet(uri: vscode.Uri, range: vscode.Range): Promise<string> {
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    const text = new TextDecoder().decode(bytes);
    const lines = text.split('\n');
    const start = Math.max(0, range.start.line);
    const end = Math.min(lines.length - 1, start + SNIPPET_LINES - 1);
    const out: string[] = [];
    for (let i = start; i <= end; i++) {
      out.push(`${i + 1}: ${lines[i].slice(0, 240)}`);
    }
    return out.join('\n');
  } catch {
    return '';
  }
}

export const gotoDefinitionTool: Tool = {
  def: {
    name: 'goto_definition',
    description:
      'Resolve the definition of the symbol at a given file/line/column using the language server. ' +
      'Useful after grep or find_symbol to follow an identifier to where it is declared. ' +
      'Returns location(s) plus a short snippet of the definition.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative path of the file containing the call site / reference.',
        },
        line: {
          type: 'number',
          description: '1-based line number where the symbol appears.',
        },
        column: {
          type: 'number',
          description: '1-based column number pointing at the symbol identifier.',
        },
      },
      required: ['path', 'line', 'column'],
    },
  },
  async execute(input, ctx) {
    const { path: relPath, line, column } = (input ?? {}) as Input;
    if (!relPath || typeof relPath !== 'string') {
      return { content: 'Error: "path" is required.', isError: true };
    }
    if (typeof line !== 'number' || line < 1) {
      return { content: 'Error: "line" must be a positive integer (1-based).', isError: true };
    }
    if (typeof column !== 'number' || column < 1) {
      return { content: 'Error: "column" must be a positive integer (1-based).', isError: true };
    }
    const abs = resolveSafePath(ctx.workspaceRoot, relPath);
    if (!abs) {
      return { content: `Error: "${relPath}" resolves outside the workspace.`, isError: true };
    }
    if (matchesAnyGlob(relPath, ctx.blacklist)) {
      return { content: `Error: "${relPath}" is blacklisted.`, isError: true };
    }

    const uri = vscode.Uri.file(abs);
    // Open the document so the language server is loaded for it.
    try {
      await vscode.workspace.openTextDocument(uri);
    } catch (err) {
      return {
        content: `Error opening file: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }

    const position = new vscode.Position(line - 1, column - 1);

    let locs: LocationLike[];
    try {
      const raw = await vscode.commands.executeCommand<LocationLike[]>(
        'vscode.executeDefinitionProvider',
        uri,
        position,
      );
      locs = Array.isArray(raw) ? raw : [];
    } catch (err) {
      return {
        content: `Error querying definition provider: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }
    if (ctx.signal.aborted) return { content: 'Aborted.', isError: true };

    if (locs.length === 0) {
      return {
        content:
          `No definition found at ${relPath}:${line}:${column}. ` +
          'The language server may not support this file type or has not finished indexing.',
      };
    }

    const out: string[] = [];
    let skippedBlacklist = 0;
    for (const loc of locs) {
      const { uri: targetUri, range } = normalizeLocation(loc);
      const rel = vscode.workspace.asRelativePath(targetUri).replace(/\\/g, '/');
      if (matchesAnyGlob(rel, ctx.blacklist)) {
        skippedBlacklist++;
        continue;
      }
      const lineNum = range.start.line + 1;
      const colNum = range.start.character + 1;
      const snippet = await readSnippet(targetUri, range);
      out.push(`${rel}:${lineNum}:${colNum}` + (snippet ? `\n${snippet}` : ''));
    }

    if (out.length === 0) {
      return {
        content: `Definition(s) found but blacklisted (${skippedBlacklist}).`,
      };
    }
    return { content: truncate(out.join('\n\n'), 8000) };
  },
};
