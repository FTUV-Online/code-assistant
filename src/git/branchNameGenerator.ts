import type * as vscode from 'vscode';
import * as log from '../util/logger';
import { getProviderForFeature } from '../providers/manager';
import { parseBranchSuggestions } from './branchNameParser';
export { parseBranchSuggestions, cleanBranchName } from './branchNameParser';

const SYSTEM_PROMPT = [
  'You are a senior engineer suggesting short git branch names.',
  'Rules:',
  '- Output ONLY a JSON array of 3 strings — no markdown, no commentary.',
  '- Each name must use lowercase kebab-case, max 60 chars.',
  '- Use a conventional prefix when appropriate (feat/, fix/, refactor/, chore/, docs/, test/).',
  '- The name should describe the change concisely; do not include dates or ticket numbers unless given.',
  '- Avoid spaces, slashes beyond the prefix, and special characters except hyphens and one slash for the prefix.',
  '- Example output: ["feat/inline-edit-cmdk","refactor/chat-session-tokens","fix/git-windows-paths"]',
].join('\n');

const MAX_DIFF_CHARS = 8000;

export async function generateBranchNames(
  context: vscode.ExtensionContext,
  opts: { diff: string; intent: string },
  signal: AbortSignal,
): Promise<string[]> {
  const provider = await getProviderForFeature(context, 'branchName');
  if (!provider) {
    throw new Error(
      'No provider configured for "branchName". Configure one in the Config tab.',
    );
  }

  const diffTruncated = opts.diff.length > MAX_DIFF_CHARS;
  const userParts: string[] = [];
  if (opts.intent.trim()) {
    userParts.push('Intent / description from the user:', opts.intent.trim(), '');
  }
  if (opts.diff.trim()) {
    userParts.push(
      'Current diff (for context):',
      '```diff',
      diffTruncated ? opts.diff.slice(0, MAX_DIFF_CHARS) + '\n... [truncated]' : opts.diff,
      '```',
    );
  }
  if (userParts.length === 0) {
    userParts.push('No diff or intent provided. Suggest 3 generic branch names for a new task.');
  }

  log.info('branch name: requesting', {
    provider: provider.id,
    diffChars: opts.diff.length,
    hasIntent: !!opts.intent.trim(),
  });

  const t0 = Date.now();
  const chunks: string[] = [];
  for await (const chunk of provider.chat(
    [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userParts.join('\n') },
    ],
    { maxTokens: 200, temperature: 0.4 },
    signal,
  )) {
    chunks.push(chunk);
  }
  const raw = chunks.join('').trim();
  log.info('branch name: ready', { ms: Date.now() - t0, chars: raw.length });
  return parseBranchSuggestions(raw);
}

