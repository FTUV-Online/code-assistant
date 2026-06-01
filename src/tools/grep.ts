import * as vscode from 'vscode';
import { TOOL_SKIP_GLOB, isBinary, matchesAnyGlob, truncate } from './common';
import type { Tool } from './types';

const DEFAULT_MAX = 50;
const HARD_MAX = 200;
const PER_LINE_CHARS = 240;
const MAX_FILES_SCANNED = 3000;

type Input = {
  pattern?: string;
  glob?: string;
  maxResults?: number;
  caseSensitive?: boolean;
};

export const grepTool: Tool = {
  readonly: true,
  def: {
    name: 'grep',
    description:
      'Search file contents in the workspace using a JavaScript regular expression. ' +
      'Returns matching lines with file path and line number. ' +
      'Case-insensitive by default. Pass a glob to limit which files are scanned.',
    input_schema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'JavaScript regex.' },
        glob: {
          type: 'string',
          description: 'Optional include glob (e.g. "src/**/*.ts").',
        },
        maxResults: {
          type: 'number',
          description: 'Max matches to return (default 50, max 200).',
        },
        caseSensitive: { type: 'boolean', description: 'Default false.' },
      },
      required: ['pattern'],
    },
  },
  async execute(input, ctx) {
    const { pattern, glob, maxResults, caseSensitive } = (input ?? {}) as Input;
    if (!pattern || typeof pattern !== 'string') {
      return { content: 'Error: "pattern" is required.', isError: true };
    }
    let regex: RegExp;
    try {
      regex = new RegExp(pattern, caseSensitive ? '' : 'i');
    } catch (err) {
      return {
        content: `Error: invalid regex: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }
    const cap = Math.min(HARD_MAX, Math.max(1, maxResults ?? DEFAULT_MAX));

    let files: vscode.Uri[];
    try {
      files = await vscode.workspace.findFiles(glob || '**/*', TOOL_SKIP_GLOB, MAX_FILES_SCANNED);
    } catch (err) {
      return {
        content: `Error listing files: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }

    const matches: string[] = [];
    let scanned = 0;
    let skippedBlacklist = 0;
    for (const uri of files) {
      if (ctx.signal.aborted) break;
      if (matches.length >= cap) break;
      const rel = vscode.workspace.asRelativePath(uri);
      if (matchesAnyGlob(rel, ctx.blacklist)) {
        skippedBlacklist++;
        continue;
      }
      scanned++;
      try {
        const bytes = await vscode.workspace.fs.readFile(uri);
        if (isBinary(bytes)) continue;
        const text = new TextDecoder().decode(bytes);
        const lines = text.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (regex.test(lines[i])) {
            const trimmedLine = lines[i].slice(0, PER_LINE_CHARS);
            matches.push(`${rel}:${i + 1}: ${trimmedLine}`);
            if (matches.length >= cap) break;
          }
        }
      } catch {
        /* skip unreadable files */
      }
    }

    if (matches.length === 0) {
      const note = skippedBlacklist > 0 ? `, ${skippedBlacklist} skipped by blacklist` : '';
      return {
        content: `No matches for /${pattern}/${caseSensitive ? '' : 'i'} (scanned ${scanned} files${note}).`,
      };
    }
    const note =
      matches.length >= cap
        ? `\n... [hit max ${cap} results; tighten the pattern or glob to see more]`
        : '';
    return { content: truncate(matches.join('\n'), 8000) + note };
  },
};
