import { writeMemory } from '../memory/manager';
import type { MemoryType } from '../memory/types';
import type { Tool } from './types';

type Input = {
  name?: string;
  description?: string;
  type?: string;
  body?: string;
};

const VALID_TYPES: MemoryType[] = ['user', 'feedback', 'project', 'reference'];

export const writeMemoryTool: Tool = {
  def: {
    name: 'write_memory',
    description:
      'Persist a memory entry across sessions. Use sparingly for durable signals ONLY: ' +
      'user preferences (e.g. "user prefers Vietnamese for explanations"), ' +
      'corrections the user gave you ("don\'t use grep when find_symbol works"), ' +
      'project facts not derivable from the code ("this repo deploys to Azure App Service via pipeline X"), ' +
      'or external references ("API docs at https://..."). ' +
      'Do NOT save ephemeral conversation state, code that can be re-read, or recap of what just happened.\n' +
      'Types: ' +
      '"user" (who they are / how they like to work), ' +
      '"feedback" (rules from corrections + reason), ' +
      '"project" (durable project facts, why), ' +
      '"reference" (pointers to external docs/dashboards).',
    input_schema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description:
            'Short kebab-case slug (a-z, 0-9, dash, underscore). E.g. "user-vietnamese", "vdc-deploy-pipeline".',
        },
        description: {
          type: 'string',
          description:
            'One-line summary shown in the index. Be specific — future-you uses this to decide whether to recall.',
        },
        type: {
          type: 'string',
          enum: VALID_TYPES,
          description: 'Memory type (see tool description for guidance).',
        },
        body: {
          type: 'string',
          description:
            'Full memory content (markdown). For feedback/project: include "Why:" and "How to apply:" lines.',
        },
      },
      required: ['name', 'description', 'type', 'body'],
    },
  },
  async execute(input) {
    const { name, description, type, body } = (input ?? {}) as Input;
    if (!name || typeof name !== 'string') {
      return { content: 'Error: "name" is required.', isError: true };
    }
    if (!description || typeof description !== 'string') {
      return { content: 'Error: "description" is required.', isError: true };
    }
    if (!type || typeof type !== 'string') {
      return { content: 'Error: "type" is required.', isError: true };
    }
    if (typeof body !== 'string') {
      return { content: 'Error: "body" must be a string.', isError: true };
    }
    if (!(VALID_TYPES as string[]).includes(type)) {
      return {
        content: `Error: "type" must be one of: ${VALID_TYPES.join(', ')}.`,
        isError: true,
      };
    }
    const result = await writeMemory({
      name,
      description,
      type: type as MemoryType,
      body,
    });
    if (!result.ok) {
      return { content: 'Error: ' + result.error, isError: true };
    }
    const verb = result.created ? 'Created' : 'Updated';
    return { content: `${verb} memory "${name}" (${type}).` };
  },
};
