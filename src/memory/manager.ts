import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { parseSimpleYaml } from '../skills/parser';
import * as log from '../util/logger';
import type { MemoryEntry, MemorySummary, MemoryType } from './types';

const MEMORY_DIR_NAME = path.join('.dev-code', 'memory');
const INDEX_FILE = 'MEMORY.md';
const VALID_TYPES: ReadonlySet<MemoryType> = new Set(['user', 'feedback', 'project', 'reference']);
const MAX_BODY_CHARS = 20_000;

export function getMemoryDir(): string {
  return path.join(os.homedir(), MEMORY_DIR_NAME);
}

function memoryFilePath(name: string): string {
  return path.join(getMemoryDir(), `${name}.md`);
}

function indexPath(): string {
  return path.join(getMemoryDir(), INDEX_FILE);
}

function sanitizeName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  if (!/^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$/i.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

async function ensureDir(): Promise<void> {
  const dirUri = vscode.Uri.file(getMemoryDir());
  try {
    await vscode.workspace.fs.createDirectory(dirUri);
  } catch {
    /* may already exist */
  }
}

async function readTextFile(absPath: string): Promise<string | null> {
  try {
    const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(absPath));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

async function writeTextFile(absPath: string, content: string): Promise<void> {
  await ensureDir();
  await vscode.workspace.fs.writeFile(
    vscode.Uri.file(absPath),
    new TextEncoder().encode(content),
  );
}

function parseMemoryFile(content: string, filePath: string): MemoryEntry | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return null;
  const fm = parseSimpleYaml(match[1]);
  const body = match[2].trim();
  const name = fm.name;
  const description = fm.description;
  const typeRaw = (fm.type || '').trim();
  if (!name || !description) return null;
  const type: MemoryType = VALID_TYPES.has(typeRaw as MemoryType)
    ? (typeRaw as MemoryType)
    : 'project';
  return { name, description, type, body, filePath };
}

export async function listMemories(): Promise<MemorySummary[]> {
  const dirUri = vscode.Uri.file(getMemoryDir());
  let entries: [string, vscode.FileType][];
  try {
    entries = await vscode.workspace.fs.readDirectory(dirUri);
  } catch {
    return [];
  }
  const out: MemorySummary[] = [];
  for (const [name, fileType] of entries) {
    if ((fileType & vscode.FileType.File) === 0) continue;
    if (!name.endsWith('.md')) continue;
    if (name === INDEX_FILE) continue;
    const content = await readTextFile(path.join(getMemoryDir(), name));
    if (!content) continue;
    const parsed = parseMemoryFile(content, path.join(getMemoryDir(), name));
    if (parsed) {
      out.push({ name: parsed.name, description: parsed.description, type: parsed.type });
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

export async function readMemory(name: string): Promise<MemoryEntry | null> {
  const safe = sanitizeName(name);
  if (!safe) return null;
  const content = await readTextFile(memoryFilePath(safe));
  if (!content) return null;
  return parseMemoryFile(content, memoryFilePath(safe));
}

export type WriteMemoryInput = {
  name: string;
  description: string;
  type: MemoryType;
  body: string;
};

export type WriteMemoryResult =
  | { ok: true; filePath: string; created: boolean }
  | { ok: false; error: string };

export async function writeMemory(input: WriteMemoryInput): Promise<WriteMemoryResult> {
  const safe = sanitizeName(input.name);
  if (!safe) {
    return {
      ok: false,
      error:
        'Invalid "name". Use kebab-case alphanumeric (e.g. "user-prefers-vietnamese"). ' +
        'Allowed chars: a-z, 0-9, "-", "_".',
    };
  }
  if (!input.description || !input.description.trim()) {
    return { ok: false, error: '"description" is required.' };
  }
  if (!VALID_TYPES.has(input.type)) {
    return {
      ok: false,
      error: `"type" must be one of: ${[...VALID_TYPES].join(', ')}.`,
    };
  }
  if (typeof input.body !== 'string') {
    return { ok: false, error: '"body" must be a string.' };
  }
  if (input.body.length > MAX_BODY_CHARS) {
    return {
      ok: false,
      error: `"body" too large (${input.body.length} chars, limit ${MAX_BODY_CHARS}).`,
    };
  }

  const file = memoryFilePath(safe);
  const existed = (await readTextFile(file)) !== null;
  const safeDescription = input.description.replace(/\r?\n/g, ' ').trim();
  const content =
    `---\n` +
    `name: ${safe}\n` +
    `description: ${safeDescription}\n` +
    `type: ${input.type}\n` +
    `---\n\n` +
    input.body.trim() +
    '\n';
  try {
    await writeTextFile(file, content);
    await refreshIndex();
    log.info('memory written', { name: safe, type: input.type, created: !existed });
    return { ok: true, filePath: file, created: !existed };
  } catch (err) {
    return {
      ok: false,
      error: `Failed to write memory: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export async function deleteMemory(name: string): Promise<{ ok: boolean; error?: string }> {
  const safe = sanitizeName(name);
  if (!safe) return { ok: false, error: 'Invalid name.' };
  const file = memoryFilePath(safe);
  try {
    await vscode.workspace.fs.delete(vscode.Uri.file(file));
    await refreshIndex();
    log.info('memory deleted', { name: safe });
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: `Failed to delete memory: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function refreshIndex(): Promise<void> {
  const entries = await listMemories();
  const lines = ['# dev-code memory index', ''];
  if (entries.length === 0) {
    lines.push('_No memories yet._');
  } else {
    for (const e of entries) {
      lines.push(`- [${e.name}](${e.name}.md) — _(${e.type})_ ${e.description}`);
    }
  }
  await writeTextFile(indexPath(), lines.join('\n') + '\n');
}

/**
 * Build the system-prompt snippet that lists all known memories so the AI
 * can decide whether to recall any of them via read_memory.
 */
export async function buildMemoryPromptSection(): Promise<string> {
  const entries = await listMemories();
  if (entries.length === 0) return '';
  const lines = [
    'Your persistent memory store has the following entries (use read_memory to load full content):',
  ];
  for (const e of entries) {
    lines.push(`- ${e.name} _(${e.type})_ — ${e.description}`);
  }
  lines.push(
    'When you learn something durable about the user or project (preferences, conventions, ' +
      'corrections), save it via write_memory so future sessions retain it.',
  );
  return lines.join('\n');
}
