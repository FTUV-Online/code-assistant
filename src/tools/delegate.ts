import { truncate } from './common';
import type { Tool } from './types';

type Input = { task?: string };

export const delegateResearchTool: Tool = {
  def: {
    name: 'delegate_research',
    description:
      'Delegate an investigation task to an autonomous sub-agent. The sub-agent has independent access ' +
      'to read_file / grep / list_dir / find_files and returns a single summary. ' +
      'Use this when you need to explore many files or topics that would clutter the main conversation. ' +
      'The sub-agent cannot delegate further (no recursion).',
    input_schema: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description:
            'Clear, self-contained research question. Include any context the sub-agent will need ' +
            '(e.g. file names, symbols, expected output format). The sub-agent has no knowledge of ' +
            'the current conversation.',
        },
      },
      required: ['task'],
    },
  },
  async execute(input, ctx) {
    const { task } = (input ?? {}) as Input;
    if (!task || typeof task !== 'string' || !task.trim()) {
      return { content: 'Error: "task" is required.', isError: true };
    }
    if (!ctx.runSubAgent) {
      return {
        content: 'Error: sub-agent execution is not available in this context.',
        isError: true,
      };
    }
    try {
      const result = await ctx.runSubAgent(task, ctx.signal);
      if (!result || !result.trim()) {
        return { content: '(sub-agent returned no answer)' };
      }
      return { content: truncate(result, 12000) };
    } catch (err) {
      return {
        content: `Sub-agent failed: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }
  },
};
