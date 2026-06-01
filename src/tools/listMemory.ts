import { listMemories } from '../memory/manager';
import type { Tool } from './types';

export const listMemoryTool: Tool = {
  readonly: true,
  def: {
    name: 'list_memory',
    description:
      'List all stored memory entries with their name, type and one-line description. ' +
      'Usually unnecessary — the index is already injected into your system prompt. ' +
      'Use this only if you suspect the index is stale (e.g. after write_memory).',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  async execute() {
    const entries = await listMemories();
    if (entries.length === 0) return { content: '(no memories stored)' };
    const lines = entries.map((e) => `- ${e.name} _(${e.type})_ — ${e.description}`);
    return { content: lines.join('\n') };
  },
};
