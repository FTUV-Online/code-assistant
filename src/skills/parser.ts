import type { Skill } from './types';

export function parseSkill(content: string, filePath: string): Skill | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return null;
  const fm = parseSimpleYaml(match[1]);
  const body = match[2].trim();
  const name = fm.name;
  const description = fm.description;
  if (!name || !description) return null;
  return {
    name,
    description,
    body,
    filePath,
    source: 'workspace',
  };
}

/** Minimal single-line "key: value" YAML parser. Strips surrounding quotes/brackets. */
export function parseSimpleYaml(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '');
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^([a-zA-Z_][a-zA-Z0-9_-]*):\s*(.*)$/);
    if (!m) continue;
    let value = m[2];
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (value.startsWith('[') && value.endsWith(']')) {
      value = value.slice(1, -1);
    }
    result[m[1]] = value;
  }
  return result;
}
