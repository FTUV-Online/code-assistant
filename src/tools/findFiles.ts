import * as vscode from 'vscode';
import { TOOL_SKIP_GLOB, matchesAnyGlob } from './common';
import type { Tool } from './types';

const DEFAULT_MAX = 50;
const HARD_MAX = 500;

type Input = { glob?: string; max?: number };

export const findFilesTool: Tool = {
  def: {
    name: 'find_files',
    description:
      'Find files in the workspace by glob pattern. ' +
      'Common build / dependency directories are excluded automatically.',
    input_schema: {
      type: 'object',
      properties: {
        glob: { type: 'string', description: 'Glob, e.g. "**/*.ts" or "src/**/foo*".' },
        max: { type: 'number', description: 'Max files to return (default 50, max 500).' },
      },
      required: ['glob'],
    },
  },
  async execute(input, ctx) {
    const { glob, max } = (input ?? {}) as Input;
    if (!glob || typeof glob !== 'string') {
      return { content: 'Error: "glob" is required.', isError: true };
    }
    const cap = Math.min(HARD_MAX, Math.max(1, max ?? DEFAULT_MAX));
    let files: vscode.Uri[];
    try {
      files = await vscode.workspace.findFiles(glob, TOOL_SKIP_GLOB, cap * 2);
    } catch (err) {
      return {
        content: `Error: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }
    const allowed = files
      .map((u) => vscode.workspace.asRelativePath(u))
      .filter((rel) => !matchesAnyGlob(rel, ctx.blacklist))
      .slice(0, cap)
      .sort();
    if (allowed.length === 0) return { content: `No files match ${glob}.` };
    const note = allowed.length >= cap ? `\n... [hit max ${cap}; refine glob to see more]` : '';
    return { content: allowed.join('\n') + note };
  },
};
