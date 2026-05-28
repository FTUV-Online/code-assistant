import * as vscode from 'vscode';
import { matchesAnyGlob, resolveSafePath, truncate } from './common';
import type { Tool } from './types';

const DEFAULT_MAX = 50;
const HARD_MAX = 200;
const PER_LINE_CHARS = 240;

type Input = {
  path?: string;
  line?: number;
  column?: number;
  maxResults?: number;
  includeDeclaration?: boolean;
};

export const findReferencesTool: Tool = {
  def: {
    name: 'find_references',
    description:
      'Find all references (call sites / usages) of the symbol at a given file/line/column using ' +
      'the language server. Returns one line per reference with file path, line, column and source. ' +
      'Use after locating a symbol to understand its impact before changing it.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative path of the file where the symbol is located.',
        },
        line: {
          type: 'number',
          description: '1-based line number of the symbol.',
        },
        column: {
          type: 'number',
          description: '1-based column number of the symbol identifier.',
        },
        maxResults: {
          type: 'number',
          description: 'Max references to return (default 50, max 200).',
        },
        includeDeclaration: {
          type: 'boolean',
          description: 'Whether the declaration site is included in the results. Default true.',
        },
      },
      required: ['path', 'line', 'column'],
    },
  },
  async execute(input, ctx) {
    const { path: relPath, line, column, maxResults, includeDeclaration } =
      (input ?? {}) as Input;
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
    const cap = Math.min(HARD_MAX, Math.max(1, maxResults ?? DEFAULT_MAX));
    const wantDecl = includeDeclaration !== false;

    const uri = vscode.Uri.file(abs);
    try {
      await vscode.workspace.openTextDocument(uri);
    } catch (err) {
      return {
        content: `Error opening file: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }

    const position = new vscode.Position(line - 1, column - 1);
    let locations: vscode.Location[];
    try {
      const raw = await vscode.commands.executeCommand<vscode.Location[]>(
        'vscode.executeReferenceProvider',
        uri,
        position,
      );
      locations = Array.isArray(raw) ? raw : [];
    } catch (err) {
      return {
        content: `Error querying reference provider: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }
    if (ctx.signal.aborted) return { content: 'Aborted.', isError: true };

    if (locations.length === 0) {
      return {
        content:
          `No references found for symbol at ${relPath}:${line}:${column}. ` +
          'The language server may not support this file type or has not finished indexing.',
      };
    }

    // Read each referenced file once (cache to avoid re-decoding) and emit source line.
    const fileCache = new Map<string, string[] | null>();
    const out: string[] = [];
    let skippedBlacklist = 0;
    let skippedDecl = 0;

    for (const loc of locations) {
      if (out.length >= cap) break;
      const rel = vscode.workspace.asRelativePath(loc.uri).replace(/\\/g, '/');
      if (matchesAnyGlob(rel, ctx.blacklist)) {
        skippedBlacklist++;
        continue;
      }
      const isDecl =
        loc.uri.fsPath === abs &&
        loc.range.start.line === position.line &&
        Math.abs(loc.range.start.character - position.character) <= 1;
      if (isDecl && !wantDecl) {
        skippedDecl++;
        continue;
      }

      let lines = fileCache.get(loc.uri.toString());
      if (lines === undefined) {
        try {
          const bytes = await vscode.workspace.fs.readFile(loc.uri);
          lines = new TextDecoder().decode(bytes).split('\n');
        } catch {
          lines = null;
        }
        fileCache.set(loc.uri.toString(), lines);
      }
      const ln = loc.range.start.line;
      const col = loc.range.start.character + 1;
      const source = lines && ln < lines.length ? lines[ln].slice(0, PER_LINE_CHARS).trim() : '';
      const marker = isDecl ? ' [declaration]' : '';
      out.push(`${rel}:${ln + 1}:${col}${marker}  ${source}`);
    }

    const notes: string[] = [];
    if (out.length >= cap) notes.push(`hit max ${cap}`);
    if (skippedBlacklist) notes.push(`${skippedBlacklist} skipped by blacklist`);
    if (skippedDecl) notes.push(`${skippedDecl} declaration(s) hidden`);
    const noteStr = notes.length ? `\n... [${notes.join('; ')}]` : '';

    return { content: truncate(out.join('\n'), 10000) + noteStr };
  },
};
