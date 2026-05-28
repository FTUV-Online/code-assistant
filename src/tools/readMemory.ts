import { readMemory } from '../memory/manager';
import type { Tool } from './types';

type Input = { name?: string };

export const readMemoryTool: Tool = {
  def: {
    name: 'read_memory',
    description:
      'Load the full content of a memory entry by name. The list of available memories ' +
      'is shown in the system prompt at session start. Use this when a memory description ' +
      'looks relevant to the current task.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Memory name (kebab-case slug from the index).' },
      },
      required: ['name'],
    },
  },
  async execute(input) {
    const { name } = (input ?? {}) as Input;
    if (!name || typeof name !== 'string') {
      return { content: 'Error: "name" is required.', isError: true };
    }
    const entry = await readMemory(name);
    if (!entry) {
      return { content: `Memory "${name}" not found.`, isError: true };
    }
    return {
      content:
        `# Memory: ${entry.name} (${entry.type})\n` +
        `${entry.description}\n\n` +
        entry.body,
    };
  },
};
