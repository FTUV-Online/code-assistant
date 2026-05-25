import { getSkillManager } from './registry';
import type { Tool } from './types';

type Input = { name?: string };

export const loadSkillTool: Tool = {
  def: {
    name: 'load_skill',
    description:
      'Load the full instructions for a user-defined skill. Call this when one of the skills ' +
      "listed in the system prompt matches the user's task. Returns the skill's body.",
    input_schema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'The skill name (must match one listed under "Available skills").',
        },
      },
      required: ['name'],
    },
  },
  async execute(input) {
    const { name } = (input ?? {}) as Input;
    if (!name || typeof name !== 'string') {
      return { content: 'Error: "name" is required.', isError: true };
    }
    const mgr = getSkillManager();
    if (!mgr) {
      return { content: 'Error: skills are not initialized.', isError: true };
    }
    const skill = mgr.getByName(name);
    if (!skill) {
      const available = mgr
        .getAll()
        .map((s) => s.name)
        .join(', ');
      return {
        content: `Error: skill "${name}" not found.${available ? ` Available: ${available}` : ' (no skills installed)'}`,
        isError: true,
      };
    }
    return {
      content: `# Skill: ${skill.name}\n\n${skill.body}`,
    };
  },
};
