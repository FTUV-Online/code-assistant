import { gitRun } from '../git/gitCli';
import { matchesAnyGlob, resolveSafePath } from './common';
import type { Tool } from './types';

type Input = {
  file?: string;
  limit?: number;
};

const DEFAULT_LIMIT = 20;
const HARD_MAX = 100;

export const gitLogTool: Tool = {
  readonly: true,
  def: {
    name: 'git_log',
    description:
      'Show recent git commits in the workspace, optionally filtered by file path. ' +
      'Returns lines formatted as: <hash>  <YYYY-MM-DD>  <author>  <subject>',
    input_schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          description: 'Optional relative file path to limit history to commits touching that file.',
        },
        limit: {
          type: 'number',
          description: 'Max commits to return (default 20, max 100).',
        },
      },
      required: [],
    },
  },
  async execute(input, ctx) {
    const { file, limit } = (input ?? {}) as Input;
    const max = Math.min(HARD_MAX, Math.max(1, limit ?? DEFAULT_LIMIT));
    const args = ['log', `-n${max}`, '--pretty=format:%h|%an|%ai|%s', '--no-merges'];
    if (file) {
      const safe = resolveSafePath(ctx.workspaceRoot, file);
      if (!safe) {
        return { content: `Error: "${file}" resolves outside the workspace.`, isError: true };
      }
      if (matchesAnyGlob(file, ctx.blacklist)) {
        return { content: `Error: "${file}" is blacklisted.`, isError: true };
      }
      args.push('--', file);
    }
    try {
      const stdout = await gitRun(ctx.workspaceRoot, args);
      if (!stdout.trim()) return { content: '(no commits)' };
      const formatted = stdout
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .map((line) => {
          const [hash, author, date, ...subjectParts] = line.split('|');
          const subject = subjectParts.join('|');
          const shortDate = (date || '').slice(0, 10);
          return `${hash}  ${shortDate}  ${author}  ${subject}`;
        })
        .join('\n');
      return { content: formatted };
    } catch (err) {
      return {
        content: `Error: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }
  },
};
