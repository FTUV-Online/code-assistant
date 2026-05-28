import * as vscode from 'vscode';
import { matchesAnyGlob, truncate } from './common';
import type { Tool } from './types';

const DEFAULT_MAX = 30;
const HARD_MAX = 100;

type Input = {
  query?: string;
  maxResults?: number;
  kind?: string;
};

const SYMBOL_KIND_NAMES: Record<number, string> = {
  [vscode.SymbolKind.File]: 'file',
  [vscode.SymbolKind.Module]: 'module',
  [vscode.SymbolKind.Namespace]: 'namespace',
  [vscode.SymbolKind.Package]: 'package',
  [vscode.SymbolKind.Class]: 'class',
  [vscode.SymbolKind.Method]: 'method',
  [vscode.SymbolKind.Property]: 'property',
  [vscode.SymbolKind.Field]: 'field',
  [vscode.SymbolKind.Constructor]: 'constructor',
  [vscode.SymbolKind.Enum]: 'enum',
  [vscode.SymbolKind.Interface]: 'interface',
  [vscode.SymbolKind.Function]: 'function',
  [vscode.SymbolKind.Variable]: 'variable',
  [vscode.SymbolKind.Constant]: 'constant',
  [vscode.SymbolKind.String]: 'string',
  [vscode.SymbolKind.Number]: 'number',
  [vscode.SymbolKind.Boolean]: 'boolean',
  [vscode.SymbolKind.Array]: 'array',
  [vscode.SymbolKind.Object]: 'object',
  [vscode.SymbolKind.Key]: 'key',
  [vscode.SymbolKind.Null]: 'null',
  [vscode.SymbolKind.EnumMember]: 'enum-member',
  [vscode.SymbolKind.Struct]: 'struct',
  [vscode.SymbolKind.Event]: 'event',
  [vscode.SymbolKind.Operator]: 'operator',
  [vscode.SymbolKind.TypeParameter]: 'type-param',
};

function kindName(kind: vscode.SymbolKind): string {
  return SYMBOL_KIND_NAMES[kind] ?? `kind-${kind}`;
}

export const findSymbolTool: Tool = {
  def: {
    name: 'find_symbol',
    description:
      'Find code symbols (classes, functions, methods, variables, etc.) across the workspace ' +
      'using the language servers VS Code already has loaded. Returns name, kind, file path and line. ' +
      'Prefer this over grep when you know you are looking for a definition by name.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Symbol name (or fragment). Empty string returns the top symbols the indexer knows about.',
        },
        kind: {
          type: 'string',
          description:
            'Optional kind filter (case-insensitive): class, function, method, interface, enum, struct, variable, constant, property, field, constructor, namespace, module.',
        },
        maxResults: {
          type: 'number',
          description: 'Max results to return (default 30, max 100).',
        },
      },
      required: ['query'],
    },
  },
  async execute(input, ctx) {
    const { query, kind, maxResults } = (input ?? {}) as Input;
    if (typeof query !== 'string') {
      return { content: 'Error: "query" must be a string.', isError: true };
    }
    const cap = Math.min(HARD_MAX, Math.max(1, maxResults ?? DEFAULT_MAX));

    let symbols: vscode.SymbolInformation[];
    try {
      const raw = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
        'vscode.executeWorkspaceSymbolProvider',
        query,
      );
      symbols = Array.isArray(raw) ? raw : [];
    } catch (err) {
      return {
        content: `Error querying symbol provider: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }
    if (ctx.signal.aborted) return { content: 'Aborted.', isError: true };

    const wantKind = kind?.toLowerCase().trim();

    const rows: string[] = [];
    let skippedBlacklist = 0;
    let filteredByKind = 0;
    for (const sym of symbols) {
      if (rows.length >= cap) break;
      const rel = vscode.workspace.asRelativePath(sym.location.uri).replace(/\\/g, '/');
      if (matchesAnyGlob(rel, ctx.blacklist)) {
        skippedBlacklist++;
        continue;
      }
      const kn = kindName(sym.kind);
      if (wantKind && kn !== wantKind) {
        filteredByKind++;
        continue;
      }
      const line = sym.location.range.start.line + 1;
      const col = sym.location.range.start.character + 1;
      const container = sym.containerName ? ` (in ${sym.containerName})` : '';
      rows.push(`${kn} ${sym.name}${container} — ${rel}:${line}:${col}`);
    }

    if (rows.length === 0) {
      const notes: string[] = [];
      if (skippedBlacklist) notes.push(`${skippedBlacklist} skipped by blacklist`);
      if (filteredByKind) notes.push(`${filteredByKind} filtered by kind`);
      if (symbols.length === 0) {
        notes.push('language servers may not have indexed this workspace yet — open a file to warm them up');
      }
      const noteStr = notes.length ? ` (${notes.join('; ')})` : '';
      return { content: `No matching symbols for "${query}"${noteStr}.` };
    }

    const truncatedNote =
      symbols.length > rows.length + skippedBlacklist + filteredByKind
        ? `\n... [${symbols.length - rows.length - skippedBlacklist - filteredByKind} more truncated; refine the query]`
        : '';
    return { content: truncate(rows.join('\n'), 8000) + truncatedNote };
  },
};
