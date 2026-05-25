import * as vscode from 'vscode';
import * as log from '../util/logger';
import { parseSkill } from './parser';
import type { Skill } from './types';

export { parseSimpleYaml, parseSkill } from './parser';

const SKILL_DIRS = ['.dev-code/skills', '.claude/skills'];

export async function loadAllSkills(): Promise<Skill[]> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders) return [];
  const out: Skill[] = [];
  for (const folder of folders) {
    for (const dir of SKILL_DIRS) {
      const dirUri = vscode.Uri.joinPath(folder.uri, dir);
      try {
        out.push(...(await loadFromDir(dirUri)));
      } catch {
        // dir may not exist — silently skip
      }
    }
  }
  // De-dup by name (workspace precedence: .dev-code/skills wins over .claude/skills)
  const seen = new Set<string>();
  const unique: Skill[] = [];
  for (const s of out) {
    if (seen.has(s.name)) continue;
    seen.add(s.name);
    unique.push(s);
  }
  log.info('skills loaded', { count: unique.length });
  return unique;
}

async function loadFromDir(dirUri: vscode.Uri): Promise<Skill[]> {
  let entries: [string, vscode.FileType][];
  try {
    entries = await vscode.workspace.fs.readDirectory(dirUri);
  } catch {
    return [];
  }
  const skills: Skill[] = [];
  for (const [name, type] of entries) {
    if (name.startsWith('.')) continue;
    if ((type & vscode.FileType.File) !== 0 && name.endsWith('.md')) {
      const fileUri = vscode.Uri.joinPath(dirUri, name);
      const skill = await loadFromFile(fileUri);
      if (skill) skills.push(skill);
    } else if ((type & vscode.FileType.Directory) !== 0) {
      // Claude Code style: <name>/SKILL.md
      const fileUri = vscode.Uri.joinPath(dirUri, name, 'SKILL.md');
      const skill = await loadFromFile(fileUri);
      if (skill) skills.push(skill);
    }
  }
  return skills;
}

async function loadFromFile(uri: vscode.Uri): Promise<Skill | null> {
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    const text = new TextDecoder().decode(bytes);
    return parseSkill(text, uri.fsPath);
  } catch (err) {
    log.warn('skill load failed', { path: uri.fsPath });
    return null;
  }
}

